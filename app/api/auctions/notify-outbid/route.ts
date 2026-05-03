import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

function authedSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
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
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Sellers POST here when a lot's leading bidder changes. The server confirms
// the seller owns the auction, looks up the previously-leading bidder, and if
// that bidder was linked to a Sports Collective member, inserts an "outbid"
// notification for the displaced member.
export async function POST(req: NextRequest) {
  const supabase = authedSupabase(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    lot_id?: string
    previous_bidder_id?: string | null
    new_bidder_id?: string | null
  }
  const { lot_id, previous_bidder_id, new_bidder_id } = body
  if (!lot_id) return NextResponse.json({ error: 'Missing lot_id' }, { status: 400 })
  if (!previous_bidder_id) return NextResponse.json({ ok: true, skipped: 'no previous bidder' })
  if (previous_bidder_id === new_bidder_id) return NextResponse.json({ ok: true, skipped: 'same bidder' })

  const admin = adminClient()

  const { data: lot } = await admin
    .from('fb_auction_lots')
    .select('id, auction_id, lot_number, current_bid, listing_id')
    .eq('id', lot_id)
    .maybeSingle()
  if (!lot) return NextResponse.json({ error: 'Lot not found' }, { status: 404 })

  const { data: auction } = await admin
    .from('fb_auctions')
    .select('id, user_id, title, post_url')
    .eq('id', lot.auction_id)
    .maybeSingle()
  if (!auction || auction.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: prevBidder } = await admin
    .from('fb_bidders')
    .select('id, name, fb_handle, member_user_id')
    .eq('id', previous_bidder_id)
    .maybeSingle()
  if (!prevBidder?.member_user_id) {
    return NextResponse.json({ ok: true, skipped: 'previous bidder not linked to a member' })
  }
  if (prevBidder.member_user_id === user.id) {
    return NextResponse.json({ ok: true, skipped: 'self' })
  }

  let listing: { title: string | null; year: number | null; brand: string | null; card_number: string | null; player: string | null; photos: string[] | null } | null = null
  if (lot.listing_id) {
    const { data } = await admin
      .from('listings')
      .select('title, year, brand, card_number, player, photos')
      .eq('id', lot.listing_id)
      .maybeSingle()
    listing = data as typeof listing
  }

  const payload = {
    lot_id: lot.id,
    auction_id: auction.id,
    auction_title: auction.title,
    auction_post_url: auction.post_url,
    lot_number: lot.lot_number,
    current_bid: lot.current_bid,
    listing,
  }

  const { error: insErr } = await admin.from('notifications').insert({
    user_id: prevBidder.member_user_id,
    kind: 'outbid',
    payload,
    link: auction.post_url,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
