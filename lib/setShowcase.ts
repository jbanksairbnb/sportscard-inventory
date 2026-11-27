// Shared, framework-free logic behind a set's showcase: the owner's set view
// and the public /seller/<handle>/set/<slug> page both turn a set's rows plus
// its value history into the same derived picture (top cards, completion,
// condition mix, value over time), so the two pages can never disagree.

import { cardValueKey, trendFromRows, type Trend } from '@/lib/cardValueHistory';
import { RAW_GRADES } from '@/lib/listingTitle';

// One value mark, trimmed to what the showcase needs. The public page ships
// these to the browser, so it deliberately carries no comps or notes.
export type MiniMark = { market_value: number; created_at: string; mark_kind?: string | null };

export type KeyCardNote = { card: string; note: string };

// Per-set selling settings (columns on public.sets).
export type ShowcaseSettings = {
  public_enabled: boolean;
  description: string | null;
  asking_price: number | null;
  accept_offers: boolean;
  min_offer: number | null;
  show_card_values: boolean;
  key_cards: KeyCardNote[];
  condition_notes: string | null;
  sale_terms: string | null;
};

export const SHOWCASE_COLUMNS =
  'public_enabled, description, asking_price, accept_offers, min_offer, show_card_values, key_cards, condition_notes, sale_terms';

export function normalizeSettings(raw: Record<string, unknown> | null | undefined): ShowcaseSettings {
  const r = raw || {};
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const keyCards = Array.isArray(r.key_cards)
    ? (r.key_cards as unknown[])
        .map(k => {
          const o = (k || {}) as Record<string, unknown>;
          return { card: String(o.card ?? '').trim(), note: String(o.note ?? '').trim() };
        })
        .filter(k => k.card)
    : [];
  return {
    public_enabled: !!r.public_enabled,
    description: (r.description as string) || null,
    asking_price: num(r.asking_price),
    accept_offers: !!r.accept_offers,
    min_offer: num(r.min_offer),
    show_card_values: r.show_card_values === undefined || r.show_card_values === null ? true : !!r.show_card_values,
    key_cards: keyCards,
    condition_notes: (r.condition_notes as string) || null,
    sale_terms: (r.sale_terms as string) || null,
  };
}

// A card as the showcase displays it. Only public-safe fields.
export type ShowcaseCard = {
  rowIdx: number;          // index into the set's original rows
  key: string;             // value-history identity key
  cardNumber: string;
  player: string;
  condition: string;       // "PSA 8", "Raw EX", or ""
  owned: boolean;
  value: number | null;
  trend: Trend | null;
  lastMarkAt: string | null;
  imageFront: string | null;
  imageBack: string | null;
};

