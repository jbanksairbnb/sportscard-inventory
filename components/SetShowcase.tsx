'use client';

// The buyer-facing sections of a set's showcase, shared by the owner's set
// view and the public /seller/<handle>/set/<slug> page: description, the
// completion / condition / pricing-source facts, key cards, set value over
// time, the top 16 cards by value, and the full set grid. Purely
// presentational; the pages compute ShowcaseCards via lib/setShowcase.

import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import Thumb from '@/components/Thumb';
import type { Trend } from '@/lib/cardValueHistory';
import {
  fmtMoney, fmtDate,
  type ShowcaseCard, type Completion, type ConditionSummary, type KeyCardNote, type TimelinePoint,
} from '@/lib/setShowcase';

const TEAL = '#2d7a6e';
const INK_MUTE = '#7a5f8a';
const RULE = '#d9b668';

function cardName(c: ShowcaseCard): string {
  return [c.cardNumber ? `#${c.cardNumber}` : '', c.player].filter(Boolean).join(' ') || 'Card';
}

function trendColor(t: Trend | null): string {
  if (!t) return 'var(--ink-mute)';
  return t.direction === 'up' ? 'var(--teal)' : t.direction === 'down' ? 'var(--rust)' : 'var(--ink-mute)';
}

export function TrendBadge({ trend, showDollars = false }: { trend: Trend | null; showDollars?: boolean }) {
  if (!trend || trend.direction === 'flat') return null;
  const arrow = trend.direction === 'up' ? '▲' : '▼';
  const pct = trend.pct !== null ? `${trend.pct >= 0 ? '+' : ''}${trend.pct.toFixed(1)}%` : '';
  const dollars = `${trend.delta >= 0 ? '+' : '-'}${fmtMoney(Math.abs(trend.delta))}`;
  return (
    <span className="mono" title={`${fmtMoney(trend.previous)} → ${fmtMoney(trend.latest)}`}
      style={{ fontSize: 11.5, fontWeight: 700, color: trendColor(trend), whiteSpace: 'nowrap' }}>
      {arrow}{pct || dollars}{showDollars && pct ? ` (${dollars})` : ''}
    </span>
  );
}

// ── Lightbox ─────────────────────────────────────────────────────────────

type LightboxItem = { url: string; label: string; side?: 'Front' | 'Back' };

function itemsFor(cards: ShowcaseCard[]): LightboxItem[] {
  const out: LightboxItem[] = [];
  for (const c of cards) {
    if (c.imageFront) out.push({ url: c.imageFront, label: cardName(c), side: 'Front' });
    if (c.imageBack) out.push({ url: c.imageBack, label: cardName(c), side: 'Back' });
  }
  return out;
}

