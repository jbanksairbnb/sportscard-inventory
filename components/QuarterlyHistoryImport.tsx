'use client';

// The quarterly half of the historical import: one set's cards, one row each,
// with an average (and sales count) per quarter. See parseQuarterlySheet in
// lib/historicalImport.ts for the layout.
//
// The owner picks which of their sets the file is for (the file name suggests
// one). Each quarter's average becomes a history entry dated the last day of
// the quarter (Q1 → Mar 31). Current Values are not touched.

import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/supabase/fetchAll';
import { contentHash, normalizeAnalysis, type AnalysisSnapshot } from '@/lib/cardValueHistory';
import { insertValueHistoryRow } from '@/lib/recordValueMark';
import {
  parseQuarterlySheet, buildQuarterlyPlan, guessSetFromFileName, quarterDate, quarterlyDedupeKey,
  type QuarterlyPlanItem, type UserSet,
} from '@/lib/historicalImport';

type Props = {
  grid: string[][];
  fileName: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onImported: () => void;
  onReset: () => void;
  onDone: () => void;
};

const fmt = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);

const MONTH = ['Mar', 'Jun', 'Sep', 'Dec'];
const quarterDay = (q: number) => (q === 1 || q === 4 ? 31 : 30);

export default function QuarterlyHistoryImport({ grid, fileName, busy, setBusy, onImported, onReset, onDone }: Props) {
  const parsed = useMemo(() => parseQuarterlySheet(grid), [grid]);
  const [userId, setUserId] = useState<string | null>(null);
  const [sets, setSets] = useState<UserSet[] | null>(null);
  const [slug, setSlug] = useState('');
  const [have, setHave] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'ready' | 'skipped'>('ready');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ written: number; duplicates: number; errors: string[] } | null>(null);

  // The owner's sets, and the quarterly entries already imported.
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setError('Sign in again to import.'); return; }
        setUserId(user.id);
        const { data, error: setsErr } = await supabase.from('sets')
          .select('slug, title, year, brand, rows').eq('user_id', user.id);
        if (setsErr) { setError(setsErr.message); return; }
        const list: UserSet[] = ((data || []) as any[]).map(s => ({
          slug: s.slug, title: s.title || s.slug, year: s.year ? Number(s.year) || null : null,
          brand: s.brand || null, rows: Array.isArray(s.rows) ? s.rows : [],
        })).sort((a, b) => a.title.localeCompare(b.title));
        setSets(list);
        setSlug(guessSetFromFileName(fileName, list) ?? '');
        // A deployment without the dedupe_key column just can't show "already
        // imported"; the import itself still works.
        try {
          const existing = await fetchAll<{ dedupe_key: string }>((from, to) => supabase.from('card_value_history')
            .select('dedupe_key').eq('user_id', user.id).like('dedupe_key', 'histq:%').range(from, to));
          setHave(new Set(existing.map(r => r.dedupe_key)));
        } catch { /* leave empty */ }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [fileName]);

  const set = sets?.find(s => s.slug === slug) ?? null;
  const plan: QuarterlyPlanItem[] = useMemo(() => (set ? buildQuarterlyPlan(parsed.rows, set) : []), [parsed.rows, set]);
  const isNew = (it: QuarterlyPlanItem, p: { year: number; quarter: number }) =>
    !!it.card && !have.has(quarterlyDedupeKey(p.year, p.quarter, it.card.slug, it.card.key));
  const ready = plan.filter(it => it.status === 'match');
  const skipped = plan.filter(it => it.status === 'skip');
  const newCount = ready.reduce((n, it) => n + it.row.points.filter(p => isNew(it, p)).length, 0);
  const alreadyCount = ready.reduce((n, it) => n + it.row.points.length, 0) - newCount;

  async function apply() {
    if (!userId || !newCount) return;
    setBusy(true); setProgress(0);
    const out = { written: 0, duplicates: 0, errors: [] as string[] };
    let done = 0;
    for (const it of ready) {
      const c = it.card!;
      for (const p of it.row.points) {
        if (!isNew(it, p)) continue;
        const sales = p.sales !== null ? ` (${p.sales} sale${p.sales === 1 ? '' : 's'})` : '';
        const notes = `Quarterly average, ${p.label}${sales} — historical import (${fileName})`;
        const snapshot: AnalysisSnapshot = { notes, market_value: p.value, rows: [] };
        const { error: err, duplicate } = await insertValueHistoryRow({
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
          market_value: p.value,
          content_hash: contentHash(normalizeAnalysis([], notes, p.value)),
          snapshot,
          mark_kind: 'manual',
          dedupe_key: quarterlyDedupeKey(p.year, p.quarter, c.slug, c.key),
          source_session_id: null,
          derived_from_id: null,
          created_at: quarterDate(p.year, p.quarter),
        });
        if (duplicate) out.duplicates++;
        else if (err) out.errors.push(`#${c.cardNumber} ${p.label}: ${err}`);
        else out.written++;
        setProgress(++done);
      }
    }
    setResult(out);
    setBusy(false);
    onImported();
  }

  if (parsed.error) return <div style={{ color: 'var(--rust)', fontSize: 13 }}>{parsed.error}</div>;
  if (error) return <div style={{ color: 'var(--rust)', fontSize: 13 }}>{error}</div>;
  if (!sets) return <div style={{ fontSize: 13, color: 'var(--plum)' }}>Loading your sets…</div>;

  if (result) {
    return (
      <div style={{ fontSize: 13, color: 'var(--plum)', lineHeight: 1.6 }}>
        <div><b>{result.written}</b> quarterly history entr{result.written === 1 ? 'y' : 'ies'} added to {set?.title}.</div>
        {result.duplicates > 0 && <div><b>{result.duplicates}</b> were already recorded (left as is).</div>}
        {result.errors.length > 0 && (
          <div style={{ color: 'var(--rust)', marginTop: 8 }}>
            {result.errors.length} could not be saved:
            <ul style={{ margin: '4px 0 0 18px' }}>{result.errors.slice(0, 10).map((e, k) => <li key={k}>{e}</li>)}</ul>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn btn-sm btn-outline" onClick={onReset}>Import another file</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  const list = view === 'ready' ? ready : skipped;
  const first = parsed.quarters[0], last = parsed.quarters[parsed.quarters.length - 1];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--plum)' }}>
        <span>Quarterly history, <b>{first}</b> – <b>{last}</b> ({parsed.quarters.length} quarters, {parsed.rows.length} cards).</span>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          For set
          <select value={slug} disabled={busy} onChange={e => setSlug(e.target.value)}>
            <option value="">— choose a set —</option>
            {sets.map(s => <option key={s.slug} value={s.slug}>{s.title}</option>)}
          </select>
        </label>
      </div>

      {!set ? (
        <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Choose which of your sets these cards are from.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => setView('ready')} className={`btn btn-sm ${view === 'ready' ? 'btn-primary' : 'btn-outline'}`}>
              Matched cards ({ready.length})
            </button>
            <button type="button" onClick={() => setView('skipped')} className={`btn btn-sm ${view === 'skipped' ? 'btn-primary' : 'btn-outline'}`}>
              Skipped ({skipped.length})
            </button>
          </div>
          <div style={{ maxHeight: 440, overflow: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--paper)' }}>
                <tr style={{ textAlign: 'left', color: 'var(--plum)' }}>
                  <th style={{ padding: 6 }}>Card</th>
                  <th style={{ padding: 6 }}>Grade</th>
                  <th style={{ padding: 6 }}>{view === 'skipped' ? 'Why skipped' : 'Quarterly averages (new ones in bold)'}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((it, k) => (
                  <tr key={k} style={{ borderTop: '1px solid var(--rule)', color: 'var(--plum)', verticalAlign: 'top' }}>
                    <td style={{ padding: 6 }}>#{it.row.cardNumber} {it.card?.player || it.row.description}</td>
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{it.row.company} {it.row.grade}</td>
                    <td style={{ padding: 6, color: view === 'skipped' ? 'var(--rust)' : 'var(--plum)' }}>
                      {view === 'skipped' ? it.reason : it.row.points.map((p, j) => (
                        <span key={j} style={{ marginRight: 10, whiteSpace: 'nowrap', fontWeight: isNew(it, p) ? 600 : 400, color: isNew(it, p) ? undefined : 'var(--ink-mute)' }}
                          title={`${p.label} — dated ${MONTH[p.quarter - 1]} ${quarterDay(p.quarter)}, ${p.year}${p.sales !== null ? ` · ${p.sales} sales` : ''}`}>
                          {p.label}: {fmt(p.value)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={3} style={{ padding: 12, color: 'var(--ink-mute)' }}>Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--plum)', flex: 1 }}>
              {newCount > 0
                ? <>Adds <b>{newCount}</b> history entr{newCount === 1 ? 'y' : 'ies'}, each dated the last day of its quarter (Q1 → Mar 31, Q2 → Jun 30, Q3 → Sep 30, Q4 → Dec 31).</>
                : <>Nothing new to import.</>}
              {alreadyCount > 0 && <> {alreadyCount} already imported.</>}
            </div>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !newCount} onClick={apply}>
              {busy ? `Saving… ${progress}/${newCount}` : `Import ${newCount} entr${newCount === 1 ? 'y' : 'ies'}`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
