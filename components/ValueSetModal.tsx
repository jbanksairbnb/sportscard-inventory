'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cardValueKey } from '@/lib/cardValueHistory';
import type { ValuedCard } from '@/app/api/cardsight/value-set/route';
import { recordSweepValueMark } from '@/lib/recordValueMark';
import type { SweepTarget } from '@/lib/sweepTargets';

export type { SweepTarget };

// Price the graded cards you own, in one pass.
//
// The research modal is a workbench: one card, comps you weight by hand. This
// is the other half — a sweep that answers "what is all of this worth today"
// and, more importantly, files a dated mark for each card so the collection
// accumulates a price series instead of a scattering of the cards somebody
// happened to open. The same component drives one set from the set editor and
// the whole collection from the home page; only the targets differ.
//
// It never writes a *value* the owner hasn't seen. Every proposal is shown
// against the value already in the row, and anything thin or widened arrives
// unticked, because a sweep that quietly overwrote hand-researched numbers
// would destroy the work this app exists to keep.

// How many cards go to the server at once. Resolution costs one API call per
// card CardSight has never been asked about, at four calls a second, so the
// batch has to stay small enough to answer well inside the function timeout.
const CHUNK = 40;

// PostgREST caps an unbounded select at 1000 rows. A single set's history fits
// under that; a collection's does not, and a truncated read would silently
// drop the protections for whichever cards fell off the end.
const HISTORY_PAGE = 1000;

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  targets: SweepTarget[];
  heading?: string;
  scopeNote?: string;
  // What still needs doing after applying, if anything. The set editor hands
  // values to an unsaved grid and needs a save; the collection sweep persists
  // them itself and needs nothing.
  valueNote?: string;
  // Hand back the values the owner accepted. May persist them; the modal
  // waits for it before reporting done.
  onApply: (applied: Array<{ target: SweepTarget; value: number }>) => void | Promise<void>;
};

type Phase = 'idle' | 'running' | 'review' | 'applying' | 'done';

// A price good enough to stand on its own: a clean median, off enough sales,
// at the grade actually asked for. Anything below this bar wants a human eye
// before it becomes either a value or a mark.
function isClean(r: ValuedCard): boolean {
  return r.reason === 'ok' && r.value !== null && !r.bucketLabel;
}

