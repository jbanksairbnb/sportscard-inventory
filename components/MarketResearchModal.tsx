'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Sources we offer in the dropdown. 'other' lets the user free-form a label.
export const RESEARCH_SOURCES = [
  { value: 'ebay_sold_auction', label: 'eBay Sold Auctions' },
  { value: 'ebay_sold_bin', label: 'eBay Sold Buy-It-Now' },
  { value: 'vcp', label: 'VCP' },
  { value: 'card_ladder', label: 'Card Ladder' },
  { value: 'beckett', label: 'Beckett' },
  { value: 'other', label: 'Other (custom)' },
] as const;
type SourceValue = (typeof RESEARCH_SOURCES)[number]['value'];

// Grading company + grade are tracked as two fields so the future pricing
// model can group cleanly (e.g. all "PSA 8" comps from anywhere).
const GRADING_COMPANIES = ['Raw', 'PSA', 'SGC', 'BGS', 'CSG', 'Other'] as const;
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
  // Photos of *this specific card* — surfaced in the modal so the user can
  // eyeball centering / corners / surface while weighting comps.
  image_urls?: string[];
  // Optional FK / breadcrumbs back to the source record.
  listing_id?: string | null;
  set_slug?: string | null;
  set_card_number?: string | null;
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
  const sorted = dps.slice().sort((a, b) => a.position - b.position);
  const rows: Row[] = sorted.map(d => {
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
      position: d.position,
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

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function sourceDisplay(s: SourceValue, label: string | null): string {
  if (s === 'other') return label?.trim() || 'Other';
  const found = RESEARCH_SOURCES.find(x => x.value === s);
  return found?.label || s;
}

const INSTRUCTIONS = `Use this to set a market value for your card based on recent comps. Pull from whichever sources you trust — eBay sold listings, VCP, Card Ladder, Beckett, your own gut — and weight each row by how comparable it is to your card (centering, corners, eye appeal). Weights must add to 100% but you don't need multiple rows; if you love VCP, put one row at 100% and you're done. Every entry is saved so you can revisit your research later.`;

export default function MarketResearchModal({ open, onClose, card, onApply }: Props) {
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaveTick, setAutoSaveTick] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const cardDefaults = useMemo(() => defaultsFor(card), [card]);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, (_, i) => emptyRow(i, defaultsFor(card))));
  const [notes, setNotes] = useState('');
  const [latestSession, setLatestSession] = useState<{ session: SessionRow; data_points: DataPointRow[] } | null>(null);
  const [history, setHistory] = useState<{ session: SessionRow; data_points: DataPointRow[] }[]>([]);
  const [community, setCommunity] = useState<CommunitySession[]>([]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      // Build a card-identity match. We require year + card_number for grouping
      // sessions by card (so a 1965 Topps #150 rows separately from a 1953 #150).
      let q = supabase.from('market_research_sessions')
        .select('*, market_research_data_points(*)')
        .order('updated_at', { ascending: false });
      if (card.year !== null) q = q.eq('card_year', card.year); else q = q.is('card_year', null);
      if (card.card_number) q = q.eq('card_number', card.card_number); else q = q.is('card_number', null);
      if (card.brand) q = q.eq('card_brand', card.brand);
      if (card.grade) q = q.eq('card_grade', card.grade);
      if (card.grading_company) q = q.eq('card_grading_company', card.grading_company);
      if (card.raw_grade) q = q.eq('card_raw_grade', card.raw_grade);
      const { data: matches, error } = await q;
      if (error) console.warn('[research] load error:', error.message);
      type SessionWithDP = SessionRow & { market_research_data_points: DataPointRow[] };
      const all = ((matches || []) as unknown as SessionWithDP[]);
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
      setSessionId(null);
      setRows(Array.from({ length: 5 }, (_, i) => emptyRow(i, cardDefaults)));
      setNotes('');
      setAutoSaveTick('idle');
      if (own.length > 0) {
        setLatestSession({ session: own[0], data_points: own[0].market_research_data_points || [] });
        // History shows every past session (including the latest), so the user
        // always has a full archive view. The banner up top is just a shortcut
        // to load the most recent.
        setHistory(own.map(s => ({ session: s, data_points: s.market_research_data_points || [] })));
      } else {
        setLatestSession(null);
        setHistory([]);
      }

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

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addRow() {
    setRows(prev => [...prev, emptyRow(prev.length, cardDefaults)]);
  }
  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, position: i })));
  }
  function loadFromCommunity(s: CommunitySession) {
    setRows(rowsFromDataPoints(s.data_points, cardDefaults));
    setNotes(prev => prev || `(Started from another collector's research from ${new Date(s.created_at).toLocaleDateString()})`);
    setSessionId(null); // Treat as new session for the current user
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
    let activeSessionId = sessionId;
    if (sessionId) {
      const { error } = await supabase.from('market_research_sessions').update(payload).eq('id', sessionId);
      if (error) { if (!opts.silent) alert('Could not save: ' + error.message); return false; }
      await supabase.from('market_research_data_points').delete().eq('session_id', sessionId);
    } else {
      const { data, error } = await supabase.from('market_research_sessions').insert(payload).select('id').single();
      if (error || !data) { if (!opts.silent) alert('Could not save: ' + error?.message); return false; }
      activeSessionId = data.id as string;
      setSessionId(activeSessionId);
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

  async function save() {
    if (!totals.weightOk) {
      alert('Weights must total 100% with at least one row that has a price filled in.');
      return;
    }
    setSaving(true);
    await persistSession();
    setSaving(false);
  }

  async function saveAndApply() {
    if (!totals.weightOk) {
      alert('Weights must total 100% with at least one row that has a price filled in.');
      return;
    }
    setSaving(true);
    const ok = await persistSession();
    setSaving(false);
    if (!ok) return;
    if (onApply) onApply(totals.marketValue);
    onClose();
  }

  function loadFromLatest() {
    if (!latestSession) return;
    setRows(rowsFromDataPoints(latestSession.data_points, cardDefaults));
    setNotes(latestSession.session.notes || '');
    setSessionId(latestSession.session.id);
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
      const ok = await persistSession({ silent: true });
      setAutoSaveTick(ok ? 'saved' : 'idle');
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, notes, open, loading]);

  // Photos lightbox — hooked into the card's image_urls so the user can
  // eyeball corners / centering / surface while weighting comps.
  const photoUrls = (card.image_urls || []).filter((u): u is string => !!u && typeof u === 'string');
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);
  useEffect(() => {
    if (photoIdx === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPhotoIdx(null);
      else if (e.key === 'ArrowLeft') setPhotoIdx(i => (i === null ? null : (i - 1 + photoUrls.length) % photoUrls.length));
      else if (e.key === 'ArrowRight') setPhotoIdx(i => (i === null ? null : (i + 1) % photoUrls.length));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoIdx, photoUrls.length]);

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
          </div>
          {photoUrls.length > 0 && (
            <button type="button" onClick={() => setPhotoIdx(0)}
              title="View photos of this card"
              className="btn btn-ghost btn-sm">
              📷 View photos {photoUrls.length > 1 ? `(${photoUrls.length})` : ''}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        {photoIdx !== null && photoUrls.length > 0 && (
          <div onClick={() => setPhotoIdx(null)} style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(42,20,52,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
              <img src={photoUrls[photoIdx]} alt="Card photo"
                style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10, display: 'block' }} />
              {photoUrls.length > 1 && (
                <>
                  <button type="button" onClick={() => setPhotoIdx(i => i === null ? null : (i - 1 + photoUrls.length) % photoUrls.length)}
                    title="Previous (←)" style={lightboxArrow('left')}>‹</button>
                  <button type="button" onClick={() => setPhotoIdx(i => i === null ? null : (i + 1) % photoUrls.length)}
                    title="Next (→)" style={lightboxArrow('right')}>›</button>
                  <div className="mono" style={{
                    position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                    padding: '4px 10px', borderRadius: 6, background: 'rgba(248,236,208,0.96)',
                    color: 'var(--plum)', fontSize: 11, fontWeight: 700,
                  }}>
                    {photoIdx + 1} / {photoUrls.length}
                  </div>
                </>
              )}
              <button type="button" onClick={() => setPhotoIdx(null)} className="btn btn-sm"
                style={{ position: 'absolute', top: 4, right: 4 }}>
                ✕ Close
              </button>
            </div>
          </div>
        )}

        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 12px' }}>{INSTRUCTIONS}</p>
        {latestSession && !sessionId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              You analyzed this card on <strong>{new Date(latestSession.session.created_at).toLocaleDateString()}</strong>
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
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                Need at least one priced row. Save unlocks at total = 100%.
              </span>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="input-label">Notes (private — only you see these)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Anything you want to remember about this analysis…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--plum)', borderRadius: 6, background: 'var(--paper)', color: 'var(--plum)', fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 22 }}>
              <button type="button" onClick={save} disabled={saving || !totals.weightOk}
                className="btn btn-ghost btn-sm">{saving ? 'Saving…' : '💾 Save research'}</button>
              <button type="button" onClick={saveAndApply} disabled={saving || !totals.weightOk || !onApply}
                className="btn btn-primary btn-sm">
                {saving ? 'Saving…' : `→ Use ${totals.weightOk ? fmtMoney(totals.marketValue) : 'value'}`}
              </button>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                {autoSaveTick === 'pending' && '· autosave pending…'}
                {autoSaveTick === 'saving' && '· autosaving…'}
                {autoSaveTick === 'saved' && '· autosaved ✓'}
              </span>
            </div>

            {/* Past research on this card (you only) */}
            {history.length > 0 && (
              <section style={{ marginBottom: 18 }}>
                <div className="display" style={{ fontSize: 14, color: 'var(--plum)', marginBottom: 8 }}>Your past research on this card</div>
                <PastList items={history.map(h => ({
                  date: h.session.created_at,
                  marketValue: h.session.market_value,
                  rows: h.data_points,
                  notes: h.session.notes,
                  applyButton: { label: 'Use this analysis', onClick: () => {
                    setRows(rowsFromDataPoints(h.data_points, cardDefaults));
                    setNotes(h.session.notes || '');
                    setSessionId(h.session.id);
                    setAutoSaveTick('idle');
                  } },
                }))} showNotes />
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

function lightboxArrow(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', top: '50%', [side]: -52, transform: 'translateY(-50%)',
    background: 'rgba(248,236,208,0.92)', color: '#3D1F4A',
    border: 0, borderRadius: 8, padding: '8px 16px', fontSize: 26,
    cursor: 'pointer', lineHeight: 1, fontWeight: 700,
  } as React.CSSProperties;
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
              {it.rows.slice().sort((a, b) => a.position - b.position).map(d => {
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
