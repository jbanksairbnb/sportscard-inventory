'use client';

// Import a year's values from a valuation workbook into price history.
//
// The workbook lays every set out side by side (see lib/historicalImport.ts).
// Each graded single that matches one of the owner's cards exactly — set, card
// number, grading company, grade, and a name that fits the player — becomes a
// history entry dated July 1 of the chosen year. Current Values are not
// touched; only the history (and so the collection-value chart) gains the
// older data points.

import React, { useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/supabase/fetchAll';
import { parseCsv } from '@/lib/csv';
import { cardValueKey, contentHash, normalizeAnalysis, type AnalysisSnapshot } from '@/lib/cardValueHistory';
import { insertValueHistoryRow } from '@/lib/recordValueMark';
import {
  parseHistoricalSheet, buildHistoricalPlan, historicalDate, historicalDedupeKey,
  type HistoricalPlanItem, type SheetBlock, type UserSet,
} from '@/lib/historicalImport';

type Props = { open: boolean; onClose: () => void; onImported: () => void };

type Row = HistoricalPlanItem & { already: boolean };

const fmt = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);

// Excel cells can hold numbers, text, dates, formulas ({ result }) or rich text.
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return cellText(o.result);
    if (typeof o.text === 'string') return o.text;
    if (Array.isArray(o.richText)) return o.richText.map(t => t.text).join('');
    return '';
  }
  return String(v);
}

// The first sheet as text, keeping every row and column in place so cell
// references in the preview point at the right spot.
async function readGrid(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) return parseCsv((await file.text()).replace(/^﻿/, ''));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value).trim());
    out.push(cells);
  }
  return out;
}

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 15 }, (_, i) => thisYear - 1 - i);

