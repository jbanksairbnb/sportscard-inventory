'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import { thumbUrl } from '@/lib/image-transform';
import { removeFromCart, clearCart, emitCartChanged } from '@/lib/cart';

type CartListing = {
  id: string;
  user_id: string;
  title: string;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  condition_type: 'raw' | 'graded';
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  photos: string[];
  status: string;
  listing_type?: 'card' | 'set' | null;
  set_slug?: string | null;
  seller_handle?: string | null;
  seller_display_name?: string | null;
};

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function gradeLabel(l: CartListing): string {
  if (l.condition_type === 'graded') {
    return [l.grading_company, l.grade].filter(Boolean).join(' ') || 'Graded';
  }
  return l.raw_grade || 'Raw';
}

// Full-screen image viewer for "click the thumbnail to view the card". Mirrors
// the marketplace lightbox so the cart feels consistent.
function PhotoLightbox({ urls, onClose }: { urls: string[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const arrowBtn: React.CSSProperties = {
    background: 'rgba(42,20,52,0.7)', color: 'var(--cream)', border: 'none',
    borderRadius: 8, padding: '8px 16px', fontSize: 24, cursor: 'pointer', lineHeight: 1,
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(42,20,52,0.92)' }} onClick={onClose}>
      <div style={{ position: 'relative', padding: 16 }} onClick={e => e.stopPropagation()}>
        <img loading="lazy" decoding="async" src={urls[idx]} alt="Card" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, display: 'block' }} />
        {urls.length > 1 && (
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <button type="button" onClick={e => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)); }} style={{ ...arrowBtn, opacity: idx === 0 ? 0.25 : 1 }} disabled={idx === 0}>‹</button>
            <button type="button" onClick={e => { e.stopPropagation(); setIdx(i => Math.min(urls.length - 1, i + 1)); }} style={{ ...arrowBtn, opacity: idx === urls.length - 1 ? 0.25 : 1 }} disabled={idx === urls.length - 1}>›</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm" style={{ position: 'absolute', top: 4, right: 4 }}>✕ Close</button>
      </div>
    </div>
  );
}

