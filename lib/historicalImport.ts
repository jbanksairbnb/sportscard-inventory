// Historical (yearly) values from a valuation workbook — pure helpers, no React
// or network.
//
// The owner keeps one sheet per year in which every set is a block of columns
// laid side by side:
//
//   row 1:  <set name>                    <set name>               …
//   row 2:  Value | Cost | Description    Value | Cost | Description
//   row 3+: 175   | 212  | #7 Bill Dickey SGC 5
//
// The set name sits over any column of its block ("1953 Topps", "1975", …), and
// blocks are not always separated by an empty column. Lots and complete sets
// ("Complete Set", "Lot of 149 PSA 7") share the columns with single cards.
//
// Only a graded single whose set, card number, grading company and grade match
// a card in the owner's sets exactly — and whose name fits that card's player —
// becomes a history entry. Everything else is listed with the reason it was
// skipped, so nothing is guessed at.

import { cardValueKey } from '@/lib/cardValueHistory';

export type SheetEntry = {
  setLabel: string;        // the block's heading, as written
  year: number | null;
  brand: string;           // heading minus the year ("Topps", "Topps Tiffany", "" for "1975")
  text: string;            // the description cell, as written
  cell: string;            // "C5" — where it is in the sheet
  value: number | null;
  cardNumber: string | null;
  name: string | null;
  company: string | null;  // "PSA", "SGC", …
  grade: string | null;    // "8", "6.5"
  problem: string | null;  // why it can't be imported, before any matching
};

export type SheetBlock = {
  setLabel: string;
  cell: string;
  problem: string | null;  // set-level reason nothing in the block is read
  entries: number;
};

