'use client';

import React, { useEffect, useState } from 'react';

// Public-page photo gallery: big hero image, thumbnail strip, and a
// full-screen lightbox with keyboard / swipe-friendly prev-next.

export default function ListingGallery({ photos, alt }: { photos: string[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const n = photos.length;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'ArrowRight') setIdx(i => (i + 1) % n);
      else if (e.key === 'ArrowLeft') setIdx(i => (i - 1 + n) % n);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, n]);

  if (n === 0) {
    return (
      <div className="panel-bordered" style={{ aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 14 }}>
        No photos yet
      </div>
    );
  }

  const navBtn: React.CSSProperties = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 44, height: 44,
    borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)', fontSize: 22, cursor: 'pointer',
  };

  return (
    <div>
      <div className="panel-bordered" style={{ position: 'relative', padding: 8, background: '#fff' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[idx]} alt={`${alt} — photo ${idx + 1}`} onClick={() => setOpen(true)}
          style={{ width: '100%', maxHeight: 560, objectFit: 'contain', display: 'block', cursor: 'zoom-in' }} />
        {n > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => setIdx((idx - 1 + n) % n)} style={{ ...navBtn, left: 12 }}>‹</button>
            <button type="button" aria-label="Next photo" onClick={() => setIdx((idx + 1) % n)} style={{ ...navBtn, right: 12 }}>›</button>
            <span style={{ position: 'absolute', bottom: 14, right: 16, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 100 }}>
              {idx + 1} / {n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p + i} src={p} alt="" onClick={() => setIdx(i)} loading="lazy"
              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                border: i === idx ? '3px solid var(--orange)' : '2px solid var(--plum)', opacity: i === idx ? 1 : 0.8 }} />
          ))}
        </div>
      )}
      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[idx]} alt={alt} onClick={e => e.stopPropagation()}
            style={{ maxWidth: '95vw', maxHeight: '92vh', objectFit: 'contain' }} />
          {n > 1 && (
            <>
              <button type="button" aria-label="Previous photo" onClick={e => { e.stopPropagation(); setIdx((idx - 1 + n) % n); }} style={{ ...navBtn, left: 16 }}>‹</button>
              <button type="button" aria-label="Next photo" onClick={e => { e.stopPropagation(); setIdx((idx + 1) % n); }} style={{ ...navBtn, right: 16 }}>›</button>
            </>
          )}
          <button type="button" aria-label="Close" onClick={() => setOpen(false)}
            style={{ position: 'absolute', top: 14, right: 18, background: 'none', border: 'none', color: '#fff', fontSize: 32, cursor: 'pointer' }}>×</button>
        </div>
      )}
    </div>
  );
}
