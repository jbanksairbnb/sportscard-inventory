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
  sweepDedupeKey,
  type AnalysisSnapshot,
  type ValueHistoryRow,
} from '@/lib/cardValueHistory';

// Columns added by later migrations. On a deployment that hasn't run one yet,
// PostgREST rejects the *entire* insert because of the unknown column — which
// silently stopped every value mark, research and manual alike, from being
// recorded. We retry without whichever column the error names, so history keeps
// accruing on older schemas.
const OPTIONAL_COLUMNS = ['mark_kind', 'dedupe_key'] as const;

// Insert one history row and hand the outcome back to the caller.
//
// Three outcomes, not two. `duplicate` means the database already holds this
// exact mark and refused the copy — which is the unique index on `dedupe_key`
// doing its job on a re-import, not a failure, so callers count it as skipped
// rather than showing the user an error. Anything else returns the error text,
// because a swallowed write failure looks exactly like a successful save until
// the user reopens the card and finds the mark missing.
export async function insertValueHistoryRow(
  payload: Record<string, unknown>,
): Promise<{ row: ValueHistoryRow | null; error: string | null; duplicate: boolean }> {
  const supabase = createClient();
  const body = { ...payload };
  let res = await supabase.from('card_value_history').insert(body).select('*').single();

  for (const col of OPTIONAL_COLUMNS) {
    if (!res.error || !(col in body)) continue;
    if (!(res.error.message || '').toLowerCase().includes(col)) continue;
    delete body[col];
    res = await supabase.from('card_value_history').insert(body).select('*').single();
  }

  if (res.error) {
    // 23505 = unique_violation. The row is already there; nothing went wrong.
    if (res.error.code === '23505') return { row: null, error: null, duplicate: true };
    console.warn('[value] history insert failed:', res.error.message);
    return { row: null, error: res.error.message, duplicate: false };
  }
  return { row: (res.data as unknown as ValueHistoryRow) ?? null, error: null, duplicate: false };
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

// Append a sweep mark — one card's value from pricing the whole set at once.
//
// Unlike recordManualValueMark this does NOT skip an unchanged value. A sweep
// is a measurement taken on a date, and "the median was the same this week as
// last" is a real and useful observation; suppressing it would leave a gap in
// the series that reads as missing data rather than as a flat market. The
// daily dedupe key stops an accidental second run from double-counting, and
// the database enforces it.
export async function recordSweepValueMark(
  userId: string,
  card: ValueMarkCard,
  value: number,
  evidence: { n: number; low: number | null; high: number | null; bucketLabel: string | null; viaSearch: boolean },
): Promise<{ ok: boolean; duplicate: boolean }> {
  if (!userId || !Number.isFinite(value)) return { ok: false, duplicate: false };

  const day = new Date().toISOString().slice(0, 10);
  const notes = [
    `CardSight sweep ${day}: median of ${evidence.n} completed sale${evidence.n === 1 ? '' : 's'} in the last 30 days`,
    evidence.low !== null && evidence.high !== null && evidence.low !== evidence.high
      ? `range $${evidence.low.toFixed(2)}–$${evidence.high.toFixed(2)}`
      : '',
    evidence.bucketLabel ? `widened to ${evidence.bucketLabel}` : '',
    evidence.viaSearch ? 'includes title-matched comps' : '',
  ].filter(Boolean).join(' · ');

  const snapshot: AnalysisSnapshot = { notes, market_value: value, rows: [] };
  const normalized = normalizeAnalysis([], notes, value);
  const { error, duplicate } = await insertValueHistoryRow({
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
    mark_kind: 'sweep' as const,
    dedupe_key: sweepDedupeKey({
      year: card.year,
      brand: card.brand,
      card_number: card.card_number,
      grade: card.grade,
      grading_company: card.grading_company,
      raw_grade: card.raw_grade,
    }, day),
    source_session_id: null,
    derived_from_id: null,
  });
  return { ok: !error, duplicate };
}

// Insert many history rows at once.
//
// The single-row path above is right for one mark made in the moment. Restoring
// a whole collection is hundreds, and one round trip each would take minutes;
// these go up in chunks instead. Chunked rather than one statement so a large
// collection doesn't build a single oversized request, and so a failure costs
// one chunk rather than everything.
//
// No dedupe_key is set on restored research marks, so the partial unique index
// can't fire and a chunk can't fail on a duplicate — which is what makes
// batching safe here. Callers de-duplicate by content_hash before calling.
const INSERT_CHUNK = 50;

export async function insertValueHistoryRows(
  payloads: Record<string, unknown>[],
  onProgress?: (done: number) => void,
): Promise<{ inserted: number; error: string | null }> {
  if (payloads.length === 0) return { inserted: 0, error: null };
  const supabase = createClient();

  // Drop the columns this deployment's schema doesn't have, decided once on the
  // first chunk rather than re-probed for every one.
  let body = payloads;
  let probe = await supabase.from('card_value_history').insert(body.slice(0, 1)).select('id');
  for (const col of OPTIONAL_COLUMNS) {
    if (!probe.error) break;
    if (!(probe.error.message || '').toLowerCase().includes(col)) continue;
    body = body.map(p => { const c = { ...p }; delete c[col]; return c; });
    probe = await supabase.from('card_value_history').insert(body.slice(0, 1)).select('id');
  }
  if (probe.error) return { inserted: 0, error: probe.error.message };

  let inserted = 1;
  onProgress?.(inserted);
  for (let i = 1; i < body.length; i += INSERT_CHUNK) {
    const chunk = body.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from('card_value_history').insert(chunk).select('id');
    if (error) return { inserted, error: error.message };
    inserted += chunk.length;
    onProgress?.(inserted);
  }
  return { inserted, error: null };
}
