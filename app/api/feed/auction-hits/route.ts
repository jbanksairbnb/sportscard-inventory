import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
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

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Live auctions across all sellers (excluding the requesting user's own).
  const { data: auctions, error: aErr } = await admin
    .from('fb_auctions')
    .select('id, user_id, title, status, post_url, ends_at, created_at, group_id')
    .eq('status', 'live')
    .neq('user_id', user.id)
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  if (!auctions || auctions.length === 0) {
    return NextResponse.json({ lots: [] })
  }
  const auctionIds = auctions.map(a => a.id)
  const auctionById = new Map(auctions.map(a => [a.id, a]))

  // Open lots for those auctions.
  const { data: lots, error: lErr } = await admin
    .from('fb_auction_lots')
    .select('id, auction_id, listing_id, lot_number, starting_bid, current_bid, bidder_name, bidder_fb_handle, comment_url, status')
    .in('auction_id', auctionIds)
    .eq('status', 'open')
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

  if (!lots || lots.length === 0) {
    return NextResponse.json({ lots: [] })
  }

  // Listings (card identity) referenced by those lots.
  const listingIds = Array.from(new Set(lots.map(l => l.listing_id).filter(Boolean) as string[]))
  const { data: listings } = listingIds.length > 0
    ? await admin
        .from('listings')
        .select('id, title, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, photos')
        .in('id', listingIds)
    : { data: [] as Array<Record<string, unknown>> }
  const listingById = new Map((listings || []).map((l: any) => [l.id, l]))

  // Seller profiles.
  const sellerIds = Array.from(new Set(auctions.map(a => a.user_id)))
  const { data: profiles } = sellerIds.length > 0
    ? await admin
        .from('user_profiles')
        .select('user_id, display_name, handle, email')
        .in('user_id', sellerIds)
    : { data: [] as Array<Record<string, unknown>> }
  const profileById = new Map((profiles || []).map((p: any) => [p.user_id, p]))

  const enriched = lots
    .filter(l => l.listing_id && listingById.has(l.listing_id as string))
    .map(l => {
      const listing = listingById.get(l.listing_id as string) as any
      const auction = auctionById.get(l.auction_id) as any
      const seller = profileById.get(auction.user_id) as any
      return {
        lot_id: l.id,
        lot_number: l.lot_number,
        starting_bid: l.starting_bid,
        current_bid: l.current_bid,
        comment_url: l.comment_url,
        leading_bidder_name: l.bidder_name,
        leading_bidder_fb_handle: l.bidder_fb_handle,
        auction_id: auction.id,
        auction_title: auction.title,
        auction_post_url: auction.post_url,
        auction_ends_at: auction.ends_at,
        auction_created_at: auction.created_at,
        seller_user_id: auction.user_id,
        seller_name: seller?.display_name || seller?.handle || (seller?.email ? String(seller.email).split('@')[0] : '—'),
        seller_handle: seller?.handle || '',
        seller_email: seller?.email || '',
        listing_id: listing.id,
        listing_title: listing.title,
        year: listing.year,
        brand: listing.brand,
        card_number: listing.card_number,
        player: listing.player,
        condition_type: listing.condition_type,
        raw_grade: listing.raw_grade,
        grading_company: listing.grading_company,
        grade: listing.grade,
        photos: listing.photos || [],
      }
    })

  return NextResponse.json({ lots: enriched })
}
