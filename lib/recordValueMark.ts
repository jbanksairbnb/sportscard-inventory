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
  markDedupeKey,
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
    .select('id, card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at')
    .eq('user_id', userId);
  if (card.set_slug) q = q.eq('set_slug', card.set_slug);
  const { data: existing } = await q;

  let latest: { id: string; market_value: number; created_at: string } | null = null;
  for (const r of (existing || []) as Array<Record<string, any>>) {
    const k = cardValueKey({
      year: r.card_year, brand: r.card_brand, card_number: r.card_number,
      grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
    });
    if (k !== key) continue;
    if (!latest || String(r.created_at).localeCompare(latest.created_at) > 0) {
      latest = { id: String(r.id), market_value: Number(r.market_value), created_at: String(r.created_at) };
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
    dedupe_key: markDedupeKey({
      year: card.year, brand: card.brand, card_number: card.card_number,
      grade: card.grade, grading_company: card.grading_company, raw_grade: card.raw_grade,
    }, contentHash(normalized), latest?.id ?? null),
    source_session_id: null,
    derived_from_id: null,
  };
  const { error } = await insertValueHistoryRow(payload);
  return !error;
}

// ── Bulk marks from a CSV import ─────────────────────────────────────────────

export type BulkValueMark = {
  card: ValueMarkCard;
  value: number;
  comps: AnalysisSnapshot['rows'];
  notes: string | null;
};

export type BulkMarkResult = { written: number; skipped: number; errors: string[] };

// Append one mark per card. Reads the set's history once (rather than once per
// card) to find each card's latest mark, so an unchanged value is a no-op and
// every new mark chains onto the right predecessor for dedupe — re-importing
// the same file twice writes nothing the second time.
export async function recordBulkValueMarks(
  userId: string,
  setSlug: string,
  marks: BulkValueMark[],
  onProgress?: (done: number) => void,
): Promise<BulkMarkResult> {
  const supabase = createClient();
  const { data: existing } = await supabase
    .from('card_value_history')
    .select('id, card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at')
    .eq('user_id', userId)
    .eq('set_slug', setSlug);

  const latestByKey = new Map<string, { id: string; market_value: number; created_at: string }>();
  for (const r of (existing || []) as Array<Record<string, any>>) {
    const k = cardValueKey({
      year: r.card_year, brand: r.card_brand, card_number: r.card_number,
      grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
    });
    const prev = latestByKey.get(k);
    if (!prev || String(r.created_at).localeCompare(prev.created_at) > 0) {
      latestByKey.set(k, { id: String(r.id), market_value: Number(r.market_value), created_at: String(r.created_at) });
    }
  }

  const result: BulkMarkResult = { written: 0, skipped: 0, errors: [] };
  let done = 0;
  for (const m of marks) {
    const { card } = m;
    const parts = {
      year: card.year, brand: card.brand, card_number: card.card_number,
      grade: card.grade, grading_company: card.grading_company, raw_grade: card.raw_grade,
    };
    const key = cardValueKey(parts);
    const identity = {
      user_id: userId,
      card_year: card.year,
      card_brand: card.brand,
      card_number: card.card_number,
      card_player: card.player,
      card_grade: card.grade,
      card_grading_company: card.grading_company,
      card_raw_grade: card.raw_grade,
      listing_id: card.listing_id ?? null,
      set_slug: card.set_slug ?? setSlug,
      set_card_number: card.set_card_number ?? null,
      source_session_id: null,
      derived_from_id: null,
    };
    // No baseline entry is written for the value a card had before its first
    // import: the import is its first history entry.
    const latest = latestByKey.get(key) ?? null;

    if (latest && Math.abs(latest.market_value - m.value) < 0.005) {
      result.skipped++; done++; onProgress?.(done); continue;
    }

    const normalized = normalizeAnalysis(m.comps, m.notes, m.value);
    const hash = contentHash(normalized);
    const { row, error, duplicate } = await insertValueHistoryRow({
      ...identity,
      market_value: m.value,
      content_hash: hash,
      snapshot: { notes: m.notes, market_value: m.value, rows: m.comps } satisfies AnalysisSnapshot,
      // With comps it reads like a research analysis (the sales open in the
      // history view); a bare number is a manual mark.
      mark_kind: m.comps.length ? 'research' : 'manual',
      dedupe_key: markDedupeKey(parts, hash, latest?.id ?? null),
    });
    if (error) result.errors.push(`#${card.card_number}: ${error}`);
    else if (duplicate) result.skipped++;
    else {
      result.written++;
      if (row) latestByKey.set(key, { id: row.id, market_value: row.market_value, created_at: row.created_at });
    }
    done++;
    onProgress?.(done);
  }
  return result;
}

