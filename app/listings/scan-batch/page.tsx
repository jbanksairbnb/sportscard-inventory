'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Listing = {
  id: string;
  title: string;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  status: 'draft' | 'active' | 'sold' | 'removed';
  photos: string[] | null;
};

type PairMode = 'fronts-then-backs' | 'interleaved';
type Phase = 'pick' | 'scanning' | 'review';
type ScanPair = { front: File | null; back: File | null };

function listingLabel(l: Listing): string {
  const parts = [
    l.year ? String(l.year) : '',
    l.brand || '',
    l.card_number ? `#${l.card_number}` : '',
    l.player || '',
  ].filter(Boolean);
  return parts.join(' ').trim() || l.title || '(untitled)';
}

function listingHasPhotos(l: Listing): boolean {
  return !!(l.photos && l.photos.length > 0);
}

export default function ScanBatchToListingsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [search, setSearch] = useState('');
  const [hideWithPhotos, setHideWithPhotos] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'active'>('all');

  const [phase, setPhase] = useState<Phase>('pick');
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]); // listing ids

  const [files, setFiles] = useState<File[]>([]);
  const [pairMode, setPairMode] = useState<PairMode>('fronts-then-backs');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedSummary, setSavedSummary] = useState('');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data } = await supabase
        .from('listings')
        .select('id, title, year, brand, card_number, player, status, photos')
        .eq('user_id', user.id)
        .in('status', ['draft', 'active'])
        .order('created_at', { ascending: false });
      setListings((data || []) as Listing[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const visibleListings = useMemo(() => {
    let arr = listings.slice();
    if (statusFilter !== 'all') arr = arr.filter(l => l.status === statusFilter);
    if (hideWithPhotos) arr = arr.filter(l => !listingHasPhotos(l));
    const q = search.trim().toLowerCase();
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      arr = arr.filter(l => {
        const hay = [l.title, l.player, l.brand, l.card_number, l.year ? String(l.year) : ''].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    return arr;
  }, [listings, statusFilter, hideWithPhotos, search]);

  const selectedListings: Listing[] = useMemo(
    () => selectedOrder.map(id => listings.find(l => l.id === id)).filter(Boolean) as Listing[],
    [selectedOrder, listings],
  );

  function toggleListing(id: string) {
    setSelectedOrder(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function moveSelected(idx: number, dir: -1 | 1) {
    setSelectedOrder(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function removeSelected(idx: number) {
    setSelectedOrder(prev => prev.filter((_, i) => i !== idx));
  }
  function selectAllVisible() {
    setSelectedOrder(prev => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const l of visibleListings) {
        if (!seen.has(l.id)) { next.push(l.id); seen.add(l.id); }
      }
      return next;
    });
  }
  function clearSelection() {
    setSelectedOrder([]);
  }

  function startScanning() {
    if (selectedOrder.length === 0) return;
    setFiles([]);
    setPhase('scanning');
  }

  const expectedFileCount = selectedOrder.length * 2;
  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [files],
  );

  const pairs: ScanPair[] = useMemo(() => {
    if (sortedFiles.length === 0) return selectedOrder.map(() => ({ front: null, back: null }));
    if (pairMode === 'interleaved') {
      const out: ScanPair[] = [];
      for (let i = 0; i < selectedOrder.length; i++) {
        out.push({ front: sortedFiles[i * 2] || null, back: sortedFiles[i * 2 + 1] || null });
      }
      return out;
    }
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

  async function saveAll() {
    if (!userId) return;
    setError('');
    if (files.length < expectedFileCount) {
      setError(`Expected ${expectedFileCount} scan files (front+back × ${selectedOrder.length}), got ${files.length}.`);
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const ts = Date.now();
    try {
      let updated = 0;
      for (let i = 0; i < selectedOrder.length; i++) {
        const listingId = selectedOrder[i];
        const listing = listings.find(l => l.id === listingId);
        if (!listing) continue;
        const pair = pairs[i];
        if (!pair.front && !pair.back) continue;

        const slots: { url: string; idx: 0 | 1 }[] = [];
        if (pair.front) {
          const ext = (pair.front.name.split('.').pop() || 'jpg').toLowerCase();
          const path = `${userId}/listings/${listingId}/${ts}-front.${ext}`;
          const { error: upErr } = await supabase.storage.from('card-images').upload(path, pair.front, { upsert: true });
          if (upErr) throw new Error(`Front upload failed (${listingLabel(listing)}): ${upErr.message}`);
          const { data } = supabase.storage.from('card-images').getPublicUrl(path);
          slots.push({ url: `${data.publicUrl}?t=${ts}`, idx: 0 });
        }
        if (pair.back) {
          const ext = (pair.back.name.split('.').pop() || 'jpg').toLowerCase();
          const path = `${userId}/listings/${listingId}/${ts}-back.${ext}`;
          const { error: upErr } = await supabase.storage.from('card-images').upload(path, pair.back, { upsert: true });
          if (upErr) throw new Error(`Back upload failed (${listingLabel(listing)}): ${upErr.message}`);
          const { data } = supabase.storage.from('card-images').getPublicUrl(path);
          slots.push({ url: `${data.publicUrl}?t=${ts}`, idx: 1 });
        }
        // Replace photos[0] / photos[1], preserve any photos[2..].
        const nextPhotos = [...(listing.photos || [])];
        for (const s of slots) nextPhotos[s.idx] = s.url;
        const { error: updErr } = await supabase
          .from('listings')
          .update({ photos: nextPhotos.filter(Boolean) })
          .eq('id', listingId)
          .eq('user_id', userId);
        if (updErr) throw new Error(`Update failed (${listingLabel(listing)}): ${updErr.message}`);
        updated++;
      }
      setSavedSummary(`${updated} listing${updated === 1 ? '' : 's'} updated with new scans`);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    setSelectedOrder([]);
    setFiles([]);
    setSavedSummary('');
    setPhase('pick');
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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Scan to Listings ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 20 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-soft)', fontSize: 13, lineHeight: 1.7 }}>
            <li>Click each listing in the order you&apos;ll scan them — selection list locks the order.</li>
            <li>Scan that exact stack on your scanner (fronts then backs, or duplex/interleaved).</li>
            <li>Drop the JPGs. The app pairs them positionally to your selected listings.</li>
            <li>Save All — each listing&apos;s front + back photos are updated in one shot.</li>
          </ol>
        </section>

        {phase === 'pick' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
            <section className="panel-bordered" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>1. Click listings in scan order</div>
                <button type="button" onClick={selectAllVisible} className="btn btn-ghost btn-sm">✓ Select all visible</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                  border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
                  flex: 1, minWidth: 220, maxWidth: 360,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--plum)' }}>🔍</span>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search title, player, year, brand…"
                    style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: 12, flex: 1, color: 'var(--plum)' }} />
                  {search && <button onClick={() => setSearch('')} style={{ background: 'transparent', border: 'none', color: 'var(--plum)', cursor: 'pointer', fontSize: 13 }}>×</button>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['all', 'draft', 'active'] as const).map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                      className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}>
                      {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--plum)', marginLeft: 'auto' }}>
                  <input type="checkbox" checked={hideWithPhotos} onChange={e => setHideWithPhotos(e.target.checked)} />
                  Hide listings that already have photos
                </label>
              </div>
              {visibleListings.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                  No listings match your filters.
                </div>
              ) : (
                <div style={{ maxHeight: 540, overflowY: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      <tr>
                        <th style={{ padding: '6px 10px', textAlign: 'left', width: 28 }}></th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', width: 36 }}>#</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left' }}>Listing</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', width: 70 }}>Status</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', width: 70 }}>Photos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleListings.map(l => {
                        const orderIdx = selectedOrder.indexOf(l.id);
                        const isSel = orderIdx >= 0;
                        const photoCount = (l.photos || []).length;
                        return (
                          <tr key={l.id} onClick={() => toggleListing(l.id)}
                            style={{ borderTop: '1px solid var(--rule)', cursor: 'pointer', background: isSel ? 'rgba(184,146,58,0.18)' : 'transparent' }}>
                            <td style={{ padding: '6px 10px' }}>
                              <input type="checkbox" checked={isSel} readOnly style={{ accentColor: 'var(--plum)' }} />
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--orange)', fontWeight: 700 }}>
                              {isSel ? `#${orderIdx + 1}` : ''}
                            </td>
                            <td style={{ padding: '6px 10px', fontSize: 12.5, color: 'var(--plum)' }}>
                              <div style={{ fontWeight: 600 }}>{l.title}</div>
                              <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{listingLabel(l)}</div>
                            </td>
                            <td style={{ padding: '6px 10px', fontSize: 10.5, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                              {l.status}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: photoCount > 0 ? 'var(--teal)' : 'var(--ink-mute)' }}>
                              {photoCount > 0 ? `${photoCount} 📷` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel-bordered" style={{ padding: '20px 24px', position: 'sticky', top: 96, alignSelf: 'start' }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>
                Scan order ({selectedOrder.length})
              </div>
              {selectedOrder.length === 0 ? (
                <div style={{ padding: 16, color: 'var(--ink-mute)', fontSize: 12, textAlign: 'center' }}>
                  Click listings on the left to add them.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto', marginBottom: 12 }}>
                  {selectedListings.map((l, i) => (
                    <div key={l.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
                      padding: '6px 8px', fontSize: 12, color: 'var(--plum)',
                    }}>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--orange)', minWidth: 22 }}>#{i + 1}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {listingLabel(l)}
                      </span>
                      <button type="button" onClick={() => moveSelected(i, -1)} disabled={i === 0} className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: 11 }}>↑</button>
                      <button type="button" onClick={() => moveSelected(i, 1)} disabled={i === selectedListings.length - 1} className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: 11 }}>↓</button>
                      <button type="button" onClick={() => removeSelected(i)} className="btn btn-ghost btn-sm" style={{ padding: '0 4px', color: 'var(--rust)', fontSize: 11 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={clearSelection} disabled={selectedOrder.length === 0} className="btn btn-ghost btn-sm" style={{ flex: 1 }}>Clear</button>
                <button type="button" onClick={startScanning} disabled={selectedOrder.length === 0}
                  className="btn btn-primary btn-sm" style={{ flex: 2 }}>
                  Start Scanning ({selectedOrder.length}) →
                </button>
              </div>
            </section>
          </div>
        )}

        {phase === 'scanning' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
            <section className="panel-bordered" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>2. Drop scans</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPairMode('fronts-then-backs')}
                    className={`btn btn-sm ${pairMode === 'fronts-then-backs' ? 'btn-primary' : 'btn-ghost'}`}>
                    Fronts → Backs
                  </button>
                  <button onClick={() => setPairMode('interleaved')}
                    className={`btn btn-sm ${pairMode === 'interleaved' ? 'btn-primary' : 'btn-ghost'}`}>
                    Interleaved
                  </button>
                </div>
              </div>
              <div onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--orange)' : 'var(--plum)'}`,
                  borderRadius: 10, padding: 24, textAlign: 'center',
                  background: dragOver ? 'rgba(232,116,44,0.10)' : 'var(--paper)',
                  marginBottom: 14,
                }}>
                <div className="display" style={{ fontSize: 14, color: 'var(--plum)', marginBottom: 6 }}>
                  Drop {expectedFileCount} JPGs here
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 10 }}>
                  Currently {files.length} loaded
                </div>
                <input type="file" id="scan-files" accept="image/*" multiple onChange={handleFiles} style={{ display: 'none' }} />
                <label htmlFor="scan-files" className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>+ Add files</label>
                {files.length > 0 && (
                  <button type="button" onClick={() => setFiles([])} className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }}>Clear all</button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedListings.map((l, i) => {
                  const p = pairs[i];
                  return (
                    <div key={l.id} style={{
                      display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px 36px',
                      gap: 8, alignItems: 'center',
                      background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
                      padding: '6px 10px',
                    }}>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--orange)' }}>#{i + 1}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {listingLabel(l)}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: p?.front ? 'var(--teal)' : 'var(--ink-mute)' }}>
                        {p?.front ? '✓ F' : '— F'}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: p?.back ? 'var(--teal)' : 'var(--ink-mute)' }}>
                        {p?.back ? '✓ B' : '— B'}
                      </span>
                      <button type="button" onClick={() => swapPair(i)}
                        disabled={!p?.front || !p?.back}
                        title="Swap front/back" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: 12 }}>⇄</button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel-bordered" style={{ padding: '20px 24px', position: 'sticky', top: 96, alignSelf: 'start' }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>3. Save</div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginBottom: 12, lineHeight: 1.6 }}>
                Each listing&apos;s photo[0] becomes the front and photo[1] becomes the back. Any extra photos on a listing are kept.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button type="button" onClick={saveAll} disabled={saving || files.length < expectedFileCount}
                  className="btn btn-primary">
                  {saving ? 'Saving…' : `Save All (${selectedOrder.length})`}
                </button>
                <button type="button" onClick={() => setPhase('pick')} disabled={saving} className="btn btn-ghost btn-sm">
                  ← Back to listing pick
                </button>
              </div>
              {error && (
                <div style={{ marginTop: 12, padding: 8, background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)', borderRadius: 6, color: 'var(--rust)', fontSize: 12 }}>
                  {error}
                </div>
              )}
            </section>
          </div>
        )}

        {phase === 'review' && (
          <section className="panel-bordered" style={{ padding: '40px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 10 }}>✓ Done</div>
            <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 20 }}>{savedSummary}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={startOver} className="btn btn-primary">Scan another batch</button>
              <Link href="/listings" className="btn btn-outline">Back to My Listings</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
