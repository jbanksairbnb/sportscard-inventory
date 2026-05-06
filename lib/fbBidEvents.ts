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
export async function logBidEvent(supabase: SupabaseClient, args: LogBidEventInput): Promise<string | null> {
  try {
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