export function parseValue(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Same identity tuple the set view and edit page use to group value history.
export function valueKeyForRow(row: Record<string, unknown>, year: string, brand: string): string {
  const grade = String(row['Grade'] || '').trim() || null;
  const gradingCompany = String(row['Grading Company'] || '').trim() || null;
  const rawGrade = String(row['Raw Grade'] || '').trim() || null;
  const isGraded = !!gradingCompany;
  return cardValueKey({
    year: year ? Number(year) || null : null,
    brand: brand || null,
    card_number: String(row['Card #'] || '').trim() || null,
    grade: isGraded ? grade : null,
    grading_company: isGraded ? gradingCompany : null,
    raw_grade: !isGraded ? rawGrade : null,
  });
}

export function conditionLabelForRow(row: Record<string, unknown>): string {
  const gradingCo = String(row['Grading Company'] || '').trim();
  const grade = String(row['Grade'] || '').trim();
  const rawGrade = String(row['Raw Grade'] || '').trim();
  if (gradingCo) return `${gradingCo}${grade ? ' ' + grade : ''}`;
  if (rawGrade) return `Raw ${rawGrade}`;
  return '';
}

// Card numbers sort numerically where they are numbers ("2" < "10"), with any
// suffix or non-numeric numbers ("SP1", "47T") falling back to text order.
export function compareCardNumbers(a: string, b: string): number {
  const ma = /^(\d+)(.*)$/.exec(a.trim());
  const mb = /^(\d+)(.*)$/.exec(b.trim());
  if (ma && mb) {
    const d = Number(ma[1]) - Number(mb[1]);
    if (d !== 0) return d;
    return ma[2].localeCompare(mb[2]);
  }
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

// Every row of the set as a ShowcaseCard, in card-number order. The current
// value is the owner-entered Value, falling back to the latest mark.
export function buildShowcaseCards(
  rows: Array<Record<string, unknown>>,
  year: string,
  brand: string,
  marksByKey: Record<string, MiniMark[]>,
): ShowcaseCard[] {
  const out: ShowcaseCard[] = rows.map((row, rowIdx) => {
    const key = valueKeyForRow(row, year, brand);
    const chrono = (marksByKey[key] || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const typed = parseValue(row['Value']);
    const value = typed > 0 ? typed : chrono.length ? chrono[chrono.length - 1].market_value : null;
    return {
      rowIdx,
      key,
      cardNumber: String(row['Card #'] || '').trim(),
      player: String(row['Player'] || row['Description'] || '').trim(),
      condition: conditionLabelForRow(row),
      owned: String(row['Owned'] || '') === 'Yes',
      value,
      trend: trendFromRows(chrono),
      lastMarkAt: chrono.length ? chrono[chrono.length - 1].created_at : null,
      imageFront: String(row['Image 1'] || '').trim() || null,
      imageBack: String(row['Image 2'] || '').trim() || null,
    };
  });
  return out.sort((a, b) => compareCardNumbers(a.cardNumber, b.cardNumber) || a.rowIdx - b.rowIdx);
}

// The highest-value owned cards, one per value identity.
export function topCardsByValue(cards: ShowcaseCard[], n = 16): ShowcaseCard[] {
  const seen = new Set<string>();
  const out: ShowcaseCard[] = [];
  for (const c of cards.filter(c => c.owned && c.value !== null && c.value > 0).sort((a, b) => (b.value! - a.value!))) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

export type Completion = { total: number; owned: number; pct: number; missing: string[] };

export function completionOf(cards: ShowcaseCard[]): Completion {
  // Count distinct card numbers so duplicate copies don't inflate the total.
  const all = new Map<string, boolean>();
  for (const c of cards) {
    const k = c.cardNumber || `row-${c.rowIdx}`;
    all.set(k, (all.get(k) || false) || c.owned);
  }
  const total = all.size;
  let owned = 0;
  const missing: string[] = [];
  for (const [num, has] of all) {
    if (has) owned += 1;
    else missing.push(num);
  }
  missing.sort(compareCardNumbers);
  return { total, owned, pct: total > 0 ? (owned / total) * 100 : 0, missing };
}

export type ConditionBucket = { label: string; count: number };
export type ConditionSummary = {
  graded: number;
  raw: number;
  ungraded: number;     // owned with no grade recorded at all
  buckets: ConditionBucket[]; // best → worst
  byCompany: ConditionBucket[];
};

const RAW_ORDER: string[] = [...RAW_GRADES];

export function conditionSummaryOf(cards: ShowcaseCard[]): ConditionSummary {
  const owned = cards.filter(c => c.owned);
  const buckets = new Map<string, number>();
  const companies = new Map<string, number>();
  let graded = 0, raw = 0, ungraded = 0;
  for (const c of owned) {
    if (!c.condition) { ungraded += 1; continue; }
    if (c.condition.startsWith('Raw ')) {
      raw += 1;
      const g = c.condition.slice(4);
      buckets.set(g, (buckets.get(g) || 0) + 1);
    } else {
      graded += 1;
      buckets.set(c.condition, (buckets.get(c.condition) || 0) + 1);
      const co = c.condition.split(' ')[0];
      companies.set(co, (companies.get(co) || 0) + 1);
    }
  }
  const rank = (label: string) => {
    const i = RAW_ORDER.indexOf(label);
    if (i >= 0) return 100 + i;
    // Graded: higher numeric grade first.
    const n = Number(label.split(' ').pop());
    return Number.isFinite(n) ? 20 - n : 500;
  };
  return {
    graded, raw, ungraded,
    buckets: [...buckets.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => rank(a.label) - rank(b.label)),
    byCompany: [...companies.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}

// Set value over time, one point per month with any marks, ending today.
// For each owned card, the value at a date is its latest mark on or before
// that date; a card with no mark yet is carried back at its earliest mark so
// the line tracks price movement rather than how many cards had been priced.
// The last point is the set's current value.
export type TimelinePoint = { date: string; value: number };

export function valueTimeline(cards: ShowcaseCard[], marksByKey: Record<string, MiniMark[]>, currentValue: number): TimelinePoint[] {
  const seen = new Set<string>();
  const series: MiniMark[][] = [];
  for (const c of cards) {
    if (!c.owned || seen.has(c.key)) continue;
    seen.add(c.key);
    const m = (marksByKey[c.key] || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (m.length) series.push(m);
  }
  if (series.length === 0) return [];
  const months = new Set<string>();
  for (const s of series) for (const m of s) months.add(m.created_at.slice(0, 7));
  const sorted = [...months].sort();
  const points: TimelinePoint[] = sorted.map(month => {
    const [y, mo] = month.split('-').map(Number);
    const end = new Date(Date.UTC(y, mo, 1)).toISOString(); // start of next month
    let total = 0;
    for (const s of series) {
      let v = s[0].market_value;
      for (const m of s) {
        if (m.created_at < end) v = m.market_value;
        else break;
      }
      total += v;
    }
    return { date: `${month}-01`, value: Math.round(total * 100) / 100 };
  });
  const today = new Date().toISOString().slice(0, 10);
  if (points.length && points[points.length - 1].date.slice(0, 7) === today.slice(0, 7)) {
    points[points.length - 1] = { date: today, value: currentValue };
  } else {
    points.push({ date: today, value: currentValue });
  }
  return points;
}

// The most recent value mark anywhere in the set, and what kinds of pricing
// back the values — shown as "Values as of …" for buyer trust.
export function valuesProvenance(marksByKey: Record<string, MiniMark[]>): { asOf: string | null; fromComps: boolean } {
  let asOf: string | null = null;
  let fromComps = false;
  for (const list of Object.values(marksByKey)) {
    for (const m of list) {
      if (!asOf || m.created_at > asOf) asOf = m.created_at;
      if (m.mark_kind && m.mark_kind !== 'manual') fromComps = true;
    }
  }
  return { asOf, fromComps };
}
