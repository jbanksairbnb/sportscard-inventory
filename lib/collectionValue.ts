// Collection value tracking — pure helpers shared by the /collection-value page
// (browser) and the monthly snapshot cron (server). No Supabase or React here.
//
// A "card in the collection" is a set row marked Owned = Yes, from any set —
// personal and inventory alike. Its value is the row's Value field.

import { cardValueKey } from '@/lib/cardValueHistory';
import { itemName, itemTypeLabel, type CollectionItem } from '@/lib/collectionItems';

export type SetInput = {
  slug: string;
  title: string | null;
  year: number | string | null;
  brand: string | null;
  purpose: string | null;
  rows: Array<Record<string, any>> | null;
};

export type CollectionCard = {
  key: string;      // stable per-card key within the collection: slug|rowId
  histKey: string;  // slug|cardValueKey — joins to card_value_history
  setSlug: string;
  setTitle: string;
  group: 'personal' | 'inventory';
  name: string;     // "#150 Willie Mays"
  condition: string; // "PSA 8" / "Raw NM"
  value: number;   // total for the line: price × qty
  cost: number;
  // Units behind `value`. Marks are per unit, so a past month's value is
  // mark × qty. 1 for a card in a set.
  qty?: number;
};

// [value, name, condition, set title]
export type CardValueEntry = [number, string, string, string];

export type SetBreakdown = { slug: string; title: string; group: 'personal' | 'inventory'; value: number; cards: number };
export type TopCard = { key: string; name: string; condition: string; setTitle: string; value: number };

export type Snapshot = {
  month: string; // 'YYYY-MM'
  total_value: number;
  total_cost: number;
  owned_cards: number;
  valued_cards: number;
  coverage: number | null;
  by_purpose: { personal: number; inventory: number };
  by_set: SetBreakdown[];
  top_cards: TopCard[];
  card_values: Record<string, CardValueEntry>;
  source: 'month_end' | 'reconstructed' | 'live';
  taken_at: string;
};

export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return monthOf(new Date(Date.UTC(y, m - 1 + n, 1)));
}
// Last instant of a month, as an ISO string (for "as of month end" lookups).
export function monthEndIso(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1) - 1).toISOString();
}
export function monthLabel(month: string, long = false): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC',
  });
}
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function groupForPurpose(purpose: string | null | undefined): 'personal' | 'inventory' {
  return purpose === 'inventory' || purpose === 'for-sale' ? 'inventory' : 'personal';
}

// Every owned card across the given sets. Cards with no value are kept (they
// count toward "owned" and the coverage figure) with value 0.
export function extractCards(sets: SetInput[]): CollectionCard[] {
  const out: CollectionCard[] = [];
  for (const s of sets) {
    const setTitle = s.title || `${s.year || ''} ${s.brand || ''}`.trim() || s.slug;
    const group = groupForPurpose(s.purpose);
    const year = s.year ? Number(s.year) || null : null;
    const brand = s.brand || null;
    (s.rows || []).forEach((r, idx) => {
      if (String(r['Owned'] ?? '') !== 'Yes') return;
      const cardNo = String(r['Card #'] ?? '').trim();
      const player = String(r['Player'] ?? r['Description'] ?? '').trim();
      const gradingCompany = String(r['Grading Company'] ?? '').trim() || null;
      const grade = String(r['Grade'] ?? '').trim() || null;
      const rawGrade = String(r['Raw Grade'] ?? '').trim() || null;
      const isGraded = !!gradingCompany;
      const rowId = typeof r['_id'] === 'string' && r['_id'] ? r['_id'] : `n${cardNo}-${idx}`;
      out.push({
        key: `${s.slug}|${rowId}`,
        histKey: `${s.slug}|${cardValueKey({
          year, brand, card_number: cardNo || null,
          grade: isGraded ? grade : null,
          grading_company: isGraded ? gradingCompany : null,
          raw_grade: !isGraded ? rawGrade : null,
        })}`,
        setSlug: s.slug,
        setTitle,
        group,
        name: [cardNo ? `#${cardNo}` : '', player].filter(Boolean).join(' ') || 'Card',
        condition: isGraded ? `${gradingCompany} ${grade || ''}`.trim() : rawGrade ? `Raw ${rawGrade}` : 'Raw',
        value: parseMoney(r['Value']),
        cost: parseMoney(r['Cost']),
      });
    });
  }
  return out;
}

// Set slug used for singles/boxes/other items so their price points join to the
// same history-mark shape cards in sets use.
export const ITEMS_SLUG = 'items';
export const ITEMS_TITLE = 'Singles & items';

// Items from the collection_items table as collection cards. Always personal,
// like a card in a personal set.
export function extractItemCards(items: Pick<CollectionItem,
  'id' | 'item_type' | 'first_name' | 'last_name' | 'year' | 'brand' | 'description' | 'qty' | 'cost' | 'value'>[]): CollectionCard[] {
  return items.filter(i => i.qty > 0).map(i => ({
    key: `${ITEMS_SLUG}|${i.id}`,
    histKey: `${ITEMS_SLUG}|${i.id}`,
    setSlug: ITEMS_SLUG,
    setTitle: ITEMS_TITLE,
    group: 'personal' as const,
    name: itemName(i),
    condition: itemTypeLabel(i.item_type),
    value: i.qty * i.value,
    cost: i.qty * i.cost,
    qty: i.qty,
  }));
}

