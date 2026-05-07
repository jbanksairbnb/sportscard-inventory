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
// Coalescing: when the user fills the bid amount and the bidder name in two
// successive blurs, we'd otherwise log two events for what's really one bid.
// Before inserting, we look for a recent event on the same lot whose amount
// matches and whose bidder slot is empty (or matches the new id) — if we find
// one, we patch it instead of inserting a new row.
const COALESCE_WINDOW_MS = 2 * 60 * 1000;

export async function logBidEvent(supabase: SupabaseClient, args: LogBidEventInput): Promise<string | null> {
  try {
    const since = new Date(Date.now() - COALESCE_WINDOW_MS).toISOString();
    const { data: recent } = await supabase
      .from('fb_auction_bid_events')
      .select('id, amount, bidder_id, bidder_name, bidder_fb_handle, created_at')
      .eq('lot_id', args.lotId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    const candidate = (recent && recent[0]) as { id: string; amount: number | null; bidder_id: string | null; bidder_name: string | null } | undefined;
    const sameAmount = candidate
      && ((candidate.amount ?? null) === (args.amount ?? null)
        || candidate.amount == null
        || args.amount == null);
    const compatibleBidder = candidate
      && (candidate.bidder_id == null
        || args.bidderId == null
        || candidate.bidder_id === args.bidderId);
    if (candidate && sameAmount && compatibleBidder) {
      const patch: Record<string, unknown> = {};
      if (args.amount != null) patch.amount = args.amount;
      if (args.bidderId) patch.bidder_id = args.bidderId;
      if (args.bidderName) patch.bidder_name = args.bidderName;
      if (args.bidderFbHandle) patch.bidder_fb_handle = args.bidderFbHandle;
      if (Object.keys(patch).length === 0) return null;
      const { error } = await supabase.from('fb_auction_bid_events').update(patch).eq('id', candidate.id);
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
