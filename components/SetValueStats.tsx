'use client';

// Set-level value-movement stats, shown to a viewer at the top of a set's
// inventory view. Rolls up every card's committed price history into a single
// picture: the set's total current value, how much the whole set moved since
// the prior marks, and — the part collectors care about — who the biggest
// winners and losers are. Purely presentational: the view page computes one
// CardValueStat per card and hands them here; this component does the
// aggregation and drawing. Dependency-free, so it adds no bundle weight.

import React, { useMemo } from 'react';
import type { Trend } from '@/lib/cardValueHistory';

// One card's contribution to the set roll-up.
export type CardValueStat = {
  key: string;
  name: string;            // e.g. "#150 Willie Mays"
  conditionLabel: string;  // e.g. "PSA 8" / "Raw NM"
  latest: number | null;   // current value (Value field; null if none)
  trend: Trend | null;     // latest vs prior recorded value (null if <2 marks)
  latestMarkAt: string | null; // ISO timestamp of the most recent value mark
  onClick?: () => void;    // open the card's value detail popup
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}
// Compact money for tight tiles: $1.2K, $34.5K, $1.1M.
function fmtMoneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${fmtMoney(abs)}`;
}
function trendArrow(dir: 'up' | 'down' | 'flat'): string {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→';
}
// Most-recent value-change date, e.g. "Aug 13, 2026". Returns '' for no marks.
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function trendColor(dir: 'up' | 'down' | 'flat'): string {
  return dir === 'up' ? 'var(--teal)' : dir === 'down' ? 'var(--rust)' : 'var(--ink-mute)';
}
// Rank value: percent when we have it, else push zero-baseline moves to the
// extremes (a card going from $0 → positive is the ultimate gainer).
function moverRank(t: Trend): number {
  if (t.pct !== null) return t.pct;
  return t.delta >= 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}
function pctLabel(t: Trend): string {
  return t.pct !== null
    ? `${t.pct >= 0 ? '+' : ''}${t.pct.toFixed(1)}%`
    : `${t.delta >= 0 ? '+' : ''}${fmtMoney(t.delta)}`;
}

function StatTile({ label, value, sub, accent }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="panel" style={{ padding: '12px 16px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, minWidth: 150, flex: 1 }}>
      <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginBottom: 3 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--plum)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Ultra-compact single-line mover, used inside the Cards Up/Down tile to name
// the biggest gainer and decliner: "▲ #4 Tommy Henrich +12%". Clickable when the
// stat carries an onClick, so it jumps to the card's value detail.
function MoverLine({ stat }: { stat: CardValueStat }) {
  const t = stat.trend!;
  const color = trendColor(t.direction);
  const Tag = stat.onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={stat.onClick}
      title={`${stat.name} — ${fmtMoney(t.previous)} → ${fmtMoney(t.latest)}`}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 4, width: '100%',
        background: 'transparent', border: 0, padding: 0, textAlign: 'left',
        cursor: stat.onClick ? 'pointer' : 'default', color: 'inherit', lineHeight: 1.5,
      }}
    >
      <span style={{ color, fontWeight: 700 }}>{trendArrow(t.direction)}</span>
      <span style={{ color: 'var(--ink-soft)', fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {stat.name}
      </span>
      <span style={{ color, fontWeight: 700, whiteSpace: 'nowrap' }}>{pctLabel(t)}</span>
    </Tag>
  );
}

// One row in the winners / losers lists: name, %/$ move, current value, and a
// diverging bar whose length is proportional to the biggest move on screen.
function MoverRow({ stat, maxAbs }: { stat: CardValueStat; maxAbs: number }) {
  const t = stat.trend!;
  const dir = t.direction;
  const color = trendColor(dir);
  const magnitude = t.pct !== null ? Math.abs(t.pct) : Math.abs(t.delta);
  const pctW = maxAbs > 0 ? Math.max(4, (magnitude / maxAbs) * 100) : 4;
  const Tag = stat.onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={stat.onClick}
      title={`${stat.name} — ${fmtMoney(t.previous)} → ${fmtMoney(t.latest)}`}
      style={{
        display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
        border: 0, padding: '5px 2px', cursor: stat.onClick ? 'pointer' : 'default',
        borderTop: '1px solid var(--rule)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--plum)', fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {stat.name}
        </span>
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
          {trendArrow(dir)}{pctLabel(t)}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {fmtMoney(t.latest)}
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--cream-warm)', borderRadius: 3, marginTop: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pctW}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </Tag>
  );
}

function MoverList({ title, accent, items, maxAbs, emptyLabel }: {
  title: string; accent: string; items: CardValueStat[]; maxAbs: number; emptyLabel: string;
}) {
  return (
    <div className="panel" style={{ padding: '10px 14px 8px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, flex: 1, minWidth: 260 }}>
      <div className="eyebrow" style={{ fontSize: 10, color: accent, marginBottom: 4 }}>{title}</div>
      {items.length === 0 ? (
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', padding: '8px 2px' }}>{emptyLabel}</div>
      ) : (
        items.map(s => <MoverRow key={s.key} stat={s} maxAbs={maxAbs} />)
      )}
    </div>
  );
}

export default function SetValueStats({ stats }: { stats: CardValueStat[] }) {
  const agg = useMemo(() => {
    const valued = stats.filter(s => s.latest !== null);
    const setValue = valued.reduce((sum, s) => sum + (s.latest || 0), 0);

    const moved = stats.filter(s => s.trend !== null);
    let prevTotal = 0, latestTotal = 0, up = 0, down = 0, flat = 0;
    for (const s of moved) {
      const t = s.trend!;
      prevTotal += t.previous;
      latestTotal += t.latest;
      if (t.direction === 'up') up += 1;
      else if (t.direction === 'down') down += 1;
      else flat += 1;
    }
    const setDelta = latestTotal - prevTotal;
    const setPct = prevTotal !== 0 ? (setDelta / prevTotal) * 100 : null;
    const setDir: 'up' | 'down' | 'flat' = setDelta > 0.005 ? 'up' : setDelta < -0.005 ? 'down' : 'flat';

    const ranked = moved.slice().sort((a, b) => moverRank(b.trend!) - moverRank(a.trend!));
    const winners = ranked.filter(s => s.trend!.direction === 'up').slice(0, 5);
    const losers = ranked.filter(s => s.trend!.direction === 'down').reverse().slice(0, 5);
    // Single biggest gainer / decliner, surfaced right in the up/down tile.
    const topGainer = winners[0] || null;
    const topDecliner = losers.length ? losers[losers.length - 1] : null;

    const maxAbs = Math.max(
      0,
      ...moved.map(s => {
        const t = s.trend!;
        return t.pct !== null ? Math.abs(t.pct) : Math.abs(t.delta);
      }),
    );

    // Most recent value change anywhere in the set — the date shown on the
    // "Change in Value" tile. Considers every card that has any mark, so even a
    // first-time valuation stamps a date.
    let lastChangeAt: string | null = null;
    for (const s of stats) {
      if (s.latestMarkAt && (!lastChangeAt || s.latestMarkAt > lastChangeAt)) lastChangeAt = s.latestMarkAt;
    }

    return { valuedCount: valued.length, setValue, movedCount: moved.length, setDelta, setPct, setDir, up, down, flat, winners, losers, topGainer, topDecliner, maxAbs, lastChangeAt };
  }, [stats]);

  // Nothing valued in this set yet — don't show an empty stats bar.
  if (agg.valuedCount === 0) return null;

  return (
    <section className="panel-bordered" style={{ padding: 16, marginBottom: 20, background: 'var(--cream)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="display" style={{ fontSize: 15, color: 'var(--plum)' }}>📊 Set Value Movement</div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600 }}>
          across {agg.valuedCount} valued card{agg.valuedCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Roll-up tiles */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: agg.movedCount > 0 ? 14 : 0 }}>
        <StatTile
          label="Set Value"
          value={fmtMoney(agg.setValue)}
          sub={`${agg.valuedCount} card${agg.valuedCount === 1 ? '' : 's'} valued`}
          accent="var(--orange)"
        />
        <StatTile
          label="Change in Value"
          value={agg.movedCount === 0 ? '—' : (
            <span style={{ color: trendColor(agg.setDir) }}>
              {trendArrow(agg.setDir)}{' '}
              {agg.setPct !== null ? `${agg.setPct >= 0 ? '+' : ''}${agg.setPct.toFixed(1)}%` : fmtMoneyShort(agg.setDelta)}
            </span>
          )}
          sub={
            agg.movedCount === 0
              ? (agg.lastChangeAt ? `set ${fmtDate(agg.lastChangeAt)} · need a 2nd mark` : 'need a second mark to compare')
              : (
                <>
                  {agg.setDelta >= 0 ? '+' : ''}{fmtMoney(agg.setDelta)} · {agg.movedCount} changed
                  {agg.lastChangeAt && <><br />as of {fmtDate(agg.lastChangeAt)}</>}
                </>
              )
          }
          accent={trendColor(agg.setDir)}
        />
        <StatTile
          label="Cards Up / Down"
          value={
            <span style={{ fontSize: 20 }}>
              <span style={{ color: 'var(--teal)' }}>{agg.up}▲</span>
              <span style={{ color: 'var(--ink-mute)', margin: '0 6px' }}>·</span>
              <span style={{ color: 'var(--rust)' }}>{agg.down}▼</span>
            </span>
          }
          sub={
            (agg.topGainer || agg.topDecliner) ? (
              <span style={{ display: 'block' }}>
                {agg.topGainer && <MoverLine stat={agg.topGainer} />}
                {agg.topDecliner && <MoverLine stat={agg.topDecliner} />}
              </span>
            ) : (agg.flat > 0 ? `${agg.flat} unchanged` : 'movers since prior mark')
          }
        />
      </div>

      {/* Winners / losers */}
      {agg.movedCount > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <MoverList title="🏆 Top Gainers" accent="var(--teal)" items={agg.winners} maxAbs={agg.maxAbs}
            emptyLabel="No cards moved up since their prior mark." />
          <MoverList title="📉 Top Decliners" accent="var(--rust)" items={agg.losers} maxAbs={agg.maxAbs}
            emptyLabel="No cards moved down since their prior mark." />
        </div>
      )}
    </section>
  );
}
