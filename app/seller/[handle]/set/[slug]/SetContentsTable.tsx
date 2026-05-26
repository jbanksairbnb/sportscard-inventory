'use client';

import React, { useEffect, useMemo, useState } from 'react';

// Read-only render of a seller's set contents on the public set listing
// page. The lightbox cycles through every image in the listing (not just
// the two on the card the buyer clicked) so they can flip through the
// whole set without closing and re-opening per card.

export type ContentsRow = {
  cardLabel: string;
  conditionLabel: string;
  images: string[];
};

type FlatImage = { url: string; cardLabel: string; conditionLabel: string };

export default function SetContentsTable({ rows }: { rows: ContentsRow[] }) {
  const [lbIdx, setLbIdx] = useState<number | null>(null);

  // Single flat list across every card so prev/next walks the whole set.
  const allImages: FlatImage[] = useMemo(() => {
    const items: FlatImage[] = [];
    for (const r of rows) {
      for (const url of r.images) {
        items.push({ url, cardLabel: r.cardLabel, conditionLabel: r.conditionLabel });
      }
    }
    return items;
  }, [rows]);

  // Translate (row, sideIdx) to the flat index by summing prior rows'
  // image counts. Avoids relying on URL uniqueness in case a buyer is
  // looking at a set where the same image appears twice.
  function openLightbox(rowIdx: number, sideIdx: number) {
    if (rows[rowIdx]?.images.length === 0) return;
    let flat = 0;
    for (let i = 0; i < rowIdx; i++) flat += rows[i].images.length;
    setLbIdx(flat + sideIdx);
  }
  function closeLightbox() { setLbIdx(null); }

  useEffect(() => {
    if (lbIdx == null) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (e.key === 'ArrowRight') setLbIdx(i => (i == null ? null : Math.min(allImages.length - 1, i + 1)));
      if (e.key === 'ArrowLeft') setLbIdx(i => (i == null ? null : Math.max(0, i - 1)));
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lbIdx, allImages.length]);

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
                      onClick={() => openLightbox(i, 0)}
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

      {lbIdx != null && allImages[lbIdx] && (
        <div onClick={closeLightbox}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(42,20,52,0.85)',
            display: 'grid', placeItems: 'center', padding: 20,
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={allImages[lbIdx].url} alt=""
            style={{ maxWidth: '90vw', maxHeight: '82vh', borderRadius: 12, display: 'block' }}
            onClick={e => e.stopPropagation()} />
          {allImages.length > 1 && (
            <>
              <button type="button"
                onClick={e => { e.stopPropagation(); setLbIdx(i => (i == null ? null : Math.max(0, i - 1))); }}
                disabled={lbIdx === 0}
                style={{
                  position: 'fixed', left: 20, top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--cream)', border: '2px solid var(--plum)', borderRadius: 100,
                  padding: '10px 14px', fontSize: 18, fontWeight: 700, color: 'var(--plum)',
                  cursor: lbIdx === 0 ? 'default' : 'pointer', opacity: lbIdx === 0 ? 0.4 : 1,
                }}>←</button>
              <button type="button"
                onClick={e => { e.stopPropagation(); setLbIdx(i => (i == null ? null : Math.min(allImages.length - 1, i + 1))); }}
                disabled={lbIdx === allImages.length - 1}
                style={{
                  position: 'fixed', right: 20, top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--cream)', border: '2px solid var(--plum)', borderRadius: 100,
                  padding: '10px 14px', fontSize: 18, fontWeight: 700, color: 'var(--plum)',
                  cursor: lbIdx === allImages.length - 1 ? 'default' : 'pointer',
                  opacity: lbIdx === allImages.length - 1 ? 0.4 : 1,
                }}>→</button>
              <div style={{
                position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                background: 'var(--cream)', border: '1.5px solid var(--plum)', borderRadius: 12,
                padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                maxWidth: '92vw', justifyContent: 'center',
              }} onClick={e => e.stopPropagation()}>
                <span className="display" style={{ fontSize: 13, color: 'var(--plum)' }}>
                  {allImages[lbIdx].cardLabel}
                </span>
                <span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)' }}>
                  {allImages[lbIdx].conditionLabel}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700 }}>
                  {lbIdx + 1} / {allImages.length}
                </span>
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
