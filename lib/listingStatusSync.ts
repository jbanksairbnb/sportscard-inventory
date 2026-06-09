import type { SupabaseClient } from '@supabase/supabase-js';

// Where a sold listing was sold, and how far along the FB sale is. These mirror
// the FB auction/claim state onto the listing so My Listings can show the sale
// channel and bucket the card as Claimed (committed, unpaid) vs Sold (paid)
// without re-querying the FB tables.
export type SoldChannel = 'marketplace' | 'auction' | 'claim' | 'ebay';
export type SoldState = 'claimed' | 'sold';

// Mark listings sold and mirror the FB sale onto them: channel (auction/claim),
// state (claimed/sold), and the selling price. Locks from draft/active/sold so
// an already-sold card can still advance its state (claimed → sold) and refresh
// its price. `sold_at` is stamped separately, only when still null, so the
// original sale date survives later re-syncs.
export async function applyListingSale(
  supabase: SupabaseClient,
  userId: string,
  listingIds: string[],
  channel: SoldChannel,
  state: SoldState,
  price: number | null,
): Promise<void> {
  if (listingIds.length === 0) return;
  const payload: Record<string, unknown> = {
    status: 'sold',
    sold_channel: channel,
    sold_state: state,
  };
  // Don't clobber a real price with null if we don't have one yet (e.g. a lot
  // locked during a live auction before any bid).
  if (price !== null && price !== undefined) payload.sold_price = price;

  const { error } = await supabase
    .from('listings')
    .update(payload)
    .in('id', listingIds)
    .eq('user_id', userId)
    .in('status', ['draft', 'active', 'sold']);
  if (error) { console.error('[listings.applyListingSale] failed:', error.message); return; }

  // Stamp the sale date once, on the first transition into sold.
  await supabase
    .from('listings')
    .update({ sold_at: new Date().toISOString() })
    .in('id', listingIds)
    .eq('user_id', userId)
    .is('sold_at', null);
}

// Reverse of applyListingSale: an FB sale was undone (item reopened / lot marked
// no-sale), so return the listing to active and clear the mirrored sale fields.
// Pulls only from sold to avoid resurrecting removed listings.
export async function clearListingSale(
  supabase: SupabaseClient,
  userId: string,
  listingIds: string[],
): Promise<void> {
  if (listingIds.length === 0) return;
  const { error } = await supabase
    .from('listings')
    .update({ status: 'active', sold_channel: null, sold_state: null, sold_price: null, sold_at: null })
    .in('id', listingIds)
    .eq('user_id', userId)
    .eq('status', 'sold');
  if (error) console.error('[listings.clearListingSale] failed:', error.message);
}

type AuctionLotForSync = {
  listing_id: string | null;
  status: 'open' | 'sold' | 'no_sale' | 'paid';
  current_bid?: number | null;
};

// Sweep over every lot in an auction and sync its listing's sold/active state
// plus the mirrored channel/state/price from current values rather than from a
// transition. Idempotent.
//
// Rule: listing is sold when the lot is sold/paid OR (auction has been
// committed — live/ended/settled — AND the lot is open). Anything else →
// listing reverts to active and its sale fields clear.
//
// Claimed vs Sold (per product decision): a won-but-unpaid lot ('sold') maps to
// Claimed; a 'paid' lot maps to Sold. A committed-but-open lot (reserved, no
// winner yet) is Claimed with no price.
export async function syncAuctionListings(
  supabase: SupabaseClient,
  userId: string,
  auctionStatus: 'draft' | 'live' | 'ended' | 'settled',
  lots: AuctionLotForSync[],
): Promise<void> {
  const committed = auctionStatus === 'live' || auctionStatus === 'ended' || auctionStatus === 'settled';
  const unlockIds: string[] = [];
  for (const l of lots) {
    if (!l.listing_id) continue;
    const sold = l.status === 'sold' || l.status === 'paid';
    if (sold || (committed && l.status === 'open')) {
      const state: SoldState = l.status === 'paid' ? 'sold' : 'claimed';
      const price = l.status === 'paid' || l.status === 'sold' ? (l.current_bid ?? null) : null;
      await applyListingSale(supabase, userId, [l.listing_id], 'auction', state, price);
    } else {
      unlockIds.push(l.listing_id);
    }
  }
  if (unlockIds.length > 0) await clearListingSale(supabase, userId, unlockIds);
}

type ClaimItemForSync = {
  listing_id: string | null;
  claim_status: 'open' | 'claimed' | 'sold' | 'paid';
  price?: number | null;
};

// Mirror a claim-sale item's state onto its listing. open → active (cleared);
// claimed/sold → Claimed; paid → Sold. Price comes from the item's price.
export async function syncClaimListing(
  supabase: SupabaseClient,
  userId: string,
  item: ClaimItemForSync,
): Promise<void> {
  if (!item.listing_id) return;
  if (item.claim_status === 'open') {
    await clearListingSale(supabase, userId, [item.listing_id]);
    return;
  }
  const state: SoldState = item.claim_status === 'paid' ? 'sold' : 'claimed';
  await applyListingSale(supabase, userId, [item.listing_id], 'claim', state, item.price ?? null);
}
