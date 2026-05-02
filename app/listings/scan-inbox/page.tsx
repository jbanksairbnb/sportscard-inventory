'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  photos: string[];
};

type PairMode = 'fronts-only' | 'fronts-then-backs' | 'interleaved';

type Pair = {
  id: string;
  front: File | null;
  back: File | null;
  status: 'pending' | 'saved' | 'skipped';
  listingId?: string;
  listingLabel?: string;
};

function listingLabel(l: Listing): string {
  const parts = [
    l.year ? String(l.year) : '',
    l.brand || '',
    l.card_number ? `#${l.card_number}` : '',
    l.player || '',
  ].filter(Boolean);
  return parts.join(' ').trim() || l.title;
}

export default function ScanInboxPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<PairMode>('fronts-then-backs');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [pairStatuses, setPairStatuses] = useState<Record<number, 'saved' | 'skipped' | 'pending'>>({});
  const [pairListings, setPairListings] = useState<Record<number, { id: string; label: string }>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data } = await supabase.from('listings')
        .select('id, title, year, brand, card_number, player, photos')
        .eq('user_id', user.id)
        .neq('status', 'sold')
        .order('created_at', { ascending: false });
      setListings((data || []) as Listing[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const pairs: Pair[] = useMemo(() => {
    if (files.length === 0) return [];
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (mode === 'fronts-only') {
      return sorted.map((f, i) => ({ id: `p${i}`, front: f, back: null, status: 'pending' }));
    }
    if (mode === 'interleaved') {
      const out: Pair[] = [];
      for (let i = 0; i < sorted.length; i += 2) {
        out.push({ id: `p${i}`, front: sorted[i], back: sorted[i + 1] || null, status: 'pending' });
      }
      return out;
    }
    const half = Math.ceil(sorted.length / 2);
    const fronts = sorted.slice(0, half);
    const backs = sorted.slice(half).reverse();
    return fronts.map((f, i) => ({ id: `p${i}`, front: f, back: backs[i] || null, status: 'pending' }));
  }, [files, mode]);

  const filteredListings = useMemo(() => {
    let arr = onlyMissing ? listings.filter(l => !l.photos || l.photos.length === 0) : listings;
    const q = searchQuery.trim();
    if (q) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      arr = arr.filter(l => {
        const hay = [l.title, l.player, l.brand, l.card_number, l.year ? String(l.year) : ''].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    return arr.slice(0, 12);
  }, [listings, searchQuery, onlyMissing]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [searchQuery, currentIdx, onlyMissing]);

  useEffect(() => {
    setCurrentIdx(0);
    setPairStatuses({});
    setPairListings({});
    setSearchQuery('');
  }, [files, mode]);

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
  const savedCount = Object.values(pairStatuses).filter(s => s === 'saved').length;
  const skippedCount = Object.values(pairStatuses).filter(s => s === 'skipped').length;
  const remaining = totalPairs - savedCount - skippedCount;

  function swapPair(idx: number) {
    const p = pairs[idx];
    if (!p) return;
    const newFiles = [...files];
    const fIdx = p.front ? newFiles.indexOf(p.front) : -1;
    const bIdx = p.back ? newFiles.indexOf(p.back) : -1;
    if (fIdx >= 0 && bIdx >= 0) {
      [newFiles[fIdx], newFiles[bIdx]] = [newFiles[bIdx], newFiles[fIdx]];
      setFiles(newFiles);
    }
  }

  function advance() {
    setSearchQuery('');
    setHighlightIdx(0);
    if (currentIdx < totalPairs - 1) setCurrentIdx(currentIdx + 1);
  }
  function goBack() {
    setSearchQuery('');
    setHighlightIdx(0);
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  }
  function skipPair() {
    setPairStatuses(prev => ({ ...prev, [currentIdx]: 'skipped' }));
    advance();
  }

  async function saveCurrent(useListingId?: string) {
    if (!currentPair) return;
    const listingId = useListingId || filteredListings[highlightIdx]?.id;
    if (!listingId) { setError('Pick a listing first.'); return; }
    const listing = listings.find(l => l.id === listingId);
    if (!listing) return;
    setError('');
    setSaving(true);

    const supabase = createClient();
    const ts = Date.now();
    const newUrls: string[] = [];

    async function uploadOne(file: File, suffix: string) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/listings/${listing!.id}/${ts}-${suffix}.${ext}`;
      const { error: upErr } = await supabase.storage.from('card-images').upload(path, file);
      if (upErr) { throw new Error(`Upload failed: ${upErr.message}`); }
      const { data } = supabase.storage.from('card-images').getPublicUrl(path);
      return data.publicUrl;
    }

    try {
      if (currentPair.front) newUrls.push(await uploadOne(currentPair.front, 'front'));
      if (currentPair.back) newUrls.push(await uploadOne(currentPair.back, 'back'));

      const newPhotos = [...(listing.photos || []), ...newUrls];
      const { error: updErr } = await supabase.from('listings').update({ photos: newPhotos }).eq('id', listing.id);
      if (updErr) throw new Error(updErr.message);

      setListings(prev => prev.map(l => l.id === listing.id ? { ...l, photos: newPhotos } : l));
      setPairStatuses(prev => ({ ...prev, [currentIdx]: 'saved' }));
      setPairListings(prev => ({ ...prev, [currentIdx]: { id: listing.id, label: listingLabel(listing) } }));
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, filteredListings.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredListings[highlightIdx]) saveCurrent(filteredListings[highlightIdx].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      skipPair();
    }
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
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Scan your stack of cards on the Ricoh fi-8170. Output one folder of JPGs (e.g. 25 fronts, then flip the stack and scan 25 backs).</li>
            <li>Pick the matching <strong>Pair Mode</strong> below: <em>Fronts then Backs</em> if you scan all fronts first then all backs (recommended; the back stack is reversed automatically). <em>Interleaved</em> if you used duplex mode (front, back, front, back). <em>Fronts only</em> if you didn&apos;t scan backs.</li>
            <li>Drop the folder of JPGs into the box. The app sorts by filename and pairs them.</li>
            <li>For each pair: type a few letters of the player name → top match highlights → press <span className="mono">Enter</span> to save and advance. <span className="mono">Esc</span> skips. <span className="mono">↑↓</span> navigates suggestions.</li>
          </ol>
        </section>

        {/* Mode + drop */}
        {pairs.length === 0 && (
          <>
            <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>1. Pair Mode</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['fronts-then-backs', 'interleaved', 'fronts-only'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={mode === m ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                    {m === 'fronts-then-backs' ? 'Fronts then Backs (recommended)' : m === 'interleaved' ? 'Interleaved (F/B/F/B)' : 'Fronts only'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, fontStyle: 'italic' }}>
                {mode === 'fronts-then-backs' && 'Files 1..N/2 are fronts; files N/2+1..N are backs (in reverse order from the flip).'}
                {mode === 'interleaved' && 'Odd-numbered files are fronts; even-numbered are backs (e.g. duplex output: 001=front1, 002=back1, 003=front2…).'}
                {mode === 'fronts-only' && 'Each file is one card front; no backs.'}
              </div>
            </section>

            <section className="panel-bordered" style={{ padding: '20px 24px' }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>2. Drop Scans</div>
              <div ref={dropRef}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
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
                <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 6 }}>
                  Drag & drop scan files here
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>
                  JPG or PNG, sorted by filename. You can also pick from your computer:
                </div>
                <input type="file" multiple accept="image/jpeg,image/png" onChange={handleFiles}
                  style={{ display: 'inline-block', padding: '8px 12px', border: '2px solid var(--plum)', borderRadius: 10, background: 'var(--cream)', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', cursor: 'pointer' }} />
              </div>
            </section>
          </>
        )}

        {/* Pair matcher */}
        {pairs.length > 0 && (
          <>
            <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>
                  Pair {currentIdx + 1} of {totalPairs}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
                  {savedCount} saved · {skippedCount} skipped · {remaining} remaining
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={() => { setFiles([]); }} className="btn btn-ghost btn-sm">Clear all & restart</button>
              </div>
              <div style={{ marginTop: 8, height: 6, background: 'var(--rule)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${totalPairs > 0 ? (savedCount / totalPairs) * 100 : 0}%`, height: '100%', background: 'var(--teal)', transition: 'width 0.2s ease' }} />
              </div>
            </section>

            {currentPair && (
              <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  {/* Thumbnails */}
                  <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                    {currentPair.front && (
                      <div style={{ textAlign: 'center' }}>
                        <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 4 }}>FRONT</div>
                        <img src={URL.createObjectURL(currentPair.front)} alt="Front"
                          style={{ width: 200, height: 280, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)' }} />
                        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {currentPair.front.name}
                        </div>
                      </div>
                    )}
                    {currentPair.back && (
                      <div style={{ textAlign: 'center' }}>
                        <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 4 }}>BACK</div>
                        <img src={URL.createObjectURL(currentPair.back)} alt="Back"
                          style={{ width: 200, height: 280, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)' }} />
                        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {currentPair.back.name}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Search + match */}
                  <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <label className="input-label" style={{ marginBottom: 0 }}>Match to listing</label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 600, cursor: 'pointer' }}>
                        <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />
                        Only listings without photos
                      </label>
                      {currentPair.front && currentPair.back && (
                        <button onClick={() => swapPair(currentIdx)} className="btn btn-ghost btn-sm" type="button">↔ Swap front/back</button>
                      )}
                    </div>
                    <input ref={searchRef} autoFocus
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={onSearchKeyDown}
                      placeholder="Type player name, year, brand…"
                      className="input-sc" style={{ width: '100%', fontSize: 14 }} />
                    {filteredListings.length === 0 ? (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13, background: 'var(--paper)', border: '1px dashed var(--rule)', borderRadius: 8 }}>
                        {searchQuery.trim() ? 'No listings match.' : (onlyMissing ? 'No listings without photos. Uncheck the filter to see all.' : 'No listings.')}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8, overflow: 'hidden' }}>
                        {filteredListings.map((l, i) => {
                          const isHi = i === highlightIdx;
                          return (
                            <button key={l.id} onClick={() => saveCurrent(l.id)}
                              onMouseEnter={() => setHighlightIdx(i)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                                background: isHi ? 'rgba(184,146,58,0.18)' : 'transparent',
                                border: 'none', textAlign: 'left', cursor: 'pointer',
                                borderTop: i > 0 ? '1px solid var(--rule)' : 'none',
                              }}>
                              {l.photos?.[0]
                                ? <img src={l.photos[0]} alt="" style={{ width: 28, height: 40, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--plum)', flexShrink: 0 }} />
                                : <div style={{ width: 28, height: 40, borderRadius: 3, background: 'var(--cream)', border: '1px dashed var(--rule)', flexShrink: 0 }} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {listingLabel(l)}
                                </div>
                                <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
                                  {l.photos?.length ? `${l.photos.length} photo${l.photos.length === 1 ? '' : 's'} already` : 'No photos yet'}
                                </div>
                              </div>
                              {isHi && <span className="mono" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700 }}>↵ Enter</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {error && (
                      <div style={{ padding: '8px 12px', background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)', borderRadius: 8, fontSize: 12, color: 'var(--rust)', fontWeight: 600 }}>
                        {error}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <button onClick={() => saveCurrent()} disabled={saving || filteredListings.length === 0}
                        className="btn btn-primary">
                        {saving ? 'Saving…' : '✓ Save & Next'}
                      </button>
                      <button onClick={skipPair} disabled={saving} className="btn btn-outline btn-sm">Skip ▶</button>
                      <button onClick={goBack} disabled={currentIdx === 0 || saving} className="btn btn-ghost btn-sm">◀ Prev</button>
                      {pairStatuses[currentIdx] === 'saved' && pairListings[currentIdx] && (
                        <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700, alignSelf: 'center', marginLeft: 'auto' }}>
                          ✓ Saved to {pairListings[currentIdx].label}
                        </span>
                      )}
                      {pairStatuses[currentIdx] === 'skipped' && (
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700, alignSelf: 'center', marginLeft: 'auto' }}>
                          (skipped)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Per-pair status list */}
            <section className="panel-bordered" style={{ padding: '16px 20px' }}>
              <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 8 }}>All pairs</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {pairs.map((_, i) => {
                  const s = pairStatuses[i] || 'pending';
                  const isCurrent = i === currentIdx;
                  return (
                    <button key={i} onClick={() => { setCurrentIdx(i); setSearchQuery(''); }}
                      style={{
                        padding: '4px 10px', borderRadius: 6,
                        border: isCurrent ? '2px solid var(--orange)' : '1.5px solid var(--rule)',
                        background: s === 'saved' ? 'var(--teal)' : s === 'skipped' ? 'var(--ink-mute)' : 'var(--paper)',
                        color: s === 'pending' ? 'var(--plum)' : 'var(--cream)',
                        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                        cursor: 'pointer',
                      }}>
                      #{i + 1}
                    </button>
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
