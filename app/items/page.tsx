'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/supabase/fetchAll';
import { parseCsv, toCsv } from '@/lib/csv';
import SCLogo from '@/components/SCLogo';
import {
  ITEM_TYPES, emptyItem, itemTotals, parseItemRows, withValuePoint,
  type CollectionItem, type ItemDraft, type ItemType, type ParsedItem,
} from '@/lib/collectionItems';

// Singles, boxes, packs and anything else tracked outside a set. Edited inline
// like a spreadsheet; each row saves when you leave a cell. Changing a value
// logs a dated price point so the Collection Value tracker can look back.

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${money(Math.abs(n))}`;
const tone = (n: number) => (n > 0.5 ? 'var(--teal)' : n < -0.5 ? 'var(--rust)' : 'var(--ink-mute)');

const cellInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '5px 6px', fontSize: 12.5,
  border: '1px solid transparent', borderRadius: 4, background: 'transparent',
  color: 'var(--plum)', fontFamily: 'var(--font-body)',
};
const th: React.CSSProperties = { padding: '8px 8px', textAlign: 'left', whiteSpace: 'nowrap' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const tdR: React.CSSProperties = { padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12.5, whiteSpace: 'nowrap' };

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="panel" style={{ padding: '14px 18px' }}>
      <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--plum)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Excel cells can hold numbers, text, formulas ({ result }) or rich text.
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
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

export default function ItemsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CollectionItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<'all' | ItemType>('all');
  const [search, setSearch] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<{ items: ParsedItem[]; skipped: number; asOf: string } | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const { data, error: err } = await supabase.from('collection_items')
        .select('*').eq('user_id', user.id).order('sort_order').order('created_at');
      if (err) {
        setError(/relation|does not exist|schema cache/i.test(err.message)
          ? 'The items table doesn’t exist yet. Run the 20261016_collection_items.sql migration in Supabase, then reload.'
          : err.message);
      } else {
        setRows(((data || []) as any[]).map(r => ({
          ...r, qty: Number(r.qty), cost: Number(r.cost), value: Number(r.value),
          value_history: Array.isArray(r.value_history) ? r.value_history : [],
        })));
      }
      setLoading(false);
    })();
  }, [router]);

  const edit = useCallback(<K extends keyof ItemDraft>(id: string, key: K, value: ItemDraft[K]) => {
    dirty.current.add(id);
    setRows(prev => prev.map(r => (r.id === id ? { ...r, [key]: value } : r)));
  }, []);

  const persist = useCallback(async (id: string) => {
    if (!dirty.current.has(id)) return;
    const r = rowsRef.current.find(x => x.id === id);
    if (!r) return;
    dirty.current.delete(id);
    const history = withValuePoint(r.value_history, r.value);
    if (history !== r.value_history) {
      setRows(prev => prev.map(x => (x.id === id ? { ...x, value_history: history } : x)));
    }
    const { error: err } = await createClient().from('collection_items').update({
      item_type: r.item_type, first_name: r.first_name, last_name: r.last_name, year: r.year,
      brand: r.brand, description: r.description, qty: r.qty, cost: r.cost, value: r.value,
      value_history: history, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (err) { dirty.current.add(id); setSaveError(err.message); } else setSaveError(null);
  }, []);

  async function addItem() {
    if (!userId) return;
    setAdding(true);
    const { data, error: err } = await createClient().from('collection_items')
      .insert({ user_id: userId, ...emptyItem(), item_type: typeFilter === 'all' ? 'single' : typeFilter, sort_order: rows.length })
      .select('*').single();
    setAdding(false);
    if (err || !data) { setSaveError(err?.message || 'Could not add the item'); return; }
    const d = data as any;
    setRows(prev => [...prev, { ...d, qty: Number(d.qty), cost: Number(d.cost), value: Number(d.value), value_history: [] }]);
  }

  async function removeItem(r: CollectionItem) {
    if (!confirm(`Delete "${[r.first_name, r.last_name, r.description].filter(Boolean).join(' ') || 'this item'}"? This cannot be undone.`)) return;
    const { error: err } = await createClient().from('collection_items').delete().eq('id', r.id);
    if (err) { setSaveError(err.message); return; }
    dirty.current.delete(r.id);
    setRows(prev => prev.filter(x => x.id !== r.id));
  }

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
    if (err) { setImportMsg(err.message); return; }
    const added = ((data || []) as any[]).map(d => ({
      ...d, qty: Number(d.qty), cost: Number(d.cost), value: Number(d.value),
      value_history: Array.isArray(d.value_history) ? d.value_history : [],
    }));
    setRows(prev => [...prev, ...added]);
    setImportMsg(`Imported ${added.length} item${added.length === 1 ? '' : 's'}.`);
    setImporting(null);
  }

  function exportCsv() {
    const out: (string | number)[][] = [['Type', 'First Name', 'Last Name', 'Year', 'Brand', 'Description', 'Qty', 'Cost', 'Total Investment', 'Estimate Value', 'Total', 'Gain/Loss']];
    for (const r of rows) {
      const t = itemTotals(r);
      out.push([r.item_type, r.first_name ?? '', r.last_name ?? '', r.year ?? '', r.brand ?? '', r.description ?? '', r.qty, r.cost, t.invested, r.value, t.worth, t.gain]);
    }
    const blob = new Blob([toCsv(out)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'collection-items.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (typeFilter !== 'all' && r.item_type !== typeFilter) return false;
      if (!q) return true;
      return [r.first_name, r.last_name, r.brand, r.description, r.year].some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [rows, typeFilter, search]);

  const totals = useMemo(() => shown.reduce((a, r) => {
    const t = itemTotals(r);
    return { units: a.units + r.qty, invested: a.invested + t.invested, worth: a.worth + t.worth };
  }, { units: 0, invested: 0, worth: 0 }), [shown]);
  const gain = totals.worth - totals.invested;
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.item_type] = (c[r.item_type] || 0) + 1;
    return c;
  }, [rows]);

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

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 28px 80px' }}>
        {error ? <p style={{ color: 'var(--rust)' }}>{error}</p> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Kpi label="Line items" value={shown.length.toLocaleString()} sub={`${totals.units.toLocaleString()} total units`} />
              <Kpi label="Total invested" value={money(totals.invested)} />
              <Kpi label="Estimated value" value={money(totals.worth)} />
              <Kpi label="Gain / loss" value={signed(gain)} color={tone(gain)}
                sub={totals.invested ? `${gain >= 0 ? '+' : '−'}${Math.abs((gain / totals.invested) * 100).toFixed(1)}% on cost` : undefined} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              {pill('all', 'All')}
              {ITEM_TYPES.map(t => pill(t.value, t.label + 's'))}
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
                  Cost and Estimate Value are read per unit; the Total columns are recalculated. The estimate values are recorded as your
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
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <tr>
                    <th style={th}>Type</th><th style={th}>First</th><th style={th}>Last</th><th style={th}>Year</th><th style={th}>Brand</th>
                    <th style={{ ...th, minWidth: 220 }}>Description</th><th style={thR}>Qty</th><th style={thR}>Cost ea.</th>
                    <th style={thR}>Invested</th><th style={thR}>Value ea.</th><th style={thR}>Total</th><th style={thR}>Gain / loss</th><th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={13} style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
                      {rows.length === 0
                        ? 'Nothing here yet. Add an item, or import the spreadsheet you already keep.'
                        : 'No items match that filter.'}
                    </td></tr>
                  )}
                  {shown.map(r => {
                    const t = itemTotals(r);
                    const text = (key: 'first_name' | 'last_name' | 'brand' | 'description', width?: number) => (
                      <input value={r[key] ?? ''} style={{ ...cellInput, width }}
                        onChange={e => edit(r.id, key, e.target.value || null)} onBlur={() => persist(r.id)} />
                    );
                    const num = (key: 'year' | 'qty' | 'cost' | 'value', w: number, step: string) => (
                      <input type="number" step={step} min={0} value={r[key] ? r[key] as number : ''} style={{ ...cellInput, width: w, textAlign: key === 'year' ? 'left' : 'right', fontFamily: 'var(--font-mono)' }}
                        onChange={e => {
                          const raw = e.target.value;
                          if (key === 'year') edit(r.id, 'year', raw ? Number(raw) : null);
                          else if (key === 'qty') edit(r.id, 'qty', raw ? Math.max(0, Math.round(Number(raw))) : 0);
                          else edit(r.id, key, raw ? Number(raw) : 0);
                        }}
                        onBlur={() => persist(r.id)} />
                    );
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--rule)' }}>
                        <td style={{ padding: '3px 4px' }}>
                          <select value={r.item_type} style={{ ...cellInput, width: 78 }}
                            onChange={e => { edit(r.id, 'item_type', e.target.value as ItemType); setTimeout(() => persist(r.id), 0); }}>
                            {ITEM_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '3px 4px' }}>{text('first_name', 90)}</td>
                        <td style={{ padding: '3px 4px' }}>{text('last_name', 110)}</td>
                        <td style={{ padding: '3px 4px' }}>{num('year', 64, '1')}</td>
                        <td style={{ padding: '3px 4px' }}>{text('brand', 120)}</td>
                        <td style={{ padding: '3px 4px' }}>{text('description')}</td>
                        <td style={{ padding: '3px 4px' }}>{num('qty', 52, '1')}</td>
                        <td style={{ padding: '3px 4px' }}>{num('cost', 84, 'any')}</td>
                        <td style={tdR}>{money(t.invested)}</td>
                        <td style={{ padding: '3px 4px' }}>{num('value', 84, 'any')}</td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{money(t.worth)}</td>
                        <td style={{ ...tdR, color: tone(t.gain) }}>{r.cost || r.value ? signed(t.gain) : '—'}</td>
                        <td style={{ padding: '3px 6px' }}>
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
                      <td colSpan={6} style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--plum)' }}>
                        Total{typeFilter !== 'all' || search ? ' (filtered)' : ''}
                      </td>
                      <td style={tdR}>{totals.units.toLocaleString()}</td>
                      <td />
                      <td style={tdR}>{money(totals.invested)}</td>
                      <td />
                      <td style={tdR}>{money(totals.worth)}</td>
                      <td style={{ ...tdR, color: tone(gain) }}>{signed(gain)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 12 }}>
              Cost and value are per unit; totals multiply by quantity. Items count toward your collection value and are tracked month to month
              in the <Link href="/collection-value" style={{ color: 'var(--teal)' }}>Value tracker</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
