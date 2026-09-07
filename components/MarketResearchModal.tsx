'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  AnalysisRow, AnalysisSnapshot, ValueHistoryRow,
  normalizeAnalysis, contentHash, trendFromRows, cardValueKey, dedupeByPosition,
  cardsightDedupeKey,
} from '@/lib/cardValueHistory';
import { insertValueHistoryRow } from '@/lib/recordValueMark';
import type { CompsResponse } from '@/app/api/cardsight/comps/route';

// Sources we offer in the dropdown. 'other' lets the user free-form a label.
export const RESEARCH_SOURCES = [
  { value: 'ebay_sold_auction', label: 'eBay Sold Auctions' },
  { value: 'ebay_sold_bin', label: 'eBay Sold Buy-It-Now' },
  // Auto-pulled comps get their own sources rather than reusing the eBay
  // values. They ARE eBay sales, but the provenance matters: a row the user
  // found and vetted is a different claim from one a machine dropped in, and
  // conflating them would hide which is which on a saved analysis. The two
  // values keep the ask/bid split visible in the table itself.
  { value: 'cardsight_auction', label: 'CardSight · eBay auction' },
  { value: 'cardsight_bin', label: 'CardSight · eBay Buy-It-Now' },
  { value: 'vcp', label: 'VCP' },
  { value: 'card_ladder', label: 'Card Ladder' },
  { value: 'beckett', label: 'Beckett' },
  { value: 'other', label: 'Other (custom)' },
] as const;
type SourceValue = (typeof RESEARCH_SOURCES)[number]['value'];

// Grading company + grade are tracked as two fields so the future pricing
// model can group cleanly (e.g. all "PSA 8" comps from anywhere).
// BVG, CGC and TAG are here because a pulled comp can legitimately carry one:
// when the exact grade is thin we widen across graders on a comparable scale,
// and a row whose company isn't in this list would render as an empty select.
const GRADING_COMPANIES = ['Raw', 'PSA', 'SGC', 'BGS', 'BVG', 'CGC', 'CSG', 'TAG', 'Other'] as const;
type GradingCompany = (typeof GRADING_COMPANIES)[number];

const RAW_GRADES = ['GEM MINT', 'MINT', 'NM-MT', 'NM', 'EX-MT', 'EX', 'VG-EX', 'VG', 'GD', 'FR', 'PR'];
const NUMERIC_GRADES = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1'];

function gradesForCompany(company: string): string[] {
  if (company === 'Raw') return RAW_GRADES;
  if (company === '' || company === 'Other') return [];
  return NUMERIC_GRADES;
}

function defaultsFor(card: CardDescriptor): { company: string; grade: string } {
  if (card.grading_company && card.grade) return { company: card.grading_company, grade: card.grade };
  if (card.raw_grade) return { company: 'Raw', grade: card.raw_grade };
  return { company: '', grade: '' };
}

export type CardDescriptor = {
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  // Grade context — separate sessions per condition variant.
  grade: string | null;
  grading_company: string | null;
  raw_grade: string | null;
  // Optional FK / breadcrumbs back to the source record.
  listing_id?: string | null;
  set_slug?: string | null;
  set_card_number?: string | null;
  // Optional scans of the card being researched, so the modal can show the
  // physical card alongside the comps. Front = Image 1, back = Image 2.
  image_front?: string | null;
  image_back?: string | null;
};

type Row = {
  position: number;
  source: SourceValue;
  source_label: string;     // only used when source === 'other'
  grade_company: string;    // '' | 'Raw' | 'PSA' | ...
  grade_value: string;      // 'NM' | '8.5' | '10' | ...
  sale_date: string;        // YYYY-MM-DD
  price: string;            // string for input handling
  weight_pct: string;       // string for input handling
  url: string;
  notes: string;
};

type DataPointRow = {
  id: string;
  session_id: string;
  position: number;
  source: SourceValue;
  source_label: string | null;
  grade_company: string | null;
  grade_value: string | null;
  // Legacy combined column kept for back-compat reads if older rows exist.
  grade_condition: string | null;
  sale_date: string | null;
  price: number | null;
  weight_pct: number | null;
  url: string | null;
  notes: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  card_year: number | null;
  card_brand: string | null;
  card_number: string | null;
  card_player: string | null;
  card_grade: string | null;
  card_grading_company: string | null;
  card_raw_grade: string | null;
  market_value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CommunitySession = SessionRow & {
  data_points: DataPointRow[];
  user_label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  card: CardDescriptor;
  onApply?: (marketValue: number) => void;   // called when user clicks "Use this value"
};

function emptyRow(position: number, defaults: { company: string; grade: string } = { company: '', grade: '' }): Row {
  return {
    position,
    source: 'ebay_sold_auction',
    source_label: '',
    grade_company: defaults.company,
    grade_value: defaults.grade,
    sale_date: '',
    price: '',
    weight_pct: '',
    url: '',
    notes: '',
  };
}

function rowsFromDataPoints(dps: DataPointRow[], defaults: { company: string; grade: string } = { company: '', grade: '' }): Row[] {
  const sorted = dedupeByPosition(dps.slice().sort((a, b) => a.position - b.position));
  const rows: Row[] = sorted.map((d, i) => {
    // Read split columns first; if absent, fall back to splitting the legacy
    // combined `grade_condition` field on the first space (e.g. "PSA 8" → PSA / 8).
    let company = d.grade_company ?? '';
    let value = d.grade_value ?? '';
    if (!company && !value && d.grade_condition) {
      const parts = d.grade_condition.split(/\s+/);
      if (parts.length >= 2 && (GRADING_COMPANIES as readonly string[]).includes(parts[0])) {
        company = parts[0];
        value = parts.slice(1).join(' ');
      } else {
        company = 'Raw';
        value = d.grade_condition;
      }
    }
    return {
      // Re-index rather than keeping the stored position: only rows with
      // user-entered content are persisted, so a blank middle row leaves a gap
      // (e.g. 0,2,3,4) and the blank rows padded on below would then collide
      // with a real row's position.
      position: i,
      source: (d.source as SourceValue) ?? 'other',
      source_label: d.source_label ?? '',
      grade_company: company,
      grade_value: value,
      sale_date: d.sale_date ?? '',
      price: d.price !== null && d.price !== undefined ? String(d.price) : '',
      weight_pct: d.weight_pct !== null && d.weight_pct !== undefined ? String(d.weight_pct) : '',
      url: d.url ?? '',
      notes: d.notes ?? '',
    };
  });
  while (rows.length < 5) rows.push(emptyRow(rows.length, defaults));
  return rows;
}

// Rebuild editable rows from a committed history snapshot (used by "Use this
// analysis"). The snapshot stores prices/weights as numbers; the form wants
// strings.
function rowsFromSnapshot(snap: AnalysisSnapshot, defaults: { company: string; grade: string } = { company: '', grade: '' }): Row[] {
  const rows: Row[] = dedupeByPosition((snap.rows || []).slice().sort((a, b) => a.position - b.position)).map((d, i) => ({
    position: i, // contiguous — see rowsFromDataPoints
    source: (d.source as SourceValue) ?? 'other',
    source_label: d.source_label ?? '',
    grade_company: d.grade_company ?? '',
    grade_value: d.grade_value ?? '',
    sale_date: d.sale_date ?? '',
    price: d.price !== null && d.price !== undefined ? String(d.price) : '',
    weight_pct: d.weight_pct !== null && d.weight_pct !== undefined ? String(d.weight_pct) : '',
    url: d.url ?? '',
    notes: d.notes ?? '',
  }));
  while (rows.length < 5) rows.push(emptyRow(rows.length, defaults));
  return rows;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

// Summary of a CardSight pull: what it matched, how comparable the comps are,
// and the shape of the sale prices behind them.
//
// The sample size is given as much room as the median deliberately. In our
// era a specific grade often has only a handful of sales in CardSight's whole
// window — a 1968 Ryan PSA 6 had exactly one — and a median of n=1 presented
// like a market price is the failure mode this panel exists to prevent.
function CompsPanel({ comps, onImportHistory, importing, imported }: {
  comps: CompsResponse;
  onImportHistory: () => void;
  importing: boolean;
  imported: number | null;
}) {
  const s = comps.stats;
  const tierLabel: Record<string, string> = {
    exact: 'exact grade match',
    'same-grade': 'same grade, different grader',
    'adjacent-grade': 'within a half grade',
    ungraded: 'ungraded sales',
  };
  const thin = !!s && s.n < 5;
  return (
    <div style={{
      border: '1.5px solid var(--rule)', borderRadius: 8, padding: '12px 14px',
      background: 'var(--paper)', marginBottom: 16, fontSize: 12.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong style={{ color: 'var(--plum)' }}>CardSight comps</strong>
        {comps.matched && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {comps.matched.year} {comps.matched.release} · {comps.matched.set} · {comps.matched.name}
          </span>
        )}
        {comps.tier && (
          <span className="chip chip-gold" style={{ fontSize: 10 }}>
            {tierLabel[comps.tier] ?? comps.tier}
          </span>
        )}
      </div>

      {s ? (
        <>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 6 }}>
            <Stat label="Listings (30d)" value={String(s.n)} warn={thin} />
            <Stat label="Wtd median" value={fmtMoney(s.median)} />
            <Stat label="Wtd mean" value={fmtMoney(s.mean)} />
            <Stat label="Middle 50%" value={`${fmtMoney(s.p25)} – ${fmtMoney(s.p75)}`} />
            <Stat label="Range" value={`${fmtMoney(s.min)} – ${fmtMoney(s.max)}`} />
            {comps.ask && <Stat label="Asking (BIN)" value={fmtMoney(comps.ask.median)} />}
          </div>

          {/* The longer view. Unlike the stats above — which are the 30-day
              comps window the table was filled from — this runs the whole
              archive, and only appears when the data can support buckets.
              See monthlySeries(): a card with one sale a month gets no line. */}
          {comps.monthly && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--rule)' }}>
              <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 4 }}>
                Monthly weighted median
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {comps.monthly.map(m => (
                  <span key={m.month} className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                    {m.month} <strong style={{ color: 'var(--plum)' }}>{fmtMoney(m.stats.median)}</strong>
                    <span style={{ color: 'var(--ink-mute)' }}> ({m.stats.n})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: 'var(--ink-mute)' }}>No sales found.</div>
      )}

      {/* Storing history is only offered when there are months worth storing:
          each point is a median of at least two sold comps. */}
      {comps.history.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={onImportHistory} disabled={importing}
            className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
            {importing ? 'Saving…' : `↳ Save ${comps.history.length} month${comps.history.length === 1 ? '' : 's'} to price history`}
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {imported === null
              ? 'One mark per month, dated to the month\u2019s end, with its sales stored.'
              : imported === 0
                ? 'Already saved — nothing new to add.'
                : `Saved ${imported} month${imported === 1 ? '' : 's'}.`}
          </span>
        </div>
      )}

      {comps.note && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: thin ? 'var(--rust)' : 'var(--ink-soft)', lineHeight: 1.5 }}>
          {comps.note}
        </div>
      )}
      {comps.lastSale && (
        <div className="mono" style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-mute)' }}>
          Last sale {new Date(comps.lastSale).toLocaleDateString()} · CardSight&rsquo;s archive currently reaches back about five months.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: 'var(--ink-mute)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: warn ? 'var(--rust)' : 'var(--plum)' }}>{value}</div>
    </div>
  );
}

