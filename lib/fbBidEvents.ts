import type { SupabaseClient } from '@supabase/supabase-js';

export type LogBidEventInput = {
  userId: string;
  auctionId: string;
  lotId: string;
  amount: number | null;
  bidderId: string | null;
  bidderName: string | null;
  bidderFbHandle: string | null;
};

// Caller passes a Supabase client that's already authed as the seller.
// Returns null on success, or an error message string on failure. Callers
// should surface failures so missed events get noticed (the table is the
// source of truth for bidder analytics).
//
// The hard part is that the lot editor infers bids from field edits, so one
// real bid can arrive as two calls (the amount blurs when focus moves to the
// bidder field) and a typo fix arrives looking exactly like a new bid. Three
// rules sort that out, applied in order:
//
//   1. An existing event on this lot with NO bidder is the first half of the
//      bid now being named — fill it in instead of inserting. This rule has no
//      time limit, and that matters: the previous version only looked 2
//      minutes back, so entering a batch of amounts and going back for the
//      names afterwards stranded the amount-only rows permanently. 363 of this
//      seller's 1558 recorded bids ended up orphaned that way, which is why
//      the amount has to be allowed to match across any gap.
//
//   2. A fresh event at the same amount, or at a LOWER one, is the same bid
//      being corrected — the seller renaming the bidder, or fixing a typo.
//      Bids never descend in an ascending auction, so a decrease is always a
//      correction and must not count as another bid.
//
//   3. Anything else is a genuine new bid, including the same bidder raising
//      their own bid.
//
// Rule 2 is time-boxed because an edit made days later is far more likely to
// be a real bid than a correction.
const CORRECTION_WINDOW_MS = 10 * 60 * 1000;

type ExistingEvent = { id: string; amount: number | null; bidder_id: string | null; created_at: string };

export async function logBidEvent(supabase: SupabaseClient, args: LogBidEventInput): Promise<string | null> {
  try {
    // The most recent event on this lot, and the most recent one still missing
    // a bidder. Both are cheap — ix_fb_auction_bid_events_lot covers them.
    const [latestRes, unnamedRes] = await Promise.all([
      supabase.from('fb_auction_bid_events')
        .select('id, amount, bidder_id, created_at')
        .eq('lot_id', args.lotId)
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('fb_auction_bid_events')
        .select('id, amount, bidder_id, created_at')
        .eq('lot_id', args.lotId).is('bidder_id', null)
        .order('created_at', { ascending: false }).limit(1),
    ]);
    const latest = (latestRes.data?.[0] ?? undefined) as ExistingEvent | undefined;
    const unnamed = (unnamedRes.data?.[0] ?? undefined) as ExistingEvent | undefined;

    let adopt: ExistingEvent | undefined;
    // Rule 1 — claim the amount-only row this bid was entered as. Require the
    // amounts to agree (or the row to have none) so a stale orphan can't
    // swallow a genuinely different bid placed later.
    if (args.bidderId && unnamed
        && (unnamed.amount == null || args.amount == null || unnamed.amount === args.amount)) {
      adopt = unnamed;
    } else if (latest && Date.now() - Date.parse(latest.created_at) <= CORRECTION_WINDOW_MS) {
      // Rule 2 — same amount means a re-attribution, lower means a typo fix.
      const sameAmount = (latest.amount ?? null) === (args.amount ?? null)
        || latest.amount == null || args.amount == null;
      const corrected = latest.amount != null && args.amount != null && args.amount < latest.amount;
      if (sameAmount || corrected) adopt = latest;
    }

    if (adopt) {
      const patch: Record<string, unknown> = {};
      if (args.amount != null) patch.amount = args.amount;
      if (args.bidderId !== undefined) patch.bidder_id = args.bidderId;
      if (args.bidderName) patch.bidder_name = args.bidderName;
      if (args.bidderFbHandle !== undefined) patch.bidder_fb_handle = args.bidderFbHandle;
      if (Object.keys(patch).length === 0) return null;
      const { error } = await supabase.from('fb_auction_bid_events').update(patch).eq('id', adopt.id);
      if (error) {
        console.error('[fb_auction_bid_events] coalesce update failed:', error.message);
        return error.message;
      }
      return null;
    }

    const { error } = await supabase.from('fb_auction_bid_events').insert({
      user_id: args.userId,
      auction_id: args.auctionId,
      lot_id: args.lotId,
      amount: args.amount,
      bidder_id: args.bidderId,
      bidder_name: args.bidderName,
      bidder_fb_handle: args.bidderFbHandle,
    });
    if (error) {
      console.error('[fb_auction_bid_events] insert failed:', error.message);
      return error.message;
    }
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[fb_auction_bid_events] insert threw:', msg);
    return msg;
  }
}

export type LotBidStats = {
  lot_id: string;
  bid_count: number;
  unique_bidders: number;
  last_bid_at: string | null;
};

export type BidHistoryEvent = {
  id: string;
  amount: number | null;
  bidder_id: string | null;
  bidder_name: string | null;
  bidder_fb_handle: string | null;
  created_at: string;
};

export async function fetchLotBidHistory(
  supabase: SupabaseClient,
  lotId: string,
): Promise<BidHistoryEvent[]> {
  const { data, error } = await supabase
    .from('fb_auction_bid_events')
    .select('id, amount, bidder_id, bidder_name, bidder_fb_handle, created_at')
    .eq('lot_id', lotId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data as BidHistoryEvent[];
}

export async function fetchLotBidStats(
  supabase: SupabaseClient,
  lotIds: string[],
): Promise<Map<string, LotBidStats>> {
  const out = new Map<string, LotBidStats>();
  if (lotIds.length === 0) return out;
  try {
    const { data, error } = await supabase
      .from('fb_auction_lot_bid_stats')
      .select('lot_id, bid_count, unique_bidders, last_bid_at')
      .in('lot_id', lotIds);
    if (error || !data) return out;
    for (const row of data as LotBidStats[]) out.set(row.lot_id, row);
  } catch {
    /* migration may not be applied yet */
  }
  return out;
}
