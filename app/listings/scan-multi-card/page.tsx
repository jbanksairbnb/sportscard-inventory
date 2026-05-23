'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isSeller } from '@/lib/sellerGuard';
import { getScanQuota, BUYER_PHOTO_CAP, type ScanQuota } from '@/lib/scanQuota';
import SCLogo from '@/components/SCLogo';
import MultiCardSplitter, { SplitResult } from '@/components/MultiCardSplitter';
import AIGradeBadge from '@/components/AIGradeBadge';
import AIGradeToggle, { loadAIGradePreference, saveAIGradePreference } from '@/components/AIGradeToggle';
import { useAIGrade, type AIGradeItem } from '@/lib/ai/use-ai-grade';

type CardRow = Record<string, unknown>;
type SetSummary = {
  user_id: string;
  slug: string;
  title: string | null;
  year: number | null;
  brand: string | null;
  row_count: number | null;
};
type FullSet = SetSummary & { rows: CardRow[] };

type Phase = 'pick-set' | 'fronts' | 'backs' | 'assign' | 'saving' | 'done';

const POSITIONS = [1, 2, 3, 4, 5, 6] as const;

function rowLabel(r: CardRow): string {
  const num = r['Card #'];
  const player = r['Player'] || r['Description'];
  return [num ? `#${num}` : '', player || ''].filter(Boolean).join(' ').trim() || '(unnamed card)';
}

