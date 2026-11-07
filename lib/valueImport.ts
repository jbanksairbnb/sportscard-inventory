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
//                             or "Nov 5, 2026 $99.99; Oct 30, 2026 $85.00"
//   - "<period> Sale Link(s)" the matching URLs, same order, " | " separated
//   - "Sale Format(s)" / "Sale Platform(s)" per-sale format and venue, same order
//   - "Value Basis"           how the value was reached ("Replaced: …",
//                             "Unchanged: …") — stored as the mark's note
// Lists are " | " separated; files that use "; " instead are read the same way.
// A "Target Price" column, when present, updates each card's Target Price too
// (no history entry — targets aren't tracked over time). A file may carry
// Target Price without Value to update targets alone.
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
  format: string | null;    // "Auction", "Buy It Now", … — from the Sale Format(s)
                            // column, else from the entry's own text
  platform: string | null;  // "eBay", "Fanatics", … — from the Sale Platform(s) column
  url: string | null;
  used: boolean;            // named in Value Basis as part of the value
};

export type CsvValueRow = {
  line: number;             // 1-based line in the file, for messages
  cardNumber: string;
  player: string;
  gradingCompany: string;
  grade: string;
  rawGrade: string;
  cost: number | null;      // tells two otherwise identical copies apart
  value: number | null;
  targetPrice: number | null; // null: column absent or cell blank — leave the target alone
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

// Words that name how a sale was made rather than what was sold.
const FORMAT_RE = /^(auction|buy it now|buy-it-now|bin|best offer( accepted)?|fixed price)$/i;

// Text inside the first top-level (...) — "(VG-VGEX (crease), Auction)" gives
// "VG-VGEX (crease), Auction", where a plain regex would stop at "(crease".
function firstParenGroup(s: string): string | null {
  const start = s.indexOf('(');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return s.slice(start + 1, i);
  }
  return s.slice(start + 1);
}

