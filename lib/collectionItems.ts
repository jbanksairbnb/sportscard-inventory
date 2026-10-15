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

export type CollectionItem = {
  id: string;
  user_id: string;
  item_type: ItemType;
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
  'item_type' | 'first_name' | 'last_name' | 'year' | 'brand' | 'description' | 'qty' | 'cost' | 'value'>;

export const emptyItem = (): ItemDraft => ({
  item_type: 'single', first_name: null, last_name: null, year: null, brand: null,
  description: null, qty: 1, cost: 0, value: 0,
});

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
    });
  }
  return { items, skipped };
}

// Sorting ---------------------------------------------------------------------

export type SortKey = 'item_type' | 'first_name' | 'last_name' | 'year' | 'brand' | 'description'
  | 'qty' | 'cost' | 'invested' | 'value' | 'total' | 'gain';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };

// The value a column sorts on: text columns as lower-cased text, number columns
// as numbers. Blank text and an unset year sort as "no value" (null).
export function sortValue(r: CollectionItem, key: SortKey): string | number | null {
  switch (key) {
    case 'item_type': return ITEM_TYPES.find(t => t.value === r.item_type)?.label.toLowerCase() ?? r.item_type;
    case 'first_name': case 'last_name': case 'brand': case 'description': {
      const v = (r[key] ?? '').trim().toLowerCase();
      return v || null;
    }
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

