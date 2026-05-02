'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type CardRow = Record<string, unknown>;

type SetSummary = {
  user_id: string;
  slug: string;
  title: string | null;
  year: number | null;
  brand: string | null;
  row_count: number | null;
};

type FullSet = SetSummary & {
  rows: CardRow[];
};

type PairMode = 'fronts-then-backs' | 'interleaved';

type Phase = 'pick-set' | 'pick-cards' | 'scanning' | 'review';

type ScanPair = { front: File | null; back: File | null };

function rowLabel(r: CardRow): string {
  const num = r['Card #'];
  const player = r['Player'];
  return [num ? `#${num}` : '', player || ''].filter(Boolean).join(' ').trim() || '(unnamed card)';
}

function rowHasImages(r: CardRow): boolean {
  return !!(String(r['Image 1'] || '').trim() || String(r['Image 2'] || '').trim());
}

export default function ScanFromSetPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');

  const [sets, setSets] = useState<SetSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [currentSet, setCurrentSet] = useState<FullSet | null>(null);

  const [phase, setPhase] = useState<Phase>('pick-set');
  const [pickQuery, setPickQuery] = useState('');
  const [hideOwnedWithImages, setHideOwnedWithImages] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<number[]>([]); // origIndex order
  const [pairMode, setPairMode] = useState<PairMode>('fronts-then-backs');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [destinations, setDestinations] = useState<Record<number, { setRow: boolean; listing: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data } = await supabase.from('sets')
        .select('user_id, slug, title, year, brand, row_count')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      setSets((data || []) as SetSummary[]);
      setLoading(false);
    }
    load();
  }, [router]);

  async function pickSet(slug: string) {
    setError('');
    setSelectedSlug(slug);
    const supabase = createClient();
    const { data, error: err } = await supabase.from('sets')
      .select('user_id, slug, title, year, brand, row_count, rows')
      .eq('user_id', userId)
      .eq('slug', slug)
      .single();
    if (err || !data) { setError('Failed to load set: ' + (err?.message || 'not found')); return; }
    setCurrentSet(data as FullSet);
    setSelectedOrder([]);
    setPhase('pick-cards');
  }

  function toggleCard(origIndex: number) {
    setSelectedOrder(prev => {
      if (prev.includes(origIndex)) return prev.filter(i => i !== origIndex);
      return [...prev, origIndex];
    });
  }
  function moveCard(idx: number, dir: -1 | 1) {
    setSelectedOrder(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function removeFromOrder(idx: number) {
    setSelectedOrder(prev => prev.filter((_, i) => i !== idx));
  }

  function startScanning() {
    if (selectedOrder.length === 0) return;
    setFiles([]);
    setDestinations(Object.fromEntries(selectedOrder.map(i => [i, { setRow: true, listing: false }])));
    setPhase('scanning');
  }

  const expectedFileCount = selectedOrder.length * 2; // front+back per card

  const sortedFiles = useMemo(() =>
    [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [files]);

  const pairs: ScanPair[] = useMemo(() => {
    if (sortedFiles.length === 0) return selectedOrder.map(() => ({ front: null, back: null }));
    if (pairMode === 'interleaved') {
      const out: ScanPair[] = [];
      for (let i = 0; i < selectedOrder.length; i++) {
        out.push({ front: sortedFiles[i * 2] || null, back: sortedFiles[i * 2 + 1] || null });
      }
      return out;
    }
    // fronts-then-backs: first half = fronts, second half = backs (reversed because of flip)
    const half = Math.ceil(sortedFiles.length / 2);
    const fronts = sortedFiles.slice(0, half);
    const backs = sortedFiles.slice(half).reverse();
    return selectedOrder.map((_, i) => ({ front: fronts[i] || null, back: backs[i] || null }));
  }, [sortedFiles, pairMode, selectedOrder]);

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
  function swapPair(idx: number) {
    setFiles(prev => {
      const sorted = [...prev].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const p = pairs[idx];
      if (!p?.front || !p?.back) return prev;
      const fIdx = sorted.indexOf(p.front);
      const bIdx = sorted.indexOf(p.back);
      if (fIdx >= 0 && bIdx >= 0) [sorted[fIdx], sorted[bIdx]] = [sorted[bIdx], sorted[fIdx]];
      return sorted;
    });
  }

  function setDest(origIndex: number, key: 'setRow' | 'listing', val: boolean) {
    setDestinations(prev => ({ ...prev, [origIndex]: { ...(prev[origIndex] || { setRow: true, listing: false }), [key]: val } }));
  }

  async function saveAll() {
    if (!currentSet || !userId) return;
    setError('');
    if (files.length < expectedFileCount) {
      setError(`Expected ${expectedFileCount} scan files (front+back × ${selectedOrder.length}), got ${files.length}.`);
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const ts = Date.now();

    try {
      const updatedRows = [...currentSet.rows];
      let setRowsTouched = 0;
      let listingsCreated = 0;

      for (let i = 0; i < selectedOrder.length; i++) {
        const origIndex = selectedOrder[i];
        const pair = pairs[i];
        const dest = destinations[origIndex] || { setRow: true, listing: false };
        if (!pair.front && !pair.back) continue;

        const uploads: { url: string; slot: 1 | 2 }[] = [];
        if (pair.front) {
          const ext = (pair.front.name.split('.').pop() || 'jpg').toLowerCase();
          const path = `${userId}/${currentSet.slug}/${origIndex}/img1.${ext}`;
          const { error: upErr } = await supabase.storage.from('card-images').upload(path, pair.front, { upsert: true });
          if (upErr) throw new Error(`Front upload failed (#${origIndex}): ${upErr.message}`);
          const { data } = supabase.storage.from('card-images').getPublicUrl(path);
          uploads.push({ url: `${data.publicUrl}?t=${ts}`, slot: 1 });
        }
        if (pair.back) {
          const ext = (pair.back.name.split('.').pop() || 'jpg').toLowerCase();
          const path = `${userId}/${currentSet.slug}/${origIndex}/img2.${ext}`;
          const { error: upErr } = await supabase.storage.from('card-images').upload(path, pair.back, { upsert: true });
          if (upErr) throw new Error(`Back upload failed (#${origIndex}): ${upErr.message}`);
          const { data } = supabase.storage.from('card-images').getPublicUrl(path);
          uploads.push({ url: `${data.publicUrl}?t=${ts}`, slot: 2 });
        }

        if (dest.setRow) {
          const row = { ...updatedRows[origIndex] };
          for (const u of uploads) {
            row[u.slot === 1 ? 'Image 1' : 'Image 2'] = u.url;
          }
          // Mark Owned if not set
          if (!row['Owned']) row['Owned'] = 'Yes';
          updatedRows[origIndex] = row;
          setRowsTouched++;
        }

        if (dest.listing) {
          const row = currentSet.rows[origIndex];
          const titleParts = [
            currentSet.year ? String(currentSet.year) : '',
            currentSet.brand || '',
            row['Card #'] ? `#${row['Card #']}` : '',
            row['Player'] || '',
          ].filter(Boolean);
          const photos = uploads.map(u => u.url);
          const { error: insErr } = await supabase.from('listings').insert({
            user_id: userId,
            title: titleParts.join(' ').trim() || 'Untitled card',
            year: currentSet.year,
            brand: currentSet.brand,
            card_number: row['Card #'] ? String(row['Card #']) : null,
            player: row['Player'] ? String(row['Player']) : null,
            photos,
            status: 'draft',
          });
          if (insErr) throw new Error(`Listing insert failed (#${origIndex}): ${insErr.message}`);
          listingsCreated++;
        }
      }

      if (setRowsTouched > 0) {
        const { error: updErr } = await supabase.from('sets').update({
          rows: updatedRows,
          updated_at: Date.now(),
        }).eq('user_id', userId).eq('slug', currentSet.slug);
        if (updErr) throw new Error(`Set update failed: ${updErr.message}`);
      }

      const parts: string[] = [];
      if (setRowsTouched) parts.push(`${setRowsTouched} card${setRowsTouched === 1 ? '' : 's'} updated in set`);
      if (listingsCreated) parts.push(`${listingsCreated} listing${listingsCreated === 1 ? '' : 's'} created`);
      setSavedSummary(parts.join(' · ') || 'No changes');
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    setCurrentSet(null);
    setSelectedSlug('');
    setSelectedOrder([]);
    setFiles([]);
    setDestinations({});
    setSavedSummary('');
    setError('');
    setPhase('pick-set');
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  const filteredSets = sets.filter(s => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = [s.title, s.brand, s.year ? String(s.year) : ''].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });

  const visibleRows = (currentSet?.rows || [])
    .map((r, origIndex) => ({ row: r, origIndex }))
    .filter(({ row }) => !hideOwnedWithImages || !rowHasImages(row));

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Scan from Set ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/listings/scan-inbox" className="btn btn-ghost btn-sm">↔ Loose pairs</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Pick a set (e.g. 1971 Topps Baseball).</li>
            <li>Click each card row in the order you&apos;ll scan them — your selection list locks the order.</li>
            <li>Scan that exact stack on the Ricoh fi-8170 (fronts then backs, or duplex/interleaved).</li>
            <li>Drop the JPGs. The app pairs them positionally to your selected cards.</li>
            <li>Per row, choose: 📚 Replace in set · 🏷️ Also create a draft listing. Save All.</li>
          </ol>
        </section>

        {error && (
          <div style={{ padding: '10px 14px', background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)', borderRadius: 8, fontSize: 13, color: 'var(--rust)', fontWeight: 600, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* PHASE: pick-set */}
        {phase === 'pick-set' && (
          <section className="panel-bordered" style={{ padding: '20px 24px' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>1. Pick a set</div>
            <input value={pickQuery} onChange={e => setPickQuery(e.target.value)}
              placeholder="Filter by title, brand, year…"
              className="input-sc" style={{ width: '100%', maxWidth: 420, marginBottom: 14, fontSize: 14 }} />
            {sets.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                You don&apos;t have any sets yet. <Link href="/set/new" style={{ color: 'var(--teal)', fontWeight: 700 }}>Create one →</Link>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {filteredSets.map(s => (
                  <button key={s.slug} onClick={() => pickSet(s.slug)}
                    style={{
                      textAlign: 'left', padding: '12px 14px',
                      background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8,
                      cursor: 'pointer', transition: 'border-color 0.15s ease',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--orange)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--rule)')}>
                    <div className="display" style={{ fontSize: 15, color: 'var(--plum)', marginBottom: 2 }}>
                      {s.title || s.slug}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                      {s.year || '—'} · {s.brand || '—'} · {s.row_count || 0} cards
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* PHASE: pick-cards */}
        {phase === 'pick-cards' && currentSet && (
          <>
            <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>{currentSet.title || currentSet.slug}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                {currentSet.year || '—'} · {currentSet.brand || '—'} · {currentSet.rows.length} cards
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={startOver} className="btn btn-ghost btn-sm">← Pick a different set</button>
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14, alignItems: 'start' }}>
              <section className="panel-bordered" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>2. Click cards in scan order</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}>
                    <input type="checkbox" checked={hideOwnedWithImages} onChange={e => setHideOwnedWithImages(e.target.checked)} />
                    Hide cards that already have images
                  </label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 540, overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 6 }}>
                  {visibleRows.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                      All cards in this set already have images. Uncheck the filter to include them.
                    </div>
                  ) : visibleRows.map(({ row, origIndex }) => {
                    const orderIdx = selectedOrder.indexOf(origIndex);
                    const isSelected = orderIdx >= 0;
                    return (
                      <button key={origIndex} onClick={() => toggleCard(origIndex)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                          background: isSelected ? 'rgba(184,146,58,0.18)' : 'transparent',
                          border: 'none', textAlign: 'left', cursor: 'pointer',
                          borderBottom: '1px solid var(--rule)',
                        }}>
                        {isSelected ? (
                          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 12, background: 'var(--orange)', color: 'var(--cream)', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{orderIdx + 1}</span>
                        ) : (
                          <span style={{ display: 'inline-block', width: 24, height: 24, borderRadius: 12, border: '1.5px dashed var(--rule)', flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, fontSize: 13, color: 'var(--plum)', fontWeight: 600 }}>
                          {rowLabel(row)}
                        </div>
                        {rowHasImages(row) && <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-mute)' }}>has photos</span>}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="panel-bordered" style={{ padding: '16px 20px', position: 'sticky', top: 80 }}>
                <div className="display" style={{ fontSize: 15, color: 'var(--plum)', marginBottom: 8 }}>
                  Scan order ({selectedOrder.length})
                </div>
                {selectedOrder.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 12, fontStyle: 'italic' }}>
                    Click cards on the left to add them.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
                    {selectedOrder.map((origIndex, i) => {
                      const row = currentSet.rows[origIndex];
                      return (
                        <div key={origIndex} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: 'var(--paper)', borderRadius: 4, fontSize: 12 }}>
                          <span className="mono" style={{ minWidth: 22, color: 'var(--orange)', fontWeight: 700 }}>{i + 1}</span>
                          <span style={{ flex: 1, color: 'var(--plum)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rowLabel(row)}
                          </span>
                          <button onClick={() => moveCard(i, -1)} disabled={i === 0}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--plum)', fontWeight: 700, padding: '0 4px', opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                          <button onClick={() => moveCard(i, 1)} disabled={i === selectedOrder.length - 1}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--plum)', fontWeight: 700, padding: '0 4px', opacity: i === selectedOrder.length - 1 ? 0.3 : 1 }}>↓</button>
                          <button onClick={() => removeFromOrder(i)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rust)', fontWeight: 700, padding: '0 4px' }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button onClick={startScanning} disabled={selectedOrder.length === 0}
                  className="btn btn-primary" style={{ width: '100%', marginTop: 12 }}>
                  Start Scanning ({selectedOrder.length} card{selectedOrder.length === 1 ? '' : 's'}) →
                </button>
              </section>
            </div>
          </>
        )}

        {/* PHASE: scanning */}
        {phase === 'scanning' && currentSet && (
          <>
            <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>3. Drop scans</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                Need {expectedFileCount} files for {selectedOrder.length} cards · {files.length} loaded
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setPhase('pick-cards')} className="btn btn-ghost btn-sm">← Back to selection</button>
            </section>

            <section className="panel-bordered" style={{ padding: '16px 20px', marginBottom: 14 }}>
              <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 8 }}>Scan mode</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                {(['fronts-then-backs', 'interleaved'] as const).map(m => (
                  <button key={m} onClick={() => setPairMode(m)}
                    className={pairMode === m ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                    {m === 'fronts-then-backs' ? 'Fronts then Backs' : 'Interleaved (F/B/F/B)'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                {pairMode === 'fronts-then-backs'
                  ? 'Scan all fronts (in selection order), flip the stack, scan all backs. Backs are auto-reversed.'
                  : 'Duplex: scanner outputs front, back, front, back…'}
              </div>
            </section>

            {files.length === 0 ? (
              <section className="panel-bordered" style={{ padding: '20px 24px' }}>
                <div onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${dragOver ? 'var(--orange)' : 'var(--plum)'}`,
                    borderRadius: 12,
                    background: dragOver ? 'rgba(218, 121, 64, 0.08)' : 'var(--paper)',
                    padding: '40px 24px', textAlign: 'center',
                    transition: 'all 0.15s ease',
                  }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📥</div>
                  <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 6 }}>Drag & drop scan files here</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>
                    JPG/PNG, sorted by filename. Need {expectedFileCount} files.
                  </div>
                  <input type="file" multiple accept="image/jpeg,image/png" onChange={handleFiles}
                    style={{ display: 'inline-block', padding: '8px 12px', border: '2px solid var(--plum)', borderRadius: 10, background: 'var(--cream)', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', cursor: 'pointer' }} />
                </div>
              </section>
            ) : (
              <>
                <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div className="mono" style={{ fontSize: 12, color: files.length === expectedFileCount ? 'var(--teal)' : 'var(--rust)', fontWeight: 700 }}>
                    {files.length === expectedFileCount ? '✓ File count matches' : `⚠ Expected ${expectedFileCount}, got ${files.length}`}
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setFiles([])} className="btn btn-ghost btn-sm">Clear files</button>
                  <button onClick={saveAll} disabled={saving || files.length < expectedFileCount}
                    className="btn btn-primary">
                    {saving ? 'Saving…' : `✓ Save All (${selectedOrder.length})`}
                  </button>
                </section>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedOrder.map((origIndex, i) => {
                    const row = currentSet.rows[origIndex];
                    const pair = pairs[i];
                    const dest = destinations[origIndex] || { setRow: true, listing: false };
                    return (
                      <div key={origIndex} className="panel-bordered" style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '40px 1fr 220px', gap: 12, alignItems: 'center' }}>
                        <div className="mono" style={{ fontSize: 16, color: 'var(--orange)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                          {pair?.front
                            ? <img src={URL.createObjectURL(pair.front)} alt="" style={{ width: 56, height: 78, objectFit: 'cover', borderRadius: 4, border: '1.5px solid var(--plum)' }} />
                            : <div style={{ width: 56, height: 78, borderRadius: 4, background: 'var(--cream)', border: '1.5px dashed var(--rule)' }} />}
                          {pair?.back
                            ? <img src={URL.createObjectURL(pair.back)} alt="" style={{ width: 56, height: 78, objectFit: 'cover', borderRadius: 4, border: '1.5px solid var(--plum)' }} />
                            : <div style={{ width: 56, height: 78, borderRadius: 4, background: 'var(--cream)', border: '1.5px dashed var(--rule)' }} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {rowLabel(row)}
                            </div>
                            {pair?.front && pair?.back && (
                              <button onClick={() => swapPair(i)} className="btn btn-ghost btn-sm" type="button" style={{ marginTop: 4, fontSize: 10 }}>↔ Swap front/back</button>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--ink-soft)' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="checkbox" checked={dest.setRow} onChange={e => setDest(origIndex, 'setRow', e.target.checked)} />
                            📚 Replace in set
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="checkbox" checked={dest.listing} onChange={e => setDest(origIndex, 'listing', e.target.checked)} />
                            🏷️ Also create draft listing
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* PHASE: review (after save) */}
        {phase === 'review' && (
          <section className="panel-bordered" style={{ padding: '24px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>Saved</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 18 }}>{savedSummary}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={startOver} className="btn btn-primary">Scan another set</button>
              {currentSet && (
                <Link href={`/set/${currentSet.slug}`} className="btn btn-outline">View set →</Link>
              )}
              <Link href="/listings" className="btn btn-ghost">My listings</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
