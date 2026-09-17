import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/supabase/fetchAll';
import type { BidderRow, LiveActivity } from '@/components/BidderSuggestions';

// Assembles the unified activity stream behind the bidder tag suggestions.
//
// Both the new-auction and new-claim-sale pages need exactly this, and when it
// was copy-pasted into each the two drifted apart (they disagreed on what
// counts as a claim win). It lives here so the recommendation is computed from
// identical history no matter which sale type you are building.
//
// Two things matter to get right:
//
//  1. Every query pages through fetchAll. PostgREST silently caps an unbounded
//     query at 1000 rows, and this seller passed that on bid events alone — so
//     a third of all bids were invisible to the ranking, and the bidders with
//     the most bids were the ones truncated hardest.
//
//  2. Bid events are NOT deduplicated per lot. Bid volume is the primary
//     ranking signal, so four bids on one card have to count as four. Wins and
//     spend are keyed on item_key instead, so they still count once.

type LotJoin = {
  id: string;
  auction_id: string | null;
  bidder_id: string;
  current_bid: number | null;
  status: 'open' | 'sold' | 'no_sale' | 'paid';
  listing: { year: number | null; brand: string | null; player: string | null } | null;
};

type EventJoin = {
  bidder_id: string;
  lot_id: string;
  amount: number | null;
  created_at: string | null;
  lot: {
    bidder_id: string | null;
    auction_id: string | null;
    current_bid: number | null;
    status: 'open' | 'sold' | 'no_sale' | 'paid';
    listing: { year: number | null; brand: string | null; player: string | null } | null;
  } | null;
};

type ClaimJoin = {
  id: string;
  claim_buyer_id: string;
  price: number | null;
  claim_status: 'open' | 'claimed' | 'sold' | 'paid';
  created_at: string | null;
  listing: { year: number | null; brand: string | null; player: string | null } | null;
};

type HistoricalRow = {
  id: string;
  bidder_id: string;
  year: number | null;
  brand: string | null;
  player: string | null;
  amount: number | null;
  channel: string | null;
  engagement_type: 'won' | 'bid' | 'tag_request';
  occurred_at: string | null;
  created_at: string | null;
};

// Auctions carry the sale date used to age a win that has no bid event behind
// it. `ends_at` is absent in some deployments, so fall back rather than lose
// the date entirely — a bidder with no date is excluded from every recency
// band, which silently drops real buyers off the list.
async function fetchAuctionDates(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const withEnds = await supabase
    .from('fb_auctions').select('id, ends_at, created_at').eq('user_id', userId);
  const rows = withEnds.error
    ? (await supabase.from('fb_auctions').select('id, created_at').eq('user_id', userId)).data
    : withEnds.data;
  for (const r of (rows || []) as { id: string; ends_at?: string | null; created_at?: string | null }[]) {
    out.set(r.id, r.ends_at || r.created_at || null);
  }
  return out;
}

