import type { SupabaseClient } from '@supabase/supabase-js';

// Move a batch of listings to a target status, optionally only when they're
// currently in `fromStatus`. Returns null on success or an error message.
// Used so a card placed in a live auction or a claimed claim-sale lot can't
// be sold twice from the inventory.
export async function setListingsStatus(
  supabase: SupabaseClient,
  userId: string,
  listingIds: string[],
  status: 'draft' | 'active' | 'sold' | 'removed',
  fromStatus?: 'draft' | 'active' | 'sold' | 'removed',
): Promise<string | null> {
  if (listingIds.length === 0) return null;
  let q = supabase.from('listings').update({ status }).in('id', listingIds).eq('user_id', userId);
  if (fromStatus) q = q.eq('status', fromStatus);
  const { error } = await q;
  if (error) {
    console.error('[listings.status update] failed:', error.message);
    return error.message;
  }
  return null;
}

type AuctionLotForSync = { listing_id: string | null; status: 'open' | 'sold' | 'no_sale' | 'paid' };

// Sweep over every lot in an auction and sync its listing's active/sold state
// from current values rather than from a transition. Idempotent — the
// fromStatus guard means we never clobber a listing the seller manually sold
// elsewhere. This handles every auction-status path (draft→live→ended,
// draft→ended, live→settled, etc.) without needing per-transition branches.
//
// Rule: listing is `sold` when the lot is sold/paid OR (auction is live AND
// lot is open). Anything else → `active`.
export async function syncAuctionListings(
  supabase: SupabaseClient,
  userId: string,
  auctionStatus: 'draft' | 'live' | 'ended' | 'settled',
  lots: AuctionLotForSync[],
): Promise<void> {
  const lockIds: string[] = [];
  const unlockIds: string[] = [];
  for (const l of lots) {
    if (!l.listing_id) continue;
    const shouldBeSold = l.status === 'sold' || l.status === 'paid'
      || (auctionStatus === 'live' && l.status === 'open');
    if (shouldBeSold) lockIds.push(l.listing_id);
    else unlockIds.push(l.listing_id);
  }
  if (lockIds.length > 0) await setListingsStatus(supabase, userId, lockIds, 'sold', 'active');
  if (unlockIds.length > 0) await setListingsStatus(supabase, userId, unlockIds, 'active', 'sold');
}

