// Collection items — singles, boxes and other things tracked outside any set.
// Pure helpers shared by the /items page, the value tracker and the monthly
// snapshot cron. No Supabase or React here.

export type ItemType = 'single' | 'box' | 'pack' | 'other';

export const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'box', label: 'Box' },
  { value: 'pack', label: 'Pack' },
  { value: 'other', label: 'Other' },
];

export function itemTypeLabel(t: string | null | undefined): string {
  return ITEM_TYPES.find(x => x.value === t)?.label ?? 'Item';
}

// One point of an item's per-unit price history.
export type ItemValuePoint = { at: string; value: number };

// Raw or graded, as on a set row. Graded items carry a grading company and
// grade; raw items carry a raw condition (NM, EX, …).
export type Condition = 'raw' | 'graded';

// Same company list the set tables offer.
export const GRADING_COMPANIES = ['PSA', 'SGC', 'BGS', 'CGC', 'TAG', 'DEGREE'] as const;
// 10, 9.5 … 1 — the numeric grades a set row offers.
export const NUMERIC_GRADES = Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ''));

export type CollectionItem = {
  id: string;
  user_id: string;
  item_type: ItemType;
  condition: Condition;
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  date_purchased: string | null;   // 'YYYY-MM-DD'
  purchased_from: string | null;
  notes: string | null;
  tag_number: string | null;
  sale_price: number | null;
  image_1: string | null;
  image_2: string | null;
  // false while the item is listed for sale or once sold — like Owned = No on
  // a set row. Not-owned items are left out of collection value.
  owned: boolean;
  first_name: string | null;
  last_name: string | null;
  year: number | null;
  brand: string | null;
  description: string | null;
  qty: number;
  cost: number;     // per unit
  value: number;    // per unit
  value_history: ItemValuePoint[];
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// Columns the page edits; everything else is managed by the database.
export type ItemDraft = Pick<CollectionItem,
  'item_type' | 'first_name' | 'last_name' | 'year' | 'brand' | 'description' | 'qty' | 'cost' | 'value'
  | 'condition' | 'raw_grade' | 'grading_company' | 'grade' | 'date_purchased' | 'purchased_from'
  | 'notes' | 'tag_number' | 'sale_price' | 'image_1' | 'image_2' | 'owned'>;

export const emptyItem = (): ItemDraft => ({
  item_type: 'single', first_name: null, last_name: null, year: null, brand: null,
  description: null, qty: 1, cost: 0, value: 0,
  condition: 'raw', raw_grade: null, grading_company: null, grade: null,
  date_purchased: null, purchased_from: null, notes: null, tag_number: null,
  sale_price: null, image_1: null, image_2: null, owned: true,
});

// "PSA 7", "Raw NM", or the item type when no condition was entered.
export function itemConditionLabel(
  i: Pick<CollectionItem, 'item_type' | 'condition' | 'raw_grade' | 'grading_company' | 'grade'>,
): string {
  if (i.condition === 'graded' && (i.grading_company || i.grade)) {
    return [i.grading_company, i.grade].filter(Boolean).join(' ');
  }
  if (i.condition === 'raw' && i.raw_grade) return `Raw ${i.raw_grade}`;
  return itemTypeLabel(i.item_type);
}

// Dates are entered as MM/DD/YYYY (as on the set tables) and stored as ISO.
export function autoSlashDate(raw: string): string {
  const d = raw.replace(/[^0-9]/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + '/' + d.slice(2);
  return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
}
export function isoToDisplay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}
// 'MM/DD/YYYY' → 'YYYY-MM-DD', or null when blank or not a real date.
export function displayToIso(text: string | null | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((text ?? '').trim());
  if (!m) return null;
  const mo = Number(m[1]), da = Number(m[2]), yr = Number(m[3]);
  const d = new Date(Date.UTC(yr, mo - 1, da));
  if (d.getUTCFullYear() !== yr || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

// A grader and grade written in free text — "PSA 7", "BGS 9.5", "SGC6".
const GRADE_RE = /\b(PSA|BGS|BVG|SGC|CGC|CSG|HGA|GAI|TAG|DEGREE)\s*-?\s*(10|[0-9](?:\.5)?)\b/i;
export function parseGradeFromText(text: string | null | undefined): { company: string; grade: string } | null {
  const m = GRADE_RE.exec(text ?? '');
  return m ? { company: m[1].toUpperCase(), grade: m[2] } : null;
}

export function itemTotals(i: Pick<CollectionItem, 'qty' | 'cost' | 'value'>) {
  const invested = i.qty * i.cost;
  const worth = i.qty * i.value;
  return { invested, worth, gain: worth - invested };
}

// A readable name for lists and the value tracker: "Mike Trout 2011 Topps — Update US175 BGS 9.5".
export function itemName(i: Pick<CollectionItem, 'first_name' | 'last_name' | 'year' | 'brand' | 'description'>): string {
  const who = [i.first_name, i.last_name].map(s => (s ?? '').trim()).filter(Boolean).join(' ');
  const what = [i.year ?? '', (i.brand ?? '').trim()].filter(Boolean).join(' ');
  const head = [who, what].filter(Boolean).join(' · ');
  const desc = (i.description ?? '').trim();
  return [head, desc].filter(Boolean).join(' — ') || 'Item';
}

// Append a price point only when the per-unit value actually changed from the
// last one, so re-saving an unchanged row never writes a flat duplicate.
export function withValuePoint(
  history: ItemValuePoint[] | null | undefined,
  value: number,
  at: string = new Date().toISOString(),
): ItemValuePoint[] {
  const h = Array.isArray(history) ? history : [];
  if (!(value > 0)) return h;
  const last = h[h.length - 1];
  if (last && Math.abs(last.value - value) < 0.005) return h;
  return [...h, { at, value }];
}

// "$2,645", "2645", "(100)" → number. Blank / junk → 0.
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

// Import -------------------------------------------------------------------
//
// Reads the layout collectors keep in Excel: First Name, Last Name, Year,
// Brand, Description, Qty, Cost, Total Investment, Estimate Value, Total.
// Cost and Estimate Value are per unit; the two Total columns are derived and
// ignored. Headers are matched loosely so a slightly different sheet still
// loads. Rows with nothing in them (spacers, the totals line) are skipped.

const HEADER_ALIASES: Record<string, string[]> = {
  type: ['type', 'item type', 'category'],
  first_name: ['first name', 'first'],
  last_name: ['last name', 'last', 'name'],
  year: ['year'],
  brand: ['brand', 'set'],
  description: ['description', 'item', 'details'],
  qty: ['qty', 'quantity'],
  cost: ['cost', 'cost each', 'paid'],
  value: ['estimate value', 'estimated value', 'value', 'est value', 'est. value'],
  raw_grade: ['raw grade', 'raw condition'],
  grading_company: ['grading company', 'grading co.', 'grading co', 'company', 'grader'],
  grade: ['grade'],
  date_purchased: ['date purchased', 'purchase date', 'purchased', 'date bought'],
  purchased_from: ['purchased from', 'bought from', 'seller', 'source'],
  tag_number: ['tag #', 'tag', 'tag number'],
  notes: ['notes', 'note'],
  sale_price: ['sale price', 'sold price', 'sold for'],
};

export type ParsedItem = ItemDraft;

export function parseItemRows(rows: string[][]): { items: ParsedItem[]; skipped: number; error?: string } {
  if (!rows.length) return { items: [], skipped: 0, error: 'The file is empty.' };
  const norm = (s: string) => s.trim().toLowerCase();
  const head = rows[0].map(norm);
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = head.findIndex(h => aliases.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  if (col.description === undefined && col.last_name === undefined) {
    return { items: [], skipped: 0, error: 'Couldn’t find a Description or Last Name column in the first row.' };
  }
  const cell = (r: string[], f: string) => (col[f] === undefined ? '' : (r[col[f]] ?? '').trim());

  const items: ParsedItem[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const desc = cell(r, 'description');
    const last = cell(r, 'last_name');
    const first = cell(r, 'first_name');
    // A priced row with no name is the sheet's totals line, not an item.
    if (!desc && !last && !first) { skipped++; continue; }
    const yearN = Number(cell(r, 'year'));
    const t = norm(cell(r, 'type'));
    const lowered = `${last} ${desc}`.toLowerCase();
    const guessed: ItemType = /\bbox\b/.test(lowered) ? 'box' : /\bpack\b/.test(lowered) ? 'pack' : 'single';
    const qtyN = Math.round(parseMoney(cell(r, 'qty')));
    // Grade: explicit columns win; otherwise lift one written into the
    // description ("#50 PSA 7") so those rows still read as graded.
    const co = cell(r, 'grading_company').toUpperCase();
    const gr = cell(r, 'grade');
    const raw = cell(r, 'raw_grade');
    const inText = parseGradeFromText(desc);
    let condition: Condition = 'raw';
    let company: string | null = null;
    let grade: string | null = null;
    if (co || gr || (!raw && inText)) {
      condition = 'graded';
      company = co || inText?.company || null;
      grade = gr || inText?.grade || null;
    }
    const dateText = cell(r, 'date_purchased');
    const dateIso = /^\d{4}-\d{2}-\d{2}/.test(dateText) ? dateText.slice(0, 10) : displayToIso(dateText);
    const saleText = cell(r, 'sale_price');
    items.push({
      item_type: (ITEM_TYPES.find(x => x.value === t || x.label.toLowerCase() === t)?.value) ?? guessed,
      first_name: first || null,
      last_name: last || null,
      year: Number.isFinite(yearN) && yearN > 0 ? yearN : null,
      brand: cell(r, 'brand') || null,
      description: desc || null,
      qty: qtyN > 0 ? qtyN : 1,
      cost: parseMoney(cell(r, 'cost')),
      value: parseMoney(cell(r, 'value')),
      condition,
      raw_grade: condition === 'raw' ? (raw || null) : null,
      grading_company: company,
      grade,
      date_purchased: dateIso,
      purchased_from: cell(r, 'purchased_from').slice(0, 50) || null,
      notes: cell(r, 'notes') || null,
      tag_number: cell(r, 'tag_number') || null,
      sale_price: saleText ? parseMoney(saleText) : null,
      image_1: null,
      image_2: null,
      owned: true,
    });
  }
  return { items, skipped };
}

// Sorting ---------------------------------------------------------------------

export type SortKey = 'item_type' | 'first_name' | 'last_name' | 'year' | 'brand' | 'description'
  | 'tag_number' | 'condition' | 'raw_grade' | 'grading_company' | 'grade'
  | 'qty' | 'cost' | 'invested' | 'value' | 'total' | 'gain'
  | 'sale_price' | 'date_purchased' | 'purchased_from' | 'notes' | 'owned';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };

// The value a column sorts on: text columns as lower-cased text, number columns
// as numbers. Blank text and an unset year sort as "no value" (null).
export function sortValue(r: CollectionItem, key: SortKey): string | number | null {
  switch (key) {
    case 'item_type': return ITEM_TYPES.find(t => t.value === r.item_type)?.label.toLowerCase() ?? r.item_type;
    case 'first_name': case 'last_name': case 'brand': case 'description':
    case 'tag_number': case 'raw_grade': case 'grading_company': case 'purchased_from': case 'notes': {
      const v = (r[key] ?? '').trim().toLowerCase();
      return v || null;
    }
    case 'condition': return r.condition === 'graded' ? 'graded' : 'raw';
    // Numeric grades sort as numbers (10 above 9.5), not as text.
    case 'grade': {
      const n = Number(r.grade);
      return r.grade && Number.isFinite(n) ? n : null;
    }
    case 'sale_price': return r.sale_price ?? null;
    case 'date_purchased': return r.date_purchased ?? null;
    case 'owned': return r.owned ? 'a' : 'b';
    case 'year': return r.year ?? null;
    case 'qty': return r.qty;
    case 'cost': return r.cost;
    case 'value': return r.value;
    case 'invested': return itemTotals(r).invested;
    case 'total': return itemTotals(r).worth;
    case 'gain': return itemTotals(r).gain;
  }
}

// Ids in sorted order. Empty cells always go to the bottom, whichever way the
// column is sorted, so a blank First Name never leads an A → Z list.
export function sortedIds(rows: CollectionItem[], { key, dir }: SortState): string[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => ({ id: r.id, i, v: sortValue(r, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map(x => x.id);
}

