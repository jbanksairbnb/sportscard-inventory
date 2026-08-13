// Shared writer for a *manual* value mark — the append-only counterpart to the
// research modal's commitHistory(). Whenever a card's Value is set directly
// (typed in the edit table or on the inventory view), we log one immutable row
// to card_value_history so movement is tracked the same way research is. The
// research modal keeps owning its own richer commit; this covers the plain
// "I just typed a number" path.
//
// Framework-light on purpose: it only needs the browser Supabase client and the
// identity/fingerprint helpers, so both the edit page and the view page can call
// it without duplicating the dedup + payload logic.

import { createClient } from '@/lib/supabase/client';
import {
  cardValueKey,
  normalizeAnalysis,
  contentHash,
  type AnalysisSnapshot,
} from '@/lib/cardValueHistory';

// The card-identity + breadcrumb fields a mark needs. Mirrors the research
// modal's CardDescriptor so callers can pass the same object.
export type ValueMarkCard = {
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  grade: string | null;
  grading_company: string | null;
  raw_grade: string | null;
  set_slug?: string | null;
  set_card_number?: string | null;
  listing_id?: string | null;
};

// Append a manual value mark for `card` at `value`, unless the most recent mark
// for this exact card identity already equals it (typing the same number again,
// or re-blurring an unchanged field, is a no-op — never a spurious "flat"
// mark). Returns true when a new mark was written.
//
// Dedup reads every mark for the set once and groups by card key in JS; nulls in
// the identity tuple make column-level .eq() filtering unreliable, and a set's
// history is small, so this is both correct and cheap.
export async function recordManualValueMark(
  userId: string,
  card: ValueMarkCard,
  value: number,
): Promise<boolean> {
  if (!userId || !Number.isFinite(value)) return false;
  const supabase = createClient();

  const key = cardValueKey({
    year: card.year,
    brand: card.brand,
    card_number: card.card_number,
    grade: card.grade,
    grading_company: card.grading_company,
    raw_grade: card.raw_grade,
  });

  // Find the latest existing mark for this card (scoped to the set when we have
  // one) so we can skip an unchanged value.
  let q = supabase
    .from('card_value_history')
    .select('card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at')
    .eq('user_id', userId);
  if (card.set_slug) q = q.eq('set_slug', card.set_slug);
  const { data: existing } = await q;

  let latest: { market_value: number; created_at: string } | null = null;
  for (const r of (existing || []) as Array<Record<string, any>>) {
    const k = cardValueKey({
      year: r.card_year, brand: r.card_brand, card_number: r.card_number,
      grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
    });
    if (k !== key) continue;
    if (!latest || String(r.created_at).localeCompare(latest.created_at) > 0) {
      latest = { market_value: Number(r.market_value), created_at: String(r.created_at) };
    }
  }
  if (latest && Math.abs(latest.market_value - value) < 0.005) return false;

  const snapshot: AnalysisSnapshot = { notes: null, market_value: value, rows: [] };
  const normalized = normalizeAnalysis([], null, value);
  const payload = {
    user_id: userId,
    card_year: card.year,
    card_brand: card.brand,
    card_number: card.card_number,
    card_player: card.player,
    card_grade: card.grade,
    card_grading_company: card.grading_company,
    card_raw_grade: card.raw_grade,
    listing_id: card.listing_id ?? null,
    set_slug: card.set_slug ?? null,
    set_card_number: card.set_card_number ?? null,
    market_value: value,
    content_hash: contentHash(normalized),
    snapshot,
    mark_kind: 'manual' as const,
    source_session_id: null,
    derived_from_id: null,
  };
  const { error } = await supabase.from('card_value_history').insert(payload);
  if (error) { console.warn('[value] manual mark insert failed:', error.message); return false; }
  return true;
}
