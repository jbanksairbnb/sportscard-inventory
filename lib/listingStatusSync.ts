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