export type ParsedSheet = { entries: SheetEntry[]; blocks: SheetBlock[]; error: string | null };

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function colName(i: number): string {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export function parseMoney(s: unknown): number | null {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const COMPANIES = 'PSA|SGC|BGS|BVG|CSG|CGC|HGA|KSA|GAI';
// "#7 Bill Dickey SGC 5", "100 Bench PSA 8", "#28 Brooks Robinson PSA 6.5 EX-MT+",
// "#101 Bobby Richardson PSA 5 (White Name)", "#310 Ernie Banks PSA EX 5".
const CARD_RE = new RegExp(`^#?\\s*(\\d+[A-Za-z]?)\\s+(.+?)\\s+(${COMPANIES})\\s+(?:[A-Z][A-Z+-]*\\s+)?(\\d{1,2}(?:\\.\\d)?)(?![\\d.])(.*)$`, 'i');
// PSA qualifiers make it a different grade than the card's own.
const QUALIFIER_RE = /\b(OC|O\/C|MC|ST|PD|OF|MK)\b/i;

export function parseDescription(text: string): Pick<SheetEntry, 'cardNumber' | 'name' | 'company' | 'grade' | 'problem'> {
  const t = text.trim().replace(/\s+/g, ' ');
  const none = { cardNumber: null, name: null, company: null, grade: null };
  // "Ruth/Aaron/Mays #1 PSA 7": the number after the name reads the same.
  const moved = t.replace(new RegExp(`^([^#\\d].*?)\\s+#\\s*(\\d+[A-Za-z]?)\\s+(?=(${COMPANIES})\\b)`, 'i'), '$2 $1 ');
  const m = moved.match(CARD_RE);
  if (!m) {
    if (!/^#?\s*\d/.test(t)) return { ...none, problem: 'Not a single card (no card # first)' };
    if (!new RegExp(`\\b(${COMPANIES})\\b`, 'i').test(t)) return { ...none, problem: 'No grading company and grade' };
    if (new RegExp(`^#?\\s*\\d+[A-Za-z]?\\s+(${COMPANIES})\\s+\\d`, 'i').test(t)) return { ...none, problem: 'No player name' };
    return { ...none, problem: 'Could not read the grade' };
  }
  const [, num, rawName, company, grade, rest] = m;
  // "#10 Jackie Robinson #10" repeats the number.
  const name = rawName.replace(/#\s*\d+[A-Za-z]?/g, ' ').replace(/\s+/g, ' ').trim();
  const parsed = { cardNumber: num, name, company: company.toUpperCase(), grade };
  // Only after the grade: "Pride of the NL" is a name, not an OF qualifier.
  if (QUALIFIER_RE.test(rest)) return { ...parsed, problem: 'Grade has a qualifier (OC, MC, …)' };
  if (/\bauto/i.test(t)) return { ...parsed, problem: 'Autograph' };
  if (!name) return { ...parsed, problem: 'No player name' };
  return { ...parsed, problem: null };
}

// `grid[r][c]` is the sheet's text, row 0 = sheet row 1.
export function parseHistoricalSheet(grid: string[][]): ParsedSheet {
  const at = (r: number, c: number) => String(grid[r]?.[c] ?? '').trim();
  // The heading row is the one (among the first few) with the most "Description" cells.
  let hr = -1, best = 0;
  for (let r = 0; r < Math.min(grid.length, 6); r++) {
    const n = (grid[r] || []).filter(v => norm(v) === 'description').length;
    if (n > best) { best = n; hr = r; }
  }
  if (hr < 1) return { entries: [], blocks: [], error: 'No "Description" column headings found under a row of set names.' };
  const nameRow = hr - 1;
  const width = Math.max(...grid.map(r => r.length));
  const entries: SheetEntry[] = [];
  const blocks: SheetBlock[] = [];
  const labelled = new Set<number>(); // set-name columns a block claimed

  let prevD = -1;
  for (let d = 0; d < width; d++) {
    if (norm(at(hr, d)) !== 'description') continue;
    // The block's set name and Value column: the nearest over this column or the
    // three before it, never reaching back into the previous block.
    const from = Math.max(0, d - 3, prevD + 1);
    prevD = d;
    let lc = -1;
    for (let c = d; c >= from; c--) if (at(nameRow, c)) { lc = c; break; }
    const near = (h: string) => {
      for (let c = d - 1; c >= from; c--) if (norm(at(hr, c)) === h) return c;
      return -1;
    };
    const vc = near('value');
    const setLabel = lc >= 0 ? at(nameRow, lc) : '';
    if (lc >= 0) labelled.add(lc);
    const cell = `${colName(d)}${hr + 1}`;
    const rows: number[] = [];
    for (let r = hr + 1; r < grid.length; r++) if (at(r, d)) rows.push(r);
    const problem = !setLabel ? 'No set name above this block'
      : vc < 0 ? 'No "Value" column in this block'
      : !rows.length ? 'No cards listed under "Description"'
      : null;
    // A stray heading with nothing under it and no set name isn't a block.
    if (!setLabel && !rows.length) continue;
    blocks.push({ setLabel: setLabel || `(column ${colName(d)})`, cell, problem, entries: problem ? 0 : rows.length });
    if (problem) continue;

    const year = Number(setLabel.match(/\b(18|19|20)\d{2}\b/)?.[0]) || null;
    const brand = setLabel.replace(/\b(18|19|20)\d{2}\b/, '').trim().replace(/\s+/g, ' ');
    for (const r of rows) {
      const text = at(r, d);
      const value = parseMoney(at(r, vc));
      const p = parseDescription(text);
      entries.push({
        setLabel, year, brand, text, cell: `${colName(d)}${r + 1}`, value, ...p,
        problem: p.problem ?? (!year ? 'Set name has no year' : value === null || value <= 0 ? 'No value' : null),
      });
    }
  }
  // Set names with no Description column under them (a block laid out without headings).
  for (let c = 0; c < width; c++) {
    if (at(nameRow, c) && !labelled.has(c)) {
      blocks.push({ setLabel: at(nameRow, c), cell: `${colName(c)}${nameRow + 1}`, problem: 'No "Value" / "Description" headings under this set name', entries: 0 });
    }
  }
  return { entries, blocks, error: null };
}

// ── Matching to the owner's cards ────────────────────────────────────────────

// Words a description adds to a name that the card's player name may not carry.
const TAG_WORDS = new Set([
  'rc', 'rookie', 'as', 'all', 'star', 'hl', 'highlight', 'highlights', 'rb', 'record', 'breaker',
  'tiffany', 'ia', 'tr', 'traded', 'w',
]);
const words = (s: string) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Every word of the sheet's name (tags aside) appears in the card's player name:
// "Bench" fits JOHNNY BENCH, "Ernie Banks RC" fits ERNIE BANKS.
export function nameFits(sheetName: string, player: string): boolean {
  const want = words(sheetName).filter(w => !TAG_WORDS.has(w));
  if (!want.length) return false;
  const have = new Set(words(player));
  return want.every(w => have.has(w));
}

function sameGrade(a: unknown, b: unknown): boolean {
  const x = Number(String(a ?? '').trim()), y = Number(String(b ?? '').trim());
  if (String(a ?? '').trim() && String(b ?? '').trim() && Number.isFinite(x) && Number.isFinite(y)) return x === y;
  return norm(a) !== '' && norm(a) === norm(b);
}
const sameNumber = (a: unknown, b: unknown) => norm(a).replace(/^#/, '') === norm(b).replace(/^#/, '');

export type UserSet = { slug: string; title: string; year: number | null; brand: string | null; rows: Array<Record<string, any>> };

export type MatchedCard = {
  slug: string;
  setTitle: string;
  year: number;
  brand: string | null;
  cardNumber: string;
  player: string;
  gradingCompany: string;
  grade: string;
  key: string;              // cardValueKey
};

export type HistoricalPlanItem = {
  entry: SheetEntry;
  status: 'match' | 'skip';
  reason: string | null;
  cards: MatchedCard[];     // one per set the card is in (usually one)
};

// A sheet heading names the set by year and brand ("1973 topps"); a heading
// with no brand ("1975") matches that year's sets of any brand. The brand is
// compared with the set's brand, or with its title minus the year.
function setMatches(s: UserSet, year: number, brand: string): boolean {
  if (s.year !== year) return false;
  if (!brand) return true;
  const b = norm(brand);
  return norm(s.brand) === b || norm(String(s.title || '').replace(/\b(18|19|20)\d{2}\b/, '')) === b;
}

export function buildHistoricalPlan(entries: SheetEntry[], sets: UserSet[]): HistoricalPlanItem[] {
  const plan: HistoricalPlanItem[] = entries.map(entry => {
    if (entry.problem) return { entry, status: 'skip', reason: entry.problem, cards: [] };
    const year = entry.year as number;
    const inSets = sets.filter(s => setMatches(s, year, entry.brand));
    if (!inSets.length) return { entry, status: 'skip', reason: `No ${entry.setLabel.trim()} set in your collection`, cards: [] };
    const byNumber: Array<{ s: UserSet; r: Record<string, any> }> = [];
    for (const s of inSets) for (const r of s.rows || []) if (sameNumber(r['Card #'], entry.cardNumber)) byNumber.push({ s, r });
    if (!byNumber.length) return { entry, status: 'skip', reason: `No card #${entry.cardNumber} in ${entry.setLabel.trim()}`, cards: [] };
    const graded = byNumber.filter(({ r }) =>
      norm(r['Grading Company']) === norm(entry.company) && sameGrade(r['Grade'], entry.grade));
    if (!graded.length) {
      const have = Array.from(new Set(byNumber.map(({ r }) => [r['Grading Company'], r['Grade']].filter(Boolean).join(' ') || 'ungraded')));
      return { entry, status: 'skip', reason: `#${entry.cardNumber} is not ${entry.company} ${entry.grade} in your set (have: ${have.join(', ')})`, cards: [] };
    }
    const fit = graded.filter(({ r }) => nameFits(entry.name as string, String(r['Player'] ?? r['Description'] ?? '')));
    if (!fit.length) {
      const players = Array.from(new Set(graded.map(({ r }) => String(r['Player'] ?? '').trim())));
      return { entry, status: 'skip', reason: `Name "${entry.name}" doesn't match ${players.join(' / ')}`, cards: [] };
    }
    const cards = new Map<string, MatchedCard>();
    for (const { s, r } of fit) {
      const parts = {
        year, brand: s.brand || null, card_number: String(r['Card #']).trim(),
        grading_company: String(r['Grading Company']).trim(), grade: String(r['Grade']).trim(), raw_grade: null,
      };
      const key = cardValueKey(parts);
      cards.set(`${s.slug}|${key}`, {
        slug: s.slug, setTitle: s.title, year, brand: s.brand || null, cardNumber: parts.card_number,
        player: String(r['Player'] ?? '').trim(), gradingCompany: parts.grading_company, grade: parts.grade, key,
      });
    }
    // Brandless headings can reach two brands' #41 PSA 9 — that's not one card.
    if (new Set([...cards.values()].map(c => c.key)).size > 1) {
      return { entry, status: 'skip', reason: 'Matches cards in more than one set brand', cards: [] };
    }
    return { entry, status: 'match', reason: null, cards: [...cards.values()] };
  });

  // Two sheet lines landing on the same card: one entry if they agree, none if not.
  const byCard = new Map<string, HistoricalPlanItem[]>();
  for (const it of plan) if (it.status === 'match') for (const c of it.cards) {
    const k = `${c.slug}|${c.key}`;
    byCard.set(k, [...(byCard.get(k) || []), it]);
  }
  for (const items of byCard.values()) {
    if (items.length < 2) continue;
    const values = new Set(items.map(i => i.entry.value));
    items.forEach((it, k) => {
      if (values.size > 1) { it.status = 'skip'; it.reason = 'Listed more than once with different values'; it.cards = []; }
      else if (k > 0) { it.status = 'skip'; it.reason = `Same card and value as ${items[0].entry.cell}`; it.cards = []; }
    });
  }
  return plan;
}

// July 1 of the year, at noon UTC so it reads as Jul 1 in every US time zone.
export const historicalDate = (year: number) => `${year}-07-01T12:00:00.000Z`;

// One entry per card, set and year: re-importing the same year's sheet is refused
// by the database rather than doubling the history.
export const historicalDedupeKey = (year: number, slug: string, key: string) => `hist:${year}:${slug}:${key}`;

// ── Quarterly history for one set ────────────────────────────────────────────
//
// A second layout: one set per file, one row per graded card, and a pair of
// columns per quarter:
//
//   Card # | Description | Grading Company | Grade | Current Value | 2023 Q4 Avg | 2023 Q4 Sales | … | Notes
//
// Each quarter with an average becomes a history entry for that card, dated
// the last day of the quarter's last month (Q1 → Mar 31, Q2 → Jun 30, …) since
// a history entry carries a date, not a quarter. The set isn't named in the
// rows, so the owner picks it (the file name suggests one).

export type QuarterPoint = {
  year: number;
  quarter: number;          // 1–4
  label: string;            // "2024 Q1"
  value: number;
  sales: number | null;     // how many sales the average is from, when given
};

export type QuarterlyRow = {
  line: number;             // 1-based line in the file
  cardNumber: string;
  description: string;
  company: string;
  grade: string;
  points: QuarterPoint[];
};

export type ParsedQuarterly = { rows: QuarterlyRow[]; quarters: string[]; error: string | null };

// "2024 Q1 Avg", "2024 Q1", "Q1 2024 Average", "2024-Q1 Value".
function quarterOf(header: string): { year: number; quarter: number } | null {
  const h = header.trim();
  const m = h.match(/^((?:19|20)\d{2})\s*[-\s]?\s*Q([1-4])\b/i) ?? h.match(/^Q([1-4])\s*[-\s]?\s*((?:19|20)\d{2})\b/i);
  if (!m) return null;
  const [year, quarter] = /^Q/i.test(h) ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
  return { year, quarter };
}
const isSalesHeader = (h: string) => /\bsales?\b|\bcount\b|#\s*sold/i.test(h);

// Whether a sheet is laid out as quarterly history rather than a yearly workbook.
export function isQuarterlySheet(grid: string[][]): boolean {
  const headers = (grid[0] || []).map(h => String(h ?? '').trim());
  return headers.some(h => quarterOf(h) && !isSalesHeader(h)) && headers.some(h => /^card\s*(#|no|number)/i.test(h));
}

export function parseQuarterlySheet(grid: string[][]): ParsedQuarterly {
  const rowsIn = grid.filter(r => r.some(c => String(c ?? '').trim() !== ''));
  if (rowsIn.length < 2) return { rows: [], quarters: [], error: 'The file has no data rows.' };
  const headers = rowsIn[0].map(h => String(h ?? '').trim());
  const col = (...names: string[]) => headers.findIndex(h => names.some(n => norm(h) === norm(n)));
  const iCard = col('Card #', 'Card Number', 'Card No', '#');
  const iDesc = col('Description', 'Player');
  const iCompany = col('Grading Company', 'Company');
  const iGrade = col('Grade');
  if (iCard < 0) return { rows: [], quarters: [], error: 'The file needs a "Card #" column.' };

  // Each quarter's average column, and the sales-count column beside it.
  const qcols: Array<{ year: number; quarter: number; label: string; avg: number; sales: number }> = [];
  headers.forEach((h, i) => {
    const q = quarterOf(h);
    if (!q || isSalesHeader(h)) return;
    const sales = headers.findIndex((g, j) => j !== i && isSalesHeader(g) &&
      quarterOf(g)?.year === q.year && quarterOf(g)?.quarter === q.quarter);
    qcols.push({ ...q, label: `${q.year} Q${q.quarter}`, avg: i, sales });
  });
  if (!qcols.length) return { rows: [], quarters: [], error: 'No quarter columns found (headings like "2024 Q1 Avg").' };

  const rows: QuarterlyRow[] = [];
  rowsIn.slice(1).forEach((cells, idx) => {
    const cell = (i: number) => (i >= 0 ? String(cells[i] ?? '').trim() : '');
    const cardNumber = cell(iCard);
    if (!cardNumber) return;
    const points: QuarterPoint[] = [];
    for (const q of qcols) {
      const value = parseMoney(cell(q.avg));
      if (value === null || value <= 0) continue;
      const n = q.sales >= 0 ? Number(cell(q.sales).replace(/,/g, '')) : NaN;
      points.push({ year: q.year, quarter: q.quarter, label: q.label, value, sales: Number.isFinite(n) && cell(q.sales) ? n : null });
    }
    rows.push({
      line: idx + 2, cardNumber, description: cell(iDesc), company: cell(iCompany), grade: cell(iGrade), points,
    });
  });
  return { rows, quarters: qcols.map(q => q.label), error: null };
}

// The last day of the quarter's last month, at noon UTC so it reads as that
// day in every US time zone: 2024 Q1 → 2024-03-31.
export function quarterDate(year: number, quarter: number): string {
  const month = quarter * 3; // 3, 6, 9, 12
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T12:00:00.000Z`;
}

// One entry per card, set and quarter, so re-importing the file adds nothing twice.
export const quarterlyDedupeKey = (year: number, quarter: number, slug: string, key: string) =>
  `histq:${year}Q${quarter}:${slug}:${key}`;

export type QuarterlyPlanItem = {
  row: QuarterlyRow;
  status: 'match' | 'skip';
  reason: string | null;
  card: MatchedCard | null;
};

// The set a file name points at: "1970_Topps_Graded_Quarterly_History_2023-2026.csv"
// → the owner's 1970 Topps set. The first year in the name is the set's year.
export function guessSetFromFileName(fileName: string, sets: UserSet[]): string | null {
  const words = norm(fileName.replace(/\.[^.]+$/, '')).replace(/[_\-]+/g, ' ');
  const year = Number(words.match(/\b(18|19|20)\d{2}\b/)?.[0]) || null;
  if (!year) return null;
  const sameYear = sets.filter(s => s.year === year);
  const byBrand = sameYear.filter(s => {
    const b = norm(s.brand || String(s.title || '').replace(/\b(18|19|20)\d{2}\b/, ''));
    return b && words.includes(b);
  });
  const pick = byBrand.length ? byBrand : sameYear;
  return pick.length === 1 ? pick[0].slug : byBrand[0]?.slug ?? null;
}

// Pair each file row with a card in the chosen set: same card #, grading
// company and grade. When the set holds more than one such copy, the player
// name (the description up to " - ") narrows it down.
export function buildQuarterlyPlan(rows: QuarterlyRow[], set: UserSet): QuarterlyPlanItem[] {
  const claimed = new Set<number>();
  return rows.map(row => {
    const skip = (reason: string): QuarterlyPlanItem => ({ row, status: 'skip', reason, card: null });
    if (!row.points.length) return skip('No quarterly averages');
    if (!set.year) return skip(`The set "${set.title}" has no year`);
    if (!row.company || !row.grade) return skip('No grading company and grade');
    const byNumber = (set.rows || []).map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !claimed.has(i) && sameNumber(r['Card #'], row.cardNumber));
    if (!byNumber.length) return skip(`No card #${row.cardNumber} in ${set.title}`);
    let graded = byNumber.filter(({ r }) =>
      norm(r['Grading Company']) === norm(row.company) && sameGrade(r['Grade'], row.grade));
    if (!graded.length) {
      const have = Array.from(new Set(byNumber.map(({ r }) => [r['Grading Company'], r['Grade']].filter(Boolean).join(' ') || 'ungraded')));
      return skip(`#${row.cardNumber} is not ${row.company} ${row.grade} in your set (have: ${have.join(', ')})`);
    }
    if (graded.length > 1 && row.description) {
      const name = row.description.split(' - ')[0];
      const fit = graded.filter(({ r }) => nameFits(name, String(r['Player'] ?? r['Description'] ?? '')));
      if (fit.length) graded = fit;
    }
    if (graded.length > 1) return skip(`More than one #${row.cardNumber} ${row.company} ${row.grade} in your set`);
    const { r, i } = graded[0];
    claimed.add(i);
    const parts = {
      year: set.year, brand: set.brand || null, card_number: String(r['Card #']).trim(),
      grading_company: String(r['Grading Company']).trim(), grade: String(r['Grade']).trim(), raw_grade: null,
    };
    return {
      row, status: 'match', reason: null,
      card: {
        slug: set.slug, setTitle: set.title, year: set.year, brand: set.brand || null,
        cardNumber: parts.card_number, player: String(r['Player'] ?? '').trim(),
        gradingCompany: parts.grading_company, grade: parts.grade, key: cardValueKey(parts),
      },
    };
  });
}
