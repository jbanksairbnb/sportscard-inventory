// Shared helpers for card value history — the append-only price-over-time log
// written whenever a user commits a market-value analysis (Save research /
// Use value). Kept framework-free so both the research modal and the set grid
// can share the identity key, change-detection, and trend math.

// A single comparable sale captured inside a committed analysis snapshot.
export type AnalysisRow = {
  position: number;
  source: string;
  source_label: string | null;
  grade_company: string | null;
  grade_value: string | null;
  sale_date: string | null;
  price: number | null;
  weight_pct: number | null;
  url: string | null;
  notes: string | null;
};

// The full, self-contained analysis stored on each history row. Because the
// comps live here (not just as mutable session data points), a history entry
// can always be re-opened even after the working session is edited.
export type AnalysisSnapshot = {
  notes: string | null;
  market_value: number;
  rows: AnalysisRow[];
};

export type ValueHistoryRow = {
  id: string;
  user_id: string;
  card_year: number | null;
  card_brand: string | null;
  card_number: string | null;
  card_player: string | null;
  card_grade: string | null;
  card_grading_company: string | null;
  card_raw_grade: string | null;
  set_slug: string | null;
  set_card_number: string | null;
  market_value: number;
  content_hash: string;
  snapshot: AnalysisSnapshot;
  // How this mark was produced: 'research' rows carry comps in snapshot.rows;
  // 'manual' rows just record a number the owner typed (empty comp list);
  // 'cardsight' rows are a month's median of sold comps, imported in bulk from
  // the price history CardSight has for the card, and dated to that month's
  // last sale rather than to the day they were imported;
  // 'sweep' rows come from pricing the whole set at once — the same 30-day
  // median the research modal computes, dated to the day it was taken. Kept
  // distinct from 'cardsight' because those are back-filled months and these
  // are a forward-running series: collapsing a sweep to one point per month
  // would throw away the very cadence that makes it worth having.
  mark_kind: 'research' | 'manual' | 'cardsight' | 'sweep';
  // Idempotency key for machine-imported marks, so re-running an import is a
  // no-op rather than a second copy. Null on marks a person made — two
  // analyses of the same card on the same day are both real.
  dedupe_key: string | null;
  source_session_id: string | null;
  derived_from_id: string | null;
  created_at: string;
};

// Identity tuple that groups snapshots into one comparable price series. Mirrors
// the session-matching key the research modal already uses: year + card_number
// + brand + grade context (graded company/grade OR raw grade). Each grade
// variant is its own series, so a PSA 8 and a raw copy track separately.
export type CardKeyParts = {
  year: number | null;
  brand: string | null;
  card_number: string | null;
  grade: string | null;
  grading_company: string | null;
  raw_grade: string | null;
};

export function cardValueKey(p: CardKeyParts): string {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  return [
    p.year ?? '',
    norm(p.card_number),
    norm(p.brand),
    norm(p.grading_company),
    norm(p.grade),
    norm(p.raw_grade),
  ].join('|');
}

// Idempotency key for a mark a person made (research analysis or typed value).
//
// MUST stay byte-identical to public.mark_dedupe_key() in migration
// 20261015_value_history_dedupe.sql.
//
// A double click, a retry, or two tabs saving at once all write "this analysis,
// on top of the same previous mark" — so the key names exactly that: the card,
// the analysis fingerprint, and the mark it was written on top of. A genuine
// A → B → A sequence is not blocked, because the second A sits on top of B.
export function markDedupeKey(p: CardKeyParts, hash: string, previousMarkId: string | null): string {
  return `mark:${cardValueKey(p)}:${hash}:${previousMarkId ?? 'none'}`;
}

// Stable normalized fingerprint of an analysis, used to answer "did anything
// actually change since the last commit?". Only the meaningful comp fields,
// notes, and resulting value participate; rows are sorted by position so pure
// row-reordering doesn't register as a change.
export function normalizeAnalysis(rows: AnalysisRow[], notes: string | null, marketValue: number): string {
  const parts = rows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(r => [
      r.source ?? '',
      (r.source_label ?? '').trim(),
      r.grade_company ?? '',
      r.grade_value ?? '',
      r.sale_date ?? '',
      r.price ?? '',
      r.weight_pct ?? '',
      (r.url ?? '').trim(),
      (r.notes ?? '').trim(),
    ].join('~'));
  return parts.join(';') + '#' + (notes ?? '').trim() + '#' + marketValue.toFixed(2);
}

