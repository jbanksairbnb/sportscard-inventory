'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isSeller } from '@/lib/sellerGuard';
import SCLogo from '@/components/SCLogo';
import MultiCardSplitter, { SplitResult } from '@/components/MultiCardSplitter';

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

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      if (!(await isSeller(supabase, user.id))) { router.replace('/marketplace'); return; }
      setUserId(user.id);
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
    setPhase('done');
  }

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
                          <img src={frontSrc} alt={`Front ${p}`} style={{
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
                            <img src={backSrc} alt={`Back at position ${p}`} style={{
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
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
          <div className="panel-bordered" style={{ padding: 28, textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>Done!</div>
            <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 18 }}>{savedSummary}</p>
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
            <img src={src} alt={`Position ${i + 1}`} style={{ width: '100%', display: 'block' }} />
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
