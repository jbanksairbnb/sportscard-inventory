import type { SupabaseClient } from '@supabase/supabase-js';

export type HistoricalChannel = 'fb_auction' | 'fb_claim' | 'other';
export type HistoricalEngagement = 'won' | 'bid' | 'tag_request';

export type HistoricalInput = {
  bidderName: string;
  bidderFbHandle?: string | null;
  occurredAt?: string | null;       // YYYY-MM-DD
  year?: number | null;
  brand?: string | null;
  cardNumber?: string | null;
  player?: string | null;
  conditionNote?: string | null;
  amount?: number | null;
  cost?: number | null;
  channel?: HistoricalChannel | null;
  engagement?: HistoricalEngagement;
  groupId?: string | null;
  notes?: string | null;
};

// Find an existing bidder for this seller by case-insensitive name match,
// or create one. Returns the bidder id (or null on failure).
export async function findOrCreateBidder(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  fbHandle?: string | null,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Case-insensitive lookup. Supabase doesn't support `lower(column) = ?`
  // directly so we use ilike with the full string.
  const { data: existing } = await supabase
    .from('fb_bidders')
    .select('id, name, fb_handle')
    .eq('user_id', userId)
    .ilike('name', trimmed)
    .limit(1);
  if (existing && existing[0]) {
    const b = existing[0] as { id: string; fb_handle: string | null };
    // Backfill fb_handle if we have one and the existing row doesn't.
    if (fbHandle && !b.fb_handle) {
      await supabase.from('fb_bidders').update({ fb_handle: fbHandle.trim() }).eq('id', b.id);
    }
    return b.id;
  }
  const { data: created, error } = await supabase
    .from('fb_bidders')
    .insert({ user_id: userId, name: trimmed, fb_handle: fbHandle?.trim() || null })
    .select('id')
    .single();
  if (error || !created) return null;
  return (created as { id: string }).id;
}

// Resolve a group by case-insensitive name for this seller, creating it if
// missing. Used by CSV import so users can reference groups by name without
// pre-creating them.
export async function findOrCreateGroup(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data: existing } = await supabase
    .from('fb_groups')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', trimmed)
    .limit(1);
  if (existing && existing[0]) return (existing[0] as { id: string }).id;
  const { data: created, error } = await supabase
    .from('fb_groups')
    .insert({ user_id: userId, name: trimmed })
    .select('id')
    .single();
  if (error || !created) return null;
  return (created as { id: string }).id;
}

export async function insertHistoricalTransaction(
  supabase: SupabaseClient,
  userId: string,
  input: HistoricalInput,
): Promise<{ id: string | null; error: string | null }> {
  const bidderId = await findOrCreateBidder(supabase, userId, input.bidderName, input.bidderFbHandle ?? null);
  const { data, error } = await supabase
    .from('historical_transactions')
    .insert({
      user_id: userId,
      bidder_id: bidderId,
      bidder_name: input.bidderName.trim(),
      bidder_fb_handle: input.bidderFbHandle?.trim() || null,
      occurred_at: input.occurredAt || null,
      year: input.year ?? null,
      brand: input.brand?.trim() || null,
      card_number: input.cardNumber?.trim() || null,
      player: input.player?.trim() || null,
      condition_note: input.conditionNote?.trim() || null,
      // Tag requests don't have a bid amount.
      amount: input.engagement === 'tag_request' ? null : (input.amount ?? null),
      // Cost only meaningful for wins (profit math); ignored otherwise.
      cost: input.engagement === 'won' ? (input.cost ?? null) : null,
      channel: input.channel || null,
      engagement_type: input.engagement || 'won',
      group_id: input.groupId || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[historical_transactions insert] failed:', error);
    return { id: null, error: error?.message || 'Insert returned no row' };
  }
  return { id: (data as { id: string }).id, error: null };
}