export default function CartPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<CartListing[]>([]);
  const [removedCount, setRemovedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);

      // Fetch the cart rows (newest first), then the live listings behind them.
      // The marketplace read policy only exposes *active* listings, so any card
      // that sold or was delisted simply won't come back — we drop those rows
      // from the cart (self-heal) so the cart and the nav badge stay in sync.
      const { data: cartRows, error } = await supabase
        .from('cart_items')
        .select('listing_id, added_at')
        .eq('user_id', user.id)
        .order('added_at', { ascending: false });
      if (error) { console.warn('[cart] load failed:', error.message); setLoading(false); return; }

      const ids = (cartRows || []).map(r => r.listing_id as string);
      if (ids.length === 0) { setItems([]); setLoading(false); return; }

      const { data: listingRows } = await supabase
        .from('listings')
        .select('id, user_id, title, year, brand, card_number, condition_type, raw_grade, grading_company, grade, asking_price, photos, status, listing_type, set_slug')
        .in('id', ids)
        .eq('status', 'active')
        .gt('asking_price', 0);
      const byId = new Map((listingRows || []).map(l => [l.id as string, l as CartListing]));

      // Self-heal: purge cart rows whose listing is no longer available.
      const staleIds = ids.filter(id => !byId.has(id));
      if (staleIds.length > 0) {
        await supabase.from('cart_items').delete().eq('user_id', user.id).in('listing_id', staleIds);
        emitCartChanged();
        setRemovedCount(staleIds.length);
      }

      // Preserve the cart's newest-first order.
      const ordered = ids.map(id => byId.get(id)).filter((l): l is CartListing => !!l);

      const sellerIds = Array.from(new Set(ordered.map(l => l.user_id)));
      const { data: profiles } = sellerIds.length > 0
        ? await supabase.from('user_profiles').select('user_id, handle, display_name').in('user_id', sellerIds)
        : { data: [] as { user_id: string; handle: string | null; display_name: string | null }[] };
      const pmap = new Map((profiles || []).map(p => [p.user_id, p]));

      setItems(ordered.map(l => ({
        ...l,
        seller_handle: pmap.get(l.user_id)?.handle || null,
        seller_display_name: pmap.get(l.user_id)?.display_name || null,
      })));
      setLoading(false);
    }
    load();
  }, [router]);

  const subtotal = useMemo(() => items.reduce((s, l) => s + (l.asking_price || 0), 0), [items]);
  const sellerName = items[0]?.seller_display_name || items[0]?.seller_handle || 'this seller';

  async function remove(id: string) {
    if (userId) await removeFromCart(createClient(), userId, id);
    setItems(prev => prev.filter(l => l.id !== id));
  }
  async function clearAll() {
    if (userId) await clearCart(createClient(), userId);
    setItems([]);
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)', borderBottom: '3px solid var(--plum)' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Your Cart ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/marketplace" className="btn btn-ghost btn-sm">← Continue shopping</Link>
            <Link href="/home" className="btn btn-outline btn-sm">Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 28px 120px' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}><SCLogo size={64} /></div>
        ) : items.length === 0 && removedCount === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }} aria-hidden>🛒</div>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>Your cart is empty</div>
            <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 20 }}>Browse the marketplace and add cards to your cart.</p>
            <Link href="/marketplace" className="btn btn-primary">Go to Marketplace →</Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {removedCount > 0 && (
              <div className="panel" style={{ padding: '10px 14px', border: '1.5px solid var(--rust)', background: 'rgba(178,58,58,0.06)', fontSize: 12.5, color: 'var(--plum)' }}>
                ⚠️ {removedCount} {removedCount === 1 ? 'card was' : 'cards were'} removed from your cart because {removedCount === 1 ? 'it' : 'they'} sold or {removedCount === 1 ? 'was' : 'were'} delisted.
              </div>
            )}

            {items.length === 0 ? (
              <div className="panel-bordered" style={{ padding: '40px 24px', textAlign: 'center' }}>
                <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>Nothing left in your cart</div>
                <Link href="/marketplace" className="btn btn-primary">Back to Marketplace →</Link>
              </div>
            ) : (
              <>
                <div className="panel-bordered" style={{ padding: '18px 22px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>
                      {items.length} {items.length === 1 ? 'card' : 'cards'} from {sellerName}
                    </div>
                    <div style={{ flex: 1 }} />
                    <button type="button" onClick={clearAll} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Clear cart</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {items.map(l => (
                      <CartRow key={l.id} l={l} onView={() => l.photos?.length && setLightbox(l.photos)} onRemove={() => remove(l.id)} />
                    ))}
                  </div>
                </div>

                {/* Summary + checkout */}
                <div className="panel-bordered" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Subtotal ({items.length} {items.length === 1 ? 'card' : 'cards'})</div>
                    <div className="display" style={{ fontSize: 24, color: 'var(--plum)' }}>{fmtMoney(subtotal)}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>Shipping calculated at checkout.</div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => router.push('/marketplace?checkout=1')}
                    className="btn btn-primary"
                  >
                    Proceed to checkout →
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {lightbox && <PhotoLightbox urls={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function CartRow({ l, unavailable, onView, onRemove }: { l: CartListing; unavailable?: boolean; onView: () => void; onRemove: () => void }) {
  const thumb = l.photos?.[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: unavailable ? 0.6 : 1 }}>
      <button
        type="button"
        onClick={onView}
        title="View card"
        aria-label={`View ${l.title}`}
        style={{ flexShrink: 0, padding: 0, border: 'none', background: 'none', cursor: thumb ? 'zoom-in' : 'default', borderRadius: 8 }}
      >
        {thumb ? (
          <img loading="lazy" decoding="async" src={thumbUrl(thumb, 160)} alt={l.title}
            style={{ width: 56, height: 78, objectFit: 'cover', borderRadius: 8, border: '1.5px solid var(--plum)', display: 'block' }} />
        ) : (
          <div style={{ width: 56, height: 78, borderRadius: 8, border: '1.5px dashed var(--rule)', display: 'grid', placeItems: 'center', fontSize: 20 }} aria-hidden>🃏</div>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="display" style={{ fontSize: 15, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
          {gradeLabel(l)}
          {l.listing_type === 'set' && l.set_slug && l.seller_handle && (
            <>
              {' · '}
              <Link href={`/seller/${encodeURIComponent(l.seller_handle)}/set/${encodeURIComponent(l.set_slug)}`} style={{ color: 'var(--teal)' }}>
                browse set
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="display" style={{ fontSize: 16, color: 'var(--plum)', flexShrink: 0 }}>{fmtMoney(l.asking_price)}</div>
      <button type="button" onClick={onRemove} className="btn btn-ghost btn-sm" style={{ flexShrink: 0, color: 'var(--rust)', fontSize: 11 }} aria-label={`Remove ${l.title}`}>
        Remove
      </button>
    </div>
  );
}
