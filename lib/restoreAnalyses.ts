// Finding analyses that never made it into the price history.
//
// A research session (the comps) and a price-history mark (the point on the
// chart) are written by different paths. The mark is only committed on an
// explicit Save research / Use value, and only once weights reach 100% — so an
// analysis saved before that gate, or on a build predating card_value_history,
// leaves every comp intact with nothing on the chart. Opening such a card shows
// an empty price history, which reads as the work having been lost.
//
// This surveys a whole collection for that condition and builds the marks that
// would fix it. It reads; it writes nothing. The caller shows the survey, and
// only writes what the owner accepts.

import {
  analysisFromDataPoints,
  cardValueKey,
  contentHash,
  normalizeAnalysis,
  type AnalysisRow,
  type AnalysisSnapshot,
  type StoredDataPoint,
} from '@/lib/cardValueHistory';

// A session as this needs it. Every column is one persistSession writes.
export type SessionForRestore = {
  id: string;
  card_year: number | null;
  card_brand: string | null;
  card_number: string | null;
  card_player: string | null;
  card_grade: string | null;
  card_grading_company: string | null;
  card_raw_grade: string | null;
  listing_id: string | null;
  set_slug: string | null;
  set_card_number: string | null;
  market_value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  market_research_data_points: StoredDataPoint[] | null;
};

// An existing mark, as far as matching cares.
export type MarkForRestore = {
  content_hash: string | null;
  source_session_id: string | null;
};

export type RestorableAnalysis = {
  sessionId: string;
  label: string;          // "1957 Topps #18 DON DRYSDALE"
  condition: string;      // "SGC 6.5" / "Raw EX" / "Raw"
  value: number;
  comps: number;
  /** When the analysis was done — the date its restored mark will carry. */
  at: string;
  payload: Record<string, unknown>;
};

function conditionLabel(s: SessionForRestore): string {
  if (s.card_grading_company && s.card_grade) return `${s.card_grading_company} ${s.card_grade}`;
  return s.card_raw_grade ? `Raw ${s.card_raw_grade}` : 'Raw';
}

function cardLabel(s: SessionForRestore): string {
  return [
    s.card_year ? String(s.card_year) : '',
    s.card_brand || '',
    s.card_number ? `#${s.card_number}` : '',
    s.card_player || '',
  ].filter(Boolean).join(' ').trim() || 'Card';
}

/**
 * Sessions carrying a market value whose analysis isn't in the price history.
 *
 * Two independent guards, because they catch different things. `content_hash`
 * catches an analysis already charted — a mark committed the normal way hashes
 * identically, so a card whose history is correct is never offered. The set of
 * `source_session_id`s catches a session restored on an earlier run, whose mark
 * would hash the same but whose presence we can prove directly.
 *
 * Newest first, so the review list opens on the work the owner did most
 * recently and is most likely to recognize.
 */
export function findRestorableAnalyses(
  userId: string,
  sessions: SessionForRestore[],
  marks: MarkForRestore[],
): RestorableAnalysis[] {
  const charted = new Set(marks.map(m => m.content_hash).filter((h): h is string => !!h));
  const restored = new Set(marks.map(m => m.source_session_id).filter((s): s is string => !!s));

  const out: RestorableAnalysis[] = [];
  for (const s of sessions) {
    if (s.market_value === null || !Number.isFinite(s.market_value)) continue;
    if (restored.has(s.id)) continue;

    const rows: AnalysisRow[] = analysisFromDataPoints(s.market_research_data_points || []);
    // A session with a value but no comps left is a husk — the value can't be
    // traced back to anything, so charting it would add a point nobody can
    // account for. Skip it rather than invent history.
    if (rows.length === 0) continue;

    const notes = (s.notes || '').trim() || null;
    const hash = contentHash(normalizeAnalysis(rows, notes, s.market_value));
    if (charted.has(hash)) continue;

    const at = s.updated_at || s.created_at;
    const snapshot: AnalysisSnapshot = { notes, market_value: s.market_value, rows };
    out.push({
      sessionId: s.id,
      label: cardLabel(s),
      condition: conditionLabel(s),
      value: s.market_value,
      comps: rows.length,
      at,
      payload: {
        user_id: userId,
        card_year: s.card_year,
        card_brand: s.card_brand,
        card_number: s.card_number,
        card_player: s.card_player,
        card_grade: s.card_grade,
        card_grading_company: s.card_grading_company,
        card_raw_grade: s.card_raw_grade,
        listing_id: s.listing_id,
        set_slug: s.set_slug,
        set_card_number: s.set_card_number,
        market_value: s.market_value,
        content_hash: hash,
        snapshot,
        mark_kind: 'research' as const,
        // Dating the mark to the analysis rather than to the restore is the
        // whole point: work done in August belongs at August in the series.
        // Restoring a year of analyses today would otherwise stack them all on
        // one day and chart a flat line with a cliff at the end.
        created_at: at,
        source_session_id: s.id,
        derived_from_id: null,
      },
    });
  }

  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

/**
 * Two analyses of the same card identity in the same restore.
 *
 * Sessions are updated in place, so one card normally has one — but a card
 * researched under a since-changed identity, or reopened after an earlier
 * analysis was forked, can have several. They are all real work and all get
 * restored; this only lets the review list say so, rather than showing what
 * look like duplicate rows.
 */
export function countPerCard(items: RestorableAnalysis[], sessions: SessionForRestore[]): Map<string, number> {
  const byId = new Map(sessions.map(s => [s.id, s]));
  const counts = new Map<string, number>();
  for (const it of items) {
    const s = byId.get(it.sessionId);
    if (!s) continue;
    const key = cardValueKey({
      year: s.card_year, brand: s.card_brand, card_number: s.card_number,
      grade: s.card_grade, grading_company: s.card_grading_company, raw_grade: s.card_raw_grade,
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
