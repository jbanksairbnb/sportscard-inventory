// Shared writers for card_value_history — the append-only price-over-time log.
//
// `insertValueHistoryRow` is the single low-level insert both commit paths go
// through (the research modal's richer commit and the manual mark below), so
// they fail the same way and stay resilient to schema drift.
//
// `recordManualValueMark` is the *manual* counterpart to the research modal's
// commitHistory(): whenever a card's Value is set directly (typed in the edit
// table or on the inventory view), we log one immutable row so movement is
// tracked the same way research is.
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
  type ValueHistoryRow,
} from '@/lib/cardValueHistory';

// Insert one history row and hand the outcome back to the caller.
//
// `mark_kind` is the newest column (migration 20260813_card_value_mark_kind).
// On a deployment where that migration hasn't been applied yet, PostgREST
// rejects the *entire* insert because of the unknown column — which silently
// stopped every value mark, research and manual alike, from being recorded.
// Retry once without the column so history keeps accruing on older schemas,
// and always return the error text so callers can tell the user instead of
// swallowing the failure.
export async function insertValueHistoryRow(
  payload: Record<string, unknown>,
): Promise<{ row: ValueHistoryRow | null; error: string | null }> {
  const supabase = createClient();
  let res = await supabase.from('card_value_history').insert(payload).select('*').single();
  if (res.error && (res.error.message || '').toLowerCase().includes('mark_kind')) {
    const retry = { ...payload };
    delete retry.mark_kind;
    res = await supabase.from('card_value_history').insert(retry).select('*').single();
  }
  if (res.error) {
    console.warn('[value] history insert failed:', res.error.message);
    return { row: null, error: res.error.message };
  }
  return { row: (res.data as unknown as ValueHistoryRow) ?? null, error: null };
}

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
  const { error } = await insertValueHistoryRow(payload);
  return !error;
}
