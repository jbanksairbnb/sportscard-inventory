'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import SetHeaderBanner from '@/components/SetHeaderBanner';
import ValueDetailModal from '@/components/ValueDetailModal';
import ValueUpdateModal from '@/components/ValueUpdateModal';
import MarketResearchModal, { type CardDescriptor } from '@/components/MarketResearchModal';
import SetValueStats, { type CardValueStat } from '@/components/SetValueStats';
import Thumb from '@/components/Thumb';
import { recordManualValueMark, type ValueMarkCard } from '@/lib/recordValueMark';
import { cardValueKey, trendFromRows, type Trend, type ValueHistoryRow } from '@/lib/cardValueHistory';

// Parse a stored Value string ("$1,234.50") into a number; 0 when empty/invalid.
function parseValue(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

type ImageItem = {
  url: string;
  cardNum: string;
  player: string;
  side: 'Front' | 'Back';
};

// Card-identity key for a display row, matching descriptorForRow on the edit
// page so value history groups the same way. A filled Grading Company means
// graded (grade + company); otherwise the raw grade drives the series.
function valueKeyForRow(row: Record<string, any>, year: string, brand: string): string {
  const grade = String(row['Grade'] || '').trim() || null;
  const gradingCompany = String(row['Grading Company'] || '').trim() || null;
  const rawGrade = String(row['Raw Grade'] || '').trim() || null;
  const isGraded = !!gradingCompany;
  return cardValueKey({
    year: year ? Number(year) || null : null,
    brand: brand || null,
    card_number: String(row['Card #'] || '').trim() || null,
    grade: isGraded ? grade : null,
    grading_company: isGraded ? gradingCompany : null,
    raw_grade: !isGraded ? rawGrade : null,
  });
}

// Full research/mark descriptor for a display row — the identity tuple plus
// breadcrumbs and image scans. Doubles as the ValueMarkCard for manual marks
// (structural superset), so one builder feeds both the research modal and the
// manual-mark writer.
function descriptorForRow(row: Record<string, any>, year: string, brand: string, slug: string): CardDescriptor {
  const grade = String(row['Grade'] || '').trim() || null;
  const gradingCompany = String(row['Grading Company'] || '').trim() || null;
  const rawGrade = String(row['Raw Grade'] || '').trim() || null;
  const isGraded = !!gradingCompany;
  const cardNumber = String(row['Card #'] || '').trim() || null;
  return {
    year: year ? Number(year) || null : null,
    brand: brand || null,
    card_number: cardNumber,
    player: String(row['Player'] || row['Description'] || '').trim() || null,
    grade: isGraded ? grade : null,
    grading_company: isGraded ? gradingCompany : null,
    raw_grade: !isGraded ? rawGrade : null,
    set_slug: slug,
    set_card_number: cardNumber,
    image_front: String(row['Image 1'] || '').trim() || null,
    image_back: String(row['Image 2'] || '').trim() || null,
  };
}

// Small inline up/down movement badge shown next to a card's value.
function MovementBadge({ trend }: { trend: Trend }) {
  const color = trend.direction === 'up' ? 'var(--teal)' : trend.direction === 'down' ? 'var(--rust)' : 'var(--ink-mute)';
  const arrow = trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '→';
  const label = trend.pct !== null ? `${trend.pct >= 0 ? '+' : ''}${trend.pct.toFixed(0)}%` : '';
  return (
    <span title={`Latest $${trend.latest.toFixed(2)} vs prior $${trend.previous.toFixed(2)}`}
      style={{ fontSize: 11, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
      {arrow}{label}
    </span>
  );
}

function ImageLightbox({ items, startIdx, onClose }: { items: ImageItem[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(Math.max(0, Math.min(startIdx, items.length - 1)));
  useEffect(() => { setIdx(Math.max(0, Math.min(startIdx, items.length - 1))); }, [startIdx, items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') { setIdx(i => (i - 1 + items.length) % items.length); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setIdx(i => (i + 1) % items.length); e.preventDefault(); }
      else if (e.key === 'Escape') { onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  if (items.length === 0) return null;
  const current = items[idx];
  const arrowBtn: React.CSSProperties = {
    background: 'rgba(42,20,52,0.7)', color: 'var(--cream)',
    border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 24,
    cursor: 'pointer', lineHeight: 1,
  };
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(42, 20, 52, 0.88)',
      }}
      onClick={onClose}
    >
      <div style={{ position: 'relative', padding: 16 }} onClick={(e) => e.stopPropagation()}>
        {/* Full-resolution original — the enlarged view intentionally serves the
            untouched scan, not a resized transform, so no detail is lost. */}
        <img loading="lazy" decoding="async" src={current.url} alt="Card" style={{ maxWidth: '90vw', maxHeight: '78vh', borderRadius: 12, display: 'block' }} />
        <div style={{
          marginTop: 12, padding: '8px 14px',
          background: 'rgba(248,236,208,0.96)', border: '2px solid var(--plum)',
          borderRadius: 8, color: 'var(--plum)', textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
            {current.cardNum ? `#${current.cardNum}` : ''}
          </span>
          <span className="display" style={{ fontSize: 14 }}>{current.player || '—'}</span>
          <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>{current.side}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 8 }}>
            {idx + 1} / {items.length}
          </span>
        </div>
        {items.length > 1 && (
          <div style={{ position: 'absolute', top: '40%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px', pointerEvents: 'none' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => (i - 1 + items.length) % items.length); }}
              style={{ ...arrowBtn, pointerEvents: 'auto' }} title="Previous (←)">‹</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => (i + 1) % items.length); }}
              style={{ ...arrowBtn, pointerEvents: 'auto' }} title="Next (→)">›</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm"
          style={{ position: 'absolute', top: 4, right: 4 }}>
          ✕ Close
        </button>
      </div>
    </div>
  );
}

function CardTile({ row, year, brand, valueDisplay, trend, onValueClick, onImageClick }: {
  row: Record<string, any>; year: string; brand: string;
  valueDisplay: string | null; trend: Trend | null; onValueClick: () => void;
  onImageClick: (cardIdx: number, side: 'Front' | 'Back') => void;
}) {
  const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
  const description = row['Player'] || row['Description'] || '';
  const gradingCo = row['Grading Company'] || '';
  const grade = row['Grade'] || '';
  const salePrice = row['Sale Price'] || '';
  const img1 = row['Image 1'] || '';
  const img2 = row['Image 2'] || '';
  const owned = String(row['Owned'] || '') === 'Yes';
  const details = [gradingCo, grade ? `Grade ${grade}` : '', salePrice].filter(Boolean).join('  ·  ');
  const cardIdx = row.__cardIdx as number;

  return (
    <div className="panel" style={{ padding: '14px 16px', position: 'relative' }}>
      {owned && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'var(--teal)', color: 'var(--cream)',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
          padding: '2px 7px', borderRadius: 100,
        }}>OWNED</div>
      )}
      <div className="eyebrow" style={{ fontSize: 10.5, color: 'var(--orange)', marginBottom: 4 }}>
        {[year, brand].filter(Boolean).join(' · ')}
      </div>
      <div style={{ marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-mute)' }}>{cardNum}</span>
        {cardNum && description && ' '}
        <span className="display" style={{ fontSize: 14, color: 'var(--plum)' }}>{description}</span>
      </div>
      {details && (
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>{details}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)' }}>VALUE</span>
        <button type="button" onClick={onValueClick} title="Update value — type a number or research the market"
          style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
            color: 'var(--orange)', fontFamily: 'var(--font-display)', fontSize: 16,
            textDecoration: 'underline', textDecorationThickness: 1, textUnderlineOffset: 2 }}>
          {valueDisplay || '＋ Set value'}
        </button>
        {trend && <MovementBadge trend={trend} />}
      </div>
      {(img1 || img2) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {img1 && (
            <Thumb url={img1} width={320} alt="Front" onClick={() => onImageClick(cardIdx, 'Front')}
              style={{ width: 128, height: 128, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }} />
          )}
          {img2 && (
            <Thumb url={img2} width={320} alt="Back" onClick={() => onImageClick(cardIdx, 'Back')}
              style={{ width: 128, height: 128, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }} />
          )}
        </div>
      )}
    </div>
  );
}

