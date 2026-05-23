'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSellerStatus } from '@/lib/sellerGuard';
import SCLogo from '@/components/SCLogo';
import AIGradeBadge from '@/components/AIGradeBadge';
import AIGradeToggle, { loadAIGradePreference, saveAIGradePreference } from '@/components/AIGradeToggle';
import { useAIGrade, type AIGradeItem } from '@/lib/ai/use-ai-grade';

type Listing = {
  id: string;
  title: string;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  tag_number: string | null;
  status: 'draft' | 'active' | 'sold' | 'removed';
  photos: string[] | null;
  condition_type: 'raw' | 'graded' | null;
  raw_grade: string | null;
  grading_company: string | null;
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

  // Hard cap on selection size so a user can't drop 300 raw JPGs into the
  // browser at once. ~25 listings = ~50 images at ~3 MB each ≈ 150 MB peak,
  // which most browsers handle without choking. Tune higher if real-world
  // batches are routinely smaller and folks complain.
  const BATCH_LIMIT = 25;

  const [files, setFiles] = useState<File[]>([]);
  const [pairMode, setPairMode] = useState<PairMode>('fronts-then-backs');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedSummary, setSavedSummary] = useState('');

  // AI grading: same shape as scan-multi-card. Toggle persists across flows.
  const [aiEnabled, setAiEnabled] = useState(true);
  useEffect(() => { setAiEnabled(loadAIGradePreference()); }, []);
  const ai = useAIGrade({ enabled: aiEnabled, source: 'scan-batch' });
  const [savedItems, setSavedItems] = useState<Array<{
    listingId: string;
    label: string;
    image_front_url: string;
    image_back_url: string;
    prior_raw_grade: string;
  }>>([]);
  const autoAppliedRef = useRef<Set<string>>(new Set());
  const [appliedGrades, setAppliedGrades] = useState<Record<string, string>>({});
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const aiEvaluatedCount = Object.values(ai.statuses).filter(s => s.state === 'done' || s.state === 'error').length;

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      { const _ss = await getSellerStatus(supabase, user.id); if (!_ss.canSell) { router.replace('/marketplace'); return; } if (!_ss.termsAccepted) { router.replace('/seller-terms'); return; } }
      setUserId(user.id);
      const { data } = await supabase
        .from('listings')
        .select('id, title, year, brand, card_number, player, tag_number, status, photos, condition_type, raw_grade, grading_company')
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
        const hay = [l.title, l.player, l.brand, l.card_number, l.year ? String(l.year) : '', l.tag_number].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    // Sort by year → brand → card # (numeric-aware so "5" < "11") → player.
    // Matches the natural order of a CSV-uploaded set, which is what sellers
    // want when scanning a physical stack against the listing list.
    arr.sort((a, b) => {
      const yearDiff = (a.year || 0) - (b.year || 0);
      if (yearDiff !== 0) return yearDiff;
      const brandCmp = (a.brand || '').localeCompare(b.brand || '');
      if (brandCmp !== 0) return brandCmp;
      const cardCmp = (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
      if (cardCmp !== 0) return cardCmp;
      return (a.player || '').localeCompare(b.player || '');
    });
    return arr;
  }, [listings, statusFilter, hideWithPhotos, search]);

  const selectedListings: Listing[] = useMemo(
    () => selectedOrder.map(id => listings.find(l => l.id === id)).filter(Boolean) as Listing[],
    [selectedOrder, listings],
  );

  function toggleListing(id: string) {
    setSelectedOrder(prev => {
      // Removing is always allowed.
      if (prev.includes(id)) return prev.filter(x => x !== id);
      // Adding hits the cap silently — the UI shows a "N / 25 max" badge
      // so the user knows why nothing happened.
      if (prev.length >= BATCH_LIMIT) return prev;
      return [...prev, id];
    });
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
  // Fill the selection up to BATCH_LIMIT with the next un-selected visible
  // listings, in current sort order. The whole point is one-click batching:
  // after the user uploads their first 25, they can hit this again to grab
  // the next 25 without manually scrolling and ticking boxes.
  function selectNextBatch() {
    setSelectedOrder(prev => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const l of visibleListings) {
        if (next.length >= BATCH_LIMIT) break;
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

  // Cache object URLs for File previews so the browser doesn't churn them on
  // every render. Revoke on file removal / unmount.
  const [thumbUrls, setThumbUrls] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    setThumbUrls(prev => {
      const next = new Map(prev);
      for (const f of files) {
        if (!next.has(f)) next.set(f, URL.createObjectURL(f));
      }
      for (const f of Array.from(next.keys())) {
        if (!files.includes(f)) {
          URL.revokeObjectURL(next.get(f) as string);
          next.delete(f);
        }
      }
      return next;
    });
  }, [files]);
  useEffect(() => () => {
    thumbUrls.forEach(u => URL.revokeObjectURL(u));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Snapshot of saved listings for the AI-grading UI on the review screen.
    const snapshot: typeof savedItems = [];
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

        const front = slots.find(s => s.idx === 0)?.url || nextPhotos[0] || '';
        const back = slots.find(s => s.idx === 1)?.url || nextPhotos[1] || '';
        snapshot.push({
          listingId,
          label: listingLabel(listing),
          image_front_url: front,
          image_back_url: back,
          prior_raw_grade: listing.raw_grade || '',
        });
      }
      setSavedSummary(`${updated} listing${updated === 1 ? '' : 's'} updated with new scans`);
      setSavedItems(snapshot);
      setPhase('review');

      // Kick off AI grading on the saved listings. Only skip cards that
      // are professionally graded (real grade is truth — running AI on
      // PSA-encapsulated cards isn't useful because the holder warps
      // the image). Front-only or back-only scans still get graded;
      // the API + prompt handle that with a low-confidence result.
      if (aiEnabled) {
        const aiItems: AIGradeItem[] = [];
        for (const it of snapshot) {
          const listing = listings.find(l => l.id === it.listingId);
          if (!listing) continue;
          const isGraded = listing.condition_type === 'graded'
            || (listing.grading_company || '').trim() !== '';
          if (isGraded) continue;
          if (!it.image_front_url) continue; // truly nothing to grade
          aiItems.push({
            id: it.listingId,
            context: {
              year: listing.year,
              brand: listing.brand,
              set_title: null,
              card_number: listing.card_number,
              player: listing.player,
              image_front_url: it.image_front_url,
              image_back_url: it.image_back_url || null,
            },
          });
        }
        if (aiItems.length > 0) ai.evaluate(aiItems);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Serial DB writes for AI grade application. Multiple results land in
  // parallel and each is a single-column update on listings — Postgres
  // handles row-level concurrency fine, but we serialize anyway so an
  // Undo click can't race past an in-flight write.
  function writeListingGrade(listingId: string, rawGrade: string) {
    if (!userId) return Promise.resolve();
    const uid = userId;
    const next = writeQueueRef.current.then(async () => {
      const supabase = createClient();
      const patch: { raw_grade: string | null; condition_type?: 'raw' } = {
        raw_grade: rawGrade || null,
      };
      // If the listing is currently raw + ungraded, AI fill bumps it to
      // condition_type='raw' so the marketplace shows the grade.
      if (rawGrade) patch.condition_type = 'raw';
      await supabase.from('listings').update(patch)
        .eq('id', listingId).eq('user_id', uid);
    });
    writeQueueRef.current = next.catch(() => {});
    return next;
  }

  useEffect(() => {
    for (const it of savedItems) {
      const s = ai.statuses[it.listingId];
      if (s?.state !== 'done') continue;
      if (autoAppliedRef.current.has(it.listingId)) continue;
      autoAppliedRef.current.add(it.listingId);
      const low = s.result.grade_low;
      setAppliedGrades(prev => ({ ...prev, [it.listingId]: low }));
      writeListingGrade(it.listingId, low);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.statuses, savedItems]);

  function startOver() {
    setSelectedOrder([]);
    setFiles([]);
    setSavedSummary('');
    setSavedItems([]);
    autoAppliedRef.current = new Set();
    setAppliedGrades({});
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="mono" style={{
                    fontSize: 11, fontWeight: 700,
                    color: selectedOrder.length >= BATCH_LIMIT ? 'var(--rust)' : 'var(--ink-mute)',
                  }}>
                    {selectedOrder.length} / {BATCH_LIMIT} max
                  </span>
                  <button type="button" onClick={selectNextBatch}
                    disabled={selectedOrder.length >= BATCH_LIMIT}
                    title={`Fill selection up to ${BATCH_LIMIT} with the next visible listings`}
                    className="btn btn-ghost btn-sm">
                    ✓ Select next {BATCH_LIMIT}
                  </button>
                </div>
              </div>
              {selectedOrder.length >= BATCH_LIMIT && (
                <div style={{
                  marginBottom: 12, padding: '8px 12px',
                  background: 'rgba(197,74,44,0.08)',
                  border: '1.5px solid var(--rust)', borderRadius: 8,
                  fontSize: 12.5, color: 'var(--plum)',
                }}>
                  <strong>Batch full.</strong> Process this batch first — once these listings have photos, come back and hit <em>Select next {BATCH_LIMIT}</em>. Keeps the browser from choking on too many raw images at once.
                </div>
              )}
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
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600 }}>{l.title}</span>
                                {l.tag_number && (
                                  <span className="mono"
                                    title="Inventory tag"
                                    style={{
                                      fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                                      background: 'var(--cream)', color: 'var(--plum)',
                                      border: '1px solid var(--plum)',
                                    }}>
                                    🏷 {l.tag_number}
                                  </span>
                                )}
                              </div>
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
                  const frontUrl = p?.front ? thumbUrls.get(p.front) : null;
                  const backUrl = p?.back ? thumbUrls.get(p.back) : null;
                  const slotStyle: React.CSSProperties = {
                    width: 56, height: 78, borderRadius: 4,
                    background: 'var(--cream)', border: '1.5px solid var(--rule)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: 'var(--ink-mute)', overflow: 'hidden',
                  };
                  return (
                    <div key={l.id} style={{
                      display: 'grid', gridTemplateColumns: '40px 1fr 56px 56px 36px',
                      gap: 8, alignItems: 'center',
                      background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
                      padding: '8px 10px',
                    }}>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--orange)' }}>#{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: 'var(--plum)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {listingLabel(l)}
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>
                          {p?.front?.name || (p?.back ? '—' : 'no file')}{p?.front && p?.back ? ' · ' : ''}{p?.back?.name || ''}
                        </div>
                      </div>
                      <div style={slotStyle} title={p?.front?.name || 'front missing'}>
                        {frontUrl
                          ? <img loading="lazy" decoding="async" src={frontUrl} alt="front" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : '— F'}
                      </div>
                      <div style={slotStyle} title={p?.back?.name || 'back missing'}>
                        {backUrl
                          ? <img loading="lazy" decoding="async" src={backUrl} alt="back" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : '— B'}
                      </div>
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
              <div style={{ marginTop: 12 }}>
                <AIGradeToggle
                  enabled={aiEnabled}
                  onToggle={v => { setAiEnabled(v); saveAIGradePreference(v); }}
                  totalCost={0}
                  evaluatedCount={0}
                  totalCount={0}
                  softCapHit={false}
                  hardCapHit={false}
                  hardCap={ai.hardCap}
                />
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
          <section className="panel-bordered" style={{ padding: '28px 32px' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 10 }}>✓ Done</div>
              <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 20 }}>{savedSummary}</div>
            </div>

            {aiEnabled && savedItems.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ marginBottom: 10 }}>
                  <AIGradeToggle
                    enabled={aiEnabled}
                    onToggle={v => { setAiEnabled(v); saveAIGradePreference(v); }}
                    totalCost={ai.totalCost}
                    evaluatedCount={aiEvaluatedCount}
                    totalCount={savedItems.filter(it => it.image_front_url && it.image_back_url).length}
                    softCapHit={ai.softCapHit}
                    hardCapHit={ai.hardCapHit}
                    hardCap={ai.hardCap}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {savedItems.map(it => {
                    const status = ai.statuses[it.listingId];
                    return (
                      <div key={it.listingId} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 12px', border: '1.5px solid var(--rule)', borderRadius: 8,
                      }}>
                        <span style={{ fontSize: 13, color: 'var(--plum)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.label}
                        </span>
                        <AIGradeBadge
                          status={status}
                          appliedGrade={appliedGrades[it.listingId]}
                          onUseHigh={status?.state === 'done' ? () => {
                            setAppliedGrades(p => ({ ...p, [it.listingId]: status.result.grade_high }));
                            writeListingGrade(it.listingId, status.result.grade_high);
                          } : undefined}
                          onUseLow={status?.state === 'done' && appliedGrades[it.listingId] !== status.result.grade_low ? () => {
                            setAppliedGrades(p => ({ ...p, [it.listingId]: status.result.grade_low }));
                            writeListingGrade(it.listingId, status.result.grade_low);
                          } : undefined}
                          onUndo={status?.state === 'done' ? () => {
                            setAppliedGrades(p => {
                              const n = { ...p };
                              delete n[it.listingId];
                              return n;
                            });
                            writeListingGrade(it.listingId, it.prior_raw_grade);
                            ai.dismissResult(it.listingId);
                          } : undefined}
                          onRetry={status?.state === 'error' ? () => {
                            const listing = listings.find(l => l.id === it.listingId);
                            if (!listing) return;
                            autoAppliedRef.current.delete(it.listingId);
                            ai.retry({
                              id: it.listingId,
                              context: {
                                year: listing.year,
                                brand: listing.brand,
                                set_title: null,
                                card_number: listing.card_number,
                                player: listing.player,
                                image_front_url: it.image_front_url,
                                image_back_url: it.image_back_url || null,
                              },
                            });
                          } : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
