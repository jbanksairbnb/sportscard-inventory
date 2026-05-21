'use client';

import React, { useEffect, useState } from 'react';

// Read-only render of a seller's set contents on the public set listing
// page. Lives as a client component so we can wire up an image lightbox
// (clicking an image opens a fullscreen viewer; arrow keys cycle between
// Image 1 and Image 2 when both exist).

export type ContentsRow = {
  cardLabel: string;
  conditionLabel: string;
  images: string[];
};

export default function SetContentsTable({ rows }: { rows: ContentsRow[] }) {
  const [lbImages, setLbImages] = useState<string[] | null>(null);
  const [lbIdx, setLbIdx] = useState(0);

  function openLightbox(images: string[], startIdx: number) {
    if (images.length === 0) return;
    setLbImages(images);
    setLbIdx(startIdx);
  }
  function closeLightbox() { setLbImages(null); setLbIdx(0); }

  useEffect(() => {
    if (!lbImages) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (e.key === 'ArrowRight') setLbIdx(i => Math.min((lbImages?.length || 1) - 1, i + 1));
      if (e.key === 'ArrowLeft') setLbIdx(i => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lbImages]);

  if (rows.length === 0) {
    return (
      <div className="panel-bordered" style={{ padding: '40px 32px', textAlign: 'center', color: 'var(--ink-mute)' }}>
        The seller hasn&apos;t marked any cards as Owned in this set yet.
      </div>
    );
  }

  return (
    <>
      <div className="panel-bordered" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <tr>
              <th style={{ padding: '10px 14px', textAlign: 'left', width: 90 }}>Image</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Card</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Condition</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const first = r.images[0] || null;
              const clickable = r.images.length > 0;
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--rule)' }}>
                  <td style={{ padding: '8px 14px' }}>
                    <button type="button"
                      onClick={() => openLightbox(r.images, 0)}
                      disabled={!clickable}
                      title={clickable ? 'Click to enlarge' : 'No image'}
                      style={{
                        width: 64, height: 90, padding: 0,
                        background: 'var(--paper)', border: '1px solid var(--rule)',
                        borderRadius: 6, overflow: 'hidden',
                        display: 'grid', placeItems: 'center',
                        cursor: clickable ? 'zoom-in' : 'default',
                      }}>
                      {first ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img loading="lazy" decoding="async" src={first} alt={r.cardLabel}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span className="eyebrow" style={{ fontSize: 8, color: 'var(--ink-mute)' }}>—</span>
                      )}
                    </button>
                  </td>
                  <td style={{ padding: '8px 14px', fontSize: 13, color: 'var(--plum)', fontWeight: 600 }}>{r.cardLabel}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12.5, color: 'var(--ink-soft)' }}>{r.conditionLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lbImages && (
        <div onClick={closeLightbox}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(42,20,52,0.85)',
            display: 'grid', placeItems: 'center', padding: 20,
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lbImages[lbIdx]} alt=""
            style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, display: 'block' }}
            onClick={e => e.stopPropagation()} />
          {lbImages.length > 1 && (
            <>
              <button type="button"
                onClick={e => { e.stopPropagation(); setLbIdx(i => Math.max(0, i - 1)); }}
                disabled={lbIdx === 0}
                style={{
                  position: 'fixed', left: 20, top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--cream)', border: '2px solid var(--plum)', borderRadius: 100,
                  padding: '10px 14px', fontSize: 18, fontWeight: 700, color: 'var(--plum)',
                  cursor: lbIdx === 0 ? 'default' : 'pointer', opacity: lbIdx === 0 ? 0.4 : 1,
                }}>←</button>
              <button type="button"
                onClick={e => { e.stopPropagation(); setLbIdx(i => Math.min(lbImages.length - 1, i + 1)); }}
                disabled={lbIdx === lbImages.length - 1}
                style={{
                  position: 'fixed', right: 20, top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--cream)', border: '2px solid var(--plum)', borderRadius: 100,
                  padding: '10px 14px', fontSize: 18, fontWeight: 700, color: 'var(--plum)',
                  cursor: lbIdx === lbImages.length - 1 ? 'default' : 'pointer',
                  opacity: lbIdx === lbImages.length - 1 ? 0.4 : 1,
                }}>→</button>
              <div className="mono" style={{
                position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                background: 'var(--cream)', border: '1.5px solid var(--plum)', borderRadius: 100,
                padding: '4px 12px', fontSize: 12, color: 'var(--plum)', fontWeight: 700,
              }}>
                {lbIdx + 1} / {lbImages.length}
              </div>
            </>
          )}
          <button type="button" onClick={closeLightbox}
            style={{
              position: 'fixed', top: 18, right: 18,
              background: 'var(--cream)', border: '2px solid var(--plum)', borderRadius: 100,
              width: 36, height: 36, fontSize: 16, fontWeight: 700, color: 'var(--plum)',
              cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0,
            }}>×</button>
        </div>
      )}
    </>
  );
}