function CardTableRow({ row, year, brand, valueDisplay, trend, onValueClick, onImageClick }: {
  row: Record<string, any>; year: string; brand: string;
  valueDisplay: string | null; trend: Trend | null; onValueClick: () => void;
  onImageClick: (cardIdx: number, side: 'Front' | 'Back') => void;
}) {
  const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
  const img1 = row['Image 1'] || '';
  const img2 = row['Image 2'] || '';
  const cardIdx = row.__cardIdx as number;

  return (
    <tr style={{ borderTop: '1.5px solid var(--cream-warm)' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream-warm)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
      <td className="eyebrow" style={{ padding: '10px 14px', fontSize: 10.5, color: 'var(--orange)', whiteSpace: 'nowrap' }}>
        {[year, brand].filter(Boolean).join(' · ')}
      </td>
      <td className="mono" style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
        {cardNum}
      </td>
      <td className="display" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--plum)' }}>
        {row['Player'] || row['Description'] || ''}
      </td>
      <td className="eyebrow" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
        {row['Grading Company'] || ''}
      </td>
      <td className="mono" style={{ padding: '10px 14px', fontSize: 13, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
        {row['Grade'] ? `Grade ${row['Grade']}` : ''}
      </td>
      <td className="mono" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--teal)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {row['Sale Price'] || ''}
      </td>
      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" onClick={onValueClick} title="Update value — type a number or research the market"
            style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              color: valueDisplay ? 'var(--orange)' : 'var(--ink-mute)', fontFamily: 'var(--font-mono)',
              fontSize: 13, fontWeight: 700, textDecoration: 'underline', textDecorationThickness: 1, textUnderlineOffset: 2 }}>
            {valueDisplay || '＋ Set'}
          </button>
          {trend && <MovementBadge trend={trend} />}
        </div>
      </td>
      <td style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {img1 && (
            <Thumb url={img1} width={240} alt="Front" onClick={() => onImageClick(cardIdx, 'Front')}
              style={{ width: 88, height: 88, borderRadius: 6, border: '1.5px solid var(--plum)', objectFit: 'cover', cursor: 'pointer' }} />
          )}
          {img2 && (
            <Thumb url={img2} width={240} alt="Back" onClick={() => onImageClick(cardIdx, 'Back')}
              style={{ width: 88, height: 88, borderRadius: 6, border: '1.5px solid var(--plum)', objectFit: 'cover', cursor: 'pointer' }} />
          )}
        </div>
      </td>
    </tr>
  );
}