// Compact deterministic fingerprint (djb2 → base36). Not cryptographic — just a
// short stable hash we can store alongside each snapshot.
export function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Two comps in one analysis can only share a `position` when concurrent saves
// double-wrote the session's rows. The extra copy isn't a second comp — it's an
// artifact, and leaving it in doubles every weight, so a 100% analysis reloads
// as 200% and can never be saved or valued again. Keep the first at each
// position, so already-affected snapshots read back correctly.
export function dedupeByPosition<T extends { position: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter(i => {
    if (seen.has(i.position)) return false;
    seen.add(i.position);
    return true;
  });
}

export type Trend = {
  direction: 'up' | 'down' | 'flat';
  latest: number;
  previous: number;
  delta: number;
  pct: number | null; // null when the previous value is 0 (no meaningful %)
};

// Marks that restate the previous value add a date, not information. A card
// re-marked every month at the same price should read as one price held since
// the first of those dates, not as a row of identical entries.
export type CollapsedMark<T> = {
  /** The mark that established this value (first of the run). */
  mark: T;
  /** Date of the last mark in the run that restated it. */
  through: string;
  /** How many marks the run covers, the first included. */
  count: number;
};

const SAME_VALUE_EPS = 0.005;

// Collapse consecutive same-valued marks (oldest → newest in, oldest → newest
// out). Only consecutive runs collapse: A → B → A keeps all three, since the
// return to A is real movement.
export function collapseUnchanged<T extends { market_value: number; created_at: string }>(
  chronological: T[],
): CollapsedMark<T>[] {
  const out: CollapsedMark<T>[] = [];
  for (const m of chronological) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.mark.market_value - m.market_value) < SAME_VALUE_EPS) {
      last.through = m.created_at;
      last.count += 1;
    } else {
      out.push({ mark: m, through: m.created_at, count: 1 });
    }
  }
  return out;
}

// Trend for ONE card: the latest value against the last value that was
// different from it. Repeats of the same price are not a "prior" to compare
// with — measured against one, every re-mark would read as 0.0%. With no
// earlier different value the card is flat. Returns null with fewer than two
// marks (nothing to compare against yet).
export function trendFromRows(rows: { market_value: number; created_at: string }[]): Trend | null {
  if (rows.length < 2) return null;
  const runs = collapseUnchanged(
    rows.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
  );
  const latest = runs[runs.length - 1].mark.market_value;
  const previous = runs.length >= 2 ? runs[runs.length - 2].mark.market_value : latest;
  const delta = latest - previous;
  const direction = delta > SAME_VALUE_EPS ? 'up' : delta < -SAME_VALUE_EPS ? 'down' : 'flat';
  const pct = previous !== 0 ? (delta / previous) * 100 : null;
  return { direction, latest, previous, delta, pct };
}

// Rebuilding an analysis from its saved session ------------------------------
//
// A research session stores its comps as `market_research_data_points`; a price
// history mark stores the same comps inside `snapshot.rows`. Turning the former
// into the latter is what both restore paths do — the per-card button in the
// research modal and the bulk pass over a whole collection.
//
// They have to agree with commitHistory on which rows belong in a snapshot and
// how each field is normalized, because `content_hash` over the result is what
// decides whether an analysis is already charted. A disagreement of a single
// trimmed string would make every already-correct card look unrestored and
// write a duplicate mark. Hence one implementation, here, rather than three.

// The subset of a stored comp row this needs. Structural, so both the modal's
// richer DataPointRow and a bare select() satisfy it.
export type StoredDataPoint = {
  position: number;
  source: string;
  source_label: string | null;
  grade_company: string | null;
  grade_value: string | null;
  sale_date: string | null;
  price: number | null;
  weight_pct: number | null;
  url: string | null;
  notes: string | null;
};

// Whether a stored comp carries anything the owner actually entered. Mirrors
// the research modal's rowHasUserContent: pre-populated source and grade
// defaults are scaffolding from the modal opening, not committed data.
export function dataPointHasUserContent(d: StoredDataPoint): boolean {
  if (d.price !== null && d.price !== undefined) return true;
  if (d.weight_pct !== null && d.weight_pct !== undefined) return true;
  if ((d.url || '').trim()) return true;
  if ((d.notes || '').trim()) return true;
  if (d.source === 'other' && (d.source_label || '').trim()) return true;
  return false;
}

// The comps of a saved session, in the shape a snapshot stores them.
export function analysisFromDataPoints(dps: StoredDataPoint[]): AnalysisRow[] {
  return dps.filter(dataPointHasUserContent).map(d => ({
    position: d.position,
    source: d.source,
    source_label: d.source === 'other' ? (d.source_label || '').trim() || null : null,
    grade_company: d.grade_company,
    grade_value: d.grade_value,
    sale_date: d.sale_date,
    price: d.price,
    weight_pct: d.weight_pct,
    url: (d.url || '').trim() || null,
    notes: (d.notes || '').trim() || null,
  }));
}
