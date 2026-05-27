'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSellerStatus } from '@/lib/sellerGuard';
import SCLogo from '@/components/SCLogo';
import { RAW_GRADES as SHARED_RAW_GRADES } from '@/lib/listingTitle';
import { cropScanPadding } from '@/lib/scanAutoCrop';

type PairMode = 'fronts-only' | 'fronts-then-backs' | 'interleaved';
type ConditionType = 'raw' | 'graded';
type ShippingOption = { label: string; cost: number; additional_cost?: number; cap?: number | null };

const RAW_GRADES = SHARED_RAW_GRADES as readonly string[];
const COMPANIES = ['PSA', 'SGC', 'BGS', 'CGC', 'TAG'];
const NUMERIC_GRADES = Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ''));
const GRADE_LABELS: Record<string, string> = {
  '10': 'GEM MT', '9.5': 'GEM MT', '9': 'MINT',
  '8.5': 'NM-MT+', '8': 'NM-MT', '7.5': 'NM+', '7': 'NM',
  '6.5': 'EX-MT+', '6': 'EX-MT', '5.5': 'EX+', '5': 'EX',
  '4.5': 'VG-EX+', '4': 'VG-EX', '3.5': 'VG+', '3': 'VG',
  '2.5': 'GOOD+', '2': 'GOOD', '1.5': 'FAIR', '1': 'POOR',
};
const DEFAULT_SHIPPING_OPTIONS: ShippingOption[] = [
  { label: 'PWE (Plain White Envelope)', cost: 1.0 },
  { label: 'Bubble Mailer with Tracking', cost: 5.0 },
];

type Pair = {
  id: string;
  front: File | null;
  back: File | null;
};

type PairForm = {
  year: string;
  brand: string;
  card_number: string;
  player: string;
  condition_type: ConditionType;
  raw_grade: string;
  grading_company: string;
  grade: string;
  asking_price: string;
  cost: string;
  description: string;
  shipping_options: ShippingOption[];
};

type PairResult = { listingId: string; title: string };

function emptyForm(defaults: ShippingOption[]): PairForm {
  return {
    year: '', brand: '', card_number: '', player: '',
    condition_type: 'raw', raw_grade: '', grading_company: '', grade: '',
    asking_price: '', cost: '', description: '',
    shipping_options: defaults.length ? [...defaults] : [...DEFAULT_SHIPPING_OPTIONS],
  };
}

function buildTitle(d: PairForm): string {
  let condition = '';
  if (d.condition_type === 'graded' && d.grading_company && d.grade) {
    const label = GRADE_LABELS[String(d.grade)] || '';
    condition = label ? `${d.grading_company} ${d.grade} ${label}` : `${d.grading_company} ${d.grade}`;
  } else if (d.condition_type === 'raw' && d.raw_grade) {
    condition = d.raw_grade;
  }
  return [
    d.year, d.brand,
    d.card_number ? `#${d.card_number}` : '',
    d.player, condition,
  ].filter(Boolean).join(' ').trim();
}