// "Sep 26: $1,100.00 (Gray Back) [MC]", "Oct 20: $1,250.00 [MK] (Buy It Now)",
// "Oct 16: $22.50 (VG-VGEX (crease), Auction)" → parts. `year` comes from the
// column header ("Aug-Oct 2026 Sale(s)") since the entries themselves omit it.
export function parseSale(entry: string, year: number): Omit<ImportedSale, 'url' | 'used' | 'platform'> | null {
  const text = entry.trim();
  if (!text) return null;
  // "Nov 3: $630.00", "Nov 3 $630.00" or "Nov 5, 2026 $99.99" — the colon and
  // the year are optional, the $ is not, so prose like "Oct 18, 2026." is never
  // mistaken for a sale. A year in the entry beats the one from the header.
  const m = text.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:\s*,?\s*((?:19|20)\d{2}))?\s*(?::\s*\$?|\$)\s*(\d[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  const saleYear = m[3] ? Number(m[3]) : year;
  const price = parseMoney(m[4]);
  const sale_date = month && day >= 1 && day <= 31
    ? `${saleYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : null;
  const rest = text.slice(m[0].length);
  const qualifier = rest.match(/\[([^\]]*)\]/)?.[1]?.trim() || null;
  // The parenthesis holds a variant/condition and/or the sale format, comma
  // separated: "Gray Back", "Buy It Now", "VG-VGEX (crease), Auction".
  const parts = (firstParenGroup(rest) ?? '').split(/,(?![^(]*\))/).map(p => p.trim()).filter(Boolean);
  const format = parts.find(p => FORMAT_RE.test(p)) ?? null;
  const variant = parts.filter(p => !FORMAT_RE.test(p)).join(', ') || null;
  const label = `${m[1]} ${m[2]}: $${m[4]}`;
  return { sale_date, label, price, variant, qualifier, format };
}

// "Nov 3: $630.00", "Nov 3 $630.00" and "Nov 3, 2026 $630.00" are the same sale.
const dropDateColon = (t: string) =>
  t.replace(/\b([A-Za-z]{3}\.?\s+\d{1,2})(?:\s*,?\s*(?:19|20)\d{2}\b)?\s*(?::\s*|(?=\$))/g, '$1 ');

// Whether `text` names this sale ("Sep 5: $1,249.00"), and not merely a longer
// price that starts the same way ("Sep 5: $1,249.001").
function mentions(text: string, label: string): boolean {
  const hay = dropDateColon(text);
  const needle = dropDateColon(label);
  let i = hay.indexOf(needle);
  while (i >= 0) {
    if (!/[\d.]/.test(hay[i + needle.length] ?? '')) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

const mean = (xs: ImportedSale[]) => {
  const p = xs.filter(s => s.price !== null);
  return p.length ? p.reduce((a, s) => a + (s.price as number), 0) / p.length : null;
};

// Which sales the value was averaged from.
//
// Value Basis is prose, and files word it differently: it may name the sales
// it used ("average of 2 White Back sale(s) (Sep 5: …, Aug 28: …)"), the ones
// it left out ("… excluded: Oct 20: …"), or a sale it kept despite looking
// odd ("Average includes Aug 11 $280.00 sale, well below the other two").
// So each reading is checked against the Value the file states, and the first
// whose plain average equals it wins:
//   0. the N most recent sales, when Value Basis says "N most recent";
//   1. the sales Value Basis names (outside an "excluded" clause);
//   2. every sale except those named in an "excluded" clause;
//   3. every listed sale.
// When none adds up (a rounded or hand-set value), the wording decides as
// before: named sales, else all but the excluded ones.
function markUsed(sales: ImportedSale[], basis: string, value: number | null) {
  const exAt = basis.search(/exclud/i);
  const included = exAt >= 0 ? basis.slice(0, exAt) : basis;
  const excluded = exAt >= 0 ? basis.slice(exAt) : '';
  const named = sales.filter(s => mentions(included, s.label));
  const notExcluded = sales.filter(s => !mentions(excluded, s.label));
  // "Average of 5 most recent of 30 qualifying sale(s)": the newest N of the
  // sales not excluded (undated ones last, file order breaking ties).
  const recentN = Number(basis.match(/\b(\d+)\s+most\s+recent\b/i)?.[1] ?? 0);
  const recent = recentN > 0
    ? notExcluded
        .map((s, k) => ({ s, k }))
        .sort((a, b) => (b.s.sale_date ?? '').localeCompare(a.s.sale_date ?? '') || a.k - b.k)
        .slice(0, recentN)
        .map(x => x.s)
    : [];
  const readings = [recent, named, notExcluded, sales].filter(r => r.length);
  const fits = (r: ImportedSale[]) => {
    const m = mean(r);
    return value !== null && m !== null && Math.abs(m - value) <= 0.01;
  };
  const chosen = readings.find(fits) ?? (recent.length ? recent : named.length ? named : notExcluded);
  for (const s of sales) s.used = chosen.includes(s);
}

// Locate a column by exact header (case-insensitive) or by a pattern.
function findCol(headers: string[], ...tests: Array<string | RegExp>): number {
  for (const t of tests) {
    const i = headers.findIndex(h => typeof t === 'string' ? norm(h) === norm(t) : t.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

// Split a per-sale list cell. Files separate entries with "|" — or, in some
// exports, ";" ("Oct 20 $181.50; Oct 11 $250.00"). A cell that has any "|"
// is split on "|" only, so a ";" inside an older entry's text stays put.
function splitList(cell: string): string[] {
  return cell.split(cell.includes('|') ? '|' : ';').map(s => s.trim());
}

export function parseValueCsv(text: string, fallbackYear: number): ParsedValueCsv {
  const grid = parseCsv(text.replace(/^﻿/, '')).filter(r => r.some(c => c.trim() !== ''));
  if (grid.length < 2) return { rows: [], error: 'The file has no data rows.' };
  const headers = grid[0].map(h => h.trim());

  const iCard = findCol(headers, 'Card #', 'Card Number', 'Card No', '#');
  const iValue = findCol(headers, 'Value', 'New Value', 'Market Value');
  const iTarget = findCol(headers, 'Target Price', 'Target', 'New Target Price', 'Target Value');
  if (iCard < 0 || (iValue < 0 && iTarget < 0)) {
    return { rows: [], error: 'The file needs a "Card #" column and a "Value" (or "Target Price") column.' };
  }
  const iPlayer = findCol(headers, 'Description', 'Player');
  const iCompany = findCol(headers, 'Grading Company');
  const iGrade = findCol(headers, 'Grade');
  const iRawGrade = findCol(headers, 'Raw Grade');
  const iCost = findCol(headers, 'Cost');
  const iSales = findCol(headers, /sale\(s\)\s*$/i, /^sales?$/i);
  const iLinks = findCol(headers, /link\(s\)\s*$/i, /^sale links?$/i);
  const iFormats = findCol(headers, /format\(s\)\s*$/i, /^sale formats?$/i, /^formats?$/i);
  const iPlatforms = findCol(headers, /platform\(s\)\s*$/i, /^sale platforms?$/i, /^platforms?$/i);
  const iBasis = findCol(headers, 'Value Basis', 'Basis', 'Value Notes');

  const yearInHeader = iSales >= 0 ? headers[iSales].match(/\b(19|20)\d{2}\b/)?.[0] : undefined;
  const saleYear = yearInHeader ? Number(yearInHeader) : fallbackYear;

  const rows: CsvValueRow[] = [];
  grid.slice(1).forEach((cells, idx) => {
    const cell = (i: number) => (i >= 0 ? String(cells[i] ?? '').trim() : '');
    const cardNumber = cell(iCard);
    if (!cardNumber) return;
    const basis = cell(iBasis);
    const links = splitList(cell(iLinks));
    const formats = splitList(cell(iFormats));
    const platforms = splitList(cell(iPlatforms));
    const sales: ImportedSale[] = [];
    splitList(cell(iSales)).forEach((entry, k) => {
      const s = parseSale(entry, saleYear);
      if (!s) return;
      const url = /^https?:\/\//i.test(links[k] ?? '') ? links[k] : null;
      // The Sale Format(s) column, position for position, beats the entry text.
      const format = formats[k] || s.format;
      sales.push({ ...s, format, platform: platforms[k] || null, url, used: true });
    });
    markUsed(sales, basis, parseMoney(cell(iValue)));
    rows.push({
      line: idx + 2,
      cardNumber,
      player: cell(iPlayer),
      gradingCompany: cell(iCompany),
      grade: cell(iGrade),
      rawGrade: cell(iRawGrade),
      cost: parseMoney(cell(iCost)),
      value: parseMoney(cell(iValue)),
      targetPrice: parseMoney(cell(iTarget)),
      basis,
      sales,
    });
  });
  return { rows, error: null };
}

// ── Matching file rows to set rows ──────────────────────────────────────────

// 'fill': the value is unchanged, but the card's latest history entry is an
// earlier CSV import of that same value that came through without its sales
// (a file whose sale lines the importer couldn't read at the time). Applying
// adds the sales to that entry, keeping its date, instead of skipping the card.
// 'target': the value is unchanged or absent, but the file's Target Price
// differs from the card's — only the target is updated.
export type PlanStatus = 'change' | 'fill' | 'target' | 'unchanged' | 'no-value' | 'not-found' | 'ambiguous';

export type ImportPlanItem = {
  csv: CsvValueRow;
  status: PlanStatus;
  rowIndex: number | null;   // index into the set's rows
  currentValue: number | null;
  newValue: number | null;
  currentTarget: number | null;
  newTarget: number | null;  // set only when the file's target differs from the card's
  fillMarkId?: string;       // status 'fill': the history entry to complete
  fillNotes?: string | null; // …and its note, kept as it was
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
    if (candidates.length > 1) {
      // A graded copy and a raw copy of the same card are told apart by the
      // Grading Company: a file row without one is the raw copy.
      const g = candidates.filter(({ r }) => csv.gradingCompany
        ? norm(r['Grading Company']) === norm(csv.gradingCompany) &&
          (!csv.grade || norm(r['Grade']) === norm(csv.grade))
        : !norm(r['Grading Company']));
      if (g.length) candidates = g;
    }
    if (candidates.length > 1 && csv.rawGrade) {
      const g = candidates.filter(({ r }) => norm(r['Raw Grade']) === norm(csv.rawGrade));
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
    if (candidates.length > 1 && csv.cost !== null) {
      // Two copies of the same card at the same grade: what each one cost.
      const c = candidates.filter(({ r }) => {
        const cost = parseMoney(r['Cost']);
        return cost !== null && Math.abs(cost - (csv.cost as number)) < 0.005;
      });
      if (c.length) candidates = c;
    }
    if (candidates.length > 1) {
      // Still more than one, but every one is the same card at the same grade
      // (same price-history series): any of them takes this value, so pair
      // them in file order. The next file row for the card gets the next copy.
      const sig = ({ r }: { r: Record<string, any> }) =>
        [r['Grading Company'], r['Grade'], r['Raw Grade'], r['Player'] ?? r['Description']].map(norm).join('|');
      if (new Set(candidates.map(sig)).size === 1) candidates = candidates.slice(0, 1);
    }

    const base = { csv, newValue: csv.value, currentTarget: null, newTarget: null };
    if (candidates.length === 0) return { ...base, status: 'not-found', rowIndex: null, currentValue: null };
    if (candidates.length > 1) return { ...base, status: 'ambiguous', rowIndex: null, currentValue: null };
    const { r, i } = candidates[0];
    claimed.add(i);
    const currentValue = parseMoney(r['Value']);
    const currentTarget = parseMoney(r['Target Price']);
    const newTarget = csv.targetPrice !== null && csv.targetPrice > 0 &&
      (currentTarget === null || Math.abs(currentTarget - csv.targetPrice) >= 0.005)
      ? csv.targetPrice : null;
    const withTarget = { ...base, rowIndex: i, currentValue, currentTarget, newTarget };
    if (csv.value === null || csv.value <= 0) {
      return { ...withTarget, newValue: null, status: newTarget !== null ? 'target' : 'no-value' };
    }
    const unchanged = currentValue !== null && Math.abs(currentValue - csv.value) < 0.005;
    if (unchanged) return { ...withTarget, status: newTarget !== null ? 'target' : 'unchanged' };
    return { ...withTarget, status: 'change' };
  });
}

// ── The comps a mark carries ────────────────────────────────────────────────

export type EbaySaleSource = 'ebay_sold_auction' | 'ebay_sold_bin';

// The research table's eBay source for a sale's format. A sale with no stated
// format is recorded as Buy-It-Now.
export function saleSource(s: Pick<ImportedSale, 'format' | 'variant' | 'qualifier'>): EbaySaleSource {
  const text = `${s.format ?? ''} ${s.variant ?? ''} ${s.qualifier ?? ''}`.toLowerCase();
  if (/auction/.test(text)) return 'ebay_sold_auction';
  return 'ebay_sold_bin';
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
  card: { grading_company: string | null; grade: string | null; raw_grade?: string | null },
): AnalysisRow[] {
  const priced = sales.filter(s => s.price !== null);
  const anyUsed = priced.some(s => s.used);
  const counts = (s: ImportedSale) => s.price !== null && (!anyUsed || s.used);
  // Comps carry the card's own grade, the way the research table pre-fills
  // them; a raw card is "Raw" + its raw grade. What the sale itself was listed
  // as (a range like "VG-VGEX (crease)") goes in the row note.
  const graded = !!(card.grading_company && card.grade);
  const company = graded ? card.grading_company : card.raw_grade ? 'Raw' : null;
  const grade = graded ? card.grade : card.raw_grade ?? null;
  const weights = evenSplit(sales.filter(counts).length);
  let k = 0;
  return sales.map((s, i) => {
    // The comp's source is an eBay type; a sale made elsewhere says where.
    const venue = s.platform && !/^ebay$/i.test(s.platform) ? s.platform : null;
    const notes = [s.variant, s.qualifier ? `[${s.qualifier}]` : null, venue, counts(s) ? null : 'not used']
      .filter(Boolean).join(' · ') || null;
    return {
      position: i,
      source: saleSource(s),
      source_label: null,
      grade_company: company,
      grade_value: grade,
      sale_date: s.sale_date,
      price: s.price,
      weight_pct: counts(s) ? weights[k++] : 0,
      url: s.url,
      notes,
    };
  });
}