export default function ValueSetModal({
  open, onClose, userId, targets, heading, scopeNote, valueNote, onApply,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Map<string, ValuedCard>>(new Map());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [markProgress, setMarkProgress] = useState(0);
  const [applied, setApplied] = useState<{ values: number; marks: number; already: number } | null>(null);

  const byKey = useMemo(() => new Map(targets.map(t => [t.key, t])), [targets]);
  // A collection-wide sweep spans sets, and "#18 · Don Drysdale" means nothing
  // without saying which set it came from. One set needs no such column.
  const multiSet = useMemo(() => new Set(targets.map(t => t.setSlug)).size > 1, [targets]);

  // A long run is minutes of API calls. The owner has to be able to call it
  // off and keep what has already priced.
  const stopRef = useRef(false);

  // Cards the owner has already valued themselves — a saved research analysis
  // or a value typed in by hand.
  //
  // A sweep median is built from completed auctions only. An analysis can weigh
  // in fixed-price sales, a Card Ladder read, condition notes on the specific
  // copy — everything the owner actually knew. That makes it the better number,
  // so the sweep must not quietly replace it. These rows are still priced and
  // still shown, with the sweep's figure beside the owner's for comparison;
  // they simply arrive unticked, so overriding one is a deliberate act.
  const [ownMarks, setOwnMarks] = useState<Map<string, { value: number; at: string }>>(new Map());
  // The pre-tick runs at the end of a sweep that may have started before this
  // query landed, so it reads the ref rather than a stale closure.
  const ownMarksRef = useRef(ownMarks);
  ownMarksRef.current = ownMarks;

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const rows: Array<Record<string, unknown>> = [];
      for (let from = 0; ; from += HISTORY_PAGE) {
        const { data, error } = await supabase
          .from('card_value_history')
          .select('card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at')
          .eq('user_id', userId)
          .in('mark_kind', ['research', 'manual'])
          .order('created_at', { ascending: false })
          // Ties on created_at would order differently on each page request,
          // which is how a paged read silently loses rows at a boundary.
          .order('id', { ascending: false })
          .range(from, from + HISTORY_PAGE - 1);
        if (cancelled) return;
        if (error || !data) {
          // Failing open would let the sweep overwrite hand-made values silently,
          // so fail closed instead: no protections, but nothing is pre-ticked
          // that the owner has not seen, which is already the modal's contract.
          return;
        }
        rows.push(...(data as Array<Record<string, unknown>>));
        if (data.length < HISTORY_PAGE) break;
      }
      // Newest first, so the first hit per identity is the current one.
      const latest = new Map<string, { value: number; at: string }>();
      for (const r of rows) {
        const k = cardValueKey({
          year: r.card_year as number | null, brand: r.card_brand as string | null,
          card_number: r.card_number as string | null, grade: r.card_grade as string | null,
          grading_company: r.card_grading_company as string | null,
          raw_grade: r.card_raw_grade as string | null,
        });
        if (!latest.has(k)) latest.set(k, { value: Number(r.market_value), at: String(r.created_at) });
      }
      const mine = new Map<string, { value: number; at: string }>();
      for (const t of targets) {
        const hit = latest.get(cardValueKey({
          year: t.descriptor.year, brand: t.descriptor.brand, card_number: t.descriptor.card_number,
          grade: t.descriptor.grade, grading_company: t.descriptor.grading_company,
          raw_grade: t.descriptor.raw_grade,
        }));
        if (hit) mine.set(t.key, hit);
      }
      if (!cancelled) setOwnMarks(mine);
    })();
    return () => { cancelled = true; };
  }, [open, userId, targets]);

  async function run() {
    setPhase('running');
    setError(null);
    setDone(0);
    stopRef.current = false;
    const acc = new Map<string, ValuedCard>();

    for (let i = 0; i < targets.length; i += CHUNK) {
      if (stopRef.current) break;
      const slice = targets.slice(i, i + CHUNK);
      try {
        const res = await fetch('/api/cardsight/value-set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cards: slice.map(t => ({
              key: t.key,
              year: t.descriptor.year,
              brand: t.descriptor.brand,
              number: t.descriptor.card_number,
              player: t.descriptor.player,
              grading_company: t.descriptor.grading_company,
              grade: t.descriptor.grade,
            })),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        for (const r of (json.results ?? []) as ValuedCard[]) acc.set(r.key, r);
      } catch (e) {
        // Keep whatever the earlier chunks produced — a collection that priced
        // 80 of 200 cards is still 80 cards priced.
        setError((e as Error).message);
        break;
      }
      setDone(Math.min(i + CHUNK, targets.length));
      setResults(new Map(acc));
    }

    // Pre-tick only what needs no judgement: a clean median that actually
    // differs from what's already there.
    const pre = new Set<string>();
    for (const [k, r] of acc) {
      const t = byKey.get(k);
      if (!isClean(r)) continue;
      // The owner's own analysis stands until they replace it themselves.
      if (ownMarksRef.current.has(k)) continue;
      if (t?.currentValue != null && Math.abs(t.currentValue - r.value!) < 0.005) continue;
      pre.add(k);
    }
    setResults(new Map(acc));
    setChosen(pre);
    setPhase('review');
  }

  // Which cards get a dated mark. Ticking governs the Value column; marking is
  // a separate question, because a mark is an observation rather than an
  // override. It appends to an immutable log, is keyed to one mark per card
  // per day, and never touches a value or an earlier analysis — so every clean
  // price is worth recording, including one the owner declined to adopt and
  // one that came back identical to last week's. A flat market is data; a gap
  // in the series reads as missing data instead.
  //
  // Thin and widened prices are the exception: those are marked only when the
  // owner ticked them, which is them vouching for the number.
  const markable = useMemo(() => {
    const out = new Set<string>();
    for (const [k, r] of results) if (isClean(r)) out.add(k);
    for (const k of chosen) if (results.get(k)?.value != null) out.add(k);
    return out;
  }, [results, chosen]);

  async function apply() {
    setPhase('applying');
    setMarkProgress(0);

    const accepted: Array<{ target: SweepTarget; value: number }> = [];
    for (const k of chosen) {
      const r = results.get(k);
      const t = byKey.get(k);
      if (!r || !t || r.value === null) continue;
      accepted.push({ target: t, value: r.value });
    }

    // Values first: it is the change the owner is watching for, and the marks
    // below take a round trip each.
    await onApply(accepted);

    let marks = 0;
    let already = 0;
    let n = 0;
    for (const k of markable) {
      const r = results.get(k);
      const t = byKey.get(k);
      if (!r || !t || r.value === null) continue;
      const { ok, duplicate } = await recordSweepValueMark(userId, {
        year: t.descriptor.year,
        brand: t.descriptor.brand,
        card_number: t.descriptor.card_number,
        player: t.descriptor.player,
        grade: t.descriptor.grade,
        grading_company: t.descriptor.grading_company,
        raw_grade: t.descriptor.raw_grade,
        set_slug: t.descriptor.set_slug ?? null,
        set_card_number: t.descriptor.set_card_number ?? null,
      }, r.value, {
        n: r.n, low: r.low, high: r.high,
        bucketLabel: r.bucketLabel, viaSearch: r.viaSearch,
      });
      if (ok) marks++;
      if (duplicate) already++;
      setMarkProgress(++n);
    }

    setApplied({ values: accepted.length, marks, already });
    setPhase('done');
  }

  if (!open) return null;

  const rows = targets.map(t => ({ t, r: results.get(t.key) })).filter(x => x.r);
  const priced = rows.filter(x => x.r!.value !== null).length;
  const total = rows.reduce((s, x) => s + (chosen.has(x.t.key) ? x.r!.value ?? 0 : 0), 0);

  return (
    <div
      onClick={phase === 'running' || phase === 'applying' ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(42,20,52,0.55)', zIndex: 60,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 10,
          width: '100%', maxWidth: 980, boxShadow: '0 10px 30px rgba(42,20,52,0.3)',
        }}
      >
        <div style={{
          padding: '14px 18px', borderBottom: '1.5px solid var(--rule)',
          display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
        }}>
          <strong style={{ color: 'var(--plum)', fontSize: 16 }}>
            {heading || 'Value the graded cards you own'}
          </strong>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {targets.length} card{targets.length === 1 ? '' : 's'}
            {scopeNote ? ` — ${scopeNote}` : ' — CardSight’s sold data covers graded cards, so raw copies and cards you don’t own are left out'}
          </span>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm"
            disabled={phase === 'running' || phase === 'applying'}
            style={{ marginLeft: 'auto', fontSize: 12 }}>Close</button>
        </div>

        <div style={{ padding: 18 }}>
          {phase === 'idle' && (
            <>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 12px', maxWidth: 640 }}>
                Each graded card gets the median of its completed sales from the last 30 days —
                the same figure the research modal computes, from the same comps. You&rsquo;ll see
                every proposal against the value already in the row before anything changes.
              </p>
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 12px', maxWidth: 640 }}>
                Applying files a dated mark for every clean price — including the ones you
                decline and the ones that came back unchanged, because a flat market is data
                and a gap in the series is not. Marks never touch a value or an earlier
                analysis, and re-running on the same day won&rsquo;t double-count.
                CardSight&rsquo;s own archive only reaches back about five months, so marks
                taken now are the only long-run history this collection will ever have.
              </p>
              {targets.length > CHUNK * 3 && (
                <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', lineHeight: 1.6, margin: '0 0 16px', maxWidth: 640 }}>
                  This is a big run — roughly {Math.ceil(targets.length / CHUNK)} batches. Cards
                  CardSight has never been asked about need a catalog lookup each, so leave the
                  tab open; you can stop partway and keep what has priced so far.
                </p>
              )}
              <button type="button" onClick={run} className="btn btn-primary"
                style={{ fontSize: 13 }}>
                Price {targets.length} card{targets.length === 1 ? '' : 's'}
              </button>
            </>
          )}

          {phase === 'running' && (
            <div>
              <div style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 10 }}>
                Pricing {done} of {targets.length}…
              </div>
              <div style={{ height: 8, background: 'var(--cream-warm)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${targets.length ? (done / targets.length) * 100 : 0}%`,
                  background: 'var(--orange)', transition: 'width 240ms ease',
                }} />
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11.5 }}
                  onClick={() => { stopRef.current = true; }}>
                  Stop and review what&rsquo;s priced
                </button>
                <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  Cards CardSight has never been asked about need a catalog lookup each, so the
                  first run on a new set is the slow one.
                </span>
              </div>
            </div>
          )}

          {(phase === 'review' || phase === 'applying') && (
            <>
              {error && (
                <div style={{ fontSize: 13, color: 'var(--rust)', marginBottom: 10 }}>
                  Stopped early: {error} — {rows.length} card{rows.length === 1 ? '' : 's'} priced before that.
                </div>
              )}
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12, alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  <strong style={{ color: 'var(--plum)' }}>{priced}</strong> of {rows.length} priced
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  <strong style={{ color: 'var(--plum)' }}>{chosen.size}</strong> selected
                  {chosen.size > 0 && <> · ${total.toFixed(2)}</>}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  <strong style={{ color: 'var(--teal)' }}>{markable.size}</strong> will be marked
                </span>
                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                  onClick={() => setChosen(new Set(rows.filter(x => x.r!.value !== null).map(x => x.t.key)))}>
                  Select all priced
                </button>
                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                  onClick={() => setChosen(new Set())}>Clear</button>
              </div>

              <div style={{ maxHeight: '52vh', overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--ink-mute)', background: 'var(--cream)' }}>
                      <th style={th}></th>
                      {multiSet && <th style={th}>Set</th>}
                      <th style={th}>Card</th>
                      <th style={{ ...th, textAlign: 'right' }}>Current</th>
                      <th style={{ ...th, textAlign: 'right' }}>Proposed</th>
                      <th style={{ ...th, textAlign: 'right' }}>Change</th>
                      <th style={{ ...th, textAlign: 'right' }}>Sales</th>
                      <th style={th}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ t, r }) => {
                      const v = r!.value;
                      const cur = t.currentValue;
                      const mine = ownMarks.get(t.key) ?? null;
                      const delta = v !== null && cur != null && cur > 0 ? ((v - cur) / cur) * 100 : null;
                      return (
                        <tr key={t.key} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                          <td style={td}>
                            <input type="checkbox" disabled={v === null}
                              checked={chosen.has(t.key)}
                              onChange={e => setChosen(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(t.key); else next.delete(t.key);
                                return next;
                              })} />
                          </td>
                          {multiSet && (
                            <td style={{ ...td, color: 'var(--ink-mute)', fontSize: 11.5, maxWidth: 160 }}>
                              {t.setTitle || t.setSlug}
                            </td>
                          )}
                          <td style={{ ...td, maxWidth: 250 }}>
                            <div style={{ color: 'var(--ink)' }}>{t.label}</div>
                            {r!.matched && (
                              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{r!.matched}</div>
                            )}
                            {mine && (
                              <div className="mono" style={{ fontSize: 10.5, color: 'var(--teal)' }}>
                                your analysis · {new Date(mine.at).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                          <td className="mono" style={{ ...td, textAlign: 'right', color: 'var(--ink-mute)' }}>
                            {cur != null ? `$${cur.toFixed(2)}` : '—'}
                          </td>
                          <td className="mono" style={{ ...td, textAlign: 'right', fontWeight: 700, color: v !== null ? 'var(--plum)' : 'var(--ink-mute)' }}>
                            {v !== null ? `$${v.toFixed(2)}` : '—'}
                          </td>
                          <td className="mono" style={{
                            ...td, textAlign: 'right',
                            color: delta === null ? 'var(--ink-mute)' : delta > 0 ? 'var(--teal)' : delta < 0 ? 'var(--rust)' : 'var(--ink-mute)',
                          }}>
                            {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}
                          </td>
                          <td className="mono" style={{ ...td, textAlign: 'right', color: r!.n && r!.n < 3 ? 'var(--rust)' : 'var(--ink-soft)' }}>
                            {r!.n || '—'}
                          </td>
                          <td style={{ ...td, color: 'var(--ink-mute)', fontSize: 11.5, maxWidth: 280 }}>
                            {[
                              mine ? 'kept — your own analysis' : '',
                              r!.bucketLabel ? `widened to ${r!.bucketLabel}` : '',
                              r!.viaSearch ? 'title-matched comps' : '',
                              markable.has(t.key) && !chosen.has(t.key) ? 'marked, value unchanged' : '',
                              r!.note ?? '',
                            ].filter(Boolean).join(' · ') || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" onClick={apply} disabled={!markable.size || phase === 'applying'}
                  className="btn btn-primary" style={{ fontSize: 13 }}>
                  {phase === 'applying'
                    ? `Filing marks… ${markProgress} of ${markable.size}`
                    : chosen.size
                      ? `Apply ${chosen.size} value${chosen.size === 1 ? '' : 's'}`
                      : `File ${markable.size} mark${markable.size === 1 ? '' : 's'}`}
                </button>
                <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  {chosen.size
                    ? `Writes the Value column for the ${chosen.size} ticked, and files ${markable.size} dated mark${markable.size === 1 ? '' : 's'} to price history.`
                    : `Nothing ticked, so no value changes — just ${markable.size} dated mark${markable.size === 1 ? '' : 's'} to price history.`}
                </span>
              </div>
            </>
          )}

          {phase === 'done' && applied && (
            <div>
              <div style={{ fontSize: 15, color: 'var(--plum)', fontWeight: 700, marginBottom: 8 }}>
                {applied.values} value{applied.values === 1 ? '' : 's'} updated · {applied.marks} mark{applied.marks === 1 ? '' : 's'} filed
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: 580 }}>
                {applied.already > 0 && `${applied.already} card${applied.already === 1 ? ' was' : 's were'} already marked today, so ${applied.already === 1 ? 'it was' : 'they were'} left alone. `}
                Price history is written straight to the database and is already saved.
                {applied.values > 0 && valueNote ? ` ${valueNote}` : ''}
              </p>
              <button type="button" onClick={onClose} className="btn btn-primary" style={{ fontSize: 13 }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '7px 9px', fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase',
  fontWeight: 500, position: 'sticky', top: 0, background: 'var(--cream)',
};
const td: React.CSSProperties = { padding: '7px 9px', verticalAlign: 'top' };