export default function ScanInboxPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [defaultShipping, setDefaultShipping] = useState<ShippingOption[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<PairMode>('fronts-then-backs');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [pairForms, setPairForms] = useState<Record<number, PairForm>>({});
  const [pairResults, setPairResults] = useState<Record<number, PairResult>>({});
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      { const _ss = await getSellerStatus(supabase, user.id); if (!_ss.canSell) { router.replace('/marketplace'); return; } if (!_ss.termsAccepted) { router.replace('/seller-terms'); return; } }
      setUserId(user.id);
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('default_shipping')
        .eq('user_id', user.id)
        .maybeSingle();
      const dShip = (profile?.default_shipping as ShippingOption[] | null) || [];
      setDefaultShipping(dShip.length ? dShip : DEFAULT_SHIPPING_OPTIONS);
      setLoading(false);
    }
    load();
  }, [router]);

  const pairs: Pair[] = useMemo(() => {
    if (files.length === 0) return [];
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (mode === 'fronts-only') {
      return sorted.map((f, i) => ({ id: `p${i}`, front: f, back: null }));
    }
    if (mode === 'interleaved') {
      const out: Pair[] = [];
      for (let i = 0; i < sorted.length; i += 2) {
        out.push({ id: `p${i}`, front: sorted[i], back: sorted[i + 1] || null });
      }
      return out;
    }
    const half = Math.ceil(sorted.length / 2);
    const fronts = sorted.slice(0, half);
    const backs = sorted.slice(half).reverse();
    return fronts.map((f, i) => ({ id: `p${i}`, front: f, back: backs[i] || null }));
  }, [files, mode]);

  // Reset state when files / mode change.
  useEffect(() => {
    setCurrentIdx(0);
    setPairForms({});
    setPairResults({});
    setSkipped(new Set());
    setError('');
  }, [files, mode]);

  // Make sure the current pair always has a form initialized.
  useEffect(() => {
    if (pairs.length === 0) return;
    setPairForms(prev => prev[currentIdx] ? prev : { ...prev, [currentIdx]: emptyForm(defaultShipping) });
  }, [currentIdx, pairs.length, defaultShipping]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
    if (dropped.length > 0) setFiles(prev => [...prev, ...dropped]);
  }
  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
    if (picked.length > 0) setFiles(prev => [...prev, ...picked]);
    e.target.value = '';
  }

  const totalPairs = pairs.length;
  const currentPair = pairs[currentIdx];
  const currentForm = pairForms[currentIdx] || emptyForm(defaultShipping);
  const savedCount = Object.keys(pairResults).length;
  const skippedCount = skipped.size;

  function patchForm(patch: Partial<PairForm>) {
    setPairForms(prev => ({ ...prev, [currentIdx]: { ...(prev[currentIdx] || emptyForm(defaultShipping)), ...patch } }));
  }
  function patchShip(idx: number, val: Partial<ShippingOption>) {
    const ships = [...currentForm.shipping_options];
    ships[idx] = { ...ships[idx], ...val };
    patchForm({ shipping_options: ships });
  }
  function addShip() { patchForm({ shipping_options: [...currentForm.shipping_options, { label: '', cost: 0 }] }); }
  function removeShip(idx: number) {
    patchForm({ shipping_options: currentForm.shipping_options.filter((_, i) => i !== idx) });
  }

  function swapPair() {
    if (!currentPair) return;
    const newFiles = [...files];
    const fIdx = currentPair.front ? newFiles.indexOf(currentPair.front) : -1;
    const bIdx = currentPair.back ? newFiles.indexOf(currentPair.back) : -1;
    if (fIdx >= 0 && bIdx >= 0) {
      [newFiles[fIdx], newFiles[bIdx]] = [newFiles[bIdx], newFiles[fIdx]];
      setFiles(newFiles);
    }
  }

  function advance() {
    if (currentIdx < totalPairs - 1) setCurrentIdx(currentIdx + 1);
  }
  function goBack() {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  }
  function skipPair() {
    setSkipped(prev => { const next = new Set(prev); next.add(currentIdx); return next; });
    advance();
  }

  async function saveCurrent() {
    if (!currentPair || !userId) return;
    setError('');
    const f = currentForm;
    const yearNum = Number(f.year);
    if (!f.year || Number.isNaN(yearNum)) { setError('Year is required.'); return; }
    if (!f.brand.trim()) { setError('Brand is required.'); return; }
    if (!f.card_number.trim()) { setError('Card # is required.'); return; }
    if (!f.player.trim()) { setError('Player is required.'); return; }
    if (f.condition_type === 'graded' && (!f.grading_company || !f.grade)) {
      setError('Graded cards need grading company + grade.'); return;
    }
    if (f.condition_type === 'raw' && !f.raw_grade) {
      setError('Raw cards need a raw grade.'); return;
    }

    setSaving(true);
    const supabase = createClient();
    const payload = {
      user_id: userId,
      title: buildTitle(f) || 'Untitled card',
      year: yearNum,
      brand: f.brand.trim(),
      card_number: f.card_number.trim(),
      player: f.player.trim(),
      condition_type: f.condition_type,
      raw_grade: f.condition_type === 'raw' ? f.raw_grade : null,
      grading_company: f.condition_type === 'graded' ? f.grading_company : null,
      grade: f.condition_type === 'graded' ? f.grade : null,
      asking_price: f.asking_price === '' ? null : Number(f.asking_price) || null,
      cost: f.cost === '' ? null : Number(f.cost) || null,
      description: f.description.trim() || null,
      shipping_options: f.shipping_options,
      photos: [] as string[],
      status: 'draft',
    };
    const { data: ins, error: insErr } = await supabase.from('listings').insert(payload).select('id, title').single();
    if (insErr || !ins) { setError(insErr?.message || 'Insert failed'); setSaving(false); return; }

    // Upload photos and update the listing.
    const ts = Date.now();
    const photoUrls: string[] = [];
    try {
      async function up(file: File, suffix: string) {
        const trimmed = await cropScanPadding(file);
        const ext = (trimmed.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${userId}/listings/${ins!.id}/${ts}-${suffix}.${ext}`;
        const { error: upErr } = await supabase.storage.from('card-images').upload(path, trimmed);
        if (upErr) throw new Error(upErr.message);
        const { data } = supabase.storage.from('card-images').getPublicUrl(path);
        return data.publicUrl;
      }
      if (currentPair.front) photoUrls.push(await up(currentPair.front, 'front'));
      if (currentPair.back) photoUrls.push(await up(currentPair.back, 'back'));
      if (photoUrls.length > 0) {
        await supabase.from('listings').update({ photos: photoUrls }).eq('id', ins.id);
      }
    } catch (e) {
      setError('Listing was created but photo upload failed: ' + (e instanceof Error ? e.message : ''));
    }
    setPairResults(prev => ({ ...prev, [currentIdx]: { listingId: ins.id, title: ins.title } }));
    setSkipped(prev => { const next = new Set(prev); next.delete(currentIdx); return next; });
    setSaving(false);
    advance();
  }

  function clearAll() {
    setFiles([]);
    setPairForms({});
    setPairResults({});
    setSkipped(new Set());
    setCurrentIdx(0);
    setError('');
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Scan Inbox ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/listings/scan-from-set" className="btn btn-ghost btn-sm">↔ From Set</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Drop a folder of card scans (JPG / PNG). Pick the matching <strong>Pair Mode</strong> below.</li>
            <li>For each pair (or single front), fill in the listing form and click <strong>Save & Next</strong>.</li>
            <li>Each save creates a <strong>draft listing</strong> with the scanned photos already attached. You can polish in My Listings later.</li>
          </ol>
        </section>

        {/* Step 1: Pair Mode */}
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>1. Pair Mode</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              ['fronts-then-backs', 'Fronts then Backs (recommended)'],
              ['interleaved', 'Interleaved (F/B/F/B)'],
              ['fronts-only', 'Fronts only'],
            ] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>
            {mode === 'fronts-then-backs' && 'Files 1..N/2 are fronts; files N/2+1..N are backs (in reverse order from the flip).'}
            {mode === 'interleaved' && 'Files alternate: front, back, front, back...'}
            {mode === 'fronts-only' && 'Each file is a single card with no back.'}
          </div>
        </section>

        {/* Step 2: Drop scans */}
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>2. Drop Scans</div>
          <div ref={dropRef}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? 'var(--orange)' : 'var(--plum)'}`,
              borderRadius: 12, padding: '30px 20px', textAlign: 'center',
              background: dragOver ? 'rgba(232,116,44,0.08)' : 'var(--paper)',
              transition: 'border-color 120ms, background 120ms',
            }}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>📥</div>
            <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 4 }}>Drag & drop scan files here</div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-soft)' }}>
              JPG or PNG, sorted by filename. {files.length > 0 && <strong>{files.length} file{files.length === 1 ? '' : 's'} loaded ({totalPairs} pair{totalPairs === 1 ? '' : 's'}).</strong>}
            </p>
            <label style={{ display: 'inline-block' }}>
              <input type="file" multiple accept="image/*" onChange={handleFiles} style={{ display: 'none' }} />
              <span className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>Choose Files</span>
            </label>
            {files.length > 0 && (
              <button onClick={clearAll} className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}>↺ Clear all</button>
            )}
          </div>
        </section>

        {/* Step 3: Per-pair form */}
        {totalPairs > 0 && currentPair && (
          <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', flex: 1 }}>
                Pair {currentIdx + 1} of {totalPairs}
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                {savedCount} saved · {skippedCount} skipped · {totalPairs - savedCount - skippedCount} remaining
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--rule)', borderRadius: 2, marginBottom: 18, overflow: 'hidden' }}>
              <div style={{ width: `${((savedCount + skippedCount) / totalPairs) * 100}%`, height: '100%', background: 'var(--orange)', transition: 'width 200ms' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 24, alignItems: 'flex-start' }}>
              {/* LEFT — images */}
              <div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 10 }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 }}>Front</div>
                    {currentPair.front ? (
                      <img loading="lazy" decoding="async" src={URL.createObjectURL(currentPair.front)} alt="Front"
                        style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8, border: '2px solid var(--plum)', background: 'var(--cream)' }} />
                    ) : (
                      <div style={{ height: 200, background: 'var(--paper)', border: '2px dashed var(--rule)', borderRadius: 8 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 }}>Back</div>
                    {currentPair.back ? (
                      <img loading="lazy" decoding="async" src={URL.createObjectURL(currentPair.back)} alt="Back"
                        style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8, border: '2px solid var(--plum)', background: 'var(--cream)' }} />
                    ) : (
                      <div style={{ height: 200, background: 'var(--paper)', border: '2px dashed var(--rule)', borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--ink-mute)', fontSize: 11 }}>No back</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  {currentPair.front && currentPair.back && (
                    <button type="button" onClick={swapPair} className="btn btn-ghost btn-sm">↔ Swap front/back</button>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 8, textAlign: 'center' }}>
                  {currentPair.front?.name}
                  {currentPair.back && <><br />{currentPair.back.name}</>}
                </div>
              </div>

              {/* RIGHT — listing form */}
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <Field label="Year *">
                    <input type="number" value={currentForm.year} onChange={e => patchForm({ year: e.target.value })} className="input-sc" />
                  </Field>
                  <Field label="Brand *">
                    <input value={currentForm.brand} onChange={e => patchForm({ brand: e.target.value })} className="input-sc" placeholder="Topps" />
                  </Field>
                  <Field label="Card # *">
                    <input value={currentForm.card_number} onChange={e => patchForm({ card_number: e.target.value })} className="input-sc" />
                  </Field>
                </div>
                <Field label="Player *">
                  <input value={currentForm.player} onChange={e => patchForm({ player: e.target.value })} className="input-sc" placeholder="Mickey Mantle" />
                </Field>
                <p className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', margin: '4px 0 12px' }}>
                  Title preview: <strong>{buildTitle(currentForm) || '—'}</strong>
                </p>

                <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>Condition Type *</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  <button type="button" onClick={() => patchForm({ condition_type: 'raw' })}
                    className={`btn btn-sm ${currentForm.condition_type === 'raw' ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }}>Raw</button>
                  <button type="button" onClick={() => patchForm({ condition_type: 'graded' })}
                    className={`btn btn-sm ${currentForm.condition_type === 'graded' ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }}>Graded</button>
                </div>

                {currentForm.condition_type === 'raw' ? (
                  <Field label="Raw Grade *">
                    <select value={currentForm.raw_grade} onChange={e => patchForm({ raw_grade: e.target.value })} className="input-sc">
                      <option value="">— Select —</option>
                      {RAW_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </Field>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Grading Company *">
                      <select value={currentForm.grading_company} onChange={e => patchForm({ grading_company: e.target.value })} className="input-sc">
                        <option value="">— Select —</option>
                        {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="Grade *">
                      <select value={currentForm.grade} onChange={e => patchForm({ grade: e.target.value })} className="input-sc">
                        <option value="">— Select —</option>
                        {NUMERIC_GRADES.map(g => <option key={g} value={g}>{g}{GRADE_LABELS[g] ? ` · ${GRADE_LABELS[g]}` : ''}</option>)}
                      </select>
                    </Field>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <Field label="Asking Price ($)">
                    <input type="number" step="0.01" value={currentForm.asking_price} onChange={e => patchForm({ asking_price: e.target.value })} className="input-sc" placeholder="0.00" />
                  </Field>
                  <Field label="Cost ($) — private">
                    <input type="number" step="0.01" value={currentForm.cost} onChange={e => patchForm({ cost: e.target.value })} className="input-sc" placeholder="0.00" />
                  </Field>
                </div>

                <Field label="Description (optional)">
                  <textarea value={currentForm.description} onChange={e => patchForm({ description: e.target.value })}
                    rows={2} className="input-sc" style={{ resize: 'vertical' }}
                    placeholder="Additional details — centering, surface, any flaws…" />
                </Field>

                <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700, margin: '14px 0 6px' }}>Shipping Options</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {currentForm.shipping_options.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input value={s.label} onChange={e => patchShip(i, { label: e.target.value })}
                        placeholder="PWE / Bubble Mailer / etc." className="input-sc" style={{ flex: 1 }} />
                      <span style={{ fontWeight: 700, color: 'var(--ink-mute)' }}>$</span>
                      <input type="number" step="0.01" value={s.cost}
                        onChange={e => patchShip(i, { cost: Number(e.target.value) || 0 })}
                        className="input-sc" style={{ width: 80 }} />
                      <button onClick={() => removeShip(i)} className="btn btn-ghost btn-sm">✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={addShip} className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }}>+ Add option</button>
                </div>

                {error && (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(192,57,43,0.12)', border: '1.5px solid var(--rust)', borderRadius: 8, color: 'var(--rust)', fontSize: 12.5, fontWeight: 600 }}>
                    {error}
                  </div>
                )}

                {pairResults[currentIdx] && (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(45,122,110,0.10)', border: '1.5px solid var(--teal)', borderRadius: 8, color: 'var(--teal)', fontSize: 12.5, fontWeight: 600 }}>
                    ✓ Saved — listing &quot;{pairResults[currentIdx].title}&quot; created.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap' }}>
                  <button onClick={goBack} disabled={currentIdx === 0} className="btn btn-ghost btn-sm">◀ Prev</button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={skipPair} className="btn btn-outline btn-sm">Skip ▶</button>
                    <button onClick={saveCurrent} disabled={saving} className="btn btn-primary">
                      {saving ? 'Saving…' : pairResults[currentIdx] ? '✓ Re-save & Next' : '💾 Save & Next →'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Done summary */}
        {totalPairs > 0 && savedCount > 0 && (
          <section className="panel-bordered" style={{ padding: '14px 18px', background: 'var(--paper)' }}>
            <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ Created drafts ★</div>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
              {Object.entries(pairResults).map(([k, v]) => (
                <li key={k}>
                  Pair #{Number(k) + 1}: <Link href={`/listings`} style={{ color: 'var(--orange)', fontWeight: 600 }}>{v.title}</Link>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 10 }}>
              <Link href="/listings" className="btn btn-primary btn-sm">Go to My Listings →</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}
