'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { parseCsv, toCsv } from '@/lib/csv';
import SCLogo from '@/components/SCLogo';
import Thumb from '@/components/Thumb';
import MarketResearchModal from '@/components/MarketResearchModal';
import { cardValueKey, trendFromRows, type Trend } from '@/lib/cardValueHistory';
import { descriptorForItem } from '@/lib/cardDescriptor';
import { recordManualValueMark } from '@/lib/recordValueMark';
import { RAW_GRADES } from '@/lib/listingTitle';
import { cropScanPadding } from '@/lib/scanAutoCrop';
import { setImageStoragePath, uploadCardImageWithThumb, removeCardImageByUrl } from '@/lib/upload-card-image';
import { pruneCardImages } from '@/lib/image-cleanup';
import { ITEMS_SLUG } from '@/lib/itemsSource';
import {
  GRADING_COMPANIES, ITEM_TYPES, NUMERIC_GRADES, autoSlashDate, displayToIso, emptyItem, isoToDisplay,
  itemTotals, parseItemRows, sortedIds, withValuePoint,
  type CollectionItem, type Condition, type ItemDraft, type ItemType, type ParsedItem, type SortKey, type SortState,
} from '@/lib/collectionItems';

// Singles, boxes, packs and anything else tracked outside a set. The columns
// follow the set tables (raw/graded, grade, cost, value, where and when it was
// bought, photos, a Sell action) minus what only makes sense for a set (Owned,
// targets). Edited inline like a spreadsheet; each row saves when you leave a
// cell. Changing a value logs a dated price point so the Collection Value
// tracker can look back.

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${money(Math.abs(n))}`;
const tone = (n: number) => (n > 0.5 ? 'var(--teal)' : n < -0.5 ? 'var(--rust)' : 'var(--ink-mute)');

const EMPTY_CARD = { year: null, brand: null, card_number: null, player: null, grade: null, grading_company: null, raw_grade: null };

type Col = { key: SortKey | null; label: string; right?: boolean; minWidth?: number };
const COLUMNS: Col[] = [
  { key: 'item_type', label: 'Type' }, { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
  { key: 'year', label: 'Year' }, { key: 'brand', label: 'Brand' }, { key: 'description', label: 'Description', minWidth: 220 },
  { key: 'tag_number', label: 'Tag #' }, { key: 'condition', label: 'Raw / Graded' }, { key: 'raw_grade', label: 'Raw Grade' },
  { key: 'grading_company', label: 'Grading Co.' }, { key: 'grade', label: 'Grade' },
  { key: 'qty', label: 'Qty', right: true }, { key: 'cost', label: 'Cost ea.', right: true },
  { key: 'invested', label: 'Invested', right: true }, { key: 'value', label: 'Value ea.', right: true },
  { key: 'total', label: 'Total', right: true }, { key: 'gain', label: 'Gain / loss', right: true },
  { key: 'sale_price', label: 'Sale Price', right: true }, { key: 'date_purchased', label: 'Date Purchased' },
  { key: 'purchased_from', label: 'Purchased From' }, { key: 'notes', label: 'Notes' },
  { key: null, label: 'Image 1' }, { key: null, label: 'Image 2' }, { key: null, label: 'Sell' }, { key: null, label: '' },
];

const cellInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '5px 6px', fontSize: 12.5,
  border: '1px solid transparent', borderRadius: 4, background: 'transparent',
  color: 'var(--plum)', fontFamily: 'var(--font-body)',
};
const th: React.CSSProperties = { padding: '8px 8px', textAlign: 'left', whiteSpace: 'nowrap' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const tdR: React.CSSProperties = { padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12.5, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '3px 4px', verticalAlign: 'middle' };

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="panel" style={{ padding: '14px 18px' }}>
      <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--plum)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Excel cells can hold numbers, text, dates, formulas ({ result }) or rich text.
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    return `${String(v.getUTCMonth() + 1).padStart(2, '0')}/${String(v.getUTCDate()).padStart(2, '0')}/${v.getUTCFullYear()}`;
  }
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return cellText(o.result);
    if (typeof o.text === 'string') return o.text;
    if (Array.isArray(o.richText)) return o.richText.map(t => t.text).join('');
    return '';
  }
  return String(v);
}

async function readSpreadsheet(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    const out: string[][] = [];
    ws?.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, i) => { cells[i - 1] = cellText(c.value); });
      out.push(Array.from(cells, c => c ?? ''));
    });
    return out;
  }
  return parseCsv(await file.text());
}

// A database row as an item. Columns added after the table first shipped are
// absent until their migration runs, and read as their defaults until then.
function toItem(r: any): CollectionItem {
  return {
    ...r,
    condition: r.condition === 'graded' ? 'graded' : 'raw',
    qty: Number(r.qty), cost: Number(r.cost), value: Number(r.value),
    sale_price: r.sale_price === null || r.sale_price === undefined ? null : Number(r.sale_price),
    owned: r.owned !== false,
    value_history: Array.isArray(r.value_history) ? r.value_history : [],
  } as CollectionItem;
}

// "#360 PSA 7" → "360": the card number written in a description, if any.
function cardNumberIn(desc: string | null): string {
  return /#\s*([A-Za-z0-9-]+)/.exec(desc ?? '')?.[1] ?? '';
}

const MIGRATION_HINT = 'This needs the 20261017_collection_items_details.sql migration. Run it in Supabase, then reload.';
const friendlyError = (msg: string) => (/column|schema cache/i.test(msg) ? `${msg} — ${MIGRATION_HINT}` : msg);

function ImageCell({ url, label, onUpload, onView }: {
  url: string | null; label: string; onUpload: (file: File) => Promise<void>; onView: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try { await onUpload(file); } finally { setUploading(false); }
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      {url ? (
        <Thumb url={url} width={160} alt={label} title="Click to view"
          onClick={onView}
          style={{ width: 48, height: 48, borderRadius: 8, border: '2px solid var(--plum)', objectFit: 'cover', cursor: 'pointer' }} />
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          style={{
            width: 48, height: 48, borderRadius: 8, border: '2px dashed var(--rule)', background: 'var(--paper)',
            color: 'var(--ink-mute)', fontSize: 10, fontWeight: 700,
            cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1,
          }}>
          {uploading ? '…' : `+ ${label}`}
        </button>
      )}
    </div>
  );
}

export default function ItemsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [canSell, setCanSell] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CollectionItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<'all' | ItemType>('all');
  const [ownedFilter, setOwnedFilter] = useState<'all' | 'owned' | 'gone'>('all');
  const [search, setSearch] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<{ items: ParsedItem[]; skipped: number; asOf: string } | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The item whose market value is being researched, and each item's price
  // trend (latest value vs the last different one) for the ▲/▼ badge.
  const [researchId, setResearchId] = useState<string | null>(null);
  const [trends, setTrends] = useState<Record<string, Trend>>({});
  // Listings created from items (by item id), for the Sell column's link.
  const [listingsByItem, setListingsByItem] = useState<Record<string, { id: string; status: string }>>({});
  // Photo being viewed full size.
  const [lightbox, setLightbox] = useState<{ id: string; slot: 1 | 2 } | null>(null);
  const lightboxFile = useRef<HTMLInputElement>(null);
  // Date text being typed, per row (the stored value is a real date).
  const [dateDraft, setDateDraft] = useState<Record<string, string>>({});
  // Column sort. The order is worked out when a header is clicked (and rows
  // added or removed), not on every keystroke, so a row you are typing in stays
  // put instead of jumping as its own value changes. Click a header again to
  // re-sort after editing.
  const [sort, setSort] = useState<SortState | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);

  // Rows with unsaved edits, and the latest rows for blur handlers (which would
  // otherwise close over a stale render).
  const dirty = useRef<Set<string>>(new Set());
  const rowsRef = useRef<CollectionItem[]>([]);
  rowsRef.current = rows;
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);

      // Sellers (and admins) get the Sell action, same gate as the set tables.
      const { data: prof } = await supabase.from('user_profiles').select('can_sell, is_admin').eq('user_id', user.id).maybeSingle();
      setCanSell(!!prof?.can_sell || !!prof?.is_admin || user.email === 'jbanks@sports-collective.com');

      const { data, error: err } = await supabase.from('collection_items')
        .select('*').eq('user_id', user.id).order('sort_order').order('created_at');
      if (err) {
        setError(/relation|does not exist|schema cache/i.test(err.message)
          ? 'The items table doesn’t exist yet. Run the 20261016_collection_items.sql migration in Supabase, then reload.'
          : err.message);
      } else {
        setRows(((data || []) as any[]).map(toItem));
        const { data: linked } = await supabase.from('listings')
          .select('id, status, source_row_id')
          .eq('user_id', user.id).eq('source_set_slug', ITEMS_SLUG).neq('status', 'removed');
        const map: Record<string, { id: string; status: string }> = {};
        for (const l of (linked || []) as { id: string; status: string; source_row_id: string | null }[]) {
          if (l.source_row_id) map[l.source_row_id] = { id: l.id, status: l.status };
        }
        setListingsByItem(map);
      }
      setLoading(false);
    })();
  }, [router]);

  const loadTrends = useCallback(async () => {
    if (!userId) return;
    const { data } = await createClient().from('card_value_history')
      .select('card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at')
      .eq('user_id', userId).eq('set_slug', 'items');
    const groups: Record<string, { market_value: number; created_at: string }[]> = {};
    for (const r of (data || []) as Array<Record<string, any>>) {
      const key = cardValueKey({
        year: r.card_year, brand: r.card_brand, card_number: r.card_number,
        grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
      });
      (groups[key] ||= []).push({ market_value: Number(r.market_value), created_at: r.created_at });
    }
    const out: Record<string, Trend> = {};
    for (const k of Object.keys(groups)) { const t = trendFromRows(groups[k]); if (t) out[k] = t; }
    setTrends(out);
  }, [userId]);
  useEffect(() => { loadTrends(); }, [loadTrends]);

  const edit = useCallback((id: string, patch: Partial<ItemDraft>) => {
    dirty.current.add(id);
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const persist = useCallback(async (id: string, patch?: Partial<ItemDraft>) => {
    if (!dirty.current.has(id)) return;
    const base = rowsRef.current.find(x => x.id === id);
    if (!base) return;
    // `patch` carries an edit made in the same tick, before React has re-rendered
    // and refreshed rowsRef.
    const r = { ...base, ...patch };
    dirty.current.delete(id);
    const history = withValuePoint(r.value_history, r.value);
    if (history !== r.value_history) {
      setRows(prev => prev.map(x => (x.id === id ? { ...x, value_history: history } : x)));
    }
    const { error: err } = await createClient().from('collection_items').update({
      item_type: r.item_type, first_name: r.first_name, last_name: r.last_name, year: r.year,
      brand: r.brand, description: r.description, qty: r.qty, cost: r.cost, value: r.value,
      condition: r.condition, raw_grade: r.raw_grade, grading_company: r.grading_company, grade: r.grade,
      date_purchased: r.date_purchased, purchased_from: r.purchased_from, notes: r.notes,
      tag_number: r.tag_number, sale_price: r.sale_price, image_1: r.image_1, image_2: r.image_2,
      owned: r.owned, value_history: history, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (err) { dirty.current.add(id); setSaveError(friendlyError(err.message)); return; }
    setSaveError(null);
    // A changed value is also a mark on the item's price history, so its trend
    // badge and research history reflect typed prices too. A value that came
    // from the research modal already has its mark and is skipped there.
    if (history !== r.value_history && r.value > 0) {
      const ok = await recordManualValueMark(r.user_id, descriptorForItem(r), r.value);
      if (ok) loadTrends();
    }
  }, [loadTrends]);

  // Edit and save in one step, for selects and other cells with no "leave the
  // cell" moment.
  const commit = useCallback((id: string, patch: Partial<ItemDraft>) => {
    edit(id, patch);
    void persist(id, patch);
  }, [edit, persist]);

  async function addItem() {
    if (!userId) return;
    setAdding(true);
    const { data, error: err } = await createClient().from('collection_items')
      .insert({ user_id: userId, ...emptyItem(), item_type: typeFilter === 'all' ? 'single' : typeFilter, sort_order: rows.length })
      .select('*').single();
    setAdding(false);
    if (err || !data) { setSaveError(friendlyError(err?.message || 'Could not add the item')); return; }
    setRows(prev => [...prev, toItem(data)]);
  }

  async function removeItem(r: CollectionItem) {
    if (!confirm(`Delete "${[r.first_name, r.last_name, r.description].filter(Boolean).join(' ') || 'this item'}"? This cannot be undone.`)) return;
    const supabase = createClient();
    const { error: err } = await supabase.from('collection_items').delete().eq('id', r.id);
    if (err) { setSaveError(err.message); return; }
    dirty.current.delete(r.id);
    setRows(prev => prev.filter(x => x.id !== r.id));
    // Photos go with the item unless a listing (or anything else) still uses them.
    if (userId) await pruneCardImages(supabase, userId, [r.image_1, r.image_2]);
  }

  // Photos --------------------------------------------------------------------
  async function uploadImage(item: CollectionItem, slot: 1 | 2, file: File) {
    if (!userId) return;
    const supabase = createClient();
    const trimmed = await cropScanPadding(file);
    const ext = trimmed.name.split('.').pop() || 'jpg';
    // Keyed on the item's id with a fresh token per upload, so a re-scan never
    // overwrites an object a listing made from this item still points at.
    const path = setImageStoragePath({ userId, slug: ITEMS_SLUG, rowKey: item.id, slot, ext });
    const { error: err } = await uploadCardImageWithThumb(supabase, path, trimmed, { upsert: true });
    if (err) { alert('Image upload failed: ' + err.message); return; }
    const { data } = supabase.storage.from('card-images').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    if (!rowsRef.current.some(r => r.id === item.id)) {
      // Deleted while the photo was uploading — drop the orphan.
      await removeCardImageByUrl(supabase, url);
      return;
    }
    commit(item.id, slot === 1 ? { image_1: url } : { image_2: url });
  }

  // Selling -------------------------------------------------------------------
  async function listItem(item: CollectionItem) {
    if (item.qty > 1 && !confirm(
      `This line has ${item.qty} units. Listing it lists the whole line and marks it not owned. ` +
      'To sell one at a time, split it into separate lines first.\n\nContinue?')) return;
    // Mark it not owned now and save before leaving, as a set row does when it
    // goes to the marketplace. If the listing is cancelled the item comes back.
    edit(item.id, { owned: false });
    await persist(item.id, { owned: false });

    const params = new URLSearchParams({ prefill: '1' });
    if (item.year) params.set('year', String(item.year));
    if (item.brand) params.set('brand', item.brand);
    const card = cardNumberIn(item.description);
    if (card) params.set('card', card);
    const who = [item.first_name, item.last_name].map(s => (s ?? '').trim()).filter(Boolean).join(' ');
    if (who) params.set('player', who);
    if (item.description) params.set('description', item.description);
    params.set('source_row_id', item.id);
    params.set('source_set_slug', ITEMS_SLUG);
    // Flows that only carry a card number (auctions, claim sales) find the
    // item by this, the same way set rows are found by Card #.
    params.set('source_card_number', item.id);
    if (item.condition === 'graded' && item.grading_company) {
      params.set('condition_type', 'graded');
      params.set('grading_company', item.grading_company);
      if (item.grade) params.set('grade', item.grade);
    } else if (item.raw_grade) {
      params.set('condition_type', 'raw');
      params.set('raw_grade', item.raw_grade);
    }
    if (item.cost > 0) params.set('cost', String(item.cost));
    if (item.tag_number) params.set('tag', item.tag_number);
    if (item.image_1) params.append('photo', item.image_1);
    if (item.image_2) params.append('photo', item.image_2);
    router.push(`/listings?${params.toString()}`);
  }

  // Import / export -----------------------------------------------------------
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportMsg(null);
    try {
      const parsed = parseItemRows(await readSpreadsheet(file));
      if (parsed.error) { setImportMsg(parsed.error); return; }
      if (!parsed.items.length) { setImportMsg('No items found in that file.'); return; }
      setImporting({ items: parsed.items, skipped: parsed.skipped, asOf: new Date().toISOString().slice(0, 10) });
    } catch {
      setImportMsg('Couldn’t read that file. Use an .xlsx or a .csv saved from Excel.');
    }
  }

  async function confirmImport() {
    if (!importing || !userId) return;
    setBusy(true);
    const at = new Date(`${importing.asOf}T12:00:00.000Z`).toISOString();
    const payload = importing.items.map((it, i) => ({
      user_id: userId, ...it,
      value_history: it.value > 0 ? [{ at, value: it.value }] : [],
      sort_order: rows.length + i,
    }));
    const { data, error: err } = await createClient().from('collection_items').insert(payload).select('*');
    setBusy(false);
    if (err) { setImportMsg(friendlyError(err.message)); return; }
    const added = ((data || []) as any[]).map(toItem);
    setRows(prev => [...prev, ...added]);
    setImportMsg(`Imported ${added.length} item${added.length === 1 ? '' : 's'}.`);
    setImporting(null);
  }

  function exportCsv() {
    const out: (string | number)[][] = [[
      'Type', 'First Name', 'Last Name', 'Year', 'Brand', 'Description', 'Tag #', 'Raw / Graded', 'Raw Grade',
      'Grading Company', 'Grade', 'Qty', 'Cost', 'Total Investment', 'Estimate Value', 'Total', 'Gain/Loss',
      'Sale Price', 'Date Purchased', 'Purchased From', 'Notes', 'Owned',
    ]];
    for (const r of rows) {
      const t = itemTotals(r);
      out.push([
        r.item_type, r.first_name ?? '', r.last_name ?? '', r.year ?? '', r.brand ?? '', r.description ?? '',
        r.tag_number ?? '', r.condition, r.raw_grade ?? '', r.grading_company ?? '', r.grade ?? '', r.qty, r.cost,
        t.invested, r.value, t.worth, t.gain, r.sale_price ?? '', isoToDisplay(r.date_purchased),
        r.purchased_from ?? '', r.notes ?? '', r.owned ? 'Yes' : 'No',
      ]);
    }
    const blob = new Blob([toCsv(out)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'collection-items.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clickHeader(key: SortKey) {
    // asc → desc → back to the original order.
    const next: SortState | null = !sort || sort.key !== key ? { key, dir: 'asc' }
      : sort.dir === 'asc' ? { key, dir: 'desc' } : null;
    setSort(next);
    setOrder(next ? sortedIds(rowsRef.current, next) : null);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter(r => {
      if (typeFilter !== 'all' && r.item_type !== typeFilter) return false;
      if (ownedFilter === 'owned' && !r.owned) return false;
      if (ownedFilter === 'gone' && r.owned) return false;
      if (!q) return true;
      return [r.first_name, r.last_name, r.brand, r.description, r.year, r.tag_number, r.purchased_from, r.notes]
        .some(v => String(v ?? '').toLowerCase().includes(q));
    });
    if (!order) return filtered;
    // Rows added since the sort (not in `order`) stay at the end, in entry order.
    const pos = new Map(order.map((id, i) => [id, i]));
    return filtered.slice().sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
  }, [rows, typeFilter, ownedFilter, search, order]);

  // Listed and sold items are out of the collection, so out of the totals too.
  const counted = useMemo(() => shown.filter(r => r.owned), [shown]);
  const totals = useMemo(() => counted.reduce((a, r) => {
    const t = itemTotals(r);
    return { units: a.units + r.qty, invested: a.invested + t.invested, worth: a.worth + t.worth };
  }, { units: 0, invested: 0, worth: 0 }), [counted]);
  const gain = totals.worth - totals.invested;
  const notCounted = shown.length - counted.length;
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.item_type] = (c[r.item_type] || 0) + 1;
    return c;
  }, [rows]);

  const researchRow = rows.find(r => r.id === researchId) ?? null;
  // Memoized on the fields that define the card, so the modal's own effects
  // don't re-run when only the value changes underneath it.
  const researchCard = useMemo(
    () => (researchRow ? descriptorForItem(researchRow) : EMPTY_CARD),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [researchRow?.id, researchRow?.first_name, researchRow?.last_name, researchRow?.year, researchRow?.brand,
      researchRow?.description, researchRow?.condition, researchRow?.raw_grade, researchRow?.grading_company, researchRow?.grade],
  );

  const lightboxRow = lightbox ? rows.find(r => r.id === lightbox.id) ?? null : null;
  const lightboxUrl = lightboxRow ? (lightbox!.slot === 1 ? lightboxRow.image_1 : lightboxRow.image_2) : null;

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  const pill = (id: 'all' | ItemType, label: string) => (
    <button key={id} type="button" onClick={() => setTypeFilter(id)}
      className={`btn btn-sm ${typeFilter === id ? 'btn-primary' : 'btn-outline'}`}>
      {label} <span style={{ opacity: 0.7 }}>({counts[id] || 0})</span>
    </button>
  );

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)', borderBottom: '3px solid var(--plum)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ 📦 Singles &amp; Items ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/collection-value" className="btn btn-outline btn-sm">📈 Value tracker</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '28px 28px 80px' }}>
        {error ? <p style={{ color: 'var(--rust)' }}>{error}</p> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Kpi label="Line items" value={counted.length.toLocaleString()} sub={`${totals.units.toLocaleString()} total units`} />
              <Kpi label="Total invested" value={money(totals.invested)} />
              <Kpi label="Estimated value" value={money(totals.worth)} />
              <Kpi label="Gain / loss" value={signed(gain)} color={tone(gain)}
                sub={totals.invested ? `${gain >= 0 ? '+' : '−'}${Math.abs((gain / totals.invested) * 100).toFixed(1)}% on cost` : undefined} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              {pill('all', 'All')}
              {ITEM_TYPES.map(t => pill(t.value, t.label + 's'))}
              <select value={ownedFilter} onChange={e => setOwnedFilter(e.target.value as 'all' | 'owned' | 'gone')}
                style={{ padding: '6px 12px', border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', color: 'var(--plum)', fontSize: 12.5, fontWeight: 600 }}>
                <option value="all">Owned &amp; listed / sold</option>
                <option value="owned">Owned only</option>
                <option value="gone">Listed / sold only</option>
              </select>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search name, brand, description…"
                style={{ padding: '6px 12px', minWidth: 220, border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', color: 'var(--plum)', fontSize: 12.5 }} />
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>⇪ Import Excel / CSV</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!rows.length}>⇩ Export CSV</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={addItem} disabled={adding}>+ Add item</button>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
            </div>

            {saveError && <p style={{ color: 'var(--rust)', fontSize: 12.5, margin: '0 0 10px' }}>Couldn’t save: {saveError}</p>}
            {importMsg && <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, margin: '0 0 10px' }}>{importMsg}</p>}

            {importing && (
              <div className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 14, background: 'var(--paper)' }}>
                <div style={{ fontWeight: 700, color: 'var(--plum)', marginBottom: 6 }}>
                  Ready to import {importing.items.length} item{importing.items.length === 1 ? '' : 's'}
                  {importing.skipped > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)' }}> ({importing.skipped} blank row{importing.skipped === 1 ? '' : 's'} skipped)</span>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                  Cost and Estimate Value are read per unit; the Total columns are recalculated. A grade written in the description
                  (“PSA 7”) is read as graded unless the file has its own grade columns. The estimate values are recorded as your
                  price on this date, which is what the Value tracker uses to look back — set it to when the figures were true.
                </div>
                <label style={{ fontSize: 12.5, color: 'var(--plum)', fontWeight: 600 }}>
                  Prices as of{' '}
                  <input type="date" value={importing.asOf} max={new Date().toISOString().slice(0, 10)}
                    onChange={e => setImporting({ ...importing, asOf: e.target.value })}
                    style={{ padding: '4px 8px', border: '1.5px solid var(--plum)', borderRadius: 6, background: 'var(--cream)' }} />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={confirmImport} disabled={busy || !importing.asOf}>
                    {busy ? 'Importing…' : 'Import'}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setImporting(null)} disabled={busy}>Cancel</button>
                </div>
              </div>
            )}

            <div className="panel" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 2100 }}>
                <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <tr>
                    {COLUMNS.map((c, i) => {
                      const key = c.key;
                      if (!key) return <th key={`${c.label}-${i}`} style={{ ...th, textAlign: c.label === 'Sell' ? 'center' : 'left' }}>{c.label}</th>;
                      const active = sort?.key === key;
                      return (
                        <th key={key} style={{ ...(c.right ? thR : th), minWidth: c.minWidth, cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => clickHeader(key)}
                          aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          title={`Sort by ${c.label}`}>
                          {c.label}
                          <span style={{ marginLeft: 4, opacity: active ? 1 : 0.35, fontSize: 9 }}>
                            {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={COLUMNS.length} style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
                      {rows.length === 0
                        ? 'Nothing here yet. Add an item, or import the spreadsheet you already keep.'
                        : 'No items match that filter.'}
                    </td></tr>
                  )}
                  {shown.map(r => {
                    const t = itemTotals(r);
                    const graded = r.condition === 'graded';
                    const text = (key: 'first_name' | 'last_name' | 'brand' | 'description' | 'tag_number' | 'notes' | 'purchased_from', width?: number, max?: number, placeholder?: string) => (
                      <input value={r[key] ?? ''} style={{ ...cellInput, width }} maxLength={max} placeholder={placeholder}
                        onChange={e => edit(r.id, { [key]: e.target.value || null })} onBlur={() => persist(r.id)} />
                    );
                    const num = (key: 'year' | 'qty' | 'cost' | 'value' | 'sale_price', w: number, step: string, placeholder?: string) => (
                      <input type="number" step={step} min={0} placeholder={placeholder}
                        value={r[key] ? r[key] as number : ''}
                        style={{ ...cellInput, width: w, textAlign: key === 'year' ? 'left' : 'right', fontFamily: 'var(--font-mono)' }}
                        onChange={e => {
                          const raw = e.target.value;
                          if (key === 'year') edit(r.id, { year: raw ? Number(raw) : null });
                          else if (key === 'qty') edit(r.id, { qty: raw ? Math.max(0, Math.round(Number(raw))) : 0 });
                          else if (key === 'sale_price') edit(r.id, { sale_price: raw ? Number(raw) : null });
                          else edit(r.id, { [key]: raw ? Number(raw) : 0 });
                        }}
                        onBlur={() => persist(r.id)} />
                    );
                    // A select that also lists a stored value outside the usual
                    // options (an imported "BVG"), so it never silently blanks.
                    const select = (value: string | null, options: readonly string[], onPick: (v: string) => void, opts: { width: number; disabled?: boolean }) => (
                      <select value={value ?? ''} disabled={opts.disabled}
                        style={{ ...cellInput, width: opts.width, opacity: opts.disabled ? 0.4 : 1 }}
                        onChange={e => onPick(e.target.value)}>
                        <option value="" />
                        {value && !options.includes(value) && <option value={value}>{value}</option>}
                        {options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    );
                    const linked = listingsByItem[r.id];
                    const tr = trends[cardValueKey(descriptorForItem(r))];
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--rule)', opacity: r.owned ? 1 : 0.6 }}>
                        <td style={td}>
                          <select value={r.item_type} style={{ ...cellInput, width: 78 }}
                            onChange={e => commit(r.id, { item_type: e.target.value as ItemType })}>
                            {ITEM_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td style={td}>{text('first_name', 90)}</td>
                        <td style={td}>{text('last_name', 110)}</td>
                        <td style={td}>{num('year', 64, '1')}</td>
                        <td style={td}>{text('brand', 120)}</td>
                        <td style={td}>{text('description')}</td>
                        <td style={td}>{text('tag_number', 70)}</td>
                        <td style={td}>
                          <select value={r.condition} style={{ ...cellInput, width: 84 }}
                            onChange={e => commit(r.id, { condition: e.target.value as Condition })}>
                            <option value="raw">Raw</option>
                            <option value="graded">Graded</option>
                          </select>
                        </td>
                        <td style={td}>{select(r.raw_grade, RAW_GRADES, v => commit(r.id, { raw_grade: v || null }), { width: 96, disabled: graded })}</td>
                        <td style={td}>{select(r.grading_company, GRADING_COMPANIES, v => commit(r.id, { grading_company: v || null }), { width: 78, disabled: !graded })}</td>
                        <td style={td}>{select(r.grade, NUMERIC_GRADES, v => commit(r.id, { grade: v || null }), { width: 68, disabled: !graded })}</td>
                        <td style={td}>{num('qty', 52, '1')}</td>
                        <td style={td}>{num('cost', 84, 'any')}</td>
                        <td style={tdR}>{money(t.invested)}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            {num('value', 84, 'any')}
                            <button type="button" title="Research market price from sold comps" aria-label="Research market price"
                              onClick={() => setResearchId(r.id)}
                              style={{ background: 'transparent', border: 0, color: 'var(--teal)', cursor: 'pointer', fontSize: 14, padding: 2 }}>📈</button>
                            {tr && (
                              <span title={`Latest $${tr.latest.toFixed(2)} vs prior $${tr.previous.toFixed(2)}`}
                                style={{ fontSize: 10, fontWeight: 700, minWidth: 30,
                                  color: tr.direction === 'up' ? 'var(--teal)' : tr.direction === 'down' ? 'var(--rust)' : 'var(--ink-mute)' }}>
                                {tr.direction === 'up' ? '▲' : tr.direction === 'down' ? '▼' : '→'}{tr.pct !== null ? `${tr.pct >= 0 ? '+' : ''}${tr.pct.toFixed(0)}%` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{money(t.worth)}</td>
                        <td style={{ ...tdR, color: tone(t.gain) }}>{r.cost || r.value ? signed(t.gain) : '—'}</td>
                        <td style={td}>{num('sale_price', 84, 'any', '$0.00')}</td>
                        <td style={td}>
                          <input value={dateDraft[r.id] ?? isoToDisplay(r.date_purchased)} placeholder="MM/DD/YYYY"
                            style={{ ...cellInput, width: 104 }} inputMode="numeric"
                            onChange={e => {
                              const text = autoSlashDate(e.target.value);
                              setDateDraft(d => ({ ...d, [r.id]: text }));
                              const iso = displayToIso(text);
                              if (iso) edit(r.id, { date_purchased: iso });
                              else if (!text) edit(r.id, { date_purchased: null });
                            }}
                            onBlur={() => {
                              // Whatever is stored wins over half-typed text.
                              setDateDraft(d => { const { [r.id]: _drop, ...rest } = d; return rest; });
                              void persist(r.id);
                            }} />
                        </td>
                        <td style={td}>{text('purchased_from', 140, 50, 'Seller / site')}</td>
                        <td style={td}>{text('notes', 160)}</td>
                        <td style={td}>
                          <ImageCell url={r.image_1} label="Img 1" onUpload={f => uploadImage(r, 1, f)} onView={() => setLightbox({ id: r.id, slot: 1 })} />
                        </td>
                        <td style={td}>
                          <ImageCell url={r.image_2} label="Img 2" onUpload={f => uploadImage(r, 2, f)} onView={() => setLightbox({ id: r.id, slot: 2 })} />
                        </td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          {linked ? (
                            <Link href={`/listings?focus=${linked.id}`} title={`Linked listing (${linked.status})`}
                              style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 6, border: '1.5px dashed var(--teal)',
                                color: 'var(--teal)', fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                              🔗 {linked.status === 'sold' ? 'Sold' : 'View listing'}
                            </Link>
                          ) : canSell && r.owned ? (
                            <button type="button" onClick={() => listItem(r)} className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>$ List</button>
                          ) : !r.owned ? (
                            <button type="button" onClick={() => commit(r.id, { owned: true })} className="btn btn-ghost btn-sm"
                              title="No listing is linked to this item — mark it owned again" style={{ whiteSpace: 'nowrap' }}>↩ Owned</button>
                          ) : <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ ...td, padding: '3px 6px' }}>
                          <button type="button" onClick={() => removeItem(r)} title="Delete"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', fontSize: 14 }}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {shown.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--plum)', background: 'var(--paper)', fontWeight: 700 }}>
                      <td colSpan={11} style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--plum)' }}>
                        Total{typeFilter !== 'all' || ownedFilter !== 'all' || search ? ' (filtered)' : ''}
                        {notCounted > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)' }}> · {notCounted} listed / sold not counted</span>}
                      </td>
                      <td style={tdR}>{totals.units.toLocaleString()}</td>
                      <td />
                      <td style={tdR}>{money(totals.invested)}</td>
                      <td />
                      <td style={tdR}>{money(totals.worth)}</td>
                      <td style={{ ...tdR, color: tone(gain) }}>{signed(gain)}</td>
                      <td colSpan={8} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 12 }}>
              Cost and value are per unit; totals multiply by quantity. Items you list or sell are marked not owned and drop out of the totals.
              Owned items count toward your collection value and are tracked month to month in the{' '}
              <Link href="/collection-value" style={{ color: 'var(--teal)' }}>Value tracker</Link>.
            </p>
          </>
        )}
      </div>

      {lightboxRow && lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(42,20,52,0.88)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 'min(92vw, 720px)', textAlign: 'center' }}>
            {lightboxUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightboxUrl} alt={`Image ${lightbox.slot}`} style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 10, border: '3px solid var(--cream)' }} />
            ) : (
              <div style={{ color: 'var(--cream)', padding: 40 }}>No photo in this slot.</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              {([1, 2] as const).map(s => (
                <button key={s} type="button" className={`btn btn-sm ${lightbox.slot === s ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setLightbox({ id: lightbox.id, slot: s })}>{s === 1 ? 'Front' : 'Back'}</button>
              ))}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => lightboxFile.current?.click()}>Replace</button>
              {lightboxUrl && (
                <button type="button" className="btn btn-outline btn-sm"
                  onClick={() => { commit(lightboxRow.id, lightbox.slot === 1 ? { image_1: null } : { image_2: null }); }}>Remove</button>
              )}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setLightbox(null)}>Close</button>
            </div>
            <input ref={lightboxFile} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={async e => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) await uploadImage(lightboxRow, lightbox.slot, f);
              }} />
          </div>
        </div>
      )}

      <MarketResearchModal
        open={!!researchRow}
        onClose={() => { setResearchId(null); loadTrends(); }}
        card={researchCard}
        onApply={(value) => {
          if (!researchRow) return;
          commit(researchRow.id, { value: Math.round(value * 100) / 100 });
        }}
      />
    </div>
  );
}