function trendArrow(dir: 'up' | 'down' | 'flat'): string {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→';
}
function trendColor(dir: 'up' | 'down' | 'flat'): string {
  return dir === 'up' ? 'var(--teal)' : dir === 'down' ? 'var(--rust)' : 'var(--ink-mute)';
}

// Tiny dependency-free SVG sparkline of the value series (chronological order).
function Sparkline({ values, width = 160, height = 34 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? 'var(--teal)' : 'var(--rust)';
  const last = pts[pts.length - 1].split(',');
  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={1.5}
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={stroke} />
    </svg>
  );
}

// Compact "prior vs new" column chart shown beside the Save / Use actions.
// Renders every committed value over time as a bar (oldest → newest) and, once
// the working analysis is valid (weights = 100%), appends the current value as
// a highlighted bar — so the collector sees, at a glance, exactly how today's
// number lands against each prior mark. A bar-per-commit reads far more
// dramatically than a two-number diff when there are several data points: the
// whole trajectory is visible and the pending bar pops against it. Zero-anchored
// so the height of each bar is proportional to its dollar value. Dependency-free
// SVG, so it adds no bundle weight.
type ChartBar = {
  value: number;
  date: string;
  kind: 'history' | 'new';
  mark: ValueHistoryRow | null;   // null on the pending "new" bar
};

function PriorVsNewChart({ history, newValue, hasNew, selectedId, onSelect }: {
  history: ValueHistoryRow[];   // chronological (oldest → newest)
  newValue: number;
  hasNew: boolean;              // true once weights total 100%
  selectedId: string | null;
  onSelect: (mark: ValueHistoryRow | null) => void;
}) {
  const MAX_BARS = 8; // keep it legible next to the action buttons
  const trimmed = history.slice(-MAX_BARS);
  const hiddenCount = history.length - trimmed.length;
  const bars: ChartBar[] = trimmed.map(h => ({
    value: h.market_value, date: h.created_at, kind: 'history' as const, mark: h,
  }));
  if (hasNew) bars.push({ value: newValue, date: new Date().toISOString(), kind: 'new', mark: null });

  // Nothing to chart yet: no prior commits and no valid new value.
  if (bars.length === 0) {
    return (
      <div style={{
        height: '100%', minHeight: 150, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '14px 16px', background: 'var(--paper)', border: '1px dashed var(--rule)', borderRadius: 8,
        fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', lineHeight: 1.5,
      }}>
        Save an analysis or finish weighting to 100% to chart the new value against your prior marks.
      </div>
    );
  }

  // Callout: the new value vs the most recent prior commit.
  const lastHist = trimmed.length ? trimmed[trimmed.length - 1].market_value : null;
  let callout: React.ReactNode = null;
  if (hasNew && lastHist !== null) {
    const delta = newValue - lastHist;
    const pct = lastHist !== 0 ? (delta / lastHist) * 100 : null;
    const dir: 'up' | 'down' | 'flat' = delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'flat';
    callout = (
      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: trendColor(dir) }}
        title={`New ${fmtMoney(newValue)} vs last ${fmtMoney(lastHist)}`}>
        {trendArrow(dir)}{' '}
        {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : `${delta >= 0 ? '+' : ''}${fmtMoney(delta)}`}
        {' '}vs last
      </span>
    );
  }

  // SVG geometry. viewBox is fixed; the element scales to its container width.
  const width = 640;
  const height = 172;
  const padL = 10;
  const padR = 10;
  const padTop = 30;    // room for value labels (+ NEW tag)
  const padBottom = 24; // room for date labels
  const plotW = width - padL - padR;
  const plotH = height - padTop - padBottom;

  const max = Math.max(...bars.map(b => b.value), 0);
  const scale = max > 0 ? plotH / max : 0;
  const n = bars.length;
  const slot = plotW / n;
  const barW = Math.min(72, slot * 0.6);

  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 10px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0 4px 4px' }}>
        {callout || (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
            {hasNew ? 'First analysis on record' : 'Finish weighting to preview the new value'}
          </span>
        )}
        {hiddenCount > 0 && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginLeft: 'auto' }}>
            showing last {trimmed.length} of {history.length}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ display: 'block' }}
        role="img"
        aria-label="Prior committed values versus the new value"
      >
        {/* baseline */}
        <line x1={padL} y1={padTop + plotH} x2={width - padR} y2={padTop + plotH}
          stroke="var(--rule)" strokeWidth={1} />
        {bars.map((b, i) => {
          const prev = i > 0 ? bars[i - 1].value : null;
          const dir: 'up' | 'down' | 'flat' =
            prev === null ? 'flat'
            : b.value - prev > 0.005 ? 'up'
            : b.value - prev < -0.005 ? 'down'
            : 'flat';
          const isNew = b.kind === 'new';
          const fill = isNew ? 'var(--orange)' : i === 0 ? 'var(--plum)' : trendColor(dir);
          const barH = Math.max(2, b.value * scale);
          const cx = padL + slot * i + slot / 2;
          const x = cx - barW / 2;
          const y = padTop + plotH - barH;
          // Every committed mark carries the comps it was built from, so the
          // bar is a way into them: click it to read the individual sales
          // behind the number instead of taking the number on trust.
          const detail = b.mark?.snapshot?.rows ?? [];
          const clickable = !!b.mark && detail.length > 0;
          const selected = !!b.mark && b.mark.id === selectedId;
          return (
            <g key={b.mark?.id ?? 'new'}
              onClick={clickable ? () => onSelect(selected ? null : b.mark) : undefined}
              style={clickable ? { cursor: 'pointer' } : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selected ? null : b.mark); }
              } : undefined}
              aria-label={clickable
                ? `${fmtMoney(b.value)} on ${new Date(b.date).toLocaleDateString()} — ${detail.length} comps`
                : undefined}
            >
              {/* Full-height hit area: a short bar is a hard target, and the
                  whole column reads as the thing you're pointing at. */}
              {clickable && (
                <rect x={cx - slot / 2} y={padTop} width={slot} height={plotH}
                  fill={selected ? 'var(--plum)' : 'transparent'} fillOpacity={selected ? 0.07 : 0} rx={4} />
              )}
              <rect
                x={x} y={y} width={barW} height={barH} rx={3}
                fill={fill}
                fillOpacity={isNew ? 1 : selected ? 1 : 0.8}
                stroke={isNew ? 'var(--plum)' : selected ? 'var(--plum)' : 'none'}
                strokeWidth={isNew || selected ? 2.5 : 0}
              />
              {isNew && (
                <text x={cx} y={y - 18} textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize={8.5} fontWeight={700}
                  letterSpacing="0.12em" fill="var(--orange)">
                  NEW
                </text>
              )}
              <text x={cx} y={y - 7} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize={11} fontWeight={700}
                fill={isNew ? 'var(--orange)' : 'var(--ink-soft)'}>
                {fmtMoney(b.value)}
              </text>
              <text x={cx} y={padTop + plotH + 15} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize={9.5}
                fontWeight={isNew ? 700 : 400}
                fill={isNew ? 'var(--orange)' : 'var(--ink-mute)'}>
                {isNew ? 'Now' : new Date(b.date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}
              </text>
            </g>
          );
        })}
      </svg>
      {bars.some(b => b.mark && (b.mark.snapshot?.rows?.length ?? 0) > 0) && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', padding: '2px 4px 0' }}>
          Click a bar to see the sales behind it.
        </div>
      )}
    </div>
  );
}

