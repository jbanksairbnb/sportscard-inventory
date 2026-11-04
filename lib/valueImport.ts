// Bulk value updates from a CSV — pure helpers, no React or network.
//
// The owner researches sold prices elsewhere (a spreadsheet, a research tool
// pulling eBay solds) and hands back a CSV of the set with new Values. Typing
// those into the grid one by one already records a price-history mark per
// card; this does the same for a whole file at once, so a bulk re-price adds
// to each card's history instead of overwriting it.
//
// The file only has to carry `Card #` and `Value`. A set export works as-is.
// Three optional columns make the mark richer:
//   - "<period> Sale(s)"      e.g. "Sep 26: $1,100.00 (Gray Back) | Sep 5: …"
//   - "<period> Sale Link(s)" the matching URLs, same order, " | " separated
//   - "Value Basis"           how the value was reached ("Replaced: …",
//                             "Unchanged: …") — stored as the mark's note
// When sales are present the mark carries them as comps, so opening the card's
// history shows exactly which sales a value came from.

import { parseCsv } from '@/lib/csv';
import type { AnalysisRow } from '@/lib/cardValueHistory';

export type ImportedSale = {
  sale_date: string | null; // YYYY-MM-DD
  label: string;            // the sale as written, e.g. "Sep 26: $1,100.00"
  price: number | null;
  variant: string | null;   // "Gray Back", "variant unstated", …
  qualifier: string | null; // "MC", "OC", …
  url: string | null;
  used: boolean;            // named in Value Basis as part of the value
};

export type CsvValueRow = {
  line: number;             // 1-based line in the file, for messages
  cardNumber: string;
  player: string;
  gradingCompany: string;
  grade: string;
  value: number | null;
  basis: string;
  sales: ImportedSale[];
};

export type ParsedValueCsv = {
  rows: CsvValueRow[];
  error: string | null;
};

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export function parseMoney(s: unknown): number | null {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// "Sep 26: $1,100.00 (Gray Back) [MC]" → parts. `year` comes from the column
// header ("Aug-Oct 2026 Sale(s)") since the entries themselves omit it.
export function parseSale(entry: string, year: number): Omit<ImportedSale, 'url' | 'used'> | null {
  const text = entry.trim();
  if (!text) return null;
  const m = text.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*:\s*\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  const price = parseMoney(m[3]);
  const sale_date = month && day >= 1 && day <= 31
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : null;
  const rest = text.slice(m[0].length);
  const variant = rest.match(/\(([^)]*)\)/)?.[1]?.trim() || null;
  const qualifier = rest.match(/\[([^\]]*)\]/)?.[1]?.trim() || null;
  const label = `${m[1]} ${m[2]}: $${m[3]}`;
  return { sale_date, label, price, variant, qualifier };
}