function csvCell(s: unknown) {
  const t = String(s ?? '');
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export default function HistoricalValueImportModal({ open, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [year, setYear] = useState<number>(thisYear - 1);
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [blocks, setBlocks] = useState<SheetBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'ready' | 'skipped' | 'already'>('ready');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ written: number; duplicates: number; errors: string[] } | null>(null);
  const gridRef = useRef<string[][] | null>(null);

  function reset() {
    setFileName(''); setRows(null); setBlocks([]); setError(null); setView('ready');
    setBusy(false); setProgress(0); setResult(null); gridRef.current = null;
    if (fileRef.current) fileRef.current.value = '';
  }
  function close() { if (busy) return; reset(); onClose(); }

  // Read the sheet, load the owner's sets, match, and flag what this year already has.
  async function analyze(grid: string[][], forYear: number) {
    setLoading(true); setError(null); setResult(null);
    try {
      const parsed = parseHistoricalSheet(grid);
      if (parsed.error) { setError(parsed.error); setRows(null); return; }
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Sign in again to import.'); return; }
      setUserId(user.id);
      const { data: sets, error: setsErr } = await supabase.from('sets')
        .select('slug, title, year, brand, rows').eq('user_id', user.id);
      if (setsErr) { setError(setsErr.message); return; }
      const userSets: UserSet[] = ((sets || []) as any[]).map(s => ({
        slug: s.slug, title: s.title || '', year: s.year ? Number(s.year) || null : null,
        brand: s.brand || null, rows: Array.isArray(s.rows) ? s.rows : [],
      }));
      const plan = buildHistoricalPlan(parsed.entries, userSets);
      // Entries this year's import already wrote (same date, set and card).
      const day = historicalDate(forYear).slice(0, 10);
      const existing = await fetchAll<any>((from, to) => supabase.from('card_value_history')
        .select('set_slug, card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade')
        .eq('user_id', user.id)
        .gte('created_at', `${day}T00:00:00.000Z`).lt('created_at', `${day}T23:59:59.999Z`)
        .range(from, to));
      const have = new Set(existing.map(r => `${r.set_slug}|${cardValueKey({
        year: r.card_year, brand: r.card_brand, card_number: r.card_number,
        grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
      })}`));
      setRows(plan.map(it => ({
        ...it,
        already: it.status === 'match' && it.cards.every(c => have.has(`${c.slug}|${c.key}`)),
      })));
      setBlocks(parsed.blocks.filter(b => b.problem));
      setView('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const y = Number(file.name.match(/\b(19|20)\d{2}\b/)?.[0]);
    const forYear = y && y < thisYear + 1 ? y : year;
    setYear(forYear);
    try {
      const grid = await readGrid(file);
      gridRef.current = grid;
      await analyze(grid, forYear);
    } catch (err) {
      setError(`Could not read the file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function changeYear(y: number) {
    setYear(y);
    if (gridRef.current) analyze(gridRef.current, y);
  }

  const ready = useMemo(() => (rows || []).filter(r => r.status === 'match' && !r.already), [rows]);
  const already = useMemo(() => (rows || []).filter(r => r.status === 'match' && r.already), [rows]);
  const skipped = useMemo(() => (rows || []).filter(r => r.status === 'skip'), [rows]);
  const entryCount = ready.reduce((n, r) => n + r.cards.length, 0);
  const readyTotal = ready.reduce((n, r) => n + (r.entry.value ?? 0), 0);

  function downloadSkipped() {
    const lines = [['Cell', 'Set', 'Description', 'Value', 'Reason'].join(',')];
    for (const r of skipped) lines.push([r.entry.cell, r.entry.setLabel, r.entry.text, r.entry.value ?? '', r.reason].map(csvCell).join(','));
    for (const b of blocks) lines.push([b.cell, b.setLabel, '(whole set)', '', b.problem].map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${(fileName || 'historical').replace(/\.[^.]+$/, '')}_skipped.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function apply() {
    if (!userId || !ready.length) return;
    setBusy(true); setProgress(0);
    const out = { written: 0, duplicates: 0, errors: [] as string[] };
    const createdAt = historicalDate(year);
    let done = 0;
    for (const it of ready) {
      const value = it.entry.value as number;
      for (const c of it.cards) {
        const notes = `Historical value import (${fileName}) — ${year}: "${it.entry.text.trim()}"`;
        const snapshot: AnalysisSnapshot = { notes, market_value: value, rows: [] };
        const { error, duplicate } = await insertValueHistoryRow({
          user_id: userId,
          card_year: c.year,
          card_brand: c.brand,
          card_number: c.cardNumber,
          card_player: c.player || null,
          card_grade: c.grade,
          card_grading_company: c.gradingCompany,
          card_raw_grade: null,
          listing_id: null,
          set_slug: c.slug,
          set_card_number: c.cardNumber,
          market_value: value,
          content_hash: contentHash(normalizeAnalysis([], notes, value)),
          snapshot,
          mark_kind: 'manual',
          dedupe_key: historicalDedupeKey(year, c.slug, c.key),
          source_session_id: null,
          derived_from_id: null,
          created_at: createdAt,
        });
        if (duplicate) out.duplicates++;
        else if (error) out.errors.push(`${it.entry.cell} ${it.entry.text}: ${error}`);
        else out.written++;
      }
      setProgress(++done);
    }
    setResult(out);
    setBusy(false);
    onImported();
  }

  if (!open) return null;

  const list = view === 'ready' ? ready : view === 'already' ? already : skipped;
  const tabBtn = (v: typeof view, label: string, n: number) => (
    <button type="button" onClick={() => setView(v)} className={`btn btn-sm ${view === v ? 'btn-primary' : 'btn-outline'}`}>
      {label} ({n})
    </button>
  );

  return (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 980, padding: 24, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)', flex: 1 }}>Import Historical Values</div>
          <button type="button" onClick={close} disabled={busy} className="btn btn-outline btn-sm">✕ Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16, lineHeight: 1.5 }}>
          Reads a yearly valuation sheet (.xlsx or .csv) with each set as a block of <b>Value</b> / <b>Cost</b> /
          <b> Description</b> columns under the set&apos;s name. A card is imported only when the set, card #, grading
          company and grade match one of your cards exactly and its name fits the card&apos;s player (&ldquo;100 Bench PSA 8&rdquo;
          → #100 JOHNNY BENCH PSA 8). Each match is added to the card&apos;s price history dated <b>July 1</b> of the
          year. Current values are not changed.
        </div>

        <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || loading} onClick={() => fileRef.current?.click()}>
            {rows ? 'Choose another file' : 'Choose file'}
          </button>
          {fileName && <span className="mono" style={{ fontSize: 12, color: 'var(--plum)' }}>{fileName}</span>}
          <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--plum)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Values are for
            <select value={year} disabled={busy || loading} onChange={e => changeYear(Number(e.target.value))}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span style={{ color: 'var(--ink-mute)' }}>(dated 7/1/{year})</span>
          </label>
        </div>
        {loading && <div style={{ fontSize: 13, color: 'var(--plum)', marginBottom: 12 }}>Matching against your sets…</div>}
        {error && <div style={{ color: 'var(--rust)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        {rows && !result && !loading && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              {tabBtn('ready', 'Ready to import', ready.length)}
              {tabBtn('skipped', 'Skipped', skipped.length)}
              {already.length > 0 && tabBtn('already', `Already in ${year}`, already.length)}
              {(skipped.length > 0 || blocks.length > 0) && (
                <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={downloadSkipped}>
                  ⬇ Download skipped list (CSV)
                </button>
              )}
            </div>
            {blocks.length > 0 && view === 'skipped' && (
              <div style={{ fontSize: 12, color: 'var(--rust)', marginBottom: 8, lineHeight: 1.5 }}>
                Sets not read at all: {blocks.map(b => `${b.setLabel.trim()} (${b.cell}: ${b.problem})`).join('; ')}
              </div>
            )}

            <div style={{ maxHeight: 440, overflow: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--paper)' }}>
                  <tr style={{ textAlign: 'left', color: 'var(--plum)' }}>
                    <th style={{ padding: 6 }}>Cell</th>
                    <th style={{ padding: 6 }}>Set</th>
                    <th style={{ padding: 6 }}>Sheet description</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>{year} value</th>
                    <th style={{ padding: 6 }}>{view === 'skipped' ? 'Why skipped' : 'Your card'}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, k) => (
                    <tr key={k} style={{ borderTop: '1px solid var(--rule)', color: 'var(--plum)' }}>
                      <td className="mono" style={{ padding: 6, color: 'var(--ink-mute)' }}>{r.entry.cell}</td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{r.entry.setLabel.trim()}</td>
                      <td style={{ padding: 6 }}>{r.entry.text}</td>
                      <td className="mono" style={{ padding: 6, textAlign: 'right' }}>{fmt(r.entry.value)}</td>
                      <td style={{ padding: 6, color: view === 'skipped' ? 'var(--rust)' : 'var(--plum)' }}>
                        {view === 'skipped' ? r.reason : r.cards.map(c =>
                          `${c.setTitle} · #${c.cardNumber} ${c.player} · ${c.gradingCompany} ${c.grade}`).join(' | ')}
                      </td>
                    </tr>
                  ))}
                  {!list.length && (
                    <tr><td colSpan={5} style={{ padding: 12, color: 'var(--ink-mute)' }}>Nothing here.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--plum)', flex: 1 }}>
                {ready.length > 0
                  ? <>Adds <b>{entryCount}</b> history entr{entryCount === 1 ? 'y' : 'ies'} dated 7/1/{year} ({fmt(readyTotal)} total).</>
                  : <>Nothing new to import for {year}.</>}
              </div>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || !ready.length} onClick={apply}>
                {busy ? `Saving… ${progress}/${ready.length}` : `Import ${ready.length} value${ready.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {result && (
          <div style={{ fontSize: 13, color: 'var(--plum)', lineHeight: 1.6 }}>
            <div><b>{result.written}</b> history entr{result.written === 1 ? 'y' : 'ies'} added, dated 7/1/{year}.</div>
            {result.duplicates > 0 && <div><b>{result.duplicates}</b> already recorded for {year} (left as is).</div>}
            {result.errors.length > 0 && (
              <div style={{ color: 'var(--rust)', marginTop: 8 }}>
                {result.errors.length} could not be saved:
                <ul style={{ margin: '4px 0 0 18px' }}>{result.errors.slice(0, 10).map((e, k) => <li key={k}>{e}</li>)}</ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-sm btn-outline" onClick={reset}>Import another year</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
