'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { createClient } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/supabase/fetchAll';
import SCLogo from '@/components/SCLogo';
import { cardValueKey } from '@/lib/cardValueHistory';
import type { CollectionItem } from '@/lib/collectionItems';
import {
  addMonths, buildSnapshot, buildValueIndex, diffSnapshots, extractCards, extractItemCards, itemMarks, usableMarks, monthLabel, monthOf, monthsBetween,
  reconstructSnapshot, type HistoryMark, type IndexPoint, type Mover, type SetInput, type Snapshot,
} from '@/lib/collectionValue';

// Collection value tracker. One month-end snapshot per month (written by the
// monthly cron; see app/api/cron/collection-snapshot) plus a live month-to-date
// point. Months that were never snapshotted are rebuilt from card_value_history
// when enough of today's cards have a mark by then.

const MIN_RECONSTRUCT_COVERAGE = 0.6;
const MAX_BACKFILL_MONTHS = 24;

const money = (n: number, compact = false) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: compact && Math.abs(n) >= 10000 ? 0 : 2 }).format(n);
const moneyShort = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${s}$${(a / 1000).toFixed(1)}K`;
  return `${s}${money(a)}`;
};
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
const pctText = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`);
const tone = (n: number) => (n > 0.005 ? 'var(--teal)' : n < -0.005 ? 'var(--rust)' : 'var(--ink-mute)');

type SeriesKey = 'total' | 'personal' | 'inventory' | 'market';
type Tab = 'movers' | 'top' | 'sets';

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: React.ReactNode; color?: string }) {
  return (
    <div className="panel" style={{ padding: '14px 18px' }}>
      <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--plum)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 14px', textAlign: 'left' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '7px 14px', fontSize: 13, color: 'var(--plum)' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' };

function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      <tr>{children}</tr>
    </thead>
  );
}