// The individual transactions behind one committed mark.
//
// Every mark stores its own comps, so this is the stored evidence rather than
// a fresh lookup — which matters most for imported months, where the point of
// keeping the sales was being able to ask later what a month's number was made
// of, long after CardSight's five-month archive has rolled past it.
function MarkDetailTable({ mark, onClose }: { mark: ValueHistoryRow; onClose: () => void }) {
  const rows = dedupeByPosition(mark.snapshot?.rows ?? []).slice()
    .sort((a, b) => (b.sale_date ?? '').localeCompare(a.sale_date ?? ''));
  const weighted = rows.some(r => r.weight_pct !== null);
  return (
    <div style={{
      border: '1.5px solid var(--plum)', borderRadius: 8, padding: '10px 12px',
      background: 'var(--paper)', marginTop: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong style={{ color: 'var(--plum)', fontSize: 13 }}>
          {fmtMoney(mark.market_value)}
        </strong>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
          {new Date(mark.created_at).toLocaleDateString()} · {rows.length} comp{rows.length === 1 ? '' : 's'}
        </span>
        {mark.mark_kind === 'cardsight' && (
          <span className="chip chip-gold" style={{ fontSize: 9.5 }}>CardSight</span>
        )}
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto', fontSize: 11 }}>Close</button>
      </div>
      {mark.snapshot?.notes && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8, lineHeight: 1.5 }}>
          {mark.snapshot.notes}
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No comps were stored with this mark.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-mute)' }}>
                <th style={detailTh}>Date</th>
                <th style={detailTh}>Source</th>
                <th style={detailTh}>Grade</th>
                <th style={{ ...detailTh, textAlign: 'right' }}>Price</th>
                {weighted && <th style={{ ...detailTh, textAlign: 'right' }}>Weight</th>}
                <th style={detailTh}>Listing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--rule)' }}>
                  <td className="mono" style={detailTd}>{r.sale_date ?? '—'}</td>
                  <td style={detailTd}>{sourceDisplay(r.source as SourceValue, r.source_label)}</td>
                  <td className="mono" style={detailTd}>
                    {[r.grade_company, r.grade_value].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="mono" style={{ ...detailTd, textAlign: 'right', fontWeight: 700, color: 'var(--orange)' }}>
                    {r.price === null ? '—' : fmtMoney(r.price)}
                  </td>
                  {weighted && (
                    <td className="mono" style={{ ...detailTd, textAlign: 'right' }}>
                      {r.weight_pct === null ? '—' : `${r.weight_pct}%`}
                    </td>
                  )}
                  <td style={{ ...detailTd, maxWidth: 280 }}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--plum)' }}>{r.notes || 'view'}</a>
                    ) : (
                      <span style={{ color: 'var(--ink-soft)' }}>{r.notes || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const detailTh: React.CSSProperties = {
  padding: '2px 8px 5px 0', fontWeight: 600, fontSize: 10,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
const detailTd: React.CSSProperties = {
  padding: '5px 8px 5px 0', verticalAlign: 'top', color: 'var(--plum)',
};

function isPriced(r: Row): boolean {
  return r.price !== '' && !Number.isNaN(Number(r.price));
}

// Spread 100% evenly across every priced row, leaving unpriced rows alone.
// The rounding remainder lands on the first row, or the total never reaches
// the 100% the Save button waits for.
function evenWeights(rows: Row[]): Row[] {
  const count = rows.filter(isPriced).length;
  if (!count) return rows;
  const each = Math.floor((100 / count) * 100) / 100;
  const first = Math.round((100 - each * (count - 1)) * 100) / 100;
  let seen = 0;
  return rows.map(r => {
    if (!isPriced(r)) return r;
    const w = seen === 0 ? first : each;
    seen += 1;
    return { ...r, weight_pct: String(w) };
  });
}

// One imported mark per month, defensively.
//
// The unique index added in migration 20260908 is the real fix; this is what
// keeps the chart honest on an environment where that migration hasn't run
// yet, and it keeps the list, the sparkline, the trend badge and the chart
// agreeing with each other rather than each collapsing differently.
//
// Keeps the OLDEST mark in each month, which is the same one the migration
// keeps — so nothing shifts underneath the user when it does run. Only
// imported marks collapse: two analyses a person made in one month are two
// real analyses.
function collapseImportedMonths(rows: ValueHistoryRow[]): ValueHistoryRow[] {
  const seen = new Set<string>();
  const out: ValueHistoryRow[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {   // rows arrive newest-first
    const r = rows[i];
    if (r.mark_kind === 'cardsight') {
      const month = r.created_at.slice(0, 7);
      if (seen.has(month)) continue;
      seen.add(month);
    }
    out.push(r);
  }
  return out.reverse();
}

function sourceDisplay(s: SourceValue, label: string | null): string {
  if (s === 'other') return label?.trim() || 'Other';
  const found = RESEARCH_SOURCES.find(x => x.value === s);
  return found?.label || s;
}

const INSTRUCTIONS = `Use this to set a market value for your card based on recent comps. Pull from whichever sources you trust — eBay sold listings, VCP, Card Ladder, Beckett, your own gut — and weight each row by how comparable it is to your card (centering, corners, eye appeal). Weights must add to 100% but you don't need multiple rows; if you love VCP, put one row at 100% and you're done. Every entry is saved so you can revisit your research later.`;

export default function MarketResearchModal({ open, onClose, card, onApply }: Props) {
  const [userId, setUserId] = useState<string>('');
  // Which history bar the user has opened to inspect its comps.
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaveTick, setAutoSaveTick] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  // A failed history write used to be a console warning only — the analysis
  // looked saved but never showed up in the price history (and so never
  // produced a % change against the prior mark). Surface it instead.
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Same value as `sessionId`, readable from queued saves. Saves are async and
  // serialized, so a queued one runs with the closure it was created in — a
  // stale `null` there would insert a *second* session for the same card.
  const sessionIdRef = useRef<string | null>(null);
  const cardDefaults = useMemo(() => defaultsFor(card), [card]);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, (_, i) => emptyRow(i, defaultsFor(card))));
  const [notes, setNotes] = useState('');
  const [latestSession, setLatestSession] = useState<{ session: SessionRow; data_points: DataPointRow[] } | null>(null);
  // Immutable committed-analysis log for this card (newest first) — powers the
  // price-history list, the sparkline, and the up/down trend badge.
  const [valueHistory, setValueHistory] = useState<ValueHistoryRow[]>([]);
  // When the working draft was seeded from a prior history entry, remember it
  // so the next commit records the lineage.
  const [derivedFromId, setDerivedFromId] = useState<string | null>(null);
  const [community, setCommunity] = useState<CommunitySession[]>([]);
  // CardSight comp pull — result of the last "Pull comps" click, kept so the
  // stats panel survives after the rows have been edited.
  const [comps, setComps] = useState<CompsResponse | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [importingHistory, setImportingHistory] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const cardIsGraded = !!card.grading_company
    && card.grading_company.toLowerCase() !== 'raw'
    && !!card.grade;

  // Keep the ref in lockstep with the state so both reads see the same session.
  function setActiveSession(id: string | null) {
    sessionIdRef.current = id;
    setSessionId(id);
  }

  // The identity tuple that groups this card's sessions and price history into
  // one series, matching how every other view (set grid, manual marks) groups
  // them.
  const identityKey = useMemo(() => cardValueKey({
    year: card.year, brand: card.brand, card_number: card.card_number,
    grade: card.grade, grading_company: card.grading_company, raw_grade: card.raw_grade,
  }), [card.year, card.brand, card.card_number, card.grade, card.grading_company, card.raw_grade]);

  // Does a stored row belong to the card we're researching? Column-level
  // `.eq()` filters can't answer this on their own: any part of the tuple that
  // is null for this card has to be left unfiltered, and an unfiltered column
  // matches *every* other variant's rows — so a raw copy would inherit the PSA
  // 5's price history. Comparing the whole key is exact, and it normalizes case
  // and whitespace so "topps" and "Topps" stay one series.
  const matchesCard = React.useCallback((r: {
    card_year: number | null; card_brand: string | null; card_number: string | null;
    card_grade: string | null; card_grading_company: string | null; card_raw_grade: string | null;
  }) => cardValueKey({
    year: r.card_year, brand: r.card_brand, card_number: r.card_number,
    grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
  }) === identityKey, [identityKey]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      // Build a card-identity match. Year + card_number narrow it server-side
      // (both are exact, nulls included); the rest of the tuple — brand and the
      // grade variant — is compared as a whole key in `matchesCard`, so a 1965
      // Topps #150 PSA 8 never picks up a 1953 #150's or a raw copy's rows.
      let q = supabase.from('market_research_sessions')
        .select('*, market_research_data_points(*)')
        .order('updated_at', { ascending: false });
      if (card.year !== null) q = q.eq('card_year', card.year); else q = q.is('card_year', null);
      if (card.card_number) q = q.eq('card_number', card.card_number); else q = q.is('card_number', null);
      const { data: matches, error } = await q;
      if (error) console.warn('[research] load error:', error.message);
      type SessionWithDP = SessionRow & { market_research_data_points: DataPointRow[] };
      const all = ((matches || []) as unknown as SessionWithDP[]).filter(matchesCard);
      const ownAll = all.filter(s => s.user_id === user.id);
      // Garbage-collect: silently delete the user's own sessions that have no
      // notes AND every data point lacks user-entered content (price, weight,
      // URL, row note, or custom-source label). Pre-populated source / grade
      // defaults alone don't count — they're scaffolding from the modal opening,
      // not data the user actually committed.
      function dpHasUserContent(d: DataPointRow): boolean {
        if (d.price !== null && d.price !== undefined) return true;
        if (d.weight_pct !== null && d.weight_pct !== undefined) return true;
        if ((d.url || '').trim()) return true;
        if ((d.notes || '').trim()) return true;
        if (d.source === 'other' && (d.source_label || '').trim()) return true;
        return false;
      }
      const empties = ownAll.filter(s => {
        if ((s.notes || '').trim()) return false;
        const dps = s.market_research_data_points || [];
        return dps.every(d => !dpHasUserContent(d));
      });
      if (empties.length > 0) {
        await supabase.from('market_research_sessions').delete().in('id', empties.map(s => s.id));
      }
      const own = ownAll.filter(s => !empties.includes(s));
      const others = all.filter(s => s.user_id !== user.id
        && (s.market_research_data_points || []).some(d => dpHasUserContent(d)));

      // Always open with a blank form. The user's latest analysis (if any) is
      // surfaced as a "Use most recent analysis" link, and the full archive is
      // visible in the history panel below the form.
      setActiveSession(null);
      setDerivedFromId(null);
      setRows(Array.from({ length: 5 }, (_, i) => emptyRow(i, cardDefaults)));
      setNotes('');
      // A pull belongs to the card it was fetched for — leaving the panel up
      // across a reopen would show one card's comps above another's table.
      setComps(null);
      setCompsError(null);
      setImportedCount(null);
      setAutoSaveTick('idle');
      setHistoryError(null);
      if (own.length > 0) {
        // The banner up top is a shortcut to resume the most recent draft; the
        // full archive lives in the price-history list, sourced separately from
        // the immutable card_value_history table below.
        setLatestSession({ session: own[0], data_points: own[0].market_research_data_points || [] });
      } else {
        setLatestSession(null);
      }

      // Immutable committed-analysis history for this card, keyed by the same
      // identity tuple used for sessions above.
      setValueHistory(await fetchValueHistory(supabase, user.id));

      // Community sessions — show last 10 from other users on this card.
      const labeledCommunity: CommunitySession[] = others.slice(0, 10).map(s => ({
        ...s,
        data_points: s.market_research_data_points || [],
        user_label: 'collector', // we don't expose other users' identities; could swap to a public handle later
      }));
      setCommunity(labeledCommunity);

      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card.year, card.brand, card.card_number, card.player, card.grade, card.grading_company, card.raw_grade]);

  const totals = useMemo(() => {
    let weight = 0;
    let weighted = 0;
    let priceFilled = 0;
    let weightFilled = 0;
    for (const r of rows) {
      const w = Number(r.weight_pct);
      const p = Number(r.price);
      if (!Number.isNaN(w) && r.weight_pct !== '') { weight += w; weightFilled += 1; }
      if (!Number.isNaN(p) && r.price !== '') { priceFilled += 1; }
      if (!Number.isNaN(w) && !Number.isNaN(p) && r.weight_pct !== '' && r.price !== '') {
        weighted += (w / 100) * p;
      }
    }
    const weightOk = Math.abs(weight - 100) < 0.001 && priceFilled > 0;
    return { totalWeight: weight, marketValue: weighted, weightOk, priceFilled, weightFilled };
  }, [rows]);

  // Offer the rebalance only when it would actually change the table. That
  // covers the case the button exists for and which the weight total alone
  // misses: a row added after a pull arrives with a blank weight, so the
  // table still reads 100% and still looks valid, while the row the user just
  // typed a price into counts for nothing.
  const canRebalance = useMemo(() => {
    if (!totals.priceFilled) return false;
    const target = evenWeights(rows);
    return rows.some((r, i) => r.weight_pct !== target[i].weight_pct);
  }, [rows, totals.priceFilled]);

  // Latest committed value vs the one before it, for the header trend badge.
  const valueTrend = useMemo(
    () => trendFromRows(valueHistory.map(h => ({ market_value: h.market_value, created_at: h.created_at }))),
    [valueHistory],
  );

  // Resolved from the id rather than held as state, so an opened mark always
  // reflects the current history — and closes itself if that mark goes away.
  const selectedMark = useMemo(
    () => valueHistory.find(h => h.id === selectedMarkId) ?? null,
    [valueHistory, selectedMarkId],
  );

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addRow() {
    setRows(prev => [...prev, emptyRow(prev.length, cardDefaults)]);
  }

  // Spread 100% evenly across every priced row.
  //
  // Pulling comps hands back a table already balanced to 100%, so adding a row
  // of your own to it — the sale you found that CardSight missed, a VCP figure,
  // your own read — necessarily breaks the total and locks Save until you
  // re-type every weight by hand. One click gets back to a valid, unopinionated
  // starting point, and hand-tuning from there is the same job it always was.
  //
  // Rows without a price are left at whatever they hold: an empty row is one
  // you're still filling in, not a comp asking for a share of the value.
  function rebalanceWeights() {
    setRows(prev => evenWeights(prev));
  }

  // Import CardSight's monthly medians as value-history marks.
  //
  // Each month becomes one immutable mark dated to that month's most recent
  // sale, so the price-history list and trend badge read as a real timeline
  // rather than a stack of rows sharing today's date. Marks are tagged
  // 'cardsight' so they stay distinguishable from the owner's own research and
  // typed values — this is the market's number, not their judgement of it.
  //
  // Re-running is safe: months already imported for this card are skipped, so
  // clicking twice, or coming back next month, only adds what's new.
  async function importHistory() {
    if (!userId || !comps?.history?.length) return;
    setImportingHistory(true);
    setCompsError(null);
    try {
      // Skip months we can already see. This is the fast path, not the
      // guarantee — the unique index on dedupe_key is what actually stops a
      // duplicate, because the case that produced them was precisely this
      // state not knowing what was stored. See migration 20260908.
      const already = new Set(
        valueHistory
          .filter(h => h.mark_kind === 'cardsight')
          .map(h => h.created_at.slice(0, 7)),
      );
      const pending = comps.history.filter(p => !already.has(p.month));
      if (!pending.length) { setImportedCount(0); return; }

      const written: ValueHistoryRow[] = [];
      for (const point of pending) {
        const analysisRows: AnalysisRow[] = point.rows.map((r, i) => ({
          position: i,
          source: r.source,
          source_label: r.source_label,
          grade_company: r.grade_company || null,
          grade_value: r.grade_value || null,
          sale_date: r.sale_date || null,
          price: r.price,
          // The comps behind a median are evidence, not a weighting — the
          // median already IS the value, so no row claims a share of it.
          weight_pct: null,
          url: r.url || null,
          notes: r.notes || null,
        }));
        const value = Math.round(point.stats.median * 100) / 100;
        const auctions = point.rows.filter(r => r.listing_type === 'auction').length;
        const asks = point.rows.length - auctions;
        const mix = [
          auctions ? `${auctions} auction${auctions === 1 ? '' : 's'}` : '',
          asks ? `${asks} ask${asks === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' + ');
        const noteText = `CardSight ${point.month}: weighted median of ${mix} (auctions count double)`;
        const snapshot: AnalysisSnapshot = { notes: noteText, market_value: value, rows: analysisRows };
        const { row, error, duplicate } = await insertValueHistoryRow({
          user_id: userId,
          card_year: card.year, card_brand: card.brand, card_number: card.card_number, card_player: card.player,
          card_grade: card.grade, card_grading_company: card.grading_company, card_raw_grade: card.raw_grade,
          listing_id: card.listing_id ?? null, set_slug: card.set_slug ?? null, set_card_number: card.set_card_number ?? null,
          market_value: value,
          content_hash: contentHash(normalizeAnalysis(analysisRows, noteText, value)),
          snapshot,
          mark_kind: 'cardsight' as const,
          dedupe_key: cardsightDedupeKey({
            year: card.year, brand: card.brand, card_number: card.card_number,
            grade: card.grade, grading_company: card.grading_company, raw_grade: card.raw_grade,
          }, point.month),
          // File the mark at the close of the month it describes, so the chart
          // reads as an evenly spaced monthly series. The month's actual last
          // sale is still in the snapshot, where it's the more useful fact.
          created_at: `${point.monthEnd}T12:00:00.000Z`,
          source_session_id: null,
          derived_from_id: null,
        });
        // A duplicate means the database already had this month. Nothing to
        // report and nothing to retry — keep going through the rest.
        if (duplicate) continue;
        if (error) { setCompsError(error); break; }
        if (row) written.push(row);
      }
      if (written.length) {
        setValueHistory(prev =>
          [...written, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        );
      }
      setImportedCount(written.length);
    } finally {
      setImportingHistory(false);
    }
  }

  // Pull comps from CardSight and drop them in as weighted rows.
  //
  // This REPLACES the current rows rather than appending. Appending would
  // silently break the 100% total the user may have already balanced, and
  // half-pulled tables are confusing; a fresh pull is a fresh starting point
  // they then adjust. Existing analyses are untouched — they live in the
  // history list, and the user has to click to load one.
  async function pullComps() {
    setCompsLoading(true);
    setCompsError(null);
    try {
      const res = await fetch('/api/cardsight/comps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          year: card.year,
          brand: card.brand,
          number: card.card_number,
          player: card.player,
          grading_company: card.grading_company ?? (card.raw_grade ? 'Raw' : null),
          grade: card.grade,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCompsError(data?.error || 'Could not reach CardSight'); return; }
      const payload = data as CompsResponse;
      setComps(payload);
      if (payload.rows.length) {
        setRows(payload.rows.map((r, i) => ({
          position: i,
          source: r.source as SourceValue,
          source_label: r.source_label ?? '',
          grade_company: r.grade_company,
          grade_value: r.grade_value,
          sale_date: r.sale_date,
          price: String(r.price),
          weight_pct: String(r.weight_pct),
          url: r.url,
          notes: r.notes,
        })));
      }
    } catch {
      setCompsError('Could not reach CardSight');
    } finally {
      setCompsLoading(false);
    }
  }
  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, position: i })));
  }
  function loadFromCommunity(s: CommunitySession) {
    setRows(rowsFromDataPoints(s.data_points, cardDefaults));
    setNotes(prev => prev || `(Started from another collector's research from ${new Date(s.created_at).toLocaleDateString()})`);
    setActiveSession(null); // Treat as new session for the current user
    setDerivedFromId(null);
  }

  // Load this card's committed price history (newest first) — research commits
  // and manual value marks alike, since both are marks on the same series. Year
  // + card_number narrow it server-side; `matchesCard` applies the rest of the
  // identity tuple exactly, the same way the session lookup above does.
  async function fetchValueHistory(supabase: ReturnType<typeof createClient>, uid: string): Promise<ValueHistoryRow[]> {
    let q = supabase.from('card_value_history').select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (card.year !== null) q = q.eq('card_year', card.year); else q = q.is('card_year', null);
    if (card.card_number) q = q.eq('card_number', card.card_number); else q = q.is('card_number', null);
    const { data, error } = await q;
    if (error) { console.warn('[research] value history load error:', error.message); return []; }
    return collapseImportedMonths(((data || []) as unknown as ValueHistoryRow[]).filter(matchesCard));
  }

  // Record an immutable snapshot of the current analysis — but only when it
  // differs from the most recent one for this card, so re-saving an unchanged
  // analysis (or reusing a prior one verbatim) is a no-op. Called only on
  // explicit Save research / Use value, never on the silent autosave.
  //
  // Returns an error message when the mark could not be written. That has to
  // reach the user: a swallowed failure looks exactly like a successful save
  // until they reopen the card and find the analysis missing from its price
  // history, with no % change against the prior mark.
  async function commitHistory(): Promise<string | null> {
    if (!userId || !totals.weightOk) return null;
    const analysisRows: AnalysisRow[] = rows.filter(rowHasUserContent).map(r => ({
      position: r.position,
      source: r.source,
      source_label: r.source === 'other' ? (r.source_label.trim() || null) : null,
      grade_company: r.grade_company || null,
      grade_value: r.grade_value || null,
      sale_date: r.sale_date || null,
      price: r.price !== '' ? Number(r.price) : null,
      weight_pct: r.weight_pct !== '' ? Number(r.weight_pct) : null,
      url: r.url.trim() || null,
      notes: r.notes.trim() || null,
    }));
    const value = totals.marketValue;
    const trimmedNotes = notes.trim() || null;
    const normalized = normalizeAnalysis(analysisRows, trimmedNotes, value);
    // No-op if this matches either the most recent commit or the specific prior
    // analysis this draft was reused from — both mean "nothing changed".
    const refs = [
      valueHistory[0],
      derivedFromId ? valueHistory.find(h => h.id === derivedFromId) : undefined,
    ];
    for (const ref of refs) {
      if (!ref) continue;
      const refNorm = normalizeAnalysis(ref.snapshot?.rows || [], ref.snapshot?.notes ?? null, ref.market_value);
      if (refNorm === normalized) return null;
    }
    const snapshot: AnalysisSnapshot = { notes: trimmedNotes, market_value: value, rows: analysisRows };
    const payload = {
      user_id: userId,
      card_year: card.year, card_brand: card.brand, card_number: card.card_number, card_player: card.player,
      card_grade: card.grade, card_grading_company: card.grading_company, card_raw_grade: card.raw_grade,
      listing_id: card.listing_id ?? null, set_slug: card.set_slug ?? null, set_card_number: card.set_card_number ?? null,
      market_value: value,
      content_hash: contentHash(normalized),
      snapshot,
      mark_kind: 'research' as const,
      source_session_id: null, // reserved for the migration backfill only
      derived_from_id: derivedFromId,
    };
    const { row, error } = await insertValueHistoryRow(payload);
    if (error) return error;
    if (row) {
      setValueHistory(prev => [row, ...prev]);
      setDerivedFromId(row.id); // subsequent commits chain off this one
    }
    return null;
  }

  // Persist current session + data points. Returns true on success. The UI
  // wrapper functions below decide whether to alert on errors / require
  // weights = 100% / etc.
  async function persistSession(opts: { silent?: boolean } = {}): Promise<boolean> {
    if (!userId) return false;
    const supabase = createClient();
    const payload = {
      user_id: userId,
      card_year: card.year,
      card_brand: card.brand,
      card_number: card.card_number,
      card_player: card.player,
      card_grade: card.grade,
      card_grading_company: card.grading_company,
      card_raw_grade: card.raw_grade,
      listing_id: card.listing_id ?? null,
      set_slug: card.set_slug ?? null,
      set_card_number: card.set_card_number ?? null,
      market_value: totals.weightOk ? totals.marketValue : null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let activeSessionId = sessionIdRef.current;
    if (activeSessionId) {
      const { error } = await supabase.from('market_research_sessions').update(payload).eq('id', activeSessionId);
      if (error) { if (!opts.silent) alert('Could not save: ' + error.message); return false; }
      await supabase.from('market_research_data_points').delete().eq('session_id', activeSessionId);
    } else {
      const { data, error } = await supabase.from('market_research_sessions').insert(payload).select('id').single();
      if (error || !data) { if (!opts.silent) alert('Could not save: ' + error?.message); return false; }
      activeSessionId = data.id as string;
      setActiveSession(activeSessionId);
    }
    const dpRows = rows
      .filter(rowHasUserContent)
      .map(r => ({
        session_id: activeSessionId,
        user_id: userId,
        position: r.position,
        source: r.source,
        source_label: r.source === 'other' ? r.source_label.trim() || null : null,
        grade_company: r.grade_company || null,
        grade_value: r.grade_value || null,
        sale_date: r.sale_date || null,
        price: r.price !== '' ? Number(r.price) : null,
        weight_pct: r.weight_pct !== '' ? Number(r.weight_pct) : null,
        url: r.url.trim() || null,
        notes: r.notes.trim() || null,
      }));
    if (dpRows.length > 0) {
      const { error: dpErr } = await supabase.from('market_research_data_points').insert(dpRows);
      if (dpErr) { if (!opts.silent) alert('Saved session but data points failed: ' + dpErr.message); return false; }
    }
    return true;
  }

  // Every write to a session goes through this queue. `persistSession` replaces
  // a session's comps with a delete-then-insert, so two of them running at once
  // can interleave (delete, delete, insert, insert) and leave the session
  // holding each comp twice — which reloads as double weights and a total that
  // can never reach 100% again. Chaining guarantees one at a time.
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  function queueSave(opts: { silent?: boolean } = {}): Promise<boolean> {
    const next = saveQueue.current.catch(() => false).then(() => persistSession(opts));
    saveQueue.current = next;
    return next;
  }

  async function save() {
    if (!totals.weightOk) {
      alert('Weights must total 100% with at least one row that has a price filled in.');
      return;
    }
    setSaving(true);
    setHistoryError(null);
    const ok = await queueSave();
    const err = ok ? await commitHistory() : null;
    setHistoryError(err);
    setSaving(false);
  }

  async function saveAndApply() {
    if (!totals.weightOk) {
      alert('Weights must total 100% with at least one row that has a price filled in.');
      return;
    }
    setSaving(true);
    setHistoryError(null);
    const ok = await queueSave();
    const err = ok ? await commitHistory() : null;
    setHistoryError(err);
    setSaving(false);
    if (!ok) return;
    if (onApply) onApply(totals.marketValue);
    // The value still gets applied — but say so when it didn't make it into the
    // price history, because the modal is about to close over the banner.
    if (err) {
      alert(`Value applied, but this analysis could not be added to the card's price history: ${err}`);
    }
    onClose();
  }

  function loadFromLatest() {
    if (!latestSession) return;
    setRows(rowsFromDataPoints(latestSession.data_points, cardDefaults));
    setNotes(latestSession.session.notes || '');
    setActiveSession(latestSession.session.id);
    setDerivedFromId(null);
    setAutoSaveTick('idle');
  }

  // Autosave: 1.5s after the last edit, persist silently. We only kick in
  // once there's at least one row with user-entered content (price, weight,
  // URL, row notes, or a custom source label) — pre-populated grade defaults
  // alone don't count, so a freshly-opened modal never creates an empty row.
  function rowHasUserContent(r: Row): boolean {
    if (r.price !== '' || r.weight_pct !== '') return true;
    if (r.url.trim() || r.notes.trim()) return true;
    if (r.source === 'other' && r.source_label.trim()) return true;
    return false;
  }
  useEffect(() => {
    if (!open || loading) return;
    const meaningful = rows.some(rowHasUserContent);
    if (!meaningful && !notes.trim()) return;
    setAutoSaveTick('pending');
    const t = setTimeout(async () => {
      setAutoSaveTick('saving');
      const ok = await queueSave({ silent: true });
      setAutoSaveTick(ok ? 'saved' : 'idle');
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, notes, open, loading]);

  if (!open) return null;

  const cardTitle = [
    card.year ? String(card.year) : '',
    card.brand || '',
    card.card_number ? `#${card.card_number}` : '',
    card.player || '',
  ].filter(Boolean).join(' ').trim() || 'Card';
  const conditionLabel = card.grading_company && card.grade
    ? `${card.grading_company} ${card.grade}`
    : (card.raw_grade ? `Raw ${card.raw_grade}` : 'Raw');

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 1100, padding: 24, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {(() => {
            const imgs = [
              { url: card.image_front || '', label: 'Front' },
              { url: card.image_back || '', label: 'Back' },
            ].filter(i => i.url);
            if (imgs.length === 0) return null;
            return (
              <div style={{ display: 'flex', gap: 6 }}>
                {imgs.map(i => (
                  <a key={i.label} href={i.url} target="_blank" rel="noreferrer"
                    title={`Open ${i.label.toLowerCase()} scan in a new tab`}
                    style={{ display: 'block', lineHeight: 0 }}>
                    <img loading="lazy" decoding="async" src={i.url} alt={i.label}
                      style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '2px solid var(--plum)', cursor: 'zoom-in' }} />
                  </a>
                ))}
              </div>
            );
          })()}
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)' }}>📈 Research Prices</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
              {cardTitle} <span style={{ color: 'var(--orange)' }}>· {conditionLabel}</span>
            </div>
          </div>
          <div className="panel-bordered" style={{ padding: '10px 16px', background: 'var(--paper)', minWidth: 180 }}>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 2 }}>Market Value</div>
            <div className="display" style={{ fontSize: 28, color: totals.weightOk ? 'var(--orange)' : 'var(--ink-mute)', fontWeight: 700 }}>
              {totals.weightOk ? fmtMoney(totals.marketValue) : '—'}
            </div>
            <div className="mono" style={{ fontSize: 10, color: totals.weightOk ? 'var(--teal)' : 'var(--rust)', fontWeight: 700 }}>
              Weights total: {totals.totalWeight.toFixed(1)}% {totals.weightOk ? '✓' : '(must = 100%)'}
            </div>
            {valueTrend && (
              <div className="mono" style={{ fontSize: 10, fontWeight: 700, marginTop: 3, color: trendColor(valueTrend.direction) }}
                title={`Last commit ${fmtMoney(valueTrend.latest)} vs prior ${fmtMoney(valueTrend.previous)}`}>
                {trendArrow(valueTrend.direction)}{' '}
                {valueTrend.pct !== null
                  ? `${valueTrend.pct >= 0 ? '+' : ''}${valueTrend.pct.toFixed(1)}%`
                  : `${valueTrend.delta >= 0 ? '+' : ''}${fmtMoney(valueTrend.delta)}`}
                {' '}vs prior
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 12px' }}>{INSTRUCTIONS}</p>
        {latestSession && !sessionId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {/* The draft is picked by most-recently-updated, so date it that way —
                  `created_at` would show when the session was first opened, which
                  on a resumed analysis is not the day the work was done. */}
              You analyzed this card on <strong>{new Date(latestSession.session.updated_at || latestSession.session.created_at).toLocaleDateString()}</strong>
              {latestSession.session.market_value !== null ? <> · {fmtMoney(latestSession.session.market_value)}</> : null}.
            </span>
            <button type="button" onClick={loadFromLatest}
              className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: 11 }}>
              ↳ Use most recent analysis
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--ink-mute)' }}>Loading…</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto', marginBottom: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1060 }}>
                <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  <tr>
                    <th style={{ padding: '8px', textAlign: 'left', width: 170 }}>Source</th>
                    <th style={{ padding: '8px', textAlign: 'left', width: 110 }}>Company</th>
                    <th style={{ padding: '8px', textAlign: 'left', width: 110 }}>Grade</th>
                    <th style={{ padding: '8px', textAlign: 'left', width: 130 }}>Date</th>
                    <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>Price ($)</th>
                    <th style={{ padding: '8px', textAlign: 'right', width: 90 }}>Weight (%)</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>URL / notes</th>
                    <th style={{ padding: '8px', width: 32 }} aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid var(--rule)' }}>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <select value={r.source} onChange={e => updateRow(idx, { source: e.target.value as SourceValue })}
                          style={fieldStyle()}>
                          {RESEARCH_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {r.source === 'other' && (
                          <input value={r.source_label} onChange={e => updateRow(idx, { source_label: e.target.value })}
                            placeholder="Source name" style={{ ...fieldStyle(), marginTop: 4 }} />
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <select value={r.grade_company}
                          onChange={e => {
                            const next = e.target.value;
                            // Reset grade if it doesn't fit the new company.
                            const fits = gradesForCompany(next).includes(r.grade_value);
                            updateRow(idx, { grade_company: next, grade_value: fits ? r.grade_value : '' });
                          }}
                          style={fieldStyle()}>
                          <option value="">—</option>
                          {GRADING_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        {r.grade_company === 'Other' || r.grade_company === '' ? (
                          <input type="text" value={r.grade_value}
                            onChange={e => updateRow(idx, { grade_value: e.target.value })}
                            placeholder="—"
                            style={fieldStyle()} />
                        ) : (
                          <select value={r.grade_value}
                            onChange={e => updateRow(idx, { grade_value: e.target.value })}
                            style={fieldStyle()}>
                            <option value="">—</option>
                            {gradesForCompany(r.grade_company).map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input type="date" value={r.sale_date} onChange={e => updateRow(idx, { sale_date: e.target.value })}
                          style={fieldStyle()} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input type="text" inputMode="decimal" value={r.price}
                          onChange={e => updateRow(idx, { price: e.target.value.replace(/[^0-9.]/g, '') })}
                          placeholder="0.00"
                          style={{ ...fieldStyle(), textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input type="text" inputMode="decimal" value={r.weight_pct}
                          onChange={e => updateRow(idx, { weight_pct: e.target.value.replace(/[^0-9.]/g, '') })}
                          placeholder="0"
                          style={{ ...fieldStyle(), textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={r.url} onChange={e => updateRow(idx, { url: e.target.value })}
                          placeholder="https://… (optional)" style={fieldStyle()} />
                        <input value={r.notes} onChange={e => updateRow(idx, { notes: e.target.value })}
                          placeholder="row note (optional)" style={{ ...fieldStyle(), marginTop: 4 }} />
                      </td>
                      <td style={{ padding: '6px 4px', verticalAlign: 'top' }}>
                        <button type="button" onClick={() => removeRow(idx)} aria-label="Remove row"
                          disabled={rows.length <= 1}
                          style={{ background: 'transparent', border: 0, color: 'var(--rust)', cursor: rows.length <= 1 ? 'not-allowed' : 'pointer', fontSize: 16, padding: 4 }}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ padding: '8px', textAlign: 'right', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>Total weight</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: totals.weightOk ? 'var(--teal)' : 'var(--rust)' }}>
                      {totals.totalWeight.toFixed(1)}%
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <button type="button" onClick={addRow} className="btn btn-ghost btn-sm">+ Add row</button>
              {/* Only offered when it would change something: rebalancing a
                  table that already totals 100% is a no-op that invites a
                  click for nothing. */}
              {canRebalance && (
                <button type="button" onClick={rebalanceWeights} className="btn btn-ghost btn-sm"
                  title={`Spread 100% evenly across the ${totals.priceFilled} priced row${totals.priceFilled === 1 ? '' : 's'}`}>
                  ⚖ Even out weights
                </button>
              )}
              {/* Graded cards get rows; ungraded cards get the price range only,
                  because CardSight publishes no condition on a raw sale and the
                  spread between a beat-up copy and a clean one is most of the
                  price. The label says which you'll get. */}
              <button type="button" onClick={pullComps} disabled={compsLoading}
                className="btn btn-ghost btn-sm"
                title={cardIsGraded
                  ? 'Fill the table with the last 30 days of auctions and Buy-It-Now asks at this grade'
                  : 'Ungraded card — shows the sold price range, not comps'}>
                {compsLoading ? 'Pulling…' : cardIsGraded ? '⇩ Pull comps' : '⇩ Pull price range'}
              </button>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                Need at least one priced row. Save unlocks at total = 100%.
              </span>
            </div>

            {compsError && (
              <div style={{ fontSize: 12, color: 'var(--rust)', marginBottom: 12 }}>{compsError}</div>
            )}
            {comps && (
              <CompsPanel comps={comps} onImportHistory={importHistory}
                importing={importingHistory} imported={importedCount} />
            )}

            <div style={{ marginBottom: 16 }}>
              <label className="input-label">Notes (private — only you see these)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Anything you want to remember about this analysis…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--plum)', borderRadius: 6, background: 'var(--paper)', color: 'var(--plum)', fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 22 }}>
              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center', minWidth: 220 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" onClick={save} disabled={saving || !totals.weightOk}
                    className="btn btn-ghost btn-sm">{saving ? 'Saving…' : '💾 Save research'}</button>
                  <button type="button" onClick={saveAndApply} disabled={saving || !totals.weightOk || !onApply}
                    className="btn btn-primary btn-sm">
                    {saving ? 'Saving…' : `→ Use ${totals.weightOk ? fmtMoney(totals.marketValue) : 'value'}`}
                  </button>
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                  {autoSaveTick === 'pending' && '· autosave pending…'}
                  {autoSaveTick === 'saving' && '· autosaving…'}
                  {autoSaveTick === 'saved' && '· autosaved ✓'}
                </span>
                {historyError && (
                  <div style={{
                    fontSize: 11.5, lineHeight: 1.5, color: 'var(--rust)', fontWeight: 600,
                    background: 'var(--paper)', border: '1.5px solid var(--rust)', borderRadius: 6, padding: '8px 10px',
                  }}>
                    Your research was saved, but this analysis could not be added to the card&apos;s
                    price history, so it won&apos;t show a change vs. your prior value.
                    <div className="mono" style={{ fontSize: 10.5, fontWeight: 400, marginTop: 4 }}>{historyError}</div>
                  </div>
                )}
              </div>
              {/* Prior-vs-new value column chart, right beside the actions */}
              <div style={{ flex: 1, minWidth: 300 }}>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>Prior vs New Value</div>
                <PriorVsNewChart
                  history={valueHistory.slice().reverse()}
                  newValue={totals.marketValue}
                  hasNew={totals.weightOk}
                  selectedId={selectedMarkId}
                  onSelect={m => setSelectedMarkId(m?.id ?? null)}
                />
                {selectedMark && (
                  <MarkDetailTable mark={selectedMark} onClose={() => setSelectedMarkId(null)} />
                )}
              </div>
            </div>

            {/* Price history for this card (you only) — immutable committed analyses */}
            {valueHistory.length > 0 && (
              <section style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div className="display" style={{ fontSize: 14, color: 'var(--plum)' }}>Price history</div>
                  {valueTrend && (
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: trendColor(valueTrend.direction) }}>
                      {trendArrow(valueTrend.direction)}{' '}
                      {valueTrend.pct !== null
                        ? `${valueTrend.pct >= 0 ? '+' : ''}${valueTrend.pct.toFixed(1)}%`
                        : `${valueTrend.delta >= 0 ? '+' : ''}${fmtMoney(valueTrend.delta)}`}
                      {' '}since prior
                    </span>
                  )}
                  {valueHistory.length >= 2 && (
                    <div style={{ marginLeft: 'auto' }}>
                      <Sparkline values={valueHistory.slice().reverse().map(h => h.market_value)} />
                    </div>
                  )}
                </div>
                <ValueHistoryList
                  items={valueHistory}
                  onUse={(h) => {
                    setRows(rowsFromSnapshot(h.snapshot, cardDefaults));
                    setNotes(h.snapshot?.notes || '');
                    setActiveSession(null);   // fork a fresh working session; don't overwrite
                    setDerivedFromId(h.id);   // lineage recorded on the next commit
                    setAutoSaveTick('idle');
                  }}
                />
              </section>
            )}

            {/* Community sessions */}
            {community.length > 0 && (
              <section>
                <div className="display" style={{ fontSize: 14, color: 'var(--plum)', marginBottom: 8 }}>
                  Community research on this card
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 500, marginLeft: 8 }}>
                    ({community.length} from other collectors)
                  </span>
                </div>
                <PastList items={community.map(s => ({
                  date: s.created_at,
                  marketValue: s.market_value,
                  rows: s.data_points,
                  notes: null, // private
                  applyButton: { label: 'Use as starting point', onClick: () => loadFromCommunity(s) },
                }))} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function fieldStyle(): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 8px',
    border: '1.5px solid var(--plum)',
    borderRadius: 4,
    background: 'var(--cream)',
    color: 'var(--plum)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
  };
}

function PastList({ items, showNotes }: {
  items: { date: string; marketValue: number | null; rows: DataPointRow[]; notes: string | null;
    applyButton?: { label: string; onClick: () => void } }[];
  showNotes?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} className="panel" style={{ padding: 12, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>
              {new Date(it.date).toLocaleDateString()}
            </span>
            <span className="display" style={{ fontSize: 16, color: 'var(--orange)', fontWeight: 700 }}>
              {it.marketValue !== null ? fmtMoney(it.marketValue) : '—'}
            </span>
            {it.applyButton && (
              <button type="button" onClick={it.applyButton.onClick}
                className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: 11 }}>
                ↳ {it.applyButton.label}
              </button>
            )}
          </div>
          {it.rows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6, fontSize: 11.5, color: 'var(--ink-soft)' }}>
              {dedupeByPosition(it.rows.slice().sort((a, b) => a.position - b.position)).map(d => {
                const gradeDisplay = d.grade_company || d.grade_value
                  ? `${d.grade_company || ''}${d.grade_company && d.grade_value ? ' ' : ''}${d.grade_value || ''}`.trim()
                  : (d.grade_condition || '');
                return (
                  <div key={d.id}>
                    <strong style={{ color: 'var(--plum)' }}>{sourceDisplay(d.source as SourceValue, d.source_label)}</strong>
                    {gradeDisplay ? ` · ${gradeDisplay}` : ''}
                    {d.sale_date ? ` · ${d.sale_date}` : ''}
                    {' · '}
                    <span style={{ color: 'var(--orange)', fontWeight: 700 }}>{d.price !== null ? fmtMoney(d.price) : '—'}</span>
                    {d.weight_pct !== null ? ` (${d.weight_pct}%)` : ''}
                  </div>
                );
              })}
            </div>
          )}
          {showNotes && it.notes && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic' }}>{it.notes}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Immutable price-history entries (newest first). Each entry shows its comps
// from the stored snapshot, the notes, and its change vs the chronologically
// previous commit, plus a "Use this analysis" button to fork it into the form.
function ValueHistoryList({ items, onUse }: {
  items: ValueHistoryRow[];
  onUse: (h: ValueHistoryRow) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((h, i) => {
        // The next item in this newest-first list is the older commit.
        const older = items[i + 1];
        const delta = older ? h.market_value - older.market_value : null;
        const pct = older && older.market_value !== 0 ? (delta! / older.market_value) * 100 : null;
        const dir: 'up' | 'down' | 'flat' = delta === null ? 'flat'
          : delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'flat';
        const snapRows = dedupeByPosition((h.snapshot?.rows || []).slice().sort((a, b) => a.position - b.position));
        return (
          <div key={h.id} className="panel" style={{ padding: 12, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>
                {new Date(h.created_at).toLocaleDateString()}
              </span>
              <span className="display" style={{ fontSize: 16, color: 'var(--orange)', fontWeight: 700 }}>
                {fmtMoney(h.market_value)}
              </span>
              {/* Imported market medians share this timeline with the owner's
                  own analyses, so say which is which — one is what the market
                  did, the other is what they concluded. */}
              {h.mark_kind === 'cardsight' && (
                <span className="chip chip-gold" style={{ fontSize: 9.5 }}>CardSight median</span>
              )}
              {delta !== null && (
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: trendColor(dir) }}>
                  {trendArrow(dir)}{' '}
                  {pct !== null
                    ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
                    : `${delta >= 0 ? '+' : ''}${fmtMoney(delta)}`}
                </span>
              )}
              <button type="button" onClick={() => onUse(h)}
                className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: 11 }}>
                ↳ Use this analysis
              </button>
            </div>
            {snapRows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6, fontSize: 11.5, color: 'var(--ink-soft)' }}>
                {snapRows.map((d, j) => {
                  const gradeDisplay = `${d.grade_company || ''}${d.grade_company && d.grade_value ? ' ' : ''}${d.grade_value || ''}`.trim();
                  return (
                    <div key={j}>
                      <strong style={{ color: 'var(--plum)' }}>{sourceDisplay(d.source as SourceValue, d.source_label)}</strong>
                      {gradeDisplay ? ` · ${gradeDisplay}` : ''}
                      {d.sale_date ? ` · ${d.sale_date}` : ''}
                      {' · '}
                      <span style={{ color: 'var(--orange)', fontWeight: 700 }}>{d.price !== null ? fmtMoney(d.price) : '—'}</span>
                      {d.weight_pct !== null ? ` (${d.weight_pct}%)` : ''}
                    </div>
                  );
                })}
              </div>
            )}
            {h.snapshot?.notes && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic' }}>{h.snapshot.notes}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