export default function ScanMultiCardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');
  const [quota, setQuota] = useState<ScanQuota | null>(null);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [currentSet, setCurrentSet] = useState<FullSet | null>(null);
  const [phase, setPhase] = useState<Phase>('pick-set');
  const [setQuery, setSetQuery] = useState('');
  const [error, setError] = useState('');

  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [splittingFront, setSplittingFront] = useState(false);
  const [splittingBack, setSplittingBack] = useState(false);
  const [frontSplit, setFrontSplit] = useState<SplitResult | null>(null);
  const [backSplit, setBackSplit] = useState<SplitResult | null>(null);

  // position 1..6 -> origIndex into rows
  const [assignment, setAssignment] = useState<Record<number, number | null>>({
    1: null, 2: null, 3: null, 4: null, 5: null, 6: null,
  });
  // backOrder[p-1] = which back image (0..5 or null) is paired with front at position p.
  // Defaults to identity (back N pairs with front N), but the user can rearrange via
  // drag-and-drop because flipping a 2x3 sheet often mirrors the back layout.
  const [backOrder, setBackOrder] = useState<(number | null)[]>([0, 1, 2, 3, 4, 5]);
  const [draggingPos, setDraggingPos] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const [savedSummary, setSavedSummary] = useState('');

  // AI grading hook + per-session toggle (persisted to localStorage so
  // sellers' preference survives across scan flows and sessions).
  const [aiEnabled, setAiEnabled] = useState(true);
  useEffect(() => { setAiEnabled(loadAIGradePreference()); }, []);
  const ai = useAIGrade({ enabled: aiEnabled });
  // After-save snapshot: what was saved, so we can render badges + apply
  // AI suggestions back to the set rows. prior_raw_grade is what the cell
  // held before AI overwrote it, used for the badge's "Undo" action.
  const [savedItems, setSavedItems] = useState<Array<{
    origIndex: number;
    cardNumber: string;
    player: string;
    image_front_url: string;
    image_back_url: string;
    prior_raw_grade: string;
  }>>([]);
  // Tracks which rows have had AI grade_low auto-applied. Prevents the
  // useEffect from firing the write twice if React re-renders.
  const autoAppliedRef = useRef<Set<number>>(new Set());
  // Latest applied grade per row (for the badge label after Use High).
  const [appliedGrades, setAppliedGrades] = useState<Record<number, string>>({});
  // Serial queue for DB writes — multiple AI results land in parallel,
  // each does a read-modify-write on the same rows JSON, so we chain
  // them through a single Promise to avoid lost updates.
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const aiEvaluatedCount = Object.values(ai.statuses).filter(s => s.state === 'done' || s.state === 'error').length;

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const sellerFlag = await isSeller(supabase, user.id);
      setUserId(user.id);
      setQuota(await getScanQuota(supabase, user.id, sellerFlag));
      const { data: setsData } = await supabase
        .from('sets')
        .select('user_id, slug, title, year, brand, row_count')
        .eq('user_id', user.id)
        .order('year', { ascending: false });
      setSets((setsData || []) as SetSummary[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const filteredSets = useMemo(() => {
    const q = setQuery.toLowerCase().trim();
    if (!q) return sets;
    return sets.filter(s => {
      const hay = [s.title, s.brand, s.year ? String(s.year) : ''].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [sets, setQuery]);

  async function pickSet(slug: string) {
    setError('');
    const supabase = createClient();
    const { data, error: e } = await supabase
      .from('sets')
      .select('user_id, slug, title, year, brand, row_count, rows')
      .eq('slug', slug)
      .maybeSingle();
    if (e || !data) { setError(e?.message || 'Could not load set'); return; }
    setCurrentSet(data as FullSet);
    setPhase('fronts');
  }

  function handleFrontFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFrontFile(f);
  }
  function handleBackFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setBackFile(f);
  }

  function onFrontSplit(result: SplitResult) {
    setSplittingFront(true);
    // Free old preview URLs.
    if (frontSplit) frontSplit.previews.forEach(URL.revokeObjectURL);
    setFrontSplit(result);
    setSplittingFront(false);
  }
  function onBackSplit(result: SplitResult) {
    setSplittingBack(true);
    if (backSplit) backSplit.previews.forEach(URL.revokeObjectURL);
    setBackSplit(result);
    setSplittingBack(false);
  }

  async function handleSave() {
    if (!currentSet || !userId || !frontSplit) {
      setError('Need a set and split fronts before saving.');
      return;
    }
    const assignedPositions = POSITIONS.filter(p => assignment[p] !== null);
    if (assignedPositions.length === 0) {
      setError('Assign at least one position to a card.');
      return;
    }
    // Multi-card upload writes one front + one back per assigned position;
    // a fully assigned 2x3 grid is 12 photos. Refuse if a buyer is over.
    const photosToWrite = assignedPositions.length * 2;
    if (quota && !quota.hasRoom(photosToWrite)) {
      setError(
        `You'd be over the ${BUYER_PHOTO_CAP}-photo limit (currently ${quota.used} stored, this would add ${photosToWrite}). ` +
        `Apply to sell from your home page to unlock unlimited scans.`
      );
      return;
    }
    setError('');
    setPhase('saving');
    const supabase = createClient();
    const updatedRows: CardRow[] = [...(currentSet.rows || [])];
    let attached = 0;

    for (const position of assignedPositions) {
      const origIndex = assignment[position]!;
      const frontBlob = frontSplit.blobs[position - 1];
      const backIdx = backOrder[position - 1];
      const backBlob = (backSplit && backIdx !== null && backIdx !== undefined)
        ? backSplit.blobs[backIdx] || null
        : null;
      try {
        const frontPath = `${userId}/${currentSet.slug}/${origIndex}/img1.png`;
        const { error: fErr } = await supabase.storage
          .from('card-images')
          .upload(frontPath, frontBlob, { upsert: true, contentType: 'image/png' });
        if (fErr) throw new Error(`Front #${origIndex}: ${fErr.message}`);
        const { data: fPub } = supabase.storage.from('card-images').getPublicUrl(frontPath);
        updatedRows[origIndex] = {
          ...(updatedRows[origIndex] || {}),
          'Image 1': `${fPub.publicUrl}?t=${Date.now()}`,
        };
        if (backBlob) {
          const backPath = `${userId}/${currentSet.slug}/${origIndex}/img2.png`;
          const { error: bErr } = await supabase.storage
            .from('card-images')
            .upload(backPath, backBlob, { upsert: true, contentType: 'image/png' });
          if (bErr) throw new Error(`Back #${origIndex}: ${bErr.message}`);
          const { data: bPub } = supabase.storage.from('card-images').getPublicUrl(backPath);
          updatedRows[origIndex] = {
            ...(updatedRows[origIndex] || {}),
            'Image 2': `${bPub.publicUrl}?t=${Date.now()}`,
          };
        }
        if (!updatedRows[origIndex]['Owned']) {
          updatedRows[origIndex] = { ...updatedRows[origIndex], Owned: 'Yes' };
        }
        attached++;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
        setPhase('assign');
        return;
      }
    }

    const ownedCount = updatedRows.filter(r => String(r['Owned'] || '') === 'Yes').length;
    const total = updatedRows.length;
    const ownedPct = total > 0 ? (ownedCount / total) * 100 : 0;
    const { error: updErr } = await supabase.from('sets')
      .update({
        rows: updatedRows,
        owned_count: ownedCount,
        owned_pct: ownedPct,
        updated_at: Date.now(),
      })
      .eq('user_id', userId)
      .eq('slug', currentSet.slug);
    if (updErr) {
      setError(`Set update failed: ${updErr.message}`);
      setPhase('assign');
      return;
    }
    setSavedSummary(`${attached} card${attached === 1 ? '' : 's'} updated in ${currentSet.title || currentSet.slug}`);

    // Snapshot what we saved so we can render rows + apply AI suggestions
    // back to the set. Only rows with BOTH images participate in AI grading
    // (front-only would give a confidence-low result; not worth the spend).
    const snapshot: typeof savedItems = [];
    const aiItems: AIGradeItem[] = [];
    for (const position of assignedPositions) {
      const origIndex = assignment[position]!;
      const row = updatedRows[origIndex] || {};
      const front = String(row['Image 1'] || '');
      const back = String(row['Image 2'] || '');
      const cardNumber = String(row['Card #'] || '');
      const player = String(row['Player'] || row['Description'] || '');
      const priorRawGrade = String(row['Raw Grade'] || '');
      snapshot.push({ origIndex, cardNumber, player, image_front_url: front, image_back_url: back, prior_raw_grade: priorRawGrade });
      // Skip cards that are already professionally graded — actual grade
      // is truth. Front-only or back-only scans still get graded with a
      // low-confidence result rather than being silently dropped.
      const alreadyGraded = String(row['Grading Company'] || '').trim() !== '';
      if (front && !alreadyGraded) {
        aiItems.push({
          id: String(origIndex),
          context: {
            year: currentSet.year ?? null,
            brand: currentSet.brand ?? null,
            set_title: currentSet.title ?? null,
            card_number: cardNumber || null,
            player: player || null,
            image_front_url: front,
            image_back_url: back || null,
          },
        });
      }
    }
    setSavedItems(snapshot);
    setPhase('done');
    if (aiEnabled && aiItems.length > 0) {
      // Fire-and-forget — the 'done' phase renders evaluation progress.
      ai.evaluate(aiItems);
    }
  }

  // Write Raw Grade to the set row, overwriting any existing value. Passing
  // empty string clears the field (used by Undo). All writes are serialized
  // through writeQueueRef so concurrent AI results don't clobber each other.
  function writeRawGrade(origIndex: number, rawGrade: string) {
    if (!currentSet || !userId) return Promise.resolve();
    const slug = currentSet.slug;
    const uid = userId;
    const next = writeQueueRef.current.then(async () => {
      const supabase = createClient();
      const { data: latest } = await supabase.from('sets')
        .select('rows').eq('user_id', uid).eq('slug', slug).maybeSingle();
      const rows: CardRow[] = Array.isArray(latest?.rows) ? [...(latest!.rows as CardRow[])] : [];
      if (!rows[origIndex]) return;
      const updated = { ...rows[origIndex] };
      if (rawGrade) updated['Raw Grade'] = rawGrade; else delete updated['Raw Grade'];
      rows[origIndex] = updated;
      await supabase.from('sets').update({ rows, updated_at: Date.now() })
        .eq('user_id', uid).eq('slug', slug);
    });
    writeQueueRef.current = next.catch(() => {});
    return next;
  }

  // Auto-apply AI grade_low as soon as each evaluation lands. Overwrites
  // any prior Raw Grade — that prior value lives on savedItems for Undo.
  useEffect(() => {
    for (const it of savedItems) {
      const s = ai.statuses[String(it.origIndex)];
      if (s?.state !== 'done') continue;
      if (autoAppliedRef.current.has(it.origIndex)) continue;
      autoAppliedRef.current.add(it.origIndex);
      const low = s.result.grade_low;
      setAppliedGrades(prev => ({ ...prev, [it.origIndex]: low }));
      writeRawGrade(it.origIndex, low);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.statuses, savedItems]);

  function startOver() {
    if (frontSplit) frontSplit.previews.forEach(URL.revokeObjectURL);
    if (backSplit) backSplit.previews.forEach(URL.revokeObjectURL);
    setCurrentSet(null);
    setPhase('pick-set');
    setFrontFile(null);
    setBackFile(null);
    setFrontSplit(null);
    setBackSplit(null);
    setAssignment({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null });
    setBackOrder([0, 1, 2, 3, 4, 5]);
    setSavedSummary('');
    setError('');
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Multi-Card Scan ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 28px 80px' }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {(['pick-set', 'fronts', 'backs', 'assign'] as Phase[]).map((p, i) => (
            <div key={p} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: phaseAt(phase, p) ? 'var(--orange)' : 'var(--rule)',
            }} />
          ))}
        </div>

        {phase === 'pick-set' && (
          <section className="panel-bordered" style={{ padding: '20px 24px' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 6 }}>Pick a set</div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 14 }}>
              All 6 cards from this scan will be assigned to rows in this set. (One set per scan session.)
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', marginBottom: 12,
            }}>
              <span>🔍</span>
              <input value={setQuery} onChange={e => setSetQuery(e.target.value)}
                placeholder="Search sets…" autoFocus
                style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 13, color: 'var(--plum)' }} />
            </div>
            {filteredSets.length === 0 ? (
              <div className="eyebrow" style={{ textAlign: 'center', padding: 20, color: 'var(--ink-mute)' }}>No sets found.</div>
            ) : (
              <div style={{ maxHeight: 460, overflowY: 'auto', display: 'grid', gap: 6 }}>
                {filteredSets.map(s => (
                  <button key={s.slug} type="button" onClick={() => pickSet(s.slug)}
                    style={{
                      textAlign: 'left', padding: '12px 14px',
                      border: '1.5px solid var(--rule)', borderRadius: 10,
                      background: 'var(--paper)', cursor: 'pointer',
                    }}>
                    <div className="display" style={{ fontSize: 14, color: 'var(--plum)' }}>
                      {s.title || `${s.year || ''} ${s.brand || ''}`.trim() || s.slug}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                      {s.year || '—'} · {s.brand || '—'} · {s.row_count || 0} rows
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {phase === 'fronts' && (
          <section className="panel-bordered" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>
                Step 1 — Upload the FRONTS
              </div>
              <button onClick={() => setPhase('pick-set')} className="btn btn-ghost btn-sm">← Back</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 14 }}>
              One image with 6 card fronts in a 2-row × 3-column grid. Drag the orange handles to align.
            </p>

            {!frontFile ? (
              <FileUpload onChange={handleFrontFile} label="Choose front-side scan…" />
            ) : (
              <>
                <MultiCardSplitter file={frontFile} onSplit={onFrontSplit} splitting={splittingFront} />
                {frontSplit && <SplitPreview previews={frontSplit.previews} title="Fronts (positions 1–6)" />}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => { setFrontFile(null); setFrontSplit(null); }} className="btn btn-ghost btn-sm">↺ Choose a different image</button>
                  {frontSplit && (
                    <button type="button" onClick={() => setPhase('backs')} className="btn btn-primary">Next: Backs →</button>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {phase === 'backs' && (
          <section className="panel-bordered" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>
                Step 2 — Upload the BACKS (optional)
              </div>
              <button onClick={() => setPhase('fronts')} className="btn btn-ghost btn-sm">← Back</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 14 }}>
              Same 2×3 grid as the fronts. Position 1 should match position 1 on the fronts. Skip if you only have fronts.
            </p>

            {!backFile ? (
              <>
                <FileUpload onChange={handleBackFile} label="Choose back-side scan… (optional)" />
                <div style={{ textAlign: 'center', marginTop: 14 }}>
                  <button onClick={() => setPhase('assign')} className="btn btn-outline btn-sm">Skip — no backs</button>
                </div>
              </>
            ) : (
              <>
                <MultiCardSplitter file={backFile} onSplit={onBackSplit} splitting={splittingBack} />
                {backSplit && <SplitPreview previews={backSplit.previews} title="Backs (positions 1–6)" />}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => { setBackFile(null); setBackSplit(null); }} className="btn btn-ghost btn-sm">↺ Choose a different image</button>
                  {backSplit && (
                    <button type="button" onClick={() => setPhase('assign')} className="btn btn-primary">Next: Assign →</button>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {phase === 'assign' && currentSet && frontSplit && (
          <section className="panel-bordered" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>
                Step 3 — Assign each position to a card
              </div>
              <button onClick={() => setPhase('backs')} className="btn btn-ghost btn-sm">← Back</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 14 }}>
              Pick the card row for each grid position. Skip a position by leaving it blank.
              {backSplit && <> The backs start in their split order — <strong>drag a back onto another back to swap them</strong> if your back scan was flipped.</>}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
              {POSITIONS.map(p => {
                const frontSrc = frontSplit.previews[p - 1];
                const backIdx = backOrder[p - 1];
                const backSrc = (backSplit && backIdx !== null && backIdx !== undefined) ? backSplit.previews[backIdx] : null;
                const isDragging = draggingPos === p;
                const isHover = hoverPos === p && draggingPos !== null && draggingPos !== p;
                return (
                  <div key={p} className="panel" style={{ padding: 16, border: '1.5px solid var(--rule)' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                      <div style={{
                        width: 36, height: 36, background: 'var(--plum)', color: 'var(--mustard)',
                        display: 'grid', placeItems: 'center', borderRadius: 8,
                        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
                      }}>{p}</div>
                      <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', letterSpacing: '0.16em' }}>
                        Position {p}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 12, marginBottom: 12, justifyContent: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>Front</div>
                        {frontSrc && (
                          <img loading="lazy" decoding="async" src={frontSrc} alt={`Front ${p}`} style={{
                            width: 110, height: 154, objectFit: 'cover', borderRadius: 6,
                            border: '2px solid var(--plum)', boxShadow: '0 2px 0 var(--plum)',
                          }} />
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>Back</div>
                        {backSrc && backSplit ? (
                          <div
                            draggable
                            onDragStart={(e) => {
                              setDraggingPos(p);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', String(p));
                            }}
                            onDragEnd={() => { setDraggingPos(null); setHoverPos(null); }}
                            onDragOver={(e) => {
                              if (draggingPos === null || draggingPos === p) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              setHoverPos(p);
                            }}
                            onDragLeave={() => { if (hoverPos === p) setHoverPos(null); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const from = Number(e.dataTransfer.getData('text/plain') || draggingPos || 0);
                              if (!from || from === p) return;
                              setBackOrder(prev => {
                                const next = [...prev];
                                const a = next[from - 1];
                                const b = next[p - 1];
                                next[from - 1] = b;
                                next[p - 1] = a;
                                return next;
                              });
                              setDraggingPos(null);
                              setHoverPos(null);
                            }}
                            title="Drag onto another back to swap"
                            style={{
                              position: 'relative', cursor: 'grab',
                              borderRadius: 6, overflow: 'hidden',
                              border: isHover ? '3px dashed var(--teal)' : '2px solid var(--plum)',
                              boxShadow: isDragging ? 'none' : '0 2px 0 var(--plum)',
                              opacity: isDragging ? 0.4 : 1,
                              transition: 'opacity 100ms',
                            }}
                          >
                            <img loading="lazy" decoding="async" src={backSrc} alt={`Back at position ${p}`} style={{
                              width: 110, height: 154, objectFit: 'cover', display: 'block',
                              pointerEvents: 'none',
                            }} />
                            <div style={{
                              position: 'absolute', top: 4, left: 4,
                              background: 'var(--plum)', color: 'var(--mustard)',
                              padding: '1px 6px', borderRadius: 100,
                              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
                              fontFamily: 'var(--font-display)',
                              pointerEvents: 'none',
                            }}>
                              from B{(backIdx as number) + 1}
                            </div>
                            <div style={{
                              position: 'absolute', bottom: 4, right: 4,
                              background: 'rgba(42,20,52,0.7)', color: 'var(--cream)',
                              padding: '1px 5px', borderRadius: 4,
                              fontSize: 9, fontWeight: 700,
                              pointerEvents: 'none',
                            }}>↔ drag</div>
                          </div>
                        ) : (
                          <div
                            onDragOver={(e) => {
                              if (draggingPos === null || draggingPos === p) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              setHoverPos(p);
                            }}
                            onDragLeave={() => { if (hoverPos === p) setHoverPos(null); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const from = Number(e.dataTransfer.getData('text/plain') || draggingPos || 0);
                              if (!from || from === p) return;
                              setBackOrder(prev => {
                                const next = [...prev];
                                const a = next[from - 1];
                                const b = next[p - 1];
                                next[from - 1] = b;
                                next[p - 1] = a;
                                return next;
                              });
                              setDraggingPos(null);
                              setHoverPos(null);
                            }}
                            style={{
                              width: 110, height: 154, borderRadius: 6,
                              border: isHover ? '3px dashed var(--teal)' : '2px dashed var(--rule)',
                              background: 'var(--paper)',
                              display: 'grid', placeItems: 'center',
                              fontSize: 10, color: 'var(--ink-mute)', textAlign: 'center', padding: 8,
                            }}>
                            {backSplit ? 'Empty — drop a back here' : 'No backs uploaded'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 4, fontWeight: 700 }}>
                      Assign to card
                    </div>
                    <CardPicker
                      rows={currentSet.rows || []}
                      value={assignment[p]}
                      onChange={(v) => setAssignment(prev => ({ ...prev, [p]: v }))}
                    />
                  </div>
                );
              })}
            </div>
            {backSplit && (
              <p className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 10, textAlign: 'center' }}>
                The badge on each back shows its original split index. Drag any back card onto another to swap them.
              </p>
            )}

            {error && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(192,57,43,0.12)', border: '1.5px solid var(--rust)', borderRadius: 8, color: 'var(--rust)', fontSize: 12.5, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{ marginTop: 14 }}>
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

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              {quota && quota.isCapped && (
                <span className="mono" title="Buyers are capped at 100 photos. Sellers are uncapped."
                  style={{
                    fontSize: 11, fontWeight: 700, marginRight: 'auto',
                    color: quota.remaining === 0 ? 'var(--rust)' : quota.remaining < 20 ? 'var(--orange)' : 'var(--ink-mute)',
                    padding: '4px 10px', border: '1.5px solid var(--rule)', borderRadius: 100,
                  }}>
                  {quota.used} / {BUYER_PHOTO_CAP} photos
                </span>
              )}
              <button onClick={startOver} className="btn btn-ghost">Start over</button>
              <button onClick={handleSave} className="btn btn-primary">Save & attach images →</button>
            </div>
          </section>
        )}

        {phase === 'saving' && (
          <div className="panel-bordered" style={{ padding: 40, textAlign: 'center' }}>
            <div className="eyebrow" style={{ color: 'var(--ink-mute)' }}>Uploading and updating set…</div>
          </div>
        )}

        {phase === 'done' && (
          <div className="panel-bordered" style={{ padding: 28 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>Done!</div>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 18 }}>{savedSummary}</p>
            </div>

            {aiEnabled && savedItems.length > 0 && (
              <section style={{ marginTop: 8, marginBottom: 18 }}>
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
                    const status = ai.statuses[String(it.origIndex)];
                    return (
                      <div key={it.origIndex} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 12px', border: '1.5px solid var(--rule)', borderRadius: 8,
                      }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', minWidth: 50 }}>
                          #{it.cardNumber || '—'}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--plum)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.player || '(unnamed)'}
                        </span>
                        <AIGradeBadge
                          status={status}
                          appliedGrade={appliedGrades[it.origIndex]}
                          // grade_low is auto-applied on result; the button
                          // switches to grade_high. Undo restores prior_raw_grade.
                          onUseHigh={status?.state === 'done' ? () => {
                            setAppliedGrades(p => ({ ...p, [it.origIndex]: status.result.grade_high }));
                            writeRawGrade(it.origIndex, status.result.grade_high);
                          } : undefined}
                          onUseLow={status?.state === 'done' && appliedGrades[it.origIndex] !== status.result.grade_low ? () => {
                            setAppliedGrades(p => ({ ...p, [it.origIndex]: status.result.grade_low }));
                            writeRawGrade(it.origIndex, status.result.grade_low);
                          } : undefined}
                          onUndo={status?.state === 'done' ? () => {
                            setAppliedGrades(p => {
                              const n = { ...p };
                              delete n[it.origIndex];
                              return n;
                            });
                            writeRawGrade(it.origIndex, it.prior_raw_grade);
                            ai.dismissResult(String(it.origIndex));
                          } : undefined}
                          onRetry={status?.state === 'error' && currentSet ? () => {
                            autoAppliedRef.current.delete(it.origIndex);
                            ai.retry({
                              id: String(it.origIndex),
                              context: {
                                year: currentSet.year ?? null,
                                brand: currentSet.brand ?? null,
                                set_title: currentSet.title ?? null,
                                card_number: it.cardNumber || null,
                                player: it.player || null,
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
              </section>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={startOver} className="btn btn-primary">Scan another sheet</button>
              {currentSet && (
                <Link href={`/set/${encodeURIComponent(currentSet.slug)}`} className="btn btn-outline">View set →</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function phaseAt(current: Phase, target: Phase): boolean {
  const order: Phase[] = ['pick-set', 'fronts', 'backs', 'assign'];
  return order.indexOf(current) >= order.indexOf(target);
}

function FileUpload({ onChange, label }: { onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; label: string }) {
  return (
    <label style={{
      display: 'block', padding: '40px 20px', textAlign: 'center',
      border: '2px dashed var(--plum)', borderRadius: 12,
      background: 'var(--paper)', cursor: 'pointer',
    }}>
      <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 6 }}>{label}</div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)' }}>JPG / PNG. Best results with a flat-bed scan or steady overhead photo.</p>
      <input type="file" accept="image/*" onChange={onChange} style={{ display: 'none' }} />
    </label>
  );
}

function SplitPreview({ previews, title }: { previews: string[]; title: string }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700, marginBottom: 8, letterSpacing: '0.16em' }}>
        ✓ {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {previews.map((src, i) => (
          <div key={i} style={{
            position: 'relative', borderRadius: 6, overflow: 'hidden',
            border: '1.5px solid var(--plum)', boxShadow: '0 1px 0 var(--plum)',
          }}>
            <img loading="lazy" decoding="async" src={src} alt={`Position ${i + 1}`} style={{ width: '100%', display: 'block' }} />
            <div style={{
              position: 'absolute', top: 4, left: 4,
              background: 'var(--plum)', color: 'var(--mustard)',
              padding: '1px 6px', borderRadius: 100,
              fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-display)',
            }}>{i + 1}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardPicker({ rows, value, onChange }: {
  rows: CardRow[];
  value: number | null | undefined;
  onChange: (idx: number | null) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = (value !== null && value !== undefined) ? rows[value] : null;
  const selectedLabel = selected ? rowLabel(selected) : '';

  // Close when clicking outside.
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = rows.map((r, i) => ({ row: r, origIndex: i }));
    if (!q) return all.slice(0, 50);
    return all.filter(({ row }) => {
      const num = String(row['Card #'] ?? '').toLowerCase();
      const player = String(row['Player'] ?? row['Description'] ?? '').toLowerCase();
      return num.includes(q) || player.includes(q);
    }).slice(0, 50);
  }, [rows, query]);

  React.useEffect(() => { setHighlight(0); }, [query]);

  function pick(idx: number | null) {
    onChange(idx);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[highlight]) pick(matches[highlight].origIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {selected && !open ? (
        <div onClick={() => { setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 0); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px',
            border: '1.5px solid var(--plum)', borderRadius: 6,
            background: 'rgba(45,122,110,0.10)', cursor: 'pointer',
            fontSize: 12, color: 'var(--plum)', fontWeight: 600,
          }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ✓ {selectedLabel}
          </span>
          <button type="button" onClick={(e) => { e.stopPropagation(); pick(null); }}
            title="Clear"
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--ink-mute)', cursor: 'pointer',
              fontSize: 14, padding: 0, lineHeight: 1,
            }}>✕</button>
        </div>
      ) : (
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search by # or player…"
          className="input-sc"
          style={{ width: '100%', fontSize: 12 }}
        />
      )}
      {open && !selected && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--cream)', border: '1.5px solid var(--plum)',
          borderRadius: 8, boxShadow: '0 6px 16px rgba(42,20,52,0.18)',
          maxHeight: 280, overflowY: 'auto', zIndex: 50,
        }}>
          <button type="button" onClick={() => pick(null)}
            style={{
              width: '100%', textAlign: 'left',
              padding: '8px 12px', borderBottom: '1px solid var(--rule)',
              background: 'transparent', cursor: 'pointer',
              fontSize: 11.5, color: 'var(--ink-mute)', fontStyle: 'italic',
            }}>— Skip / leave blank —</button>
          {matches.length === 0 ? (
            <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--ink-mute)' }}>
              No matches.
            </div>
          ) : matches.map(({ row, origIndex }, i) => (
            <button key={origIndex} type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(origIndex)}
              style={{
                width: '100%', textAlign: 'left',
                padding: '7px 12px',
                background: highlight === i ? 'rgba(184, 146, 58, 0.22)' : 'transparent',
                border: 'none', borderTop: i > 0 ? '1px solid var(--rule)' : 'none',
                cursor: 'pointer',
                fontSize: 12.5, color: 'var(--plum)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
              <span className="mono" style={{ fontWeight: 700, color: 'var(--orange)', minWidth: 32 }}>
                #{String(row['Card #'] ?? '').trim() || '—'}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {String(row['Player'] ?? row['Description'] ?? '(unnamed)') || '(unnamed)'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
