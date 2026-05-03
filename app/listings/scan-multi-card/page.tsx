'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
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
  const [savedSummary, setSavedSummary] = useState('');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
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
      const backBlob = backSplit?.blobs[position - 1] || null;
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
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {POSITIONS.map(p => {
                const frontSrc = frontSplit.previews[p - 1];
                const backSrc = backSplit?.previews[p - 1];
                return (
                  <div key={p} className="panel" style={{ padding: 14, border: '1.5px solid var(--rule)' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                      <div style={{
                        width: 32, height: 32, background: 'var(--plum)', color: 'var(--mustard)',
                        display: 'grid', placeItems: 'center', borderRadius: 8,
                        fontFamily: 'var(--font-display)', fontWeight: 700,
                      }}>{p}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {frontSrc && <img src={frontSrc} alt="" style={{ width: 36, height: 50, objectFit: 'cover', borderRadius: 4, border: '1.5px solid var(--plum)' }} />}
                        {backSrc && <img src={backSrc} alt="" style={{ width: 36, height: 50, objectFit: 'cover', borderRadius: 4, border: '1.5px solid var(--plum)' }} />}
                      </div>
                    </div>
                    <select value={assignment[p] ?? ''}
                      onChange={e => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        setAssignment(prev => ({ ...prev, [p]: v }));
                      }}
                      className="input-sc" style={{ width: '100%', fontSize: 12 }}>
                      <option value="">— Skip / leave blank —</option>
                      {(currentSet.rows || []).map((r, i) => (
                        <option key={i} value={i}>{rowLabel(r)}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

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
