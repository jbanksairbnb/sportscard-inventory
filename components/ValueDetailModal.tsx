'use client';

// Read-only market-value detail popup for the buyer-facing inventory view.
//
// Unlike MarketResearchModal (an editor that writes new analyses), this modal
// only *reads* a card's committed price history — the immutable snapshots in
// card_value_history — and presents them to a potential buyer: the current
// value, the up/down movement vs the prior commit, a bar chart of value over
// time, the comps behind the latest analysis, and the full history log.

import React, { useMemo } from 'react';
import { ValueHistoryRow, AnalysisRow, trendFromRows } from '@/lib/cardValueHistory';

// Mirrors RESEARCH_SOURCES in MarketResearchModal — kept inline so the view
// page doesn't pull the editor (and its Supabase writes) into its bundle.
const SOURCE_LABELS: Record<string, string> = {
  ebay_sold_auction: 'eBay Sold Auctions',
  ebay_sold_bin: 'eBay Sold Buy-It-Now',
  vcp: 'VCP',
  card_ladder: 'Card Ladder',
  beckett: 'Beckett',
  other: 'Other',
};

function sourceDisplay(source: string, label: string | null): string {
  if (source === 'other') return label?.trim() || 'Other';
  return SOURCE_LABELS[source] || source;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function trendArrow(dir: 'up' | 'down' | 'flat'): string {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→';
}
function trendColor(dir: 'up' | 'down' | 'flat'): string {
  return dir === 'up' ? 'var(--teal)' : dir === 'down' ? 'var(--rust)' : 'var(--ink-mute)';
}

// Zero-anchored SVG bar chart of the value series over time (oldest → newest).
// Dependency-free so it works anywhere. Each bar is colored by its move vs the
// previous commit (teal up, rust down); the most recent bar is outlined so the
// current value reads at a glance. Value labels sit above, dates below.
function ValueBarChart({ points }: { points: { value: number; date: string }[] }) {
  const width = 560;
  const height = 220;
  const padL = 12;
  const padR = 12;
  const padTop = 26;   // room for value labels
  const padBottom = 26; // room for date labels
  const plotW = width - padL - padR;
  const plotH = height - padTop - padBottom;

  const max = Math.max(...points.map(p => p.value), 0);
  const scale = max > 0 ? plotH / max : 0;
  const n = points.length;
  const slot = plotW / n;
  const barW = Math.min(64, slot * 0.62);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ display: 'block', maxWidth: width, margin: '0 auto' }}
      role="img"
      aria-label="Value over time"
    >
      {/* baseline */}
      <line x1={padL} y1={padTop + plotH} x2={width - padR} y2={padTop + plotH}
        stroke="var(--rule)" strokeWidth={1} />
      {points.map((p, i) => {
        const prev = i > 0 ? points[i - 1].value : null;
        const dir: 'up' | 'down' | 'flat' =
          prev === null ? 'flat'
          : p.value - prev > 0.005 ? 'up'
          : p.value - prev < -0.005 ? 'down'
          : 'flat';
        const isLast = i === n - 1;
        const fill = i === 0 ? 'var(--plum)' : trendColor(dir);
        const barH = Math.max(2, p.value * scale);
        const cx = padL + slot * i + slot / 2;
        const x = cx - barW / 2;
        const y = padTop + plotH - barH;
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={barH} rx={3}
              fill={fill}
              fillOpacity={isLast ? 1 : 0.82}
              stroke={isLast ? 'var(--orange)' : 'none'}
              strokeWidth={isLast ? 2.5 : 0}
            />
            <text x={cx} y={y - 7} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize={11} fontWeight={700}
              fill={isLast ? 'var(--orange)' : 'var(--ink-soft)'}>
              {fmtMoney(p.value)}
            </text>
            <text x={cx} y={padTop + plotH + 16} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize={9.5}
              fill="var(--ink-mute)">
              {fmtDate(p.date)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// The comps behind a single committed analysis.
function CompRows({ rows }: { rows: AnalysisRow[] }) {
  const sorted = rows.slice().sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, fontSize: 11.5, color: 'var(--ink-soft)' }}>
      {sorted.map((d, j) => {
        const gradeDisplay = `${d.grade_company || ''}${d.grade_company && d.grade_value ? ' ' : ''}${d.grade_value || ''}`.trim();
        return (
          <div key={j}>
            <strong style={{ color: 'var(--plum)' }}>{sourceDisplay(d.source, d.source_label)}</strong>
            {gradeDisplay ? ` · ${gradeDisplay}` : ''}
            {d.sale_date ? ` · ${d.sale_date}` : ''}
            {' · '}
            <span style={{ color: 'var(--orange)', fontWeight: 700 }}>{d.price !== null ? fmtMoney(d.price) : '—'}</span>
            {d.weight_pct !== null ? ` (${d.weight_pct}%)` : ''}
          </div>
        );
      })}
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  cardTitle: string;
  conditionLabel: string;
  // Committed analyses for this exact card/grade, newest first (as stored).
  history: ValueHistoryRow[];
};

export default function ValueDetailModal({ open, onClose, cardTitle, conditionLabel, history }: Props) {
  // Chronological (oldest → newest) for the chart and trend math.
  const chrono = useMemo(
    () => history.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [history],
  );
  const trend = useMemo(
    () => trendFromRows(chrono.map(h => ({ market_value: h.market_value, created_at: h.created_at }))),
    [chrono],
  );

  if (!open) return null;

  const latest = chrono.length > 0 ? chrono[chrono.length - 1] : null;
  const chartPoints = chrono.map(h => ({ value: h.market_value, date: h.created_at }));

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 760, padding: 24, background: 'var(--cream)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>💰 Market Value</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
              {cardTitle} <span style={{ color: 'var(--orange)' }}>· {conditionLabel}</span>
            </div>
          </div>
          <div className="panel-bordered" style={{ padding: '10px 16px', background: 'var(--paper)', minWidth: 170, textAlign: 'right' }}>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 2 }}>Current Value</div>
            <div className="display" style={{ fontSize: 28, color: 'var(--orange)', fontWeight: 700 }}>
              {latest ? fmtMoney(latest.market_value) : '—'}
            </div>
            {trend && (
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: trendColor(trend.direction) }}
                title={`Latest ${fmtMoney(trend.latest)} vs prior ${fmtMoney(trend.previous)}`}>
                {trendArrow(trend.direction)}{' '}
                {trend.pct !== null
                  ? `${trend.pct >= 0 ? '+' : ''}${trend.pct.toFixed(1)}%`
                  : `${trend.delta >= 0 ? '+' : ''}${fmtMoney(trend.delta)}`}
                {' '}since prior
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="btn btn-sm" style={{ flexShrink: 0 }}>✕ Close</button>
        </div>

        {chrono.length === 0 ? (
          <div className="panel" style={{ padding: '28px 20px', textAlign: 'center', background: 'var(--paper)', border: '1px solid var(--rule)' }}>
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: 0 }}>No committed value analysis for this card yet.</p>
          </div>
        ) : (
          <>
            {/* Bar chart */}
            <section style={{ marginBottom: 18 }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 8 }}>Value Over Time</div>
              {chartPoints.length >= 2 ? (
                <div className="panel" style={{ padding: '14px 10px 8px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8 }}>
                  <ValueBarChart points={chartPoints} />
                </div>
              ) : (
                <div className="panel" style={{ padding: '16px 20px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, fontSize: 12, color: 'var(--ink-mute)' }}>
                  Only one analysis on record — the chart appears once there's a second data point to compare against.
                </div>
              )}
            </section>

            {/* Latest analysis detail */}
            {latest && (latest.snapshot?.rows?.length || latest.snapshot?.notes) && (
              <section style={{ marginBottom: 18 }}>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 8 }}>
                  Latest Analysis · {fmtDate(latest.created_at)}
                </div>
                <div className="panel" style={{ padding: 12, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6 }}>
                  <CompRows rows={latest.snapshot?.rows || []} />
                  {latest.snapshot?.notes && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic' }}>{latest.snapshot.notes}</div>
                  )}
                </div>
              </section>
            )}

            {/* Full history log (newest first) */}
            <section>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 8 }}>
                Value History <span style={{ color: 'var(--ink-mute)' }}>({chrono.length})</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {chrono.slice().reverse().map((h, i, arr) => {
                  const older = arr[i + 1]; // next in newest-first order is the older commit
                  const delta = older ? h.market_value - older.market_value : null;
                  const pct = older && older.market_value !== 0 ? (delta! / older.market_value) * 100 : null;
                  const dir: 'up' | 'down' | 'flat' = delta === null ? 'flat'
                    : delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'flat';
                  return (
                    <div key={h.id} className="panel" style={{ padding: 12, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>
                          {fmtDate(h.created_at)}
                        </span>
                        <span className="display" style={{ fontSize: 16, color: 'var(--orange)', fontWeight: 700 }}>
                          {fmtMoney(h.market_value)}
                        </span>
                        {delta !== null && (
                          <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: trendColor(dir) }}>
                            {trendArrow(dir)}{' '}
                            {pct !== null
                              ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
                              : `${delta >= 0 ? '+' : ''}${fmtMoney(delta)}`}
                          </span>
                        )}
                      </div>
                      <CompRows rows={h.snapshot?.rows || []} />
                      {h.snapshot?.notes && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic' }}>{h.snapshot.notes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