export function CardLightbox({ items, startIdx, onClose }: { items: LightboxItem[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(Math.max(0, Math.min(startIdx, items.length - 1)));
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') setIdx(i => (i - 1 + items.length) % items.length);
      else if (e.key === 'ArrowRight') setIdx(i => (i + 1) % items.length);
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);
  if (items.length === 0) return null;
  const cur = items[idx];
  const arrow: React.CSSProperties = {
    background: 'rgba(42,20,52,0.7)', color: 'var(--cream)', border: 'none', borderRadius: 8,
    padding: '8px 14px', fontSize: 24, cursor: 'pointer', lineHeight: 1,
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(42,20,52,0.9)', padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.url} alt={[cur.label, cur.side].filter(Boolean).join(' ')} style={{ maxWidth: 'min(92vw, 900px)', maxHeight: '76vh', borderRadius: 10, display: 'block', margin: '0 auto' }} />
        <div style={{ marginTop: 10, padding: '8px 14px', background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 8, color: 'var(--plum)', display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="display" style={{ fontSize: 14 }}>{cur.label}</span>
          {cur.side && <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>{cur.side}</span>}
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{idx + 1} / {items.length}</span>
        </div>
        {items.length > 1 && (
          <div style={{ position: 'absolute', top: '38%', left: 0, right: 0, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none' }}>
            <button type="button" aria-label="Previous" onClick={() => setIdx(i => (i - 1 + items.length) % items.length)} style={{ ...arrow, pointerEvents: 'auto' }}>‹</button>
            <button type="button" aria-label="Next" onClick={() => setIdx(i => (i + 1) % items.length)} style={{ ...arrow, pointerEvents: 'auto' }}>›</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm" style={{ position: 'absolute', top: 6, right: 6 }}>✕ Close</button>
      </div>
    </div>
  );
}

function useLightbox(cards: ShowcaseCard[]) {
  const items = useMemo(() => itemsFor(cards), [cards]);
  const [start, setStart] = useState<number | null>(null);
  const open = (c: ShowcaseCard, side: 'Front' | 'Back') => {
    const url = side === 'Front' ? c.imageFront : c.imageBack;
    const i = items.findIndex(it => it.url === url && it.side === side);
    if (i >= 0) setStart(i);
  };
  const node = start !== null ? <CardLightbox items={items} startIdx={start} onClose={() => setStart(null)} /> : null;
  return { open, node };
}

// ── Description ──────────────────────────────────────────────────────────

export function SetDescription({ description, conditionNotes }: { description: string | null; conditionNotes: string | null }) {
  if (!description && !conditionNotes) return null;
  return (
    <section className="panel-bordered" style={{ padding: '18px 22px', marginBottom: 20, background: 'var(--cream)' }}>
      {description && (
        <>
          <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>About this set</div>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>{description}</p>
        </>
      )}
      {conditionNotes && (
        <div style={{ marginTop: description ? 14 : 0 }}>
          <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>Condition notes</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>{conditionNotes}</p>
        </div>
      )}
    </section>
  );
}

// ── Facts: completion, condition mix, pricing source ─────────────────────

function FactPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: '12px 16px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, flex: '1 1 260px', minWidth: 0 }}>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

export function SetFacts({ completion, condition, asOf, fromComps }: {
  completion: Completion; condition: ConditionSummary; asOf: string | null; fromComps: boolean;
}) {
  const [showAllMissing, setShowAllMissing] = useState(false);
  const missingShown = showAllMissing ? completion.missing : completion.missing.slice(0, 40);
  const ownedTotal = condition.graded + condition.raw + condition.ungraded;
  const maxBucket = Math.max(1, ...condition.buckets.map(b => b.count));
  return (
    <section style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
      <FactPanel title="Set completion">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="display" style={{ fontSize: 24, color: 'var(--plum)' }}>{completion.owned} / {completion.total}</span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>{completion.pct.toFixed(1)}% complete</span>
        </div>
        <div className="progress" style={{ margin: '8px 0' }}>
          <span style={{ width: `${Math.min(100, completion.pct)}%`, background: 'var(--teal)' }} />
        </div>
        {completion.missing.length === 0 ? (
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--teal)', fontWeight: 700 }}>✓ Complete set: every card is here</div>
        ) : (
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            <strong>Missing ({completion.missing.length}):</strong>{' '}
            {missingShown.map(n => `#${n}`).join(', ')}
            {completion.missing.length > 40 && (
              <button type="button" onClick={() => setShowAllMissing(v => !v)}
                style={{ marginLeft: 6, background: 'none', border: 0, padding: 0, color: 'var(--orange)', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', fontSize: 11 }}>
                {showAllMissing ? 'show less' : `+${completion.missing.length - 40} more`}
              </button>
            )}
          </div>
        )}
      </FactPanel>

      <FactPanel title="Condition">
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8, fontWeight: 600 }}>
          {condition.graded > 0 && <><strong style={{ color: 'var(--plum)' }}>{condition.graded}</strong> graded{condition.byCompany.length > 0 && ` (${condition.byCompany.map(c => `${c.count} ${c.label}`).join(', ')})`} · </>}
          <strong style={{ color: 'var(--plum)' }}>{condition.raw}</strong> raw
          {condition.ungraded > 0 && <> · {condition.ungraded} not graded yet</>}
        </div>
        {condition.buckets.length === 0 ? (
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>No grades recorded yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {condition.buckets.slice(0, 8).map(b => (
              <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 36px', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--plum)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
                <span style={{ height: 8, background: 'var(--cream-warm)', borderRadius: 4, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(b.count / maxBucket) * 100}%`, background: 'var(--plum)', borderRadius: 4 }} />
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', textAlign: 'right' }}>{b.count}</span>
              </div>
            ))}
            {condition.buckets.length > 8 && (
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>+{condition.buckets.length - 8} more grades across {ownedTotal} cards</span>
            )}
          </div>
        )}
      </FactPanel>

      <FactPanel title="About the values">
        <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 4 }}>
          {asOf ? `Values as of ${fmtDate(asOf)}` : 'Values not yet tracked'}
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
          {fromComps
            ? 'Card values are market estimates based on recent sold sales of the same card in the same condition, updated regularly.'
            : 'Card values are the seller’s market estimates for each card in its condition.'}
          {' '}Movement compares each card’s latest value with its previous one.
        </p>
      </FactPanel>
    </section>
  );
}

// ── Key cards ────────────────────────────────────────────────────────────

export function KeyCards({ notes, cards, showValues }: { notes: KeyCardNote[]; cards: ShowcaseCard[]; showValues: boolean }) {
  const entries = useMemo(() => notes.map(n => {
    const matches = cards.filter(c => c.cardNumber.toLowerCase() === n.card.toLowerCase());
    const card = matches.find(c => c.owned) || matches[0] || null;
    return { note: n, card };
  }).filter(e => e.card), [notes, cards]);
  const lb = useLightbox(useMemo(() => entries.map(e => e.card!), [entries]));
  if (entries.length === 0) return null;
  return (
    <section className="panel-bordered" style={{ padding: '16px 18px', marginBottom: 20, background: 'var(--cream)' }}>
      <div className="display" style={{ fontSize: 17, color: 'var(--plum)', marginBottom: 12 }}>⭐ Key Cards</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
        {entries.map(({ note, card }) => (
          <div key={note.card} style={{ display: 'flex', gap: 12, padding: 10, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8 }}>
            {card!.imageFront ? (
              <Thumb url={card!.imageFront} width={240} alt={cardName(card!)} onClick={() => lb.open(card!, 'Front')}
                style={{ width: 72, height: 100, objectFit: 'cover', borderRadius: 6, border: '2px solid var(--plum)', cursor: 'pointer', flexShrink: 0 }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div className="display" style={{ fontSize: 14, color: 'var(--plum)' }}>{cardName(card!)}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', margin: '2px 0 4px' }}>
                {card!.condition && <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{card!.condition}</span>}
                {showValues && card!.value !== null && <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--orange)' }}>{fmtMoney(card!.value)}</span>}
                {!card!.owned && <span className="eyebrow" style={{ fontSize: 10, color: 'var(--rust)' }}>Not included</span>}
              </div>
              {note.note && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{note.note}</p>}
            </div>
          </div>
        ))}
      </div>
      {lb.node}
    </section>
  );
}

// ── Value over time ──────────────────────────────────────────────────────

export function SetValueChart({ points }: { points: TimelinePoint[] }) {
  if (points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : null;
  const fmtShort = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : `$${Math.round(n)}`;
  const fmtMonth = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  return (
    <section className="panel-bordered" style={{ padding: '16px 18px 8px', marginBottom: 20, background: 'var(--cream)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="display" style={{ fontSize: 17, color: 'var(--plum)' }}>📈 Set Value Over Time</div>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: delta >= 0 ? 'var(--teal)' : 'var(--rust)' }}>
          {delta >= 0 ? '▲' : '▼'} {delta >= 0 ? '+' : '-'}{fmtMoney(Math.abs(delta))}{pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''} since {fmtMonth(points[0].date)}
        </span>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={RULE} strokeOpacity={0.35} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: INK_MUTE }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: INK_MUTE }} axisLine={false} tickLine={false} width={52} domain={['auto', 'auto']} />
            <Tooltip
              formatter={(v: number) => [fmtMoney(v), 'Set value']}
              labelFormatter={(d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              contentStyle={{ background: '#f8ecd0', border: '2px solid #3d1f4a', borderRadius: 8, fontSize: 12 }}
            />
            <Line type="monotone" dataKey="value" stroke={TEAL} strokeWidth={2} dot={{ r: 4, fill: TEAL, strokeWidth: 0 }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ── Top cards ────────────────────────────────────────────────────────────

export function TopCards({ cards, title = 'Top 16 Cards by Value', onValueClick }: {
  cards: ShowcaseCard[]; title?: string; onValueClick?: (c: ShowcaseCard) => void;
}) {
  const lb = useLightbox(cards);
  if (cards.length === 0) return null;
  return (
    <section style={{ marginBottom: 28 }}>
      <div className="display" style={{ fontSize: 20, color: 'var(--plum)', margin: '4px 0 12px' }}>💎 {title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(max(140px, calc(25% - 12px)), 1fr))', gap: 12 }}>
        {cards.map((c, i) => (
          <div key={c.key + c.rowIdx} className="panel" style={{ padding: 10, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <span className="mono" style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, background: 'var(--plum)', color: 'var(--mustard)', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 100 }}>#{i + 1}</span>
            <div style={{ aspectRatio: '5 / 7', background: 'var(--plum)', borderRadius: 6, overflow: 'hidden', display: 'grid', placeItems: 'center', cursor: c.imageFront ? 'pointer' : 'default' }}
              onClick={() => c.imageFront && lb.open(c, 'Front')}>
              {c.imageFront ? (
                <Thumb url={c.imageFront} width={480} alt={cardName(c)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <span className="eyebrow" style={{ color: 'var(--cream)', fontSize: 10 }}>No photo</span>
              )}
            </div>
            <div style={{ marginTop: 8, flex: 1 }}>
              <div className="display" style={{ fontSize: 13.5, color: 'var(--plum)', lineHeight: 1.25 }}>{cardName(c)}</div>
              {c.condition && <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginTop: 2 }}>{c.condition}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {onValueClick ? (
                <button type="button" onClick={() => onValueClick(c)} title="Update value"
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--orange)', fontFamily: 'var(--font-display)', fontSize: 18, textDecoration: 'underline', textDecorationThickness: 1, textUnderlineOffset: 2 }}>
                  {c.value !== null ? fmtMoney(c.value) : '—'}
                </button>
              ) : (
                <span className="display" style={{ fontSize: 18, color: 'var(--orange)' }}>{c.value !== null ? fmtMoney(c.value) : '—'}</span>
              )}
              <TrendBadge trend={c.trend} />
            </div>
            {c.imageBack && (
              <button type="button" onClick={() => lb.open(c, 'Back')} className="mono"
                style={{ marginTop: 4, alignSelf: 'flex-start', background: 'none', border: 0, padding: 0, fontSize: 10.5, color: 'var(--ink-mute)', cursor: 'pointer', textDecoration: 'underline' }}>
                View back
              </button>
            )}
          </div>
        ))}
      </div>
      {lb.node}
    </section>
  );
}

// ── Full set grid (public, read-only) ────────────────────────────────────

const PAGE = 48;

export function SetCardGrid({ cards, showValues }: { cards: ShowcaseCard[]; showValues: boolean }) {
  const [filter, setFilter] = useState<'all' | 'owned' | 'missing'>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter(c =>
      (filter === 'all' || (filter === 'owned' ? c.owned : !c.owned)) &&
      (!needle || c.player.toLowerCase().includes(needle) || c.cardNumber.toLowerCase() === needle.replace(/^#/, '')),
    );
  }, [cards, filter, q]);
  const shown = filtered.slice(0, limit);
  const lb = useLightbox(shown);
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <div className="display" style={{ fontSize: 20, color: 'var(--plum)', flex: '1 1 auto' }}>The Complete Checklist</div>
        <input className="input-sc" value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search player or #"
          style={{ maxWidth: 220, padding: '6px 10px', fontSize: 13 }} />
        {(['all', 'owned', 'missing'] as const).map(f => (
          <button key={f} type="button" onClick={() => { setFilter(f); setLimit(PAGE); }}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}>
            {f === 'all' ? 'All' : f === 'owned' ? 'Included' : 'Missing'}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>No cards match.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
          {shown.map(c => (
            <div key={c.rowIdx} className="panel" style={{ padding: '10px 12px', display: 'flex', gap: 10, opacity: c.owned ? 1 : 0.6 }}>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {c.imageFront ? (
                  <Thumb url={c.imageFront} width={240} alt={`${cardName(c)} front`} onClick={() => lb.open(c, 'Front')}
                    style={{ width: 58, height: 80, objectFit: 'cover', borderRadius: 5, border: '1.5px solid var(--plum)', cursor: 'pointer' }} />
                ) : (
                  <div style={{ width: 58, height: 80, borderRadius: 5, border: '1.5px dashed var(--rule)' }} />
                )}
                {c.imageBack && (
                  <Thumb url={c.imageBack} width={240} alt={`${cardName(c)} back`} onClick={() => lb.open(c, 'Back')}
                    style={{ width: 58, height: 80, objectFit: 'cover', borderRadius: 5, border: '1.5px solid var(--plum)', cursor: 'pointer' }} />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.3 }}>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--ink-mute)' }}>{c.cardNumber ? `#${c.cardNumber}` : ''}</span>{' '}
                  <span className="display" style={{ color: 'var(--plum)' }}>{c.player}</span>
                </div>
                {c.condition && <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginTop: 3 }}>{c.condition}</div>}
                {!c.owned && <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--rust)', marginTop: 3 }}>Not included</div>}
                {showValues && c.owned && c.value !== null && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginTop: 4 }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>{fmtMoney(c.value)}</span>
                    <TrendBadge trend={c.trend} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {filtered.length > shown.length && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={() => setLimit(l => l + PAGE * 2)}>
            Show more ({filtered.length - shown.length} left)
          </button>
        </div>
      )}
      {lb.node}
    </section>
  );
}
