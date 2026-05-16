import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { claimPurchaseIntoBuyerSets } from '@/lib/inventory'

// POST /api/inventory/buyer-claim
//
// Called from the marketplace checkout right after a purchase succeeds.
// For each matching row in any of the buyer's sets (same year + brand +
// card #) that isn't already marked Owned, fills in Owned=Yes plus the
// buyer's bookkeeping fields (Cost, Date Purchased, Purchased From,
// Grading Co + Grade or Raw Grade, photos when blank).
//
// Rows already Owned are NEVER overwritten — buyer's call to manually
// adjust if they upgraded condition. Buyers with no matching set rows
// see no changes; the call is a no-op.
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { purchase_id?: string }
  const purchaseId = body.purchase_id
  if (!purchaseId) return NextResponse.json({ error: 'Missing purchase_id' }, { status: 400 })

  // Service-role client for cross-user reads (listing belongs to seller,
  // we need to read it from the buyer's request).
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: purchase } = await admin
    .from('purchases')
    .select('id, listing_id, buyer_id, seller_id, item_price')
    .eq('id', purchaseId)
    .maybeSingle()
  if (!purchase) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
  if (purchase.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: listing } = await admin
    .from('listings')
    .select('id, year, brand, card_number, condition_type, raw_grade, grading_company, grade, photos')
    .eq('id', purchase.listing_id)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

  const { data: sellerProfile } = await admin
    .from('user_profiles')
    .select('display_name, handle')
    .eq('user_id', purchase.seller_id)
    .maybeSingle()
  const sellerLabel = sellerProfile?.display_name || sellerProfile?.handle || null

  const updated = await claimPurchaseIntoBuyerSets(admin, {
    buyerUserId: user.id,
    year: listing.year,
    brand: listing.brand,
    cardNumber: listing.card_number,
    condition_type: listing.condition_type,
    raw_grade: listing.raw_grade,
    grading_company: listing.grading_company,
    grade: listing.grade,
    purchasePrice: purchase.item_price != null ? Number(purchase.item_price) : null,
    sellerLabel,
    photos: Array.isArray(listing.photos) ? (listing.photos as string[]) : null,
  })

  return NextResponse.json({ ok: true, updated })
}