export default function CollectionValuePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [indexPts, setIndexPts] = useState<IndexPoint[]>([]);
  const [series, setSeries] = useState<SeriesKey>('total');
  const [selected, setSelected] = useState<string>('');
  const [tab, setTab] = useState<Tab>('movers');
  const [moverView, setMoverView] = useState<'gainers' | 'losers' | 'all'>('all');

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const [setsRes, marks, stored, itemsRes] = await Promise.all([
        supabase.from('sets').select('slug, title, year, brand, purpose, rows').eq('user_id', user.id),
        // mark_kind and the note text only weight a mark in the market index;
        // a deployment without those columns falls back to the plain select.
        (async () => {
          const withKind = await fetchAll<any>((from, to) => supabase.from('card_value_history')
            .select('set_slug, card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at, mark_kind, mark_notes:snapshot->>notes')
            .eq('user_id', user.id).order('created_at').range(from, to));
          if (withKind.length) return withKind;
          return fetchAll<any>((from, to) => supabase.from('card_value_history')
            .select('set_slug, card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at')
            .eq('user_id', user.id).order('created_at').range(from, to));
        })(),
        supabase.from('collection_value_snapshots').select('*').eq('user_id', user.id).order('month'),
        // Singles & items. A missing table (migration not run) just means no items.
        supabase.from('collection_items').select('id, item_type, first_name, last_name, year, brand, description, qty, cost, value, value_history').eq('user_id', user.id),
      ]);
      const items = ((itemsRes.data || []) as any[]).map(r => ({
        ...r, qty: Number(r.qty), cost: Number(r.cost), value: Number(r.value),
        value_history: Array.isArray(r.value_history) ? r.value_history : [],
      })) as CollectionItem[];
      if (setsRes.error) { setError(setsRes.error.message); setLoading(false); return; }
      // A missing table (migration not run yet) shouldn't blank the page: we can
      // still show the live numbers, just without stored history.
      const have = new Map<string, Snapshot>();
      for (const r of (stored.data || []) as any[]) have.set(r.month, { ...r, total_value: Number(r.total_value), total_cost: Number(r.total_cost), coverage: r.coverage === null ? null : Number(r.coverage) });

      const cards = [...extractCards((setsRes.data || []) as SetInput[]), ...extractItemCards(items)];
      const thisMonth = monthOf(new Date());
      // Rebuilt months are recomputed on every visit (they are cheap and follow
      // the price marks as you add them); only month-end snapshots taken at the
      // time are kept as stored.
      const out = new Map([...have].filter(([, v]) => v.source === 'month_end'));
      const toWrite: Snapshot[] = [];

      // Live, month-to-date point.
      const live = buildSnapshot(cards, thisMonth, 'live');
      out.set(thisMonth, live);
      if (cards.length) toWrite.push(live);

      // Past months: rebuild from price history, starting at the first month with
      // enough coverage and continuing from there. The month just before this one
      // is the baseline the current month is measured against, so it is always
      // built from marks dated before this month began — whatever coverage there
      // is, shown on the page — and never from anything entered this month.
      const histMarks: HistoryMark[] = usableMarks(marks.map(m => ({
        set_slug: m.set_slug,
        key: cardValueKey({
          year: m.card_year, brand: m.card_brand, card_number: m.card_number,
          grade: m.card_grade, grading_company: m.card_grading_company, raw_grade: m.card_raw_grade,
        }),
        market_value: Number(m.market_value),
        created_at: m.created_at,
        kind: m.mark_kind ?? null,
        notes: m.mark_notes ?? null,
      }))).concat(itemMarks(items)).sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (histMarks.length && cards.length) {
        const first = monthOf(new Date(histMarks[0].created_at));
        const start = first < addMonths(thisMonth, -MAX_BACKFILL_MONTHS) ? addMonths(thisMonth, -MAX_BACKFILL_MONTHS) : first;
        let started = false;
        const baseline = addMonths(thisMonth, -1);
        for (const m of monthsBetween(start, baseline)) {
          const existing = have.get(m);
          const isBaseline = m === baseline;
          if (existing?.source === 'month_end' && !isBaseline) { started = true; continue; }
          const rec = reconstructSnapshot(cards, histMarks, m);
          const ok = rec.total_value > 0
            && (isBaseline || (rec.coverage !== null && rec.coverage >= MIN_RECONSTRUCT_COVERAGE));
          if (!started && !ok) continue;
          if (ok) {
            started = true;
            out.set(m, rec);
            // A month-end snapshot is the record of what was stored then; the
            // baseline view replaces it on screen but never overwrites it.
            if (existing?.source !== 'month_end') toWrite.push(rec);
          }
        }
      }

      if (toWrite.length) {
        const { error: werr } = await supabase.from('collection_value_snapshots')
          .upsert(toWrite.map(s => ({ user_id: user.id, ...s })));
        if (werr) console.warn('[collection-value] snapshot save failed:', werr.message);
      }

      const list = [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
      if (list.length > 1) setIndexPts(buildValueIndex(cards, histMarks, list.map(x => x.month)));
      setSnaps(list);
      setSelected(thisMonth);
      setLoading(false);
    })();
  }, [router]);

  const idx = snaps.findIndex(s => s.month === selected);
  const cur = idx >= 0 ? snaps[idx] : null;
  const prev = idx > 0 ? snaps[idx - 1] : null;
  const latest = snaps[snaps.length - 1] ?? null;

  const diff = useMemo(() => (cur && prev ? diffSnapshots(prev, cur) : null), [cur, prev]);

  // Market-adjusted line: the like-for-like index scaled to today's total, so a
  // month moves only when cards that were actually re-marked moved.
  const marketByMonth = useMemo(() => {
    const m = new Map<string, IndexPoint & { value: number }>();
    const end = indexPts[indexPts.length - 1];
    const now = snaps[snaps.length - 1];
    if (!end || !now || indexPts.length !== snaps.length) return m;
    for (const p of indexPts) m.set(p.month, { ...p, value: now.total_value * (p.index / end.index) });
    return m;
  }, [indexPts, snaps]);

  const chartData = useMemo(() => snaps.map(s => ({
    month: s.month, label: monthLabel(s.month),
    total: Math.round(s.total_value), personal: Math.round(s.by_purpose.personal), inventory: Math.round(s.by_purpose.inventory),
    market: marketByMonth.has(s.month) ? Math.round(marketByMonth.get(s.month)!.value) : undefined,
    source: s.source,
  })), [snaps, marketByMonth]);

  const metrics = useMemo(() => {
    if (!snaps.length) return null;
    const changes = snaps.slice(1).map((s, i) => ({ month: s.month, delta: s.total_value - snaps[i].total_value, pct: snaps[i].total_value ? ((s.total_value - snaps[i].total_value) / snaps[i].total_value) * 100 : null }));
    const best = changes.reduce<typeof changes[number] | null>((b, c) => (!b || c.delta > b.delta ? c : b), null);
    const worst = changes.reduce<typeof changes[number] | null>((b, c) => (!b || c.delta < b.delta ? c : b), null);
    const peak = snaps.reduce((b, s) => (s.total_value > b.total_value ? s : b), snaps[0]);
    const l = snaps[snaps.length - 1];
    const topShare = l.total_value ? (l.top_cards.reduce((a, c) => a + c.value, 0) / l.total_value) * 100 : 0;
    return { best, worst, peak, topShare };
  }, [snaps]);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  const moversShown: Mover[] = diff
    ? diff.movers
        .filter(m => (moverView === 'gainers' ? m.delta > 0 : moverView === 'losers' ? m.delta < 0 : true))
        .sort((a, b) => (moverView === 'losers' ? a.delta - b.delta : moverView === 'gainers' ? b.delta - a.delta : Math.abs(b.delta) - Math.abs(a.delta)))
        .slice(0, 25)
    : [];

  const monthDelta = cur && prev ? cur.total_value - prev.total_value : null;
  const monthPct = cur && prev && prev.total_value ? ((cur.total_value - prev.total_value) / prev.total_value) * 100 : null;
  const gain = latest ? latest.total_value - latest.total_cost : 0;
  const isLive = cur?.source === 'live';
  const drv = diff?.drivers;
  // A rebuilt prior month is built from the cards you own today, so a card that
  // is "added" against it was not new — it just had no price before then.
  const prevRebuilt = prev?.source === 'reconstructed';
  const addedLabel = prevRebuilt ? 'No prior price' : 'New to collection';

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" onClick={() => setTab(t)} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`}>{label}</button>
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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ 📈 Collection Value ★</div>
          <div style={{ marginLeft: 'auto' }}><Link href="/home" className="btn btn-outline btn-sm">← Home</Link></div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        {error && <p style={{ color: 'var(--rust)' }}>Couldn&apos;t load your collection: {error}</p>}
        {!error && !latest && <p style={{ color: 'var(--ink-soft)' }}>No owned cards with a value yet. Mark cards as owned and add values, then come back.</p>}

        {latest && metrics && (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 22 }}>
              <Kpi label="Collection value" value={moneyShort(latest.total_value)}
                sub={`${latest.valued_cards.toLocaleString()} valued of ${latest.owned_cards.toLocaleString()} owned`} />
              <Kpi label={`Change in ${monthLabel(selected, true)}`}
                value={monthDelta === null ? '—' : signed(monthDelta)}
                color={monthDelta === null ? undefined : tone(monthDelta)}
                sub={monthDelta === null ? 'no prior month yet' : `${pctText(monthPct)} vs ${monthLabel(prev!.month)}${isLive ? ' · month to date' : ''}`} />
              <Kpi label="Personal / Inventory" value={`${moneyShort(latest.by_purpose.personal)} / ${moneyShort(latest.by_purpose.inventory)}`}
                sub={latest.total_value ? `${((latest.by_purpose.personal / latest.total_value) * 100).toFixed(0)}% personal` : undefined} />
              <Kpi label="Paid vs worth" value={latest.total_cost ? signed(gain) : '—'} color={latest.total_cost ? tone(gain) : undefined}
                sub={latest.total_cost ? `${money(latest.total_cost, true)} cost basis · ${pctText((gain / latest.total_cost) * 100)}` : 'no cost data'} />
              {metrics.best && <Kpi label="Best month" value={signed(metrics.best.delta)} color="var(--teal)" sub={`${monthLabel(metrics.best.month, true)} · ${pctText(metrics.best.pct)}`} />}
              {metrics.worst && metrics.worst.delta < 0 && <Kpi label="Worst month" value={signed(metrics.worst.delta)} color="var(--rust)" sub={`${monthLabel(metrics.worst.month, true)} · ${pctText(metrics.worst.pct)}`} />}
              <Kpi label="Peak value" value={moneyShort(metrics.peak.total_value)} sub={monthLabel(metrics.peak.month, true)} />
              <Kpi label="Top 25 concentration" value={`${metrics.topShare.toFixed(0)}%`} sub="of value sits in 25 cards" />
            </div>

            {/* Trend chart */}
            <div className="panel" style={{ padding: '18px 20px 10px', marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700 }}>★ Value trend ★</span>
                {(['total', 'personal', 'inventory', ...(marketByMonth.size ? ['market'] : [])] as SeriesKey[]).map(k => (
                  <button key={k} type="button" onClick={() => setSeries(k)} className={`btn btn-sm ${series === k ? 'btn-primary' : 'btn-outline'}`}
                    title={k === 'market' ? 'Only counts cards that were re-priced each month, so cards you added or never re-marked don’t move the line' : undefined}>
                    {k === 'total' ? 'Total' : k === 'personal' ? 'Personal' : k === 'inventory' ? 'Inventory' : 'Market-adjusted'}
                  </button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
                  Click a point to see what drove that month.
                </span>
              </div>
              {chartData.length < 2 ? (
                <p style={{ color: 'var(--ink-soft)', fontSize: 13, padding: '24px 0' }}>
                  Tracking starts in {monthLabel(chartData[0].month, true)}. The trend appears once there are two months, and a new
                  point is saved at the close of every month.
                </p>
              ) : (
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                      onClick={(e: any) => { const m = e?.activePayload?.[0]?.payload?.month; if (m) setSelected(m); }}>
                      <defs>
                        <linearGradient id="cvFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2d7a6e" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#2d7a6e" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(61,31,74,0.12)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v: number) => moneyShort(v)} tick={{ fontSize: 11 }} width={64} domain={['auto', 'auto']} />
                      <Tooltip formatter={(v: any) => money(Number(v))} labelFormatter={(l: any) => String(l)} />
                      <Area type="monotone" dataKey={series} stroke="#2d7a6e" strokeWidth={2.5} fill="url(#cvFill)"
                        dot={{ r: 3, fill: '#2d7a6e' }} activeDot={{ r: 6 }} name="Value" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '6px 0 8px' }}>
                {snaps.some(s => s.source === 'reconstructed') && 'Months marked “rebuilt” were reconstructed from your price history using the cards you own today, so they show what today’s collection was worth then. '}
                The current month is month-to-date until it closes.
                {series === 'market' && ' Market-adjusted compares only cards that got a new price mark each month, weighted by value and by how many sales stood behind the mark, then scales to today’s total. Months with little new pricing are flagged.'}
              </p>
              {series === 'market' && marketByMonth.get(selected) && (() => {
                const p = marketByMonth.get(selected)!;
                if (p.link === null) return <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '0 0 8px' }}>No cards were re-priced in {monthLabel(selected, true)}, so the line holds flat.</p>;
                return (
                  <p style={{ fontSize: 11.5, color: p.coverage < 0.25 ? 'var(--rust)' : 'var(--ink-mute)', margin: '0 0 8px' }}>
                    {monthLabel(selected, true)}: {pctText((p.link - 1) * 100)} like-for-like from {p.observed.toLocaleString()} re-priced card{p.observed === 1 ? '' : 's'}
                    {' '}({(p.coverage * 100).toFixed(0)}% of value){p.coverage < 0.25 ? ' — thin data, treat this move with caution.' : '.'}
                  </p>
                );
              })()}
            </div>

            {/* Month picker + drivers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700 }}>★ Month ★</span>
              <select value={selected} onChange={e => setSelected(e.target.value)}
                style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', color: 'var(--plum)', fontFamily: 'var(--font-body)', cursor: 'pointer' }}>
                {[...snaps].reverse().map(s => (
                  <option key={s.month} value={s.month}>
                    {monthLabel(s.month, true)}{s.source === 'live' ? ' (month to date)' : s.source === 'reconstructed' ? ' (rebuilt)' : ''}
                  </option>
                ))}
              </select>
              {cur && <span className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{money(cur.total_value)}</span>}
              {cur?.source === 'reconstructed' && cur.coverage !== null && cur.coverage < 0.95 && (
                <span style={{ fontSize: 12, color: 'var(--rust)' }}>Only {(cur.coverage * 100).toFixed(0)}% of cards had a price mark by then — value is likely understated.</span>
              )}
            </div>

            {drv && prev && (
              <div className="panel" style={{ padding: '14px 18px', marginBottom: 18 }}>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 8 }}>
                  What drove the change · {monthLabel(prev.month)} → {monthLabel(selected)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  {[
                    { l: 'Cards that rose', v: drv.repricedUp, n: drv.upCount },
                    { l: 'Cards that fell', v: drv.repricedDown, n: drv.downCount },
                    { l: addedLabel, v: drv.added, n: drv.addedCount },
                    { l: 'Left collection', v: drv.removed, n: drv.removedCount },
                    { l: 'Net change', v: drv.net, n: null as number | null },
                  ].map(x => (
                    <div key={x.l}>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{x.l}{x.n !== null ? ` (${x.n})` : ''}</div>
                      <div className="display" style={{ fontSize: 20, fontWeight: 700, color: tone(x.v) }}>{signed(x.v)}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '8px 0 0' }}>
                  {prevRebuilt
                    ? `${monthLabel(prev!.month, true)} is rebuilt from each card’s latest price before ${monthLabel(selected, true)} began, so price moves are cards re-priced since. “No prior price” cards had no earlier mark, so their full value shows as added.`
                    : 'Price moves are market changes; additions and removals are cards bought, sold, or re-marked as owned.'}
                </p>
              </div>
            )}

            {/* Tables */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {tabBtn('movers', 'Biggest movers')}
              {tabBtn('top', 'Top 25 by value')}
              {tabBtn('sets', 'By set')}
            </div>

            <div className="panel" style={{ overflowX: 'auto' }}>
              {tab === 'movers' && (
                <>
                  <div style={{ display: 'flex', gap: 8, padding: '10px 14px', alignItems: 'center' }}>
                    {(['all', 'gainers', 'losers'] as const).map(v => (
                      <button key={v} type="button" onClick={() => setMoverView(v)} className={`btn btn-sm ${moverView === v ? 'btn-primary' : 'btn-ghost'}`}>
                        {v === 'all' ? 'Largest $ move' : v === 'gainers' ? 'Gainers' : 'Decliners'}
                      </button>
                    ))}
                    <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>Top 25 · by dollar change</span>
                  </div>
                  {!diff ? (
                    <p style={{ padding: '4px 18px 18px', color: 'var(--ink-soft)', fontSize: 13 }}>No earlier month to compare against yet.</p>
                  ) : moversShown.length === 0 ? (
                    <p style={{ padding: '4px 18px 18px', color: 'var(--ink-soft)', fontSize: 13 }}>No cards changed in value this month.</p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <THead><th style={th}>Card</th><th style={th}>Set</th><th style={th}>Condition</th><th style={thR}>Was</th><th style={thR}>Now</th><th style={thR}>Change</th><th style={thR}>%</th></THead>
                      <tbody>
                        {moversShown.map(m => (
                          <tr key={m.key} style={{ borderTop: '1px solid var(--rule)' }}>
                            <td style={{ ...td, fontWeight: 600 }}>
                              {m.name}
                              {m.kind !== 'repriced' && <span className="chip" style={{ marginLeft: 8, fontSize: 9 }}>{m.kind === 'added' ? (prevRebuilt ? 'No prior price' : 'New') : 'Left'}</span>}
                            </td>
                            <td style={{ ...td, color: 'var(--ink-soft)' }}>{m.setTitle}</td>
                            <td style={{ ...td, color: 'var(--ink-soft)' }}>{m.condition}</td>
                            <td style={tdR}>{m.kind === 'added' ? '—' : money(m.from)}</td>
                            <td style={tdR}>{m.kind === 'removed' ? '—' : money(m.to)}</td>
                            <td style={{ ...tdR, fontWeight: 700, color: tone(m.delta) }}>{signed(m.delta)}</td>
                            <td style={{ ...tdR, color: tone(m.delta) }}>{pctText(m.pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {tab === 'top' && cur && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <THead><th style={th}>#</th><th style={th}>Card</th><th style={th}>Set</th><th style={th}>Condition</th><th style={thR}>Value</th><th style={thR}>% of total</th><th style={thR}>vs prior month</th></THead>
                  <tbody>
                    {cur.top_cards.map((c, i) => {
                      const was = prev?.card_values[c.key]?.[0];
                      const d = was === undefined ? null : c.value - was;
                      return (
                        <tr key={c.key} style={{ borderTop: '1px solid var(--rule)' }}>
                          <td style={{ ...td, color: 'var(--ink-mute)' }}>{i + 1}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{c.name}</td>
                          <td style={{ ...td, color: 'var(--ink-soft)' }}>{c.setTitle}</td>
                          <td style={{ ...td, color: 'var(--ink-soft)' }}>{c.condition}</td>
                          <td style={{ ...tdR, fontWeight: 700 }}>{money(c.value)}</td>
                          <td style={tdR}>{cur.total_value ? ((c.value / cur.total_value) * 100).toFixed(1) : '0'}%</td>
                          <td style={{ ...tdR, color: d === null ? 'var(--ink-mute)' : tone(d) }}>{d === null ? (prev ? (prevRebuilt ? 'No prior price' : 'New') : '—') : Math.abs(d) < 0.005 ? '—' : signed(d)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {tab === 'sets' && cur && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <THead><th style={th}>Set</th><th style={th}>Type</th><th style={thR}>Cards owned</th><th style={thR}>Value</th><th style={thR}>% of total</th><th style={thR}>vs prior month</th></THead>
                  <tbody>
                    {cur.by_set.filter(s => s.value > 0 || s.cards > 0).map(s => {
                      const was = prev?.by_set.find(p => p.slug === s.slug)?.value;
                      const d = was === undefined ? null : s.value - was;
                      return (
                        <tr key={s.slug} style={{ borderTop: '1px solid var(--rule)' }}>
                          <td style={{ ...td, fontWeight: 600 }}>{s.title}</td>
                          <td style={{ ...td, color: 'var(--ink-soft)' }}>{s.group === 'inventory' ? 'Inventory' : 'Personal'}</td>
                          <td style={tdR}>{s.cards.toLocaleString()}</td>
                          <td style={{ ...tdR, fontWeight: 700 }}>{money(s.value)}</td>
                          <td style={tdR}>{cur.total_value ? ((s.value / cur.total_value) * 100).toFixed(1) : '0'}%</td>
                          <td style={{ ...tdR, color: d === null ? 'var(--ink-mute)' : tone(d) }}>{d === null ? '—' : Math.abs(d) < 0.005 ? '—' : signed(d)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 14 }}>
              Counts every card marked Owned, in personal and inventory sets, at its Value, plus your <Link href="/items" style={{ color: 'var(--teal)' }}>singles &amp; items</Link> at quantity × value. Want-list cards aren&apos;t included, so this can be
              lower than “Est. value” on the home page, which totals every row in every set.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
