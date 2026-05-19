import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { markSourceRowOwned } from '@/lib/inventory'

// Marks a source set row as owned/unowned. Used when the caller doesn't
// have RLS permission on the seller's sets (e.g. a buyer hits the
// marketplace purchase flow and the seller's inventory needs updating).
//
// Authorization: the caller must be either the seller themselves OR the
// buyer of an existing purchase whose listing maps to the same source row.
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

  const body = await req.json().catch(() => ({})) as {
    listing_id?: string
    purchase_id?: string
    owned?: boolean
  }
  const { listing_id, purchase_id, owned } = body
  if (typeof owned !== 'boolean') return NextResponse.json({ error: 'Missing owned' }, { status: 400 })
  if (!listing_id && !purchase_id) return NextResponse.json({ error: 'Missing listing_id or purchase_id' }, { status: 400 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Resolve the listing (and seller) — either directly or via the purchase.
  let listingId = listing_id || ''
  let purchaseSellerId: string | null = null
  let purchaseBuyerId: string | null = null
  if (purchase_id) {
    const { data: p } = await admin
      .from('purchases')
      .select('id, listing_id, seller_id, buyer_id')
      .eq('id', purchase_id)
      .maybeSingle()
    if (!p) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    listingId = p.listing_id
    purchaseSellerId = p.seller_id
    purchaseBuyerId = p.buyer_id
  }

  const { data: listing } = await admin
    .from('listings')
    .select('id, user_id, source_set_slug, source_card_number, source_row_id')
    .eq('id', listingId)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (!listing.source_set_slug || (!listing.source_card_number && !listing.source_row_id)) {
    return NextResponse.json({ ok: true, skipped: 'listing has no source row' })
  }

  // Authorize: must be the seller, OR the buyer/seller on the linked purchase.
  const sellerId = listing.user_id
  const allowed =
    user.id === sellerId ||
    user.id === purchaseSellerId ||
    user.id === purchaseBuyerId
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const updated = await markSourceRowOwned(admin, {
    sellerUserId: sellerId,
    setSlug: listing.source_set_slug,
    cardNumber: listing.source_card_number,
    rowId: listing.source_row_id,
    owned,
  })
  return NextResponse.json({ ok: true, updated })
}
