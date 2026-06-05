'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { thumbUrl } from '@/lib/image-transform';

// Read-only grid for the public seller storefront. Visitors can browse photos
// (lightbox) but cannot buy: every purchase affordance is a "Log in to buy"
// link to /login. No Supabase calls happen here — all data arrives as props
// from the server component, which read it with the service-role key.

export type StorefrontItem = {
  id: string;
  title: string;
  description: string | null;
  conditionLabel: string;
  askingPrice: number | null;
  photos: string[];
  isSet: boolean;
  setHref: string | null;
};

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function PhotoLightbox({ urls, startIdx, onClose }: { urls: string[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIdx);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIdx(i => Math.min(urls.length - 1, i + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [urls.length, onClose]);

  const arrowBtn: React.CSSProperties = {
    background: 'rgba(42,20,52,0.7)', color: 'var(--cream)',
    border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 24,
    cursor: 'pointer', lineHeight: 1,
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 250,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(42, 20, 52, 0.92)',
    }} onClick={onClose}>
      <div style={{ position: 'relative', padding: 16 }} onClick={e => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={urls[idx]} alt="Listing" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, display: 'block' }} />
        {urls.length > 1 && (
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <button type="button" onClick={e => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)); }}
              style={{ ...arrowBtn, opacity: idx === 0 ? 0.25 : 1 }} disabled={idx === 0}>‹</button>
            <button type="button" onClick={e => { e.stopPropagation(); setIdx(i => Math.min(urls.length - 1, i + 1)); }}
              style={{ ...arrowBtn, opacity: idx === urls.length - 1 ? 0.25 : 1 }} disabled={idx === urls.length - 1}>›</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm" style={{ position: 'absolute', top: 4, right: 4 }}>✕ Close</button>
      </div>
    </div>
  );
}

export default function StorefrontListings({ items }: { items: StorefrontItem[] }) {
  const [lightboxPhotos, setLightboxPhotos] = useState<string[] | null>(null);

  if (items.length === 0) {
    return (
      <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>Nothing for sale right now</div>
        <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>This seller doesn&apos;t have any active listings at the moment.</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {items.map(l => (
          <div key={l.id} className="panel-bordered" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div
              onClick={() => l.photos.length > 0 && setLightboxPhotos(l.photos)}
              style={{
                width: '100%', aspectRatio: '4/3', background: 'var(--paper)',
                display: 'grid', placeItems: 'center', overflow: 'hidden',
                borderBottom: '2px solid var(--plum)',
                cursor: l.photos.length > 0 ? 'zoom-in' : 'default',
              }}>
              {l.photos.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" src={thumbUrl(l.photos[0], 500)} alt={l.title}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <span className="eyebrow" style={{ color: 'var(--ink-mute)' }}>No photo</span>
              )}
            </div>
            <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {l.isSet && (
                <span style={{
                  alignSelf: 'flex-start', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
                  padding: '3px 8px', borderRadius: 100, background: 'var(--teal)', color: 'var(--cream)',
                }}>📚 COMPLETE SET</span>
              )}
              <div className="display" style={{ fontSize: 15, color: 'var(--plum)', lineHeight: 1.25 }}>{l.title}</div>
              {l.description && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                  {l.description.length > 120 ? l.description.slice(0, 120) + '…' : l.description}
                </p>
              )}
              {l.isSet && l.setHref && (
                <Link href={l.setHref} style={{ fontSize: 11.5, color: 'var(--teal)', fontWeight: 700, textDecoration: 'underline' }}>
                  ↗ View set contents (images + condition)
                </Link>
              )}
              <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)' }}>{l.conditionLabel}</div>
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10 }}>
                <span className="display" style={{ fontSize: 18, color: 'var(--plum)', fontWeight: 700 }}>{fmtMoney(l.askingPrice)}</span>
                <Link href="/login" className="btn btn-outline btn-sm" title="Log in to buy">Log in to buy →</Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {lightboxPhotos && (
        <PhotoLightbox urls={lightboxPhotos} startIdx={0} onClose={() => setLightboxPhotos(null)} />
      )}
    </>
  );
}