// Locate a column by exact header (case-insensitive) or by a pattern.
function findCol(headers: string[], ...tests: Array<string | RegExp>): number {
  for (const t of tests) {
    const i = headers.findIndex(h => typeof t === 'string' ? norm(h) === norm(t) : t.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseValueCsv(text: string, fallbackYear: number): ParsedValueCsv {
  const grid = parseCsv(text.replace(/^﻿/, '')).filter(r => r.some(c => c.trim() !== ''));
  if (grid.length < 2) return { rows: [], error: 'The file has no data rows.' };
  const headers = grid[0].map(h => h.trim());

  const iCard = findCol(headers, 'Card #', 'Card Number', 'Card No', '#');
  const iValue = findCol(headers, 'Value', 'New Value', 'Market Value');
  if (iCard < 0 || iValue < 0) {
    return { rows: [], error: 'The file needs a "Card #" column and a "Value" column.' };
  }
  const iPlayer = findCol(headers, 'Description', 'Player');
  const iCompany = findCol(headers, 'Grading Company');
  const iGrade = findCol(headers, 'Grade');
  const iSales = findCol(headers, /sale\(s\)\s*$/i, /^sales?$/i);
  const iLinks = findCol(headers, /link\(s\)\s*$/i, /^sale links?$/i);
  const iBasis = findCol(headers, 'Value Basis', 'Basis', 'Value Notes');

  const yearInHeader = iSales >= 0 ? headers[iSales].match(/\b(19|20)\d{2}\b/)?.[0] : undefined;
  const saleYear = yearInHeader ? Number(yearInHeader) : fallbackYear;

  const rows: CsvValueRow[] = [];
  grid.slice(1).forEach((cells, idx) => {
    const cell = (i: number) => (i >= 0 ? String(cells[i] ?? '').trim() : '');
    const cardNumber = cell(iCard);
    if (!cardNumber) return;
    const basis = cell(iBasis);
    const links = cell(iLinks).split('|').map(s => s.trim());
    const sales: ImportedSale[] = [];
    cell(iSales).split('|').forEach((entry, k) => {
      const s = parseSale(entry, saleYear);
      if (!s) return;
      const url = /^https?:\/\//i.test(links[k] ?? '') ? links[k] : null;
      // A sale counts toward the value when Value Basis names it.
      const used = !!basis && basis.includes(s.label);
      sales.push({ ...s, url, used });
    });
    rows.push({
      line: idx + 2,
      cardNumber,
      player: cell(iPlayer),
      gradingCompany: cell(iCompany),
      grade: cell(iGrade),
      value: parseMoney(cell(iValue)),
      basis,
      sales,
    });
  });
  return { rows, error: null };
}

// ── Matching file rows to set rows ──────────────────────────────────────────

export type PlanStatus = 'change' | 'unchanged' | 'no-value' | 'not-found' | 'ambiguous';

export type ImportPlanItem = {
  csv: CsvValueRow;
  status: PlanStatus;
  rowIndex: number | null;   // index into the set's rows
  currentValue: number | null;
  newValue: number | null;
};

function sameNumber(a: unknown, b: unknown) {
  return norm(a).replace(/^#/, '') === norm(b).replace(/^#/, '');
}

// Pair each file row with the set row it prices. Card # first; when a set holds
// more than one copy of a number, the grade and then the player narrow it down.
// A file row that still can't be pinned to one card is left alone rather than
// guessed at.
export function buildImportPlan(
  csvRows: CsvValueRow[],
  setRows: Array<Record<string, any>>,
): ImportPlanItem[] {
  const claimed = new Set<number>();
  return csvRows.map(csv => {
    let candidates = setRows
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !claimed.has(i) && sameNumber(r['Card #'], csv.cardNumber));
    if (candidates.length > 1 && (csv.gradingCompany || csv.grade)) {
      const g = candidates.filter(({ r }) =>
        (!csv.gradingCompany || norm(r['Grading Company']) === norm(csv.gradingCompany)) &&
        (!csv.grade || norm(r['Grade']) === norm(csv.grade)));
      if (g.length) candidates = g;
    }
    if (candidates.length > 1 && csv.player) {
      const p = candidates.filter(({ r }) => norm(r['Player'] ?? r['Description']) === norm(csv.player));
      if (p.length) candidates = p;
    }
    if (candidates.length > 1 && csv.value !== null) {
      // Several copies of the card: only the owned one(s) carry a value.
      const owned = candidates.filter(({ r }) => norm(r['Owned']) === 'yes');
      if (owned.length) candidates = owned;
    }

    const base = { csv, newValue: csv.value };
    if (candidates.length === 0) return { ...base, status: 'not-found', rowIndex: null, currentValue: null };
    if (candidates.length > 1) return { ...base, status: 'ambiguous', rowIndex: null, currentValue: null };
    const { r, i } = candidates[0];
    claimed.add(i);
    const currentValue = parseMoney(r['Value']);
    if (csv.value === null || csv.value <= 0) {
      return { ...base, status: 'no-value', rowIndex: i, currentValue };
    }
    const unchanged = currentValue !== null && Math.abs(currentValue - csv.value) < 0.005;
    return { ...base, status: unchanged ? 'unchanged' : 'change', rowIndex: i, currentValue };
  });
}

// ── The comps a mark carries ────────────────────────────────────────────────

export type EbaySaleSource = 'ebay_sold_auction' | 'ebay_sold_bin';

// A sale's own text wins over the import-wide default when it says which kind
// of sale it was ("(Auction)", "[BIN]", "Best Offer", …).
export function saleSource(s: ImportedSale, fallback: EbaySaleSource): EbaySaleSource {
  const text = `${s.variant ?? ''} ${s.qualifier ?? ''}`.toLowerCase();
  if (/auction/.test(text)) return 'ebay_sold_auction';
  if (/\bbin\b|buy[- ]?it[- ]?now|best offer|fixed/.test(text)) return 'ebay_sold_bin';
  return fallback;
}

// Split 100% evenly across `count` rows in hundredths, so the total is exactly
// 100 — the research table won't save at 99.99%. Leftover hundredths go one
// apiece to the first rows (3 → 33.34 / 33.33 / 33.33; 6 → 16.67 ×4, 16.66 ×2),
// which keeps the weighted value within a few cents of the plain average.
export function evenSplit(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(10000 / count);
  const extra = 10000 - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

// Sales become the analysis rows of the mark. The ones the value was averaged
// from share the weight evenly; the rest ride along at 0% so the history shows
// what was looked at and set aside (unstated variant, miscut, …). When Value
// Basis names none of them, every sale shares the weight.
export function salesToAnalysisRows(
  sales: ImportedSale[],
  card: { grading_company: string | null; grade: string | null },
  defaultSource: EbaySaleSource = 'ebay_sold_bin',
): AnalysisRow[] {
  const priced = sales.filter(s => s.price !== null);
  const anyUsed = priced.some(s => s.used);
  const counts = (s: ImportedSale) => s.price !== null && (!anyUsed || s.used);
  const weights = evenSplit(sales.filter(counts).length);
  let k = 0;
  return sales.map((s, i) => {
    const notes = [s.variant, s.qualifier ? `[${s.qualifier}]` : null, counts(s) ? null : 'not used']
      .filter(Boolean).join(' · ') || null;
    return {
      position: i,
      source: saleSource(s, defaultSource),
      source_label: null,
      grade_company: card.grading_company,
      grade_value: card.grade,
      sale_date: s.sale_date,
      price: s.price,
      weight_pct: counts(s) ? weights[k++] : 0,
      url: s.url,
      notes,
    };
  });
}