// ── Import baselines ─────────────────────────────────────────────────────────

// The note on the entry earlier imports added for a card's value from before it
// had any history. Imports no longer write these; the owner can clear old ones.
export const IMPORT_BASELINE_NOTE = 'Value before CSV import';

// Ids of a set's import baselines: entries with that note and no comps. An entry
// whose note was edited, or that was given sales, is the owner's and is left out.
export async function findImportBaselines(userId: string, setSlug: string): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('card_value_history')
    .select('id, snapshot')
    .eq('user_id', userId)
    .eq('set_slug', setSlug);
  if (error) return [];
  return ((data || []) as Array<Record<string, any>>)
    .filter(r => {
      const snap = (r.snapshot || {}) as Partial<AnalysisSnapshot>;
      return snap.notes === IMPORT_BASELINE_NOTE && !(Array.isArray(snap.rows) && snap.rows.length);
    })
    .map(r => String(r.id));
}

// Delete history entries by id, in batches so a large set stays under URL limits.
export async function deleteValueMarks(userId: string, ids: string[]): Promise<string | null> {
  const supabase = createClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from('card_value_history')
      .delete().in('id', ids.slice(i, i + 200)).eq('user_id', userId);
    if (error) return error.message;
  }
  return null;
}

// ── Completing an earlier import ─────────────────────────────────────────────

export type LatestMark = {
  id: string;
  market_value: number;
  created_at: string;
  notes: string | null;
  compCount: number;
};

// The newest history entry per card in a set, keyed by cardValueKey.
export async function loadLatestMarks(userId: string, setSlug: string): Promise<Map<string, LatestMark>> {
  const supabase = createClient();
  const { data } = await supabase
    .from('card_value_history')
    .select('id, card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at, snapshot')
    .eq('user_id', userId)
    .eq('set_slug', setSlug);
  const out = new Map<string, LatestMark>();
  for (const r of (data || []) as Array<Record<string, any>>) {
    const k = cardValueKey({
      year: r.card_year, brand: r.card_brand, card_number: r.card_number,
      grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
    });
    const prev = out.get(k);
    if (prev && String(r.created_at).localeCompare(prev.created_at) <= 0) continue;
    const snap = (r.snapshot || {}) as Partial<AnalysisSnapshot>;
    out.set(k, {
      id: String(r.id),
      market_value: Number(r.market_value),
      created_at: String(r.created_at),
      notes: snap.notes ?? null,
      compCount: Array.isArray(snap.rows) ? snap.rows.length : 0,
    });
  }
  return out;
}

// Put the sales into an existing entry, in place: same date, same value, same
// note. Used when an import's sale lines were missed the first time round.
export async function fillMarkComps(
  userId: string,
  markId: string,
  value: number,
  notes: string | null,
  comps: AnalysisSnapshot['rows'],
): Promise<string | null> {
  const supabase = createClient();
  const snapshot: AnalysisSnapshot = { notes, market_value: value, rows: comps };
  const { error } = await supabase.from('card_value_history')
    .update({
      snapshot,
      content_hash: contentHash(normalizeAnalysis(comps, notes, value)),
      mark_kind: comps.length ? 'research' : 'manual',
      dedupe_key: null,
    })
    .eq('id', markId)
    .eq('user_id', userId);
  return error ? error.message : null;
}
