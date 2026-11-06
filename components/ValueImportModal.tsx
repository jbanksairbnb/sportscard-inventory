'use client';

// Import Values from a CSV for a whole set at once.
//
// Pick a file → review every card's current → new value → apply. Applying
// updates each card's Value in the set AND appends a dated mark to its price
// history, so a bulk re-price builds on the history rather than replacing it.
// Parsing and matching live in lib/valueImport.ts; the history writes in
// lib/recordValueMark.ts. The parent owns the set rows and their save.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CardDescriptor } from '@/components/MarketResearchModal';
import {
  parseValueCsv, buildImportPlan, salesToAnalysisRows,
  saleSource, type ImportPlanItem, type PlanStatus,
} from '@/lib/valueImport';
import {
  recordBulkValueMarks, loadLatestMarks, fillMarkComps, findImportBaselines, deleteValueMarks,
  IMPORT_BASELINE_NOTE, type BulkMarkResult,
} from '@/lib/recordValueMark';
import { cardValueKey } from '@/lib/cardValueHistory';

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  slug: string;
  rows: Array<Record<string, any>>;
  describe: (row: Record<string, any>) => CardDescriptor;
  // Write the new values and/or target prices into the set (and save it).
  onApplyValues: (updates: Array<{ rowIndex: number; value?: number; targetPrice?: number }>) => void;
  // History changed — refresh trend badges.
  onHistoryChanged: () => void;
};

const fmt = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);

// Rows the owner can tick and apply.
const actionable = (st: PlanStatus) => st === 'change' || st === 'fill' || st === 'target';

const STATUS_LABEL: Record<PlanStatus, string> = {
  change: 'Update',
  fill: 'Add sales to existing entry',
  target: 'Target price only',
  unchanged: 'Unchanged',
  'no-value': 'No value in file',
  'not-found': 'Card # not in set',
  ambiguous: 'Matches several cards',
};