export async function loadBidderActivity(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ bidders: BidderRow[]; activity: LiveActivity[] }> {
  const [biddersRes, lotRows, eventRows, claimRows, historicalRows, auctionDates] = await Promise.all([
    supabase.from('fb_bidders').select('id, name, fb_handle').eq('user_id', userId).order('name'),
    fetchAll<LotJoin>((from, to) => supabase
      .from('fb_auction_lots')
      .select('id, auction_id, bidder_id, current_bid, status, listing:listings(year, brand, player)')
      .eq('user_id', userId).not('bidder_id', 'is', null)
      .order('id', { ascending: true }).range(from, to) as never),
    fetchAll<EventJoin>((from, to) => supabase
      .from('fb_auction_bid_events')
      .select('bidder_id, lot_id, amount, created_at, lot:fb_auction_lots(bidder_id, auction_id, current_bid, status, listing:listings(year, brand, player))')
      .eq('user_id', userId).not('bidder_id', 'is', null)
      .order('created_at', { ascending: true }).range(from, to) as never),
    fetchAll<ClaimJoin>((from, to) => supabase
      .from('fb_claim_sale_items')
      .select('id, claim_buyer_id, price, claim_status, created_at, listing:listings(year, brand, player)')
      .eq('user_id', userId).not('claim_buyer_id', 'is', null)
      .order('id', { ascending: true }).range(from, to) as never),
    fetchAll<HistoricalRow>((from, to) => supabase
      .from('historical_transactions')
      .select('id, bidder_id, year, brand, player, amount, channel, engagement_type, occurred_at, created_at')
      .eq('user_id', userId).not('bidder_id', 'is', null)
      .order('id', { ascending: true }).range(from, to) as never),
    fetchAuctionDates(supabase, userId),
  ]);

  const activity: LiveActivity[] = [];

  // One row per recorded bid. The lot supplies the outcome: a bid only counts
  // as a win when that bidder is the one the lot actually settled on.
  const lotsWithOwnBid = new Set<string>();
  for (const e of eventRows) {
    const lot = e.lot;
    if (!lot) continue;
    lotsWithOwnBid.add(`${e.bidder_id}|${e.lot_id}`);
    const isWinner = lot.bidder_id === e.bidder_id && (lot.status === 'sold' || lot.status === 'paid');
    activity.push({
      bidder_id: e.bidder_id,
      source: 'auction',
      kind: 'bid',
      item_key: `lot:${e.lot_id}`,
      is_winner: isWinner,
      is_paid: lot.bidder_id === e.bidder_id && lot.status === 'paid',
      bid_amount: lot.status === 'paid' ? (lot.current_bid ?? null) : null,
      occurred_at: e.created_at
        || (lot.auction_id ? auctionDates.get(lot.auction_id) ?? null : null),
      listing_year: lot.listing?.year ?? null,
      listing_brand: lot.listing?.brand ?? null,
      listing_player: lot.listing?.player ?? null,
    });
  }

  // Lots a bidder holds with no bid event of their own behind them. Their
  // winning bid was recorded without attribution, so credit the item and date
  // it from the auction — otherwise these buyers look inactive forever.
  for (const l of lotRows) {
    if (lotsWithOwnBid.has(`${l.bidder_id}|${l.id}`)) continue;
    activity.push({
      bidder_id: l.bidder_id,
      source: 'auction',
      kind: 'acquisition',
      item_key: `lot:${l.id}`,
      is_winner: l.status === 'sold' || l.status === 'paid',
      is_paid: l.status === 'paid',
      bid_amount: l.status === 'paid' ? (l.current_bid ?? null) : null,
      occurred_at: l.auction_id ? auctionDates.get(l.auction_id) ?? null : null,
      listing_year: l.listing?.year ?? null,
      listing_brand: l.listing?.brand ?? null,
      listing_player: l.listing?.player ?? null,
    });
  }

  for (const c of claimRows) {
    activity.push({
      bidder_id: c.claim_buyer_id,
      source: 'claim',
      kind: 'acquisition',
      item_key: `claim:${c.id}`,
      is_winner: c.claim_status === 'claimed' || c.claim_status === 'sold' || c.claim_status === 'paid',
      is_paid: c.claim_status === 'paid',
      bid_amount: c.price,
      occurred_at: c.created_at ?? null,
      listing_year: c.listing?.year ?? null,
      listing_brand: c.listing?.brand ?? null,
      listing_player: c.listing?.player ?? null,
    });
  }

  for (const h of historicalRows) {
    // Only imported wins count as wins; imported bids and tag requests are
    // engagement, which is exactly what the bid count is meant to measure.
    activity.push({
      bidder_id: h.bidder_id,
      source: h.channel === 'fb_claim' ? 'claim' : 'auction',
      kind: h.engagement_type === 'won' ? 'acquisition' : 'bid',
      item_key: `hist:${h.id}`,
      is_winner: h.engagement_type === 'won',
      is_paid: h.engagement_type === 'won',
      bid_amount: h.engagement_type === 'won' ? h.amount : null,
      occurred_at: h.occurred_at ? `${h.occurred_at}T00:00:00Z` : (h.created_at ?? null),
      listing_year: h.year,
      listing_brand: h.brand,
      listing_player: h.player,
    });
  }

  return { bidders: (biddersRes.data || []) as BidderRow[], activity };
}
