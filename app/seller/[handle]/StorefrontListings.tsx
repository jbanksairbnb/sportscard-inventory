'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { thumbUrl } from '@/lib/image-transform';
import Pagination from '@/components/Pagination';

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
  // Structured fields powering the exact-match facet filters.
  year: number | null;
  brand: string | null;
  player: string | null;
  // Lowercased blob of the identifying fields (title, player, brand, card #,
  // year, grade) assembled server-side so the keyword box can match on more
  // than just the rendered title. Excludes the free-text description on
  // purpose — see page.tsx.
  searchText: string;
};

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

const filterSelectStyle: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--ink)',
  background: 'var(--cream)', border: '1.5px solid var(--plum)',
  borderRadius: 8, padding: '6px 10px', cursor: 'pointer', maxWidth: 200,
};

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
  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Build the dropdown options from the listings actually on offer. Years
  // newest-first; brands and conditions alphabetical.
  const { years, brands, conditions } = useMemo(() => {
    const ys = new Set<number>();
    const bs = new Set<string>();
    const cs = new Set<string>();
    for (const it of items) {
      if (it.year != null) ys.add(it.year);
      if (it.brand) bs.add(it.brand);
      if (it.conditionLabel) cs.add(it.conditionLabel);
    }
    return {
      years: Array.from(ys).sort((a, b) => b - a),
      brands: Array.from(bs).sort((a, b) => a.localeCompare(b)),
      conditions: Array.from(cs).sort((a, b) => a.localeCompare(b)),
    };
  }, [items]);

  // Facets are exact matches against the structured columns; the keyword box
  // adds an AND over the identifying-fields blob, so "griffey" alongside a
  // Year of 1989 and Condition of PSA 9 narrows precisely. Searching a year
  // here only hits the real year column — never a digit buried in a blurb.
  const hasFilters = !!(query.trim() || yearFilter || brandFilter || conditionFilter);
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(it => {
      if (yearFilter && String(it.year ?? '') !== yearFilter) return false;
      if (brandFilter && it.brand !== brandFilter) return false;
      if (conditionFilter && it.conditionLabel !== conditionFilter) return false;
      if (terms.length && !terms.every(t => it.searchText.includes(t))) return false;
      return true;
    });
  }, [items, query, yearFilter, brandFilter, conditionFilter]);

  function clearAll() {
    setQuery('');
    setYearFilter('');
    setBrandFilter('');
    setConditionFilter('');
  }

  // Any filter or page-size change should drop the viewer back to page 1 so
  // they aren't stranded on a page that no longer exists.
  useEffect(() => { setPage(1); }, [query, yearFilter, brandFilter, conditionFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((curPage - 1) * pageSize, curPage * pageSize),
    [filtered, curPage, pageSize],
  );

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
      <div className="panel" style={{
        padding: '10px 14px', marginBottom: 16, background: 'var(--paper)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span aria-hidden style={{ fontSize: 16, color: 'var(--ink-mute)' }}>🔍</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search this storefront — player, title, card #…"
            aria-label="Search listings"
            style={{
              flex: 1, minWidth: 200, border: 'none', background: 'transparent',
              fontSize: 14, color: 'var(--ink)', outline: 'none',
            }}
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {hasFilters
              ? `${filtered.length} of ${items.length}`
              : `${items.length} ${items.length === 1 ? 'listing' : 'listings'}`}
          </span>
          {hasFilters && (
            <button type="button" onClick={clearAll} className="btn btn-outline btn-sm">Clear</button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--rule-soft)', paddingTop: 10 }}>
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            aria-label="Filter by year"
            style={filterSelectStyle}
          >
            <option value="">All years</option>
            {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <select
            value={brandFilter}
            onChange={e => setBrandFilter(e.target.value)}
            aria-label="Filter by brand"
            style={filterSelectStyle}
          >
            <option value="">All brands</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select
            value={conditionFilter}
            onChange={e => setConditionFilter(e.target.value)}
            aria-label="Filter by condition"
            style={filterSelectStyle}
          >
            <option value="">All conditions</option>
            {conditions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="panel-bordered" style={{ padding: '40px 32px', textAlign: 'center' }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 6 }}>No matches</div>
          <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
            Nothing matches your filters. Try widening your search.
          </p>
        </div>
      ) : (
      <>
      <Pagination
        total={filtered.length}
        page={curPage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {paged.map(l => (
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
      <Pagination
        total={filtered.length}
        page={curPage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
      </>
      )}

      {lightboxPhotos && (
        <PhotoLightbox urls={lightboxPhotos} startIdx={0} onClose={() => setLightboxPhotos(null)} />
      )}
    </>
  );
}