export default function ValueImportModal({
  open, onClose, userId, slug, rows, describe, onApplyValues, onHistoryChanged,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlanItem[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(BulkMarkResult & { updated: number; filled: number; targets: number }) | null>(null);

  // "Value before CSV import" entries already in this set's history, which the
  // owner can clear in one go.
  const [baselineIds, setBaselineIds] = useState<string[]>([]);
  const [baselineMsg, setBaselineMsg] = useState<string | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBaselineMsg(null);
    findImportBaselines(userId, slug).then(ids => { if (live) setBaselineIds(ids); });
    return () => { live = false; };
  }, [open, userId, slug, result]);

  async function removeBaselines() {
    const n = baselineIds.length;
    if (!n) return;
    if (!window.confirm(`Delete ${n} "${IMPORT_BASELINE_NOTE}" entr${n === 1 ? 'y' : 'ies'} from this set's price history? Card values and the import entries are not touched. This can't be undone.`)) return;
    setBaselineBusy(true);
    const err = await deleteValueMarks(userId, baselineIds);
    setBaselineBusy(false);
    if (err) { setBaselineMsg(`Could not delete: ${err}`); return; }
    setBaselineIds([]);
    setBaselineMsg(`Deleted ${n} entr${n === 1 ? 'y' : 'ies'}.`);
    onHistoryChanged();
  }

  function reset() {
    setFileName(''); setPlan(null); setParseError(null); setSelected(new Set());
    setShowSkipped(false); setBusy(false); setProgress(0); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }
  function close() { if (busy) return; reset(); onClose(); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    const parsed = parseValueCsv(text, new Date().getFullYear());
    if (parsed.error) { setParseError(parsed.error); setPlan(null); return; }
    setParseError(null);
    const p = buildImportPlan(parsed.rows, rows);
    // An unchanged card whose latest entry is an earlier CSV import of this
    // same value, saved without all its sales (none, or only the first when a
    // ";"-separated list was misread as one sale), gets those sales filled in.
    const latest = await loadLatestMarks(userId, slug);
    for (const it of p) {
      if ((it.status !== 'unchanged' && it.status !== 'target') || it.rowIndex === null || !it.csv.sales.length || it.newValue === null) continue;
      const m = latest.get(cardValueKey(describe(rows[it.rowIndex])));
      if (m && m.compCount < it.csv.sales.length && (m.notes || '').startsWith('CSV import')
          && Math.abs(m.market_value - it.newValue) < 0.005) {
        it.status = 'fill';
        it.fillMarkId = m.id;
        it.fillNotes = m.notes;
      }
    }
    setPlan(p);
    setSelected(new Set(p.map((it, i) => (actionable(it.status) ? i : -1)).filter(i => i >= 0)));
  }

  const counts = useMemo(() => {
    const c: Record<PlanStatus, number> = { change: 0, fill: 0, target: 0, unchanged: 0, 'no-value': 0, 'not-found': 0, ambiguous: 0 };
    for (const it of plan || []) c[it.status]++;
    return c;
  }, [plan]);

  const visible = useMemo(
    () => (plan || []).map((it, i) => ({ it, i }))
      .filter(({ it }) => showSkipped ? it.status !== 'no-value' : actionable(it.status)),
    [plan, showSkipped],
  );

  const selectedTotal = useMemo(() => {
    let before = 0, after = 0;
    for (const i of selected) {
      const it = plan?.[i];
      if (!it) continue;
      if (it.status === 'target') continue; // value not touched
      before += it.currentValue ?? 0;
      after += it.newValue ?? 0;
    }
    return { before, after };
  }, [plan, selected]);

  async function apply() {
    if (!plan || selected.size === 0) return;
    setBusy(true);
    setProgress(0);
    const picked = Array.from(selected).sort((a, b) => a - b).map(i => plan[i]);
    const chosen = picked
      .filter(it => it.status === 'change' && it.rowIndex !== null && it.newValue !== null);
    const fills = picked
      .filter(it => it.status === 'fill' && it.rowIndex !== null && it.newValue !== null && it.fillMarkId);

    // 1. The set itself: new values, and new target prices wherever the file has one.
    const targetsOnly = picked.filter(it => it.status === 'target' && it.rowIndex !== null && it.newTarget !== null);
    const setUpdates = [
      ...chosen.map(it => ({
        rowIndex: it.rowIndex as number, value: it.newValue as number,
        ...(it.newTarget !== null ? { targetPrice: it.newTarget } : {}),
      })),
      ...[...fills, ...targetsOnly].filter(it => it.newTarget !== null)
        .map(it => ({ rowIndex: it.rowIndex as number, targetPrice: it.newTarget as number })),
    ];
    const targetsUpdated = setUpdates.filter(u => u.targetPrice !== undefined).length;
    onApplyValues(setUpdates);

    // 2. One history mark per card.
    const marks = chosen.map(it => {
      const card = describe(rows[it.rowIndex as number]);
      const notes = ['CSV import', fileName ? `(${fileName})` : '', it.csv.basis ? `— ${it.csv.basis}` : '']
        .filter(Boolean).join(' ');
      return {
        card,
        value: it.newValue as number,
        comps: salesToAnalysisRows(it.csv.sales, {
          grading_company: card.grading_company, grade: card.grade, raw_grade: card.raw_grade,
        }),
        notes,
      };
    });
    const res = await recordBulkValueMarks(userId, slug, marks, setProgress);

    // 3. Sales added to earlier entries that came through without them.
    let filled = 0;
    for (const it of fills) {
      const card = describe(rows[it.rowIndex as number]);
      const comps = salesToAnalysisRows(it.csv.sales, {
        grading_company: card.grading_company, grade: card.grade, raw_grade: card.raw_grade,
      });
      const err = await fillMarkComps(userId, it.fillMarkId as string, it.newValue as number, it.fillNotes ?? null, comps);
      if (err) res.errors.push(`#${card.card_number}: ${err}`);
      else filled++;
      setProgress(chosen.length + filled);
    }
    setResult({ ...res, updated: chosen.length, filled, targets: targetsUpdated });
    setBusy(false);
    onHistoryChanged();
  }

  if (!open) return null;

  const toggle = (i: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const allChangeIdx = (plan || []).map((it, i) => (actionable(it.status) ? i : -1)).filter(i => i >= 0);
  const allSelected = allChangeIdx.length > 0 && allChangeIdx.every(i => selected.has(i));

  return (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 920, padding: 24, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)', flex: 1 }}>Import Values from CSV</div>
          <button type="button" onClick={close} disabled={busy} className="btn btn-outline btn-sm">✕ Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16, lineHeight: 1.5 }}>
          Updates each card&apos;s Value and adds a dated entry to its price history — earlier values are kept.
          The file needs <b>Card #</b> and <b>Value</b> columns (an Export CSV of this set works). Optional
          <b> … Sale(s)</b>, <b>… Sale Link(s)</b>, <b>Sale Format(s)</b> and <b>Value Basis</b> columns are saved with
          the history entry; each sale is recorded as eBay Sold Auctions or Buy-It-Now from its format.
          A <b>Target Price</b> column, if present, updates each card&apos;s Target Price as well (blank cells are left alone).
        </div>

        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {plan ? 'Choose another file' : 'Choose CSV file'}
          </button>
          {fileName && <span className="mono" style={{ fontSize: 12, color: 'var(--plum)' }}>{fileName}</span>}
        </div>
        {parseError && <div style={{ color: 'var(--rust)', fontSize: 13, marginBottom: 12 }}>{parseError}</div>}

        {(baselineIds.length > 0 || baselineMsg) && !busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--plum)',
            border: '1.5px solid var(--rule)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
            {baselineIds.length > 0 ? (
              <>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <b>{baselineIds.length}</b> card{baselineIds.length === 1 ? ' has a' : 's have a'} &ldquo;{IMPORT_BASELINE_NOTE}&rdquo;
                  entry in its price history (the value it had before its first import, which imports no longer add).
                </span>
                <button type="button" className="btn btn-sm btn-outline" disabled={baselineBusy} onClick={removeBaselines}>
                  {baselineBusy ? 'Deleting…' : 'Delete these entries'}
                </button>
              </>
            ) : null}
            {baselineMsg && <span style={{ color: baselineMsg.startsWith('Could') ? 'var(--rust)' : 'var(--teal)' }}>{baselineMsg}</span>}
          </div>
        )}

        {plan && !result && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--plum)', marginBottom: 10 }}>
              <span><b>{counts.change}</b> to update</span>
              {counts.target > 0 && <span><b>{counts.target}</b> target price only</span>}
              {counts.fill > 0 && <span><b>{counts.fill}</b> earlier import{counts.fill === 1 ? '' : 's'} missing sales</span>}
              <span><b>{counts.unchanged}</b> unchanged</span>
              {counts['no-value'] > 0 && <span><b>{counts['no-value']}</b> without a value (skipped)</span>}
              {counts['not-found'] > 0 && <span style={{ color: 'var(--rust)' }}><b>{counts['not-found']}</b> not found</span>}
              {counts.ambiguous > 0 && <span style={{ color: 'var(--rust)' }}><b>{counts.ambiguous}</b> ambiguous</span>}
              <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={showSkipped} onChange={e => setShowSkipped(e.target.checked)} />
                Show skipped rows
              </label>
            </div>

            <div style={{ maxHeight: 440, overflow: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--paper)' }}>
                  <tr style={{ textAlign: 'left', color: 'var(--plum)' }}>
                    <th style={{ padding: 6, width: 28 }}>
                      <input type="checkbox" checked={allSelected} disabled={!allChangeIdx.length}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(allChangeIdx))} />
                    </th>
                    <th style={{ padding: 6 }}>#</th>
                    <th style={{ padding: 6 }}>Player</th>
                    <th style={{ padding: 6 }}>Grade</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Current</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>New</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Change</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Target</th>
                    <th style={{ padding: 6 }}>Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={9} style={{ padding: 14, textAlign: 'center', color: 'var(--ink-mute)' }}>
                      No values or target prices to update in this file.
                    </td></tr>
                  )}
                  {visible.map(({ it, i }) => {
                    const row = it.rowIndex !== null ? rows[it.rowIndex] : null;
                    const delta = it.currentValue !== null && it.newValue !== null ? it.newValue - it.currentValue : null;
                    const pct = delta !== null && it.currentValue ? (delta / it.currentValue) * 100 : null;
                    const used = it.csv.sales.filter(s => s.used).length;
                    const grade = row ? [row['Grading Company'], row['Grade']].filter(Boolean).join(' ') || row['Raw Grade'] || '' : '';
                    return (
                      <tr key={i} style={{ borderTop: '1px solid var(--rule)', opacity: actionable(it.status) ? 1 : 0.6 }}
                        title={it.csv.basis || undefined}>
                        <td style={{ padding: 6 }}>
                          {actionable(it.status)
                            ? <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                            : null}
                        </td>
                        <td className="mono" style={{ padding: 6 }}>{it.csv.cardNumber}</td>
                        <td style={{ padding: 6 }}>
                          {row?.['Player'] || it.csv.player}
                          {it.status !== 'change' && (
                            <div style={{ fontSize: 10.5, color: it.status === 'fill' || it.status === 'target' ? 'var(--teal)' : it.status === 'unchanged' ? 'var(--ink-mute)' : 'var(--rust)' }}>
                              {STATUS_LABEL[it.status]}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: 6 }}>{grade}</td>
                        <td className="mono" style={{ padding: 6, textAlign: 'right' }}>{fmt(it.currentValue)}</td>
                        <td className="mono" style={{ padding: 6, textAlign: 'right', fontWeight: 700 }}>{fmt(it.newValue)}</td>
                        <td className="mono" style={{
                          padding: 6, textAlign: 'right',
                          color: delta === null || Math.abs(delta) < 0.005 ? 'var(--ink-mute)' : delta > 0 ? 'var(--teal)' : 'var(--rust)',
                        }}>
                          {delta === null || Math.abs(delta) < 0.005 ? '—'
                            : `${delta > 0 ? '▲' : '▼'} ${fmt(Math.abs(delta))}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}`}
                        </td>
                        <td className="mono" style={{ padding: 6, textAlign: 'right' }}>
                          {it.newTarget !== null
                            ? <span title={`Current target: ${fmt(it.currentTarget)}`}>
                                <span style={{ color: 'var(--ink-mute)' }}>{fmt(it.currentTarget)} → </span><b>{fmt(it.newTarget)}</b>
                              </span>
                            : <span style={{ color: 'var(--ink-mute)' }}>{it.currentTarget !== null ? fmt(it.currentTarget) : '—'}</span>}
                        </td>
                        <td style={{ padding: 6, color: 'var(--ink-mute)' }}>
                          {it.csv.sales.length ? `${used || it.csv.sales.length} of ${it.csv.sales.length}` : ''}
                          {it.csv.sales.length > 0 && (() => {
                            const auctions = it.csv.sales.filter(s => saleSource(s) === 'ebay_sold_auction').length;
                            const bins = it.csv.sales.length - auctions;
                            return (
                              <div style={{ fontSize: 10.5 }}>
                                {[auctions ? `${auctions} Auction` : '', bins ? `${bins} BIN` : ''].filter(Boolean).join(' · ')}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--plum)' }}>
                {selected.size} selected · {fmt(selectedTotal.before)} → <b>{fmt(selectedTotal.after)}</b>
              </span>
              <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }}
                disabled={busy || selected.size === 0} onClick={apply}>
                {busy ? `Saving… ${progress}/${selected.size}` : `Update ${selected.size} card${selected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {result && (
          <div style={{ fontSize: 13, color: 'var(--plum)', lineHeight: 1.6 }}>
            <div><b>{result.updated}</b> value{result.updated === 1 ? '' : 's'} updated in the set.</div>
            {result.targets > 0 && (
              <div><b>{result.targets}</b> target price{result.targets === 1 ? '' : 's'} updated.</div>
            )}
            {result.filled > 0 && (
              <div><b>{result.filled}</b> earlier entr{result.filled === 1 ? 'y' : 'ies'} given {result.filled === 1 ? 'its' : 'their'} sales (date kept).</div>
            )}
            <div><b>{result.written}</b> price-history entr{result.written === 1 ? 'y' : 'ies'} added
              {result.skipped ? `, ${result.skipped} already recorded` : ''}.</div>
            {result.errors.length > 0 && (
              <div style={{ color: 'var(--rust)', marginTop: 8 }}>
                History could not be saved for {result.errors.length} card(s):
                <ul style={{ margin: '4px 0 0 18px' }}>{result.errors.slice(0, 10).map((e, k) => <li key={k}>{e}</li>)}</ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-sm btn-outline" onClick={reset}>Import another file</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
