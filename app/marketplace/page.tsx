'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>}>
      <MarketplacePageInner />
    </Suspense>
  );
}

function MarketplacePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [search, setSearch] = useState(searchParams.get('q') || '');
    const [conditionFilter, setConditionFilter] = useState<'all' | 'raw' | 'graded'>('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [lightboxPhotos, setLightboxPhotos] = useState<string[] | null>(null);
  const [buyTarget, setBuyTarget] = useState<MarketplaceListing | null>(null);
  // Want-list filter: opt-in. Defaults off so the marketplace shows every
  // active listing to a fresh visitor. Built from the user's sets — keyed by
  // `${year}|${brand}|${card_number}` for cards they have not marked Owned.
  const [wantListOnly, setWantListOnly] = useState(searchParams.get('wantlist') === '1');
  const [wantListKeys, setWantListKeys] = useState<Set<string>>(new Set());
  // Multi-card cart. Keys are listing ids; we enforce single-seller carts
  // (adding a card from a different seller prompts to replace the cart).
  // Cart UI only appears in the list view.
  const [cart, setCart] = useState<Set<string>>(new Set());
  const [bulkCheckoutOpen, setBulkCheckoutOpen] = useState(false);

  function onPurchaseComplete(listingId: string) {
    setListings(prev => prev.filter(l => l.id !== listingId));
    setBuyTarget(null);
  }
  function onBulkComplete(listingIds: string[]) {
    setListings(prev => prev.filter(l => !listingIds.includes(l.id)));
    setCart(new Set());
    setBulkCheckoutOpen(false);
  }
  function toggleCart(l: MarketplaceListing) {
    setCart(prev => {
      const next = new Set(prev);
      if (next.has(l.id)) {
        next.delete(l.id);
        return next;
      }
      // Single-seller cart: if the cart already has another seller's card,
      // confirm the replacement.
      const cartItems = listings.filter(x => prev.has(x.id));
      const existingSeller = cartItems[0]?.user_id;
      if (existingSeller && existingSeller !== l.user_id) {
        if (!confirm('Your cart has cards from another seller. Replace cart with this card?')) {
          return prev;
        }
        return new Set([l.id]);
      }
      next.add(l.id);
      return next;
    });
  }

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setCurrentUserId(user.id);

      const [{ data: rows }, { data: setRows }] = await Promise.all([
        supabase
          .from('listings')
          .select('id, user_id, title, description, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, asking_price, photos, shipping_options, created_at')
          .eq('status', 'active')
          .gt('asking_price', 0)
          .order('created_at', { ascending: false }),
        supabase
          .from('sets')
          .select('year, brand, rows')
          .eq('user_id', user.id),
      ]);

      // Build a key set of every card across the user's sets that isn't
      // marked Owned. Used by the optional Want-list filter below.
      const keys = new Set<string>();
      for (const s of (setRows || []) as Array<{ year: number | null; brand: string | null; rows: any }>) {
        const sr = Array.isArray(s.rows) ? s.rows : [];
        for (const r of sr) {
          if (String(r?.['Owned'] ?? '').toLowerCase() === 'yes') continue;
          const cardNum = String(r?.['Card #'] ?? '').trim();
          if (!cardNum) continue;
          const yr = s.year ?? '';
          const br = (s.brand || '').toString().trim().toLowerCase();
          keys.add(`${yr}|${br}|${cardNum}`);
        }
      }
      setWantListKeys(keys);

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

  function isOnWantList(l: MarketplaceListing): boolean {
    if (!l.card_number) return false;
    const yr = l.year ?? '';
    const br = (l.brand || '').toString().trim().toLowerCase();
    return wantListKeys.has(`${yr}|${br}|${String(l.card_number).trim()}`);
  }

  const filtered = useMemo(() => {
    return listings.filter(l => {
      if (l.user_id === currentUserId) return false;
      if (wantListOnly && !isOnWantList(l)) return false;
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
        const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
        const hay = [l.title, l.player, l.brand, l.card_number, l.description, l.seller_handle, l.seller_display_name].filter(Boolean).join(' ').toLowerCase();
        if (!terms.every(t => hay.includes(t))) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, currentUserId, conditionFilter, minPrice, maxPrice, search, wantListOnly, wantListKeys]);

  const wantListMatchCount = useMemo(
    () => listings.filter(l => l.user_id !== currentUserId && isOnWantList(l)).length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [listings, currentUserId, wantListKeys]);

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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search — multiple terms supported (e.g. 1971 Topps Munson)"
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
          <button type="button" onClick={() => setWantListOnly(v => !v)}
            disabled={wantListKeys.size === 0}
            title={wantListKeys.size === 0
              ? 'Build a set on My Shelf to enable want-list filtering'
              : 'Show only listings of cards on your want list'}
            className={`btn btn-sm ${wantListOnly ? 'btn-primary' : 'btn-outline'}`}>
            ⭐ Want list {wantListOnly ? 'on' : 'only'}{wantListKeys.size > 0 ? ` · ${wantListMatchCount}` : ''}
          </button>
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
                    <button type="button" onClick={() => setBuyTarget(l)}
                      className="btn btn-primary btn-sm">
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
                  minWidth: 160, borderLeft: '1.5px solid var(--rule)',
                }}>
                  <span className="display" style={{ fontSize: 16, color: 'var(--plum)', fontWeight: 700 }}>
                    {fmtMoney(l.asking_price)}
                  </span>
                  <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
                    <button type="button" onClick={() => toggleCart(l)}
                      className={`btn btn-sm ${cart.has(l.id) ? 'btn-primary' : 'btn-outline'}`}
                      style={{ whiteSpace: 'nowrap', minWidth: 110 }}>
                      {cart.has(l.id) ? '✓ In cart' : '+ Add to cart'}
                    </button>
                    <button type="button" onClick={() => setBuyTarget(l)}
                      className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                      Buy just this →
                    </button>
                  </div>
                </div>
              </div>
            ))}
                                  </div>
        )}
      </div>

      {/* Sticky cart bar — only shows when at least one item is in the cart. */}
      {cart.size > 0 && (() => {
        const cartItems = filtered.filter(l => cart.has(l.id));
        const cartSubtotal = cartItems.reduce((s, l) => s + (l.asking_price || 0), 0);
        const sellerName = cartItems[0]?.seller_display_name || cartItems[0]?.seller_handle || 'seller';
        return (
          <div style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 80, display: 'flex', alignItems: 'center', gap: 16,
            padding: '12px 20px', borderRadius: 100,
            background: 'var(--plum)', color: 'var(--cream)',
            boxShadow: '0 8px 24px rgba(42,20,52,0.3)',
            border: '2px solid var(--orange)',
          }}>
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
              {cart.size} {cart.size === 1 ? 'card' : 'cards'} from {sellerName}
            </span>
            <span className="display" style={{ fontSize: 16, color: 'var(--mustard)', fontWeight: 700 }}>
              {fmtMoney(cartSubtotal)}
            </span>
            <button type="button" onClick={() => setCart(new Set())}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--cream)', fontSize: 11 }}>
              Clear
            </button>
            <button type="button" onClick={() => setBulkCheckoutOpen(true)}
              className="btn btn-primary btn-sm">
              Checkout →
            </button>
          </div>
        );
      })()}

            {lightboxPhotos && (
        <PhotoLightbox urls={lightboxPhotos} startIdx={0} onClose={() => setLightboxPhotos(null)} />
      )}

      {buyTarget && (
        <BuyModal listing={buyTarget} onClose={() => setBuyTarget(null)} onComplete={onPurchaseComplete} />
      )}

      {bulkCheckoutOpen && cart.size > 0 && (
        <BulkBuyModal
          listings={listings.filter(l => cart.has(l.id))}
          onClose={() => setBulkCheckoutOpen(false)}
          onRemove={(id) => {
            setCart(prev => {
              const next = new Set(prev); next.delete(id);
              if (next.size === 0) setBulkCheckoutOpen(false);
              return next;
            });
          }}
          onComplete={onBulkComplete}
        />
      )}
    </div>
  );
}
function BuyModal({
  listing, onClose, onComplete,
}: {
  listing: MarketplaceListing;
  onClose: () => void;
  onComplete: (listingId: string) => void;
}) {
  const opts = listing.shipping_options || [];
  const [shipIdx, setShipIdx] = useState<number>(opts.length > 0 ? 0 : -1);
  const [name, setName] = useState('');
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [stateReg, setStateReg] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState('US');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const ship = shipIdx >= 0 ? opts[shipIdx] : null;
  const itemPrice = listing.asking_price || 0;
  const shippingCost = ship?.cost || 0;
  const total = itemPrice + shippingCost;

  async function confirm() {
    setError('');
    if (!listing.asking_price || listing.asking_price <= 0) {
      setError('Card unavailable. Seller may have this in an auction — please contact the seller if interested.');
      return;
    }
    if (!ship) { setError('Pick a shipping option.'); return; }
    if (!name.trim() || !addr1.trim() || !city.trim() || !stateReg.trim() || !zip.trim() || !country.trim()) {
      setError('All shipping address fields except line 2 are required.');
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { data: purchaseId, error: rpcErr } = await supabase.rpc('purchase_listing', {
      p_listing_id: listing.id,
      p_shipping_label: ship.label,
      p_shipping_cost: ship.cost,
      p_ship_to_name: name.trim(),
      p_ship_to_address1: addr1.trim(),
      p_ship_to_address2: addr2.trim() || null,
      p_ship_to_city: city.trim(),
      p_ship_to_state: stateReg.trim(),
      p_ship_to_zip: zip.trim(),
      p_ship_to_country: country.trim(),
    });
    if (rpcErr) {
      setSubmitting(false);
      setError(rpcErr.message);
      return;
    }
    const res = await fetch('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchaseId }),
    });
    if (!res.ok) {
      console.error('Email send failed:', await res.text());
    }
    // Pull the card out of the seller's inventory now that the order is
    // confirmed (purchase row exists). Server route handles authorization
    // and the seller-side update via service-role.
    await fetch('/api/inventory/mark-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchase_id: purchaseId, owned: false }),
    }).catch(() => {});
    setSubmitting(false);
    alert('Purchase confirmed! Check your email for details. The seller will reach out about payment.');
    onComplete(listing.id);
  }

  const fieldStyle: React.CSSProperties = {
    border: '2px solid var(--plum)', borderRadius: 8, padding: '8px 12px',
    fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--plum)',
    background: 'var(--cream)', width: '100%', boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle: React.CSSProperties = { fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 560, padding: 28, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>Buy: {listing.title}</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <div>
            <div className="eyebrow" style={labelStyle}>Shipping</div>
            {opts.length === 0 ? (
              <div className="mono" style={{ fontSize: 12, color: 'var(--rust)', fontWeight: 700, fontStyle: 'italic' }}>
                Seller has not set any shipping options. You cannot buy this listing yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {opts.map((o, i) => (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8,
                    border: shipIdx === i ? '2px solid var(--plum)' : '1.5px solid var(--rule)',
                    background: shipIdx === i ? 'var(--paper)' : 'transparent',
                    cursor: 'pointer',
                  }}>
                    <input type="radio" checked={shipIdx === i} onChange={() => setShipIdx(i)} />
                    <span style={{ flex: 1, fontSize: 13.5, color: 'var(--plum)' }}>{o.label}</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 700 }}>${o.cost.toFixed(2)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Ship to *</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" style={fieldStyle} />
              <input value={addr1} onChange={e => setAddr1(e.target.value)} placeholder="Address line 1" style={fieldStyle} />
              <input value={addr2} onChange={e => setAddr2(e.target.value)} placeholder="Address line 2 (optional)" style={fieldStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: 8 }}>
                <input value={city} onChange={e => setCity(e.target.value)} placeholder="City" style={fieldStyle} />
                <input value={stateReg} onChange={e => setStateReg(e.target.value.toUpperCase().slice(0, 3))} placeholder="State" style={fieldStyle} />
                <input value={zip} onChange={e => setZip(e.target.value)} placeholder="ZIP" style={fieldStyle} />
              </div>
              <input value={country} onChange={e => setCountry(e.target.value.toUpperCase())} placeholder="Country (e.g. US)" style={fieldStyle} />
            </div>
          </div>

          <div className="panel" style={{ padding: '12px 16px', background: 'var(--paper)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>
              <span>Item</span><span>${itemPrice.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
              <span>Shipping{ship ? ` · ${ship.label}` : ''}</span><span>${shippingCost.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: 'var(--plum)', borderTop: '2px solid var(--plum)', paddingTop: 8 }}>
              <span>Total</span><span style={{ color: 'var(--teal)' }}>${total.toFixed(2)}</span>
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={confirm} disabled={submitting || opts.length === 0}
              className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
              {submitting ? 'Confirming…' : `Confirm Purchase · $${total.toFixed(2)}`}
            </button>
            <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
          </div>
          <p className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 600, textAlign: 'center', margin: 0 }}>
            By confirming, the listing will be marked sold and the seller will be emailed your shipping info.
          </p>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// BulkBuyModal — checkout flow for the multi-card cart on /marketplace.
// All cart items are guaranteed to share a single seller (enforced when items
// are added). We collect a single shipping option + ship-to address, then
// loop through purchase_listing for each card; failed cards (typically lost
// to a race) are surfaced inline and removed from the cart so the buyer can
// review and retry.
// ──────────────────────────────────────────────────────────────────────────
function BulkBuyModal({
  listings, onClose, onRemove, onComplete,
}: {
  listings: MarketplaceListing[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onComplete: (listingIds: string[]) => void;
}) {
  // Shipping options come from the FIRST listing — sellers configure shipping
  // per-listing, but for a multi-card invoice we need a single number. We
  // intersect the available labels across the cart so we only show options
  // every card supports, then take the max cost so the buyer is never
  // under-charged.
  const sharedOptions = useMemo(() => {
    if (listings.length === 0) return [] as ShippingOption[];
    const first = listings[0].shipping_options || [];
    return first
      .map(opt => {
        let maxCost = opt.cost;
        for (const l of listings) {
          const match = (l.shipping_options || []).find(o => o.label === opt.label);
          if (!match) return null; // not supported on every card → drop
          if (match.cost > maxCost) maxCost = match.cost;
        }
        return { label: opt.label, cost: maxCost };
      })
      .filter((x): x is ShippingOption => x !== null);
  }, [listings]);

  const [shipIdx, setShipIdx] = useState<number>(sharedOptions.length > 0 ? 0 : -1);
  const [name, setName] = useState('');
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [stateReg, setStateReg] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState('US');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [failedIds, setFailedIds] = useState<string[]>([]);

  const ship = shipIdx >= 0 ? sharedOptions[shipIdx] : null;
  const subtotal = listings.reduce((s, l) => s + (l.asking_price || 0), 0);
  const shippingCost = ship?.cost || 0;
  const total = subtotal + shippingCost;

  async function confirm() {
    setError('');
    setFailedIds([]);
    if (!ship) { setError('Pick a shipping option.'); return; }
    if (!name.trim() || !addr1.trim() || !city.trim() || !stateReg.trim() || !zip.trim() || !country.trim()) {
      setError('All shipping address fields except line 2 are required.');
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const purchaseIds: string[] = [];
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const l of listings) {
      // Each cart item gets its own purchases row. Shipping cost is recorded
      // on every row at the cart-wide rate; the bulk-email endpoint takes the
      // max so the buyer is never double-billed.
      const { data: purchaseId, error: rpcErr } = await supabase.rpc('purchase_listing', {
        p_listing_id: l.id,
        p_shipping_label: ship.label,
        p_shipping_cost: ship.cost,
        p_ship_to_name: name.trim(),
        p_ship_to_address1: addr1.trim(),
        p_ship_to_address2: addr2.trim() || null,
        p_ship_to_city: city.trim(),
        p_ship_to_state: stateReg.trim(),
        p_ship_to_zip: zip.trim(),
        p_ship_to_country: country.trim(),
      });
      if (rpcErr || !purchaseId) {
        failed.push(l.id);
        continue;
      }
      purchaseIds.push(purchaseId as string);
      succeeded.push(l.id);
    }

    if (purchaseIds.length === 0) {
      setSubmitting(false);
      setError('None of the cards could be purchased — they may have been sold to another buyer. Try refreshing the marketplace.');
      return;
    }

    // One combined invoice email per cart.
    const emailRes = await fetch('/api/purchase/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchaseIds }),
    });
    if (!emailRes.ok) {
      console.error('Bulk email failed:', await emailRes.text());
    }

    // Pull successful purchases out of seller inventory (mirrors single-card flow).
    await Promise.all(purchaseIds.map(pid =>
      fetch('/api/inventory/mark-row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_id: pid, owned: false }),
      }).catch(() => {})
    ));

    setSubmitting(false);

    if (failed.length > 0) {
      setFailedIds(failed);
      alert(
        `${succeeded.length} purchased successfully. ${failed.length} could not be purchased ` +
        `(may have been sold). Check your email for the invoice on the successful ones.`
      );
    } else {
      alert('Order confirmed! Check your email for the combined invoice. The seller will reach out about payment.');
    }
    onComplete(succeeded);
  }

  const fieldStyle: React.CSSProperties = {
    border: '2px solid var(--plum)', borderRadius: 8, padding: '8px 12px',
    fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--plum)',
    background: 'var(--cream)', width: '100%', boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle: React.CSSProperties = { fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 640, padding: 28, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>
            Checkout · {listings.length} card{listings.length === 1 ? '' : 's'}
          </div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <div>
            <div className="eyebrow" style={labelStyle}>Items</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {listings.map(l => (
                <div key={l.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8,
                  border: failedIds.includes(l.id) ? '1.5px solid var(--rust)' : '1.5px solid var(--rule)',
                  background: failedIds.includes(l.id) ? 'rgba(197,74,44,0.08)' : 'var(--paper)',
                }}>
                  <div style={{
                    width: 44, height: 44, flexShrink: 0,
                    background: 'var(--cream)', border: '1.5px solid var(--plum)', borderRadius: 6,
                    display: 'grid', placeItems: 'center', overflow: 'hidden',
                  }}>
                    {l.photos && l.photos.length > 0 ? (
                      <img src={l.photos[0]} alt={l.title}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <span className="eyebrow" style={{ fontSize: 8, color: 'var(--ink-mute)' }}>—</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="display" style={{ fontSize: 13, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.title}
                    </div>
                    {failedIds.includes(l.id) && (
                      <div className="mono" style={{ fontSize: 10, color: 'var(--rust)', fontWeight: 700 }}>
                        Could not be purchased — may have been sold
                      </div>
                    )}
                  </div>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 700 }}>
                    {fmtMoney(l.asking_price)}
                  </span>
                  {!submitting && !failedIds.includes(l.id) && (
                    <button type="button" onClick={() => onRemove(l.id)}
                      title="Remove from cart"
                      style={{ background: 'transparent', border: 0, color: 'var(--rust)', cursor: 'pointer', fontSize: 18, padding: 4 }}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Shipping</div>
            {sharedOptions.length === 0 ? (
              <div className="mono" style={{ fontSize: 12, color: 'var(--rust)', fontWeight: 700, fontStyle: 'italic' }}>
                The cards in this cart don&apos;t share a common shipping option. Buy them individually for now.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sharedOptions.map((o, i) => (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8,
                    border: shipIdx === i ? '2px solid var(--plum)' : '1.5px solid var(--rule)',
                    background: shipIdx === i ? 'var(--paper)' : 'transparent',
                    cursor: 'pointer',
                  }}>
                    <input type="radio" checked={shipIdx === i} onChange={() => setShipIdx(i)} />
                    <span style={{ flex: 1, fontSize: 13.5, color: 'var(--plum)' }}>{o.label}</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 700 }}>${o.cost.toFixed(2)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Ship to *</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" style={fieldStyle} />
              <input value={addr1} onChange={e => setAddr1(e.target.value)} placeholder="Address line 1" style={fieldStyle} />
              <input value={addr2} onChange={e => setAddr2(e.target.value)} placeholder="Address line 2 (optional)" style={fieldStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: 8 }}>
                <input value={city} onChange={e => setCity(e.target.value)} placeholder="City" style={fieldStyle} />
                <input value={stateReg} onChange={e => setStateReg(e.target.value.toUpperCase().slice(0, 3))} placeholder="State" style={fieldStyle} />
                <input value={zip} onChange={e => setZip(e.target.value)} placeholder="ZIP" style={fieldStyle} />
              </div>
              <input value={country} onChange={e => setCountry(e.target.value.toUpperCase())} placeholder="Country (e.g. US)" style={fieldStyle} />
            </div>
          </div>

          <div className="panel" style={{ padding: '12px 16px', background: 'var(--paper)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>
              <span>Subtotal · {listings.length} {listings.length === 1 ? 'item' : 'items'}</span><span>${subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
              <span>Shipping{ship ? ` · ${ship.label}` : ''}</span><span>${shippingCost.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: 'var(--plum)', borderTop: '2px solid var(--plum)', paddingTop: 8 }}>
              <span>Total</span><span style={{ color: 'var(--teal)' }}>${total.toFixed(2)}</span>
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={confirm}
              disabled={submitting || sharedOptions.length === 0}
              className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
              {submitting ? 'Confirming…' : `Confirm Purchase · $${total.toFixed(2)}`}
            </button>
            <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
          </div>
          <p className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 600, textAlign: 'center', margin: 0 }}>
            By confirming, all listings will be marked sold and the seller will be emailed your shipping info.
          </p>
        </div>
      </div>
    </div>
  );
}
