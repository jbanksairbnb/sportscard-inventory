'use client';

import { useMemo, useState } from 'react';
import type { CardDescriptor } from '@/components/MarketResearchModal';
import type { ValuedCard } from '@/app/api/cardsight/value-set/route';
import { recordSweepValueMark } from '@/lib/recordValueMark';

// Price every card in a set in one pass.
//
// The research modal is a workbench: one card, comps you weight by hand. This
// is the other half — a sweep that answers "what is all of this worth today"
// and, more importantly, files a dated mark for each card so the collection
// accumulates a price series instead of a scattering of the cards somebody
// happened to open.
//
// It never writes a value the owner hasn't seen. Every proposal is shown
// against the value already in the row, and anything thin or widened arrives
// unticked, because a sweep that quietly overwrote hand-researched numbers
// would destroy the work this app exists to keep.

// How many cards go to the server at once. Resolution costs one API call per
// card CardSight has never been asked about, at four calls a second, so the
// batch has to stay small enough to answer well inside the function timeout.
const CHUNK = 40;

export type SweepTarget = {
  key: string;              // stable row handle
  rowIndex: number;
  descriptor: CardDescriptor;
  label: string;            // what to show in the review table
  currentValue: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  targets: SweepTarget[];
  // Hand back the values the owner accepted, keyed by row index.
  onApply: (values: Map<number, number>) => void;
};

type Phase = 'idle' | 'running' | 'review' | 'applying' | 'done';

export default function ValueSetModal({ open, onClose, userId, targets, onApply }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Map<string, ValuedCard>>(new Map());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ values: number; marks: number } | null>(null);

  const byKey = useMemo(() => new Map(targets.map(t => [t.key, t])), [targets]);

  async function run() {
    setPhase('running');
    setError(null);
    setDone(0);
    const acc = new Map<string, ValuedCard>();

    for (let i = 0; i < targets.length; i += CHUNK) {
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
        // Keep whatever the earlier chunks produced — a set that priced 80 of
        // 200 cards is still 80 cards priced.
        setError((e as Error).message);
        break;
      }
      setDone(Math.min(i + CHUNK, targets.length));
      setResults(new Map(acc));
    }

    // Pre-tick only what needs no judgement: a clean median off enough sales,
    // at the exact grade, that actually differs from what's already there.
    const pre = new Set<string>();
    for (const [k, r] of acc) {
      const t = byKey.get(k);
      if (r.reason !== 'ok' || r.value === null || r.bucketLabel) continue;
      if (t?.currentValue != null && Math.abs(t.currentValue - r.value) < 0.005) continue;
      pre.add(k);
    }
    setResults(new Map(acc));
    setChosen(pre);
    setPhase('review');
  }

  async function apply() {
    setPhase('applying');
    const values = new Map<number, number>();
    let marks = 0;

    for (const k of chosen) {
      const r = results.get(k);
      const t = byKey.get(k);
      if (!r || !t || r.value === null) continue;
      values.set(t.rowIndex, r.value);
      const { ok } = await recordSweepValueMark(userId, {
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
    }

    onApply(values);
    setApplied({ values: values.size, marks });
    setPhase('done');
  }

  if (!open) return null;

  const rows = targets.map(t => ({ t, r: results.get(t.key) })).filter(x => x.r);
  const priced = rows.filter(x => x.r!.value !== null).length;
  const total = rows.reduce((s, x) => s + (chosen.has(x.t.key) ? x.r!.value ?? 0 : 0), 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(42,20,52,0.55)', zIndex: 60,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 10,
          width: '100%', maxWidth: 940, boxShadow: '0 10px 30px rgba(42,20,52,0.3)',
        }}
      >
        <div style={{
          padding: '14px 18px', borderBottom: '1.5px solid var(--rule)',
          display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
        }}>
          <strong style={{ color: 'var(--plum)', fontSize: 16 }}>Value the whole set</strong>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {targets.length} card{targets.length === 1 ? '' : 's'} with enough detail to look up
          </span>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto', fontSize: 12 }}>Close</button>
        </div>

        <div style={{ padding: 18 }}>
          {phase === 'idle' && (
            <>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 12px', maxWidth: 620 }}>
                Each graded card gets the median of its completed sales from the last 30 days —
                the same figure the research modal computes, from the same comps. You&rsquo;ll see
                every proposal against the value already in the row before anything changes.
              </p>
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 16px', maxWidth: 620 }}>
                Applying also files a dated mark per card, so the price history builds
                whether or not you ever open that card again. CardSight&rsquo;s own archive only
                reaches back about five months, so marks taken now are the only long-run
                history this collection will ever have.
              </p>
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
              <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 8 }}>
                Cards CardSight has never been asked about need a catalog lookup each, so the
                first run on a new set is the slow one.
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
                          <td style={{ ...td, maxWidth: 250 }}>
                            <div style={{ color: 'var(--ink)' }}>{t.label}</div>
                            {r!.matched && (
                              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{r!.matched}</div>
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
                              r!.bucketLabel ? `widened to ${r!.bucketLabel}` : '',
                              r!.viaSearch ? 'title-matched comps' : '',
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
                <button type="button" onClick={apply} disabled={!chosen.size || phase === 'applying'}
                  className="btn btn-primary" style={{ fontSize: 13 }}>
                  {phase === 'applying' ? 'Applying…' : `Apply ${chosen.size} value${chosen.size === 1 ? '' : 's'}`}
                </button>
                <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  Writes the Value column and files one dated mark per card.
                </span>
              </div>
            </>
          )}

          {phase === 'done' && applied && (
            <div>
              <div style={{ fontSize: 15, color: 'var(--plum)', fontWeight: 700, marginBottom: 8 }}>
                {applied.values} value{applied.values === 1 ? '' : 's'} updated
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: 560 }}>
                {applied.marks} mark{applied.marks === 1 ? '' : 's'} filed to price history.
                {applied.marks < applied.values && ' The rest were already marked today.'}
                {' '}Remember to save the set to keep the new values.
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