export default function InventoryViewPage() {
  const router = useRouter();
  const params = useParams();
  const slug = String(params?.slug || '');

  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [brand, setBrand] = useState('');
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [listView, setListView] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  // Committed value analyses for this set, grouped by the shared card-identity
  // key. Powers each card's value, up/down movement badge, and the detail popup.
  const [historyByKey, setHistoryByKey] = useState<Record<string, ValueHistoryRow[]>>({});
  const [valueModalKey, setValueModalKey] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // The row (index into `rows`) whose value-update popup is open, and the card
  // currently open in the research table. Both are owner-only edit affordances.
  const [editRowIdx, setEditRowIdx] = useState<number | null>(null);
  const [researchTarget, setResearchTarget] = useState<{ rowIdx: number; descriptor: CardDescriptor } | null>(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);

  // Re-fetch this set's value history and group it by card-identity key. Called
  // on first load and after any value edit so trends/movers refresh live.
  const loadHistory = React.useCallback(async (uid: string) => {
    const supabase = createClient();
    const { data: hist } = await supabase
      .from('card_value_history')
      .select('*')
      .eq('user_id', uid)
      .eq('set_slug', slug);
    const groups: Record<string, ValueHistoryRow[]> = {};
    for (const h of (hist || []) as unknown as ValueHistoryRow[]) {
      const key = cardValueKey({
        year: h.card_year, brand: h.card_brand, card_number: h.card_number,
        grade: h.card_grade, grading_company: h.card_grading_company, raw_grade: h.card_raw_grade,
      });
      (groups[key] ||= []).push(h);
    }
    setHistoryByKey(groups);
  }, [slug]);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data, error } = await supabase
        .from('sets')
        .select('title, year, brand, rows')
        .eq('user_id', user.id)
        .eq('slug', slug)
        .maybeSingle();
      if (error) {
        console.error('[set view] failed to load set:', error);
        setLoading(false);
        return;
      }
      await loadHistory(user.id);
      if (data) {
        setTitle(data.title || '');
        setYear(data.year ? String(data.year) : '');
        setBrand(data.brand || '');
        setRows(data.rows || []);
      }
      setLoading(false);
    }
    load();
  }, [slug, router, loadHistory]);

  // Persist a new value for one card: write the Value field back to the set,
  // then log a dated mark so its movement is tracked. Research commits its own
  // (richer) mark, so this manual writer is only used for the typed path.
  const persistRowValue = React.useCallback(async (rowIdx: number, value: number, recordMark: boolean) => {
    if (!userId) return;
    const supabase = createClient();
    // The value the card carried *before* this edit — seeded as a baseline mark
    // so a single change immediately shows movement (old → new) instead of
    // needing a second change to have something to compare against.
    const priorValue = parseValue(rows[rowIdx]?.['Value']);
    const formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
    const nextRows = rows.map((r, i) => (i === rowIdx ? { ...r, Value: formatted } : r));
    const target = nextRows[rowIdx];
    setRows(nextRows);
    const { error } = await supabase.from('sets').update({ rows: nextRows }).eq('user_id', userId).eq('slug', slug);
    if (error) { console.error('[set view] failed to save value:', error); return; }
    if (recordMark && target) {
      const card = descriptorForRow(target, year, brand, slug) as ValueMarkCard;
      // Seed the prior value first (no-op if it already matches the latest mark),
      // then the new value — two sequential inserts keep created_at ordered.
      if (priorValue > 0 && Math.abs(priorValue - value) >= 0.005) {
        await recordManualValueMark(userId, card, priorValue);
      }
      await recordManualValueMark(userId, card, value);
    }
    await loadHistory(userId);
  }, [userId, slug, year, brand, loadHistory, rows]);

  // Snapshot every owned card's current value as a dated mark, establishing (or
  // re-setting) the baseline the "Change in Value" / "Cards Up / Down" tiles
  // measure against. Deduped per card, so cards already carrying their current
  // value as the latest mark are skipped — re-running when nothing changed is a
  // no-op. After this, the next value change on any card shows movement.
  const setBenchmark = React.useCallback(async () => {
    if (!userId || benchmarkBusy) return;
    setBenchmarkBusy(true);
    try {
      const seen = new Set<string>();
      for (const row of rows) {
        if (String(row['Owned'] || '') !== 'Yes') continue;
        const value = parseValue(row['Value']);
        if (value <= 0) continue;
        const key = valueKeyForRow(row, year, brand);
        if (seen.has(key)) continue;
        seen.add(key);
        await recordManualValueMark(userId, descriptorForRow(row, year, brand, slug) as ValueMarkCard, value);
      }
      await loadHistory(userId);
    } finally {
      setBenchmarkBusy(false);
    }
  }, [userId, benchmarkBusy, rows, year, brand, slug, loadHistory]);

  const displayed = useMemo(() => {
    // __rowIdx = index into the unfiltered `rows` (stable identity for edits);
    // __cardIdx = index into this displayed slice (drives the image lightbox).
    const withIdx = rows.map((r, i): Record<string, any> => ({ ...r, __rowIdx: i }));
    const arr = showOwnedOnly
      ? withIdx.filter((r) => String(r['Owned'] || '') === 'Yes')
      : withIdx;
    return arr.map((r, i): Record<string, any> => ({ ...r, __cardIdx: i }));
  }, [rows, showOwnedOnly]);

  // Build a flat list of every image across the displayed cards so the
  // lightbox can scroll through the whole set with the arrow keys.
  const lightboxItems: ImageItem[] = useMemo(() => {
    const items: ImageItem[] = [];
    for (const row of displayed) {
      const cardNum = row['Card #'] ? String(row['Card #']) : '';
      const player = String(row['Player'] || row['Description'] || '');
      if (row['Image 1']) items.push({ url: String(row['Image 1']), cardNum, player, side: 'Front' });
      if (row['Image 2']) items.push({ url: String(row['Image 2']), cardNum, player, side: 'Back' });
    }
    return items;
  }, [displayed]);

  function openLightbox(cardIdx: number, side: 'Front' | 'Back') {
    const target = displayed[cardIdx];
    if (!target) return;
    const targetUrl = String(target[side === 'Front' ? 'Image 1' : 'Image 2'] || '');
    if (!targetUrl) return;
    const idx = lightboxItems.findIndex(it => it.url === targetUrl);
    setLightboxIdx(idx >= 0 ? idx : 0);
  }

  // Per-card display: value string, up/down movement, and (when history exists)
  // a click handler that opens the analysis/history/chart popup.
  const fmtMoney = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
  function valueInfoFor(row: Record<string, any>): {
    valueDisplay: string | null; trend: Trend | null; onValueClick: () => void;
  } {
    const key = valueKeyForRow(row, year, brand);
    const hist = historyByKey[key];
    const hasHistory = !!hist && hist.length > 0;
    // The current value: prefer the owner-entered Value; fall back to the most
    // recent committed analysis so a number still shows when one exists.
    const typed = String(row['Value'] || '').trim();
    let valueDisplay: string | null = typed || null;
    let trend: Trend | null = null;
    if (hasHistory) {
      const chrono = hist.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (!valueDisplay) valueDisplay = fmtMoney(chrono[chrono.length - 1].market_value);
      trend = trendFromRows(chrono.map(h => ({ market_value: h.market_value, created_at: h.created_at })));
    }
    // The value is always editable from this (owner-only) view — clicking opens
    // the update popup, which itself offers "type a value", research, or history.
    return { valueDisplay, trend, onValueClick: () => setEditRowIdx(row.__rowIdx as number) };
  }

  // Roll-up of every displayed card's committed value + movement, feeding the
  // set-level stats panel (total value, overall move, winners & losers). One
  // entry per distinct card key so duplicate rows can't double-count.
  // Set-value roll-up is always over OWNED cards (independent of the All/Owned
  // display toggle): the collection's worth is what you hold. A card counts when
  // it has a current Value (typed or research) OR any recorded mark. `latest`
  // is the current Value field so the set total matches the visible per-card
  // values; movement still comes from the mark history.
  const setStats: CardValueStat[] = useMemo(() => {
    const seen = new Set<string>();
    const out: CardValueStat[] = [];
    for (const row of rows) {
      if (String(row['Owned'] || '') !== 'Yes') continue;
      const key = valueKeyForRow(row, year, brand);
      if (seen.has(key)) continue;
      const hist = historyByKey[key];
      const chrono = (hist || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      const typedVal = parseValue(row['Value']);
      const hasTyped = String(row['Value'] || '').trim() !== '' && typedVal > 0;
      const latest: number | null = hasTyped
        ? typedVal
        : (chrono.length ? chrono[chrono.length - 1].market_value : null);
      if (latest === null) continue; // nothing to value this card by
      seen.add(key);
      const trend = trendFromRows(chrono.map(h => ({ market_value: h.market_value, created_at: h.created_at })));
      const latestMarkAt = chrono.length ? chrono[chrono.length - 1].created_at : null;
      const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
      const player = String(row['Player'] || row['Description'] || '');
      const name = [cardNum, player].filter(Boolean).join(' ').trim() || 'Card';
      const gradingCo = String(row['Grading Company'] || '').trim();
      const grade = String(row['Grade'] || '').trim();
      const rawGrade = String(row['Raw Grade'] || '').trim();
      const conditionLabel = gradingCo
        ? `${gradingCo}${grade ? ' ' + grade : ''}`
        : (rawGrade ? `Raw ${rawGrade}` : 'Raw');
      out.push({
        key, name, conditionLabel, latest, trend, latestMarkAt,
        onClick: chrono.length ? () => setValueModalKey(key) : undefined,
      });
    }
    return out;
  }, [rows, historyByKey, year, brand]);

  // The card whose value popup is open (identity label + its history rows).
  const modalCard = useMemo(() => {
    if (!valueModalKey) return null;
    const hist = historyByKey[valueModalKey];
    if (!hist || hist.length === 0) return null;
    const row = displayed.find(r => valueKeyForRow(r, year, brand) === valueModalKey);
    const cardTitle = [
      year, brand,
      row?.['Card #'] ? `#${row['Card #']}` : '',
      row?.['Player'] || row?.['Description'] || '',
    ].filter(Boolean).join(' ').trim() || 'Card';
    const gradingCo = String(row?.['Grading Company'] || '').trim();
    const grade = String(row?.['Grade'] || '').trim();
    const rawGrade = String(row?.['Raw Grade'] || '').trim();
    const conditionLabel = gradingCo
      ? `${gradingCo}${grade ? ' ' + grade : ''}`
      : (rawGrade ? `Raw ${rawGrade}` : 'Raw');
    return { cardTitle, conditionLabel, history: hist };
  }, [valueModalKey, historyByKey, displayed, year, brand]);

  // The card whose value-update popup is open (by index into `rows`).
  const editCard = useMemo(() => {
    if (editRowIdx === null) return null;
    const row = rows[editRowIdx];
    if (!row) return null;
    const key = valueKeyForRow(row, year, brand);
    const hist = historyByKey[key];
    const hasHistory = !!hist && hist.length > 0;
    const typedVal = parseValue(row['Value']);
    const hasTyped = String(row['Value'] || '').trim() !== '' && typedVal > 0;
    const currentValue: number | null = hasTyped
      ? typedVal
      : (hasHistory ? hist.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))[hist.length - 1].market_value : null);
    const cardTitle = [
      year, brand,
      row['Card #'] ? `#${row['Card #']}` : '',
      row['Player'] || row['Description'] || '',
    ].filter(Boolean).join(' ').trim() || 'Card';
    const gradingCo = String(row['Grading Company'] || '').trim();
    const grade = String(row['Grade'] || '').trim();
    const rawGrade = String(row['Raw Grade'] || '').trim();
    const conditionLabel = gradingCo
      ? `${gradingCo}${grade ? ' ' + grade : ''}`
      : (rawGrade ? `Raw ${rawGrade}` : 'Raw');
    return {
      row, key, hasHistory, currentValue, cardTitle, conditionLabel,
      imageFront: String(row['Image 1'] || '') || null,
      imageBack: String(row['Image 2'] || '') || null,
    };
  }, [editRowIdx, rows, year, brand, historyByKey]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <SCLogo size={80} />
          <p className="eyebrow" style={{ marginTop: 20, color: 'var(--ink-mute)' }}>Loading inventory…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{
          maxWidth: 1400, margin: '0 auto', padding: '10px 28px',
          display: 'flex', alignItems: 'center', gap: 20,
        }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>

          <Link href={`/set/${encodeURIComponent(slug)}`} className="btn btn-outline btn-sm" style={{ flexShrink: 0 }}>
            ← Edit
          </Link>

          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button type="button" onClick={() => setListView((v) => !v)}
              className={`btn btn-sm ${listView ? 'btn-primary' : 'btn-ghost'}`}>
              {listView ? 'Grid' : 'List'}
            </button>
            <button type="button" onClick={() => setShowOwnedOnly((v) => !v)}
              className={`btn btn-sm ${showOwnedOnly ? 'btn-primary' : 'btn-ghost'}`}>
              {showOwnedOnly ? 'Owned Only' : 'All Cards'}
            </button>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 700 }}>
              {displayed.length} cards
            </span>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 28px 80px' }}>
        <div style={{ marginBottom: 20 }}>
          <SetHeaderBanner year={year} brand={brand} title={title} />
        </div>
        <SetValueStats stats={setStats} onSetBenchmark={setBenchmark} benchmarkBusy={benchmarkBusy} />
        {displayed.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No cards to display</div>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: 0 }}>
              {showOwnedOnly ? 'No owned cards yet.' : 'This set has no cards.'}
            </p>
          </div>
        ) : listView ? (
          <div className="panel-bordered" style={{ overflow: 'hidden', padding: 0 }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--plum)' }}>
                 {['Year · Brand', 'Card #', 'Player', 'Grading Co.', 'Grade', 'Sale Price', 'Value', 'Images'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left',
                      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      color: 'var(--mustard)', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ background: 'var(--cream)' }}>
                {displayed.map((row, i) => {
                  const vi = valueInfoFor(row);
                  return (
                    <CardTableRow key={i} row={row} year={year} brand={brand}
                      valueDisplay={vi.valueDisplay} trend={vi.trend} onValueClick={vi.onValueClick}
                      onImageClick={openLightbox} />
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {displayed.map((row, i) => {
              const vi = valueInfoFor(row);
              return (
                <CardTile key={i} row={row} year={year} brand={brand}
                  valueDisplay={vi.valueDisplay} trend={vi.trend} onValueClick={vi.onValueClick}
                  onImageClick={openLightbox} />
              );
            })}
          </div>
        )}
      </div>

      {lightboxIdx !== null && lightboxItems.length > 0 && (
        <ImageLightbox items={lightboxItems} startIdx={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}

      <ValueDetailModal
        open={!!modalCard}
        onClose={() => setValueModalKey(null)}
        cardTitle={modalCard?.cardTitle || ''}
        conditionLabel={modalCard?.conditionLabel || ''}
        history={modalCard?.history || []}
      />

      <ValueUpdateModal
        open={!!editCard}
        onClose={() => setEditRowIdx(null)}
        cardTitle={editCard?.cardTitle || ''}
        conditionLabel={editCard?.conditionLabel || ''}
        currentValue={editCard?.currentValue ?? null}
        imageFront={editCard?.imageFront}
        imageBack={editCard?.imageBack}
        hasHistory={!!editCard?.hasHistory}
        onSave={(value) => { if (editRowIdx !== null) persistRowValue(editRowIdx, value, true); }}
        onResearch={() => {
          if (editCard && editRowIdx !== null) {
            setResearchTarget({ rowIdx: editRowIdx, descriptor: descriptorForRow(editCard.row, year, brand, slug) });
          }
        }}
        onViewHistory={() => { if (editCard) setValueModalKey(editCard.key); }}
      />

      <MarketResearchModal
        open={!!researchTarget}
        onClose={() => { setResearchTarget(null); if (userId) loadHistory(userId); }}
        card={researchTarget?.descriptor || { year: null, brand: null, card_number: null, player: null, grade: null, grading_company: null, raw_grade: null }}
        onApply={(value) => {
          if (!researchTarget) return;
          // Research commits its own (research-kind) mark; just persist the Value.
          persistRowValue(researchTarget.rowIdx, value, false);
        }}
      />

      <footer style={{
        borderTop: '3px solid var(--plum)', padding: '24px 28px',
        maxWidth: 1400, margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: 'var(--plum)', fontSize: 11.5, letterSpacing: '0.12em',
        textTransform: 'uppercase', fontWeight: 700,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SCLogo size={32} />
          <div style={{ lineHeight: 0.9 }}>
            <div className="wordmark" style={{ fontSize: 16, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 10, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <span>Est. 2023</span>
          <span>Keep on collectin&apos;</span>
        </div>
      </footer>
    </div>
  );
}
