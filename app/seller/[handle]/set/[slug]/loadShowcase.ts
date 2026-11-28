import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';
import { cardValueKey } from '@/lib/cardValueHistory';
import { normalizeSettings, SHOWCASE_COLUMNS, type MiniMark, type ShowcaseSettings } from '@/lib/setShowcase';

// Server-side data for the public set showcase, shared by the page, its
// metadata (Facebook link preview text) and its Open Graph image.
//
// Uses the service role, so this is the privacy boundary: only whitelisted,
// buyer-safe card fields leave here — never cost, purchase dates, sale
// prices or other private columns.

const PUBLIC_ROW_FIELDS = [
  'Card #', 'Player', 'Description', 'Grade', 'Grading Company', 'Raw Grade',
  'Value', 'Owned', 'Image 1', 'Image 2',
] as const;

export type PublicShowcaseData = {
  seller: { handle: string; displayName: string };
  set: { title: string; year: string; brand: string; slug: string };
  settings: ShowcaseSettings;
  rows: Array<Record<string, string>>;
  marksByKey: Record<string, MiniMark[]>;
  listing: { id: string; askingPrice: number | null } | null;
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export const loadShowcase = cache(async (handle: string, slug: string): Promise<PublicShowcaseData | null> => {
  const db = admin();
  const { data: seller } = await db
    .from('user_profiles')
    .select('user_id, handle, display_name')
    .eq('handle', handle)
    .maybeSingle();
  if (!seller) return null;

  const { data: set } = await db
    .from('sets')
    .select(`title, year, brand, slug, rows, ${SHOWCASE_COLUMNS}`)
    .eq('user_id', seller.user_id)
    .eq('slug', slug)
    .maybeSingle();
  if (!set) return null;

  const { data: listing } = await db
    .from('listings')
    .select('id, asking_price')
    .eq('user_id', seller.user_id)
    .eq('listing_type', 'set')
    .eq('set_slug', slug)
    .eq('status', 'active')
    .maybeSingle();

  // The minimum offer is the seller's secret; /api/set-offers enforces it.
  // Blank it here so it never reaches the page or its data.
  const settings = { ...normalizeSettings(set as unknown as Record<string, unknown>), min_offer: null };
  // Visible when the owner switched the page on, or (as before) while the set
  // has an active complete-set marketplace listing.
  if (!settings.public_enabled && !listing) return null;

  const rows = (Array.isArray(set.rows) ? set.rows : []).map((r: Record<string, unknown>) => {
    const out: Record<string, string> = {};
    for (const f of PUBLIC_ROW_FIELDS) {
      const v = r?.[f];
      if (v !== undefined && v !== null && v !== '') out[f] = String(v);
    }
    return out;
  });

  // Value history, paged past PostgREST's 1000-row default.
  const marksByKey: Record<string, MiniMark[]> = {};
  const PAGE = 1000;
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data: hist, error } = await db
      .from('card_value_history')
      .select('card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at, mark_kind')
      .eq('user_id', seller.user_id)
      .eq('set_slug', slug)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !hist) break;
    for (const h of hist) {
      const key = cardValueKey({
        year: h.card_year, brand: h.card_brand, card_number: h.card_number,
        grade: h.card_grade, grading_company: h.card_grading_company, raw_grade: h.card_raw_grade,
      });
      (marksByKey[key] ||= []).push({ market_value: Number(h.market_value), created_at: h.created_at, mark_kind: h.mark_kind });
    }
    if (hist.length < PAGE) break;
  }

  return {
    seller: { handle: seller.handle, displayName: seller.display_name || seller.handle },
    set: { title: set.title || '', year: set.year ? String(set.year) : '', brand: set.brand || '', slug },
    settings,
    rows,
    marksByKey,
    listing: listing ? { id: listing.id, askingPrice: listing.asking_price != null ? Number(listing.asking_price) : null } : null,
  };
});
