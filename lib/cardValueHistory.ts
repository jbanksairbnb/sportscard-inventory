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

export type Trend = {
  direction: 'up' | 'down' | 'flat';
  latest: number;
  previous: number;
  delta: number;
  pct: number | null; // null when the previous value is 0 (no meaningful %)
};

// Trend for ONE card: the most recently committed value vs the value committed
// just before it. Returns null with fewer than two snapshots (nothing to
// compare against yet).
export function trendFromRows(rows: { market_value: number; created_at: string }[]): Trend | null {
  if (rows.length < 2) return null;
  const sorted = rows.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latest = sorted[sorted.length - 1].market_value;
  const previous = sorted[sorted.length - 2].market_value;
  const delta = latest - previous;
  const direction = delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'flat';
  const pct = previous !== 0 ? (delta / previous) * 100 : null;
  return { direction, latest, previous, delta, pct };
}