// An item's saved per-unit price points as history marks.
export function itemMarks(items: Pick<CollectionItem, 'id' | 'value_history'>[]): HistoryMark[] {
  return items.flatMap(i => (i.value_history || []).map(p => ({
    set_slug: ITEMS_SLUG, key: i.id, market_value: Number(p.value), created_at: p.at, kind: 'manual' as const,
  })));
}

// Marks that don't describe the owner's own view of a card's price. Imported
// CardSight medians and whole-set sweeps were found unreliable, so they are
// left out of every reconstructed value; a card falls back to its most recent
// research or typed mark instead.
const EXCLUDED_MARK_KINDS = new Set(['cardsight', 'sweep']);
export function usableMarks(marks: HistoryMark[]): HistoryMark[] {
  return marks.filter(m => !EXCLUDED_MARK_KINDS.has(m.kind ?? ''));
}

// Build a snapshot from cards priced by `valueOf` (current Value by default).
export function buildSnapshot(
  cards: CollectionCard[],
  month: string,
  source: Snapshot['source'],
  valueOf: (c: CollectionCard) => number | null = c => (c.value > 0 ? c.value : null),
  coverage: number | null = null,
): Snapshot {
  const card_values: Record<string, CardValueEntry> = {};
  const setMap = new Map<string, SetBreakdown>();
  const byPurpose = { personal: 0, inventory: 0 };
  let total = 0, cost = 0, valued = 0;
  for (const c of cards) {
    const sb = setMap.get(c.setSlug) ?? { slug: c.setSlug, title: c.setTitle, group: c.group, value: 0, cards: 0 };
    sb.cards += 1;
    setMap.set(c.setSlug, sb);
    cost += c.cost;
    const v = valueOf(c);
    if (v === null || !(v > 0)) continue;
    valued += 1;
    total += v;
    byPurpose[c.group] += v;
    sb.value += v;
    card_values[c.key] = [v, c.name, c.condition, c.setTitle];
  }
  const top_cards: TopCard[] = Object.entries(card_values)
    .map(([key, e]) => ({ key, value: e[0], name: e[1], condition: e[2], setTitle: e[3] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25);
  return {
    month, total_value: total, total_cost: cost, owned_cards: cards.length, valued_cards: valued,
    coverage, by_purpose: byPurpose,
    by_set: [...setMap.values()].sort((a, b) => b.value - a.value),
    top_cards, card_values, source, taken_at: new Date().toISOString(),
  };
}

export type HistoryMark = {
  set_slug: string | null; key: string; market_value: number; created_at: string;
  // Optional provenance, used only to weight a mark in the market index.
  kind?: string | null;
  notes?: string | null;
};

// Rebuild a past month from price-history marks: each card is valued at its
// latest mark on or before month end. This uses the cards owned TODAY, so it
// answers "what would today's collection have been worth then", not what was
// physically owned. `coverage` is the share of currently-valued cards that had
// a mark by then — low coverage means the figure is understated.
export function reconstructSnapshot(cards: CollectionCard[], marks: HistoryMark[], month: string): Snapshot {
  const end = monthEndIso(month);
  const latest = new Map<string, { v: number; at: string }>();
  for (const m of marks) {
    if (!m.set_slug || m.created_at > end) continue;
    const k = `${m.set_slug}|${m.key}`;
    const cur = latest.get(k);
    if (!cur || m.created_at > cur.at) latest.set(k, { v: Number(m.market_value), at: m.created_at });
  }
  const priced = cards.filter(c => c.value > 0);
  const hit = priced.filter(c => latest.has(c.histKey)).length;
  const coverage = priced.length ? hit / priced.length : 0;
  return buildSnapshot(cards, month, 'reconstructed', c => {
    const v = latest.get(c.histKey)?.v;
    return v === undefined ? null : v * (c.qty ?? 1);
  }, coverage);
}

export type Mover = {
  key: string;
  name: string;
  condition: string;
  setTitle: string;
  kind: 'repriced' | 'added' | 'removed';
  from: number;
  to: number;
  delta: number;
  pct: number | null;
};

export type Drivers = {
  repricedUp: number;
  repricedDown: number;
  added: number;
  removed: number;
  net: number;
  upCount: number;
  downCount: number;
  addedCount: number;
  removedCount: number;
};

// What changed between two snapshots, card by card.
export function diffSnapshots(prev: Snapshot, cur: Snapshot): { movers: Mover[]; drivers: Drivers } {
  const movers: Mover[] = [];
  const d: Drivers = { repricedUp: 0, repricedDown: 0, added: 0, removed: 0, net: 0, upCount: 0, downCount: 0, addedCount: 0, removedCount: 0 };
  for (const [key, e] of Object.entries(cur.card_values)) {
    const p = prev.card_values[key];
    if (!p) {
      movers.push({ key, name: e[1], condition: e[2], setTitle: e[3], kind: 'added', from: 0, to: e[0], delta: e[0], pct: null });
      d.added += e[0]; d.addedCount++;
    } else if (Math.abs(e[0] - p[0]) >= 0.005) {
      const delta = e[0] - p[0];
      movers.push({ key, name: e[1], condition: e[2], setTitle: e[3], kind: 'repriced', from: p[0], to: e[0], delta, pct: p[0] ? (delta / p[0]) * 100 : null });
      if (delta > 0) { d.repricedUp += delta; d.upCount++; } else { d.repricedDown += delta; d.downCount++; }
    }
  }
  for (const [key, p] of Object.entries(prev.card_values)) {
    if (cur.card_values[key]) continue;
    movers.push({ key, name: p[1], condition: p[2], setTitle: p[3], kind: 'removed', from: p[0], to: 0, delta: -p[0], pct: null });
    d.removed += -p[0]; d.removedCount++;
  }
  d.net = cur.total_value - prev.total_value;
  return { movers, drivers: d };
}


// Market index ---------------------------------------------------------------
//
// reconstructSnapshot answers "what would today's collection have been worth",
// but it carries each card's last mark forward indefinitely. A card re-marked
// once in March and never again looks perfectly flat through November, so the
// line stays level and then jumps whenever the stragglers are finally re-marked.
//
// The index below only believes what was observed. For each month it takes the
// cards that received a NEW mark that month, compares each to its value at the
// previous month end, and averages those moves weighted by prior value and by
// how trustworthy the mark is. Cards nobody re-marked contribute nothing —
// absence of a mark is not evidence of no change. Months chain together
// (index_m = index_{m-1} × link_m), cards first marked in a month are skipped
// (they are additions, not price moves), and the whole series is anchored to
// today's collection value so it reads in dollars.

// How far to trust one mark, 0–1. A sweep or import that rests on one sale is
// a single data point, not a market; a typed value is the owner's judgement.
export function markQuality(m: { kind?: string | null; notes?: string | null }): number {
  const kind = m.kind ?? 'research';
  if (kind === 'research') return 1;
  if (kind === 'manual') return 0.8;
  const n = /median of (\d+)/i.exec(m.notes ?? '');
  const comps = n ? Number(n[1]) : null;
  if (comps === null) return 0.5;
  return comps >= 5 ? 1 : comps >= 2 ? 0.7 : 0.35;
}

export type IndexPoint = {
  month: string;
  index: number;          // 100 at the first month
  link: number | null;    // this month's like-for-like change, as a ratio (null for the first month)
  observed: number;       // cards with a usable new mark this month
  coverage: number;       // share of collection value (at prior month end) that was observed
};

export function buildValueIndex(cards: CollectionCard[], marks: HistoryMark[], months: string[]): IndexPoint[] {
  if (!months.length) return [];
  const wanted = new Set(cards.filter(c => c.value > 0).map(c => c.histKey));
  // Weights are dollars at stake, so a line of ten boxes counts ten times one.
  const qtyOf = new Map(cards.map(c => [c.histKey, c.qty ?? 1] as const));
  const series = new Map<string, HistoryMark[]>();
  for (const m of marks) {
    if (!m.set_slug) continue;
    const k = `${m.set_slug}|${m.key}`;
    if (!wanted.has(k)) continue;
    const arr = series.get(k) ?? [];
    arr.push(m);
    series.set(k, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const out: IndexPoint[] = [{ month: months[0], index: 100, link: null, observed: 0, coverage: 0 }];
  for (let i = 1; i < months.length; i++) {
    const start = monthEndIso(months[i - 1]);
    const end = monthEndIso(months[i]);
    let num = 0, den = 0, observed = 0, observedValue = 0, allValue = 0;
    for (const [k, arr] of series) {
      const q = qtyOf.get(k) ?? 1;
      let prev: HistoryMark | null = null;
      let last: HistoryMark | null = null;
      for (const m of arr) {
        if (m.created_at <= start) prev = m;
        else if (m.created_at <= end) last = m;
      }
      if (!prev) continue;
      const pv = Number(prev.market_value) * q;
      if (!(pv > 0)) continue;
      allValue += pv;
      if (!last) continue;
      const cv = Number(last.market_value) * q;
      if (!(cv > 0)) continue;
      // A re-mark at the same price restates the prior one; it confirms a flat
      // market at half the weight rather than counting as a second opinion.
      const repeat = Math.abs(cv - pv) < 0.005;
      const w = markQuality(last) * (repeat ? 0.5 : 1);
      num += w * cv;
      den += w * pv;
      observed += 1;
      observedValue += pv;
    }
    const link = den > 0 ? num / den : 1;
    out.push({
      month: months[i],
      index: out[i - 1].index * link,
      link: den > 0 ? link : null,
      observed,
      coverage: allValue > 0 ? observedValue / allValue : 0,
    });
  }
  return out;
}
