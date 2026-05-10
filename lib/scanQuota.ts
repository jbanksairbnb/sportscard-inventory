import type { SupabaseClient } from '@supabase/supabase-js';

// Maximum photos a buyer-only member can store across their inventory and
// listings. Sellers are uncapped. The cap is generous enough for casual
// card-management use (~50 cards with full front/back coverage) while
// keeping storage costs predictable.
export const BUYER_PHOTO_CAP = 100;

export type ScanQuota = {
  used: number;
  max: number; // Infinity for sellers
  isCapped: boolean;
  remaining: number;
  hasRoom: (n: number) => boolean;
};

// Counts every photo the user has stored. Photos live in two places:
//   - sets.rows[].'Image 1' / 'Image 2' / 'Image 3' (per-row inventory photos)
//   - listings.photos[] (listing photos)
// Both contribute to the cap, so a user can't sidestep by routing scans
// through listings vs sets.
export async function getScanQuota(
  supabase: SupabaseClient,
  userId: string,
  isSeller: boolean
): Promise<ScanQuota> {
  const max = isSeller ? Infinity : BUYER_PHOTO_CAP;

  let used = 0;

  const { data: sets } = await supabase
    .from('sets')
    .select('rows')
    .eq('user_id', userId);
  for (const set of (sets || []) as Array<{ rows: Record<string, unknown>[] | null }>) {
    for (const row of set.rows || []) {
      for (const k of ['Image 1', 'Image 2', 'Image 3'] as const) {
        if (String(row[k] || '').trim()) used++;
      }
    }
  }

  const { data: listings } = await supabase
    .from('listings')
    .select('photos')
    .eq('user_id', userId);
  for (const l of (listings || []) as Array<{ photos: string[] | null }>) {
    used += (l.photos || []).length;
  }

  return {
    used,
    max,
    isCapped: !isSeller,
    remaining: isSeller ? Infinity : Math.max(0, max - used),
    hasRoom: (n: number) => isSeller || used + n <= max,
  };
}
