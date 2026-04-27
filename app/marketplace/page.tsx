'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type ConditionType = 'raw' | 'graded';
type ShippingOption = { label: string; cost: number };

type MarketplaceListing = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: ConditionType;
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  photos: string[];
  shipping_options: ShippingOption[];
  created_at: string;
  seller_handle?: string | null;
  seller_display_name?: string | null;
};

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function PhotoLightbox({ urls, startIdx, onClose }: { urls: string[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIdx);
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
      <div style={{ position: 'relative', padding: 16 }} onClick={(e) => e.stopPropagation()}>
        <img src={urls[idx]} alt="Listing" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, display: 'block' }} />
        {urls.length > 1 && (
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)); }}
              style={{ ...arrowBtn, opacity: idx === 0 ? 0.25 : 1 }} disabled={idx === 0}>‹</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => Math.min(urls.length - 1, i + 1)); }}
              style={{ ...arrowBtn, opacity: idx === urls.length - 1 ? 0.25 : 1 }} disabled={idx === urls.length - 1}>›</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm" style={{ position: 'absolute', top: 4, right: 4 }}>✕ Close</button>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [search, setSearch] = useState('');
    const [conditionFilter, setConditionFilter] = useState<'all' | 'raw' | 'graded'>('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [lightboxPhotos, setLightboxPhotos] = useState<string[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setCurrentUserId(user.id);

      const { data: rows } = await supabase
        .from('listings')
        .select('id, user_id, title, description, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, asking_price, photos, shipping_options, created_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      const sellerIds = Array.from(new Set((rows || []).map(r => r.user_id)));
      const { data: profiles } = sellerIds.length > 0
        ? await supabase.from('user_profiles').select('user_id, handle, display_name').in('user_id', sellerIds)
        : { data: [] as { user_id: string; handle: string | null; display_name: string | null }[] };
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      setListings((rows || []).map(r => ({
        ...r,
        seller_handle: profileMap.get(r.user_id)?.handle || null,
        seller_display_name: profileMap.get(r.user_id)?.display_name || null,
      })) as MarketplaceListing[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const filtered = useMemo(() => {
    return listings.filter(l => {
      if (l.user_id === currentUserId) return false;
      if (conditionFilter !== 'all' && l.condition_type !== conditionFilter) return false;
      if (minPrice) {
        const m = Number(minPrice);
        if (!Number.isNaN(m) && (l.asking_price ?? 0) < m) return false;
      }
      if (maxPrice) {
        const m = Number(maxPrice);
        if (!Number.isNaN(m) && (l.asking_price ?? 0) > m) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [l.title, l.player, l.brand, l.card_number, l.description].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [listings, currentUserId, conditionFilter, minPrice, maxPrice, search]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    );
  }

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Marketplace ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div className="panel-bordered" style={{ padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by year, brand, player…"
            style={{
              flex: 1, minWidth: 220, border: '2px solid var(--plum)', borderRadius: 8,
              padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 13.5,
              color: 'var(--plum)', background: 'var(--cream)',
            }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'raw', 'graded'] as const).map(c => (
              <button key={c} onClick={() => setConditionFilter(c)}
                className={`btn btn-sm ${conditionFilter === c ? 'btn-primary' : 'btn-ghost'}`}>
                {c === 'all' ? 'All' : c === 'raw' ? 'Raw' : 'Graded'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Price $</span>
            <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="min"
              style={{ width: 80, border: '1.5px solid var(--plum)', borderRadius: 6, padding: '6px 8px', fontSize: 13, color: 'var(--plum)', background: 'var(--cream)' }} />
            <span style={{ color: 'var(--ink-mute)' }}>–</span>
            <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="max"
              style={{ width: 80, border: '1.5px solid var(--plum)', borderRadius: 6, padding: '6px 8px', fontSize: 13, color: 'var(--plum)', background: 'var(--cream)' }} />
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700 }}>
            {filtered.length} {filtered.length === 1 ? 'listing' : 'listings'}
          </span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            {(['grid', 'list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`btn btn-sm ${view === v ? 'btn-primary' : 'btn-ghost'}`}>
                {v === 'grid' ? '▦ Grid' : '☰ List'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No listings match</div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Try a different search or clear the filters.</p>
          </div>
               ) : view === 'grid' ? (
          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}>
            {filtered.map(l => (
              <div key={l.id} className="panel-bordered" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                <div
                  onClick={() => l.photos && l.photos.length > 0 && setLightboxPhotos(l.photos)}
                  style={{
                    width: '100%', aspectRatio: '4/3', background: 'var(--paper)',
                    display: 'grid', placeItems: 'center', overflow: 'hidden',
                    borderBottom: '2px solid var(--plum)',
                    cursor: l.photos && l.photos.length > 0 ? 'zoom-in' : 'default',
                  }}>
                  {l.photos && l.photos.length > 0 ? (
                    <img src={l.photos[0]} alt={l.title}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span className="eyebrow" style={{ color: 'var(--ink-mute)' }}>No photo</span>
                  )}
                </div>
                <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="display" style={{ fontSize: 15, color: 'var(--plum)', lineHeight: 1.25 }}>
                    {l.title}
                  </div>
                  {l.description && (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                      {l.description.length > 120 ? l.description.slice(0, 120) + '…' : l.description}
                    </p>
                  )}
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600 }}>
                    Seller: {l.seller_display_name || l.seller_handle || '—'}
                  </div>
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10 }}>
                    <span className="display" style={{ fontSize: 18, color: 'var(--plum)', fontWeight: 700 }}>
                      {fmtMoney(l.asking_price)}
                    </span>
                    <button type="button" disabled
                      title="Buy flow lands in Phase 2B"
                      className="btn btn-primary btn-sm" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                      Buy →
                    </button>
                  </div>
                                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(l => (
              <div key={l.id} className="panel-bordered" style={{ padding: 0, overflow: 'hidden', display: 'flex', alignItems: 'stretch' }}>
                                <div
                  onClick={() => l.photos && l.photos.length > 0 && setLightboxPhotos(l.photos)}
                  style={{
                    width: 140, height: 140, flexShrink: 0,
                    background: 'var(--paper)',
                    display: 'grid', placeItems: 'center', overflow: 'hidden',
                    borderRight: '2px solid var(--plum)',
                    cursor: l.photos && l.photos.length > 0 ? 'zoom-in' : 'default',
                  }}>
                  {l.photos && l.photos.length > 0 ? (
                    <img src={l.photos[0]} alt={l.title}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span className="eyebrow" style={{ color: 'var(--ink-mute)', fontSize: 10 }}>No photo</span>
                  )}
                </div>
                <div style={{ flex: 1, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <div className="display" style={{ fontSize: 16, color: 'var(--plum)', lineHeight: 1.3 }}>
                    {l.title}
                  </div>
                  {l.description && (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
                      {l.description.length > 200 ? l.description.slice(0, 200) + '…' : l.description}
                    </p>
                  )}
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600, marginTop: 'auto' }}>
                    Seller: {l.seller_display_name || l.seller_handle || '—'}
                  </div>
                </div>
                <div style={{
                  padding: '14px 20px',
                  display: 'flex', flexDirection: 'column', gap: 10,
                  alignItems: 'flex-end', justifyContent: 'space-between',
                  minWidth: 140, borderLeft: '1.5px solid var(--rule)',
                }}>
                  <span className="display" style={{ fontSize: 16, color: 'var(--plum)', fontWeight: 700 }}>
                    {fmtMoney(l.asking_price)}
                  </span>
                  <button type="button" disabled
                    title="Buy flow lands in Phase 2B"
                    className="btn btn-primary btn-sm" style={{ opacity: 0.6, cursor: 'not-allowed', whiteSpace: 'nowrap' }}>
                    Buy →
                  </button>
                </div>
              </div>
            ))}
                                  </div>
        )}
      </div>

      {lightboxPhotos && (
        <PhotoLightbox urls={lightboxPhotos} startIdx={0} onClose={() => setLightboxPhotos(null)} />
      )}
    </div>
  );
}
