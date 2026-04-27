'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Purchase = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  item_price: number;
  shipping_label: string;
  shipping_cost: number;
  total: number;
  ship_to_name: string;
  ship_to_address1: string;
  ship_to_address2: string | null;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
  ship_to_country: string;
  status: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  tracking_number: string | null;
  created_at: string;
  listing?: { title: string; photos: string[] } | null;
  seller_name?: string;
  seller_email?: string;
};

const STATUS_FILTERS = ['all', 'unpaid', 'paid', 'shipped', 'completed', 'cancelled'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBg(s: string) {
  if (s === 'paid') return 'var(--mustard)';
  if (s === 'shipped') return 'var(--orange)';
  if (s === 'completed') return 'var(--teal)';
  if (s === 'cancelled') return 'var(--ink-mute)';
  return 'var(--rust)'; // unpaid
}
function statusFg(s: string) {
  if (s === 'paid') return 'var(--plum)';
  return 'var(--cream)';
}

export default function PurchasesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: rows } = await supabase
        .from('purchases')
        .select('*, listing:listings(title, photos)')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });

      const sellerIds = Array.from(new Set((rows || []).map(r => r.seller_id)));
      const { data: profiles } = sellerIds.length > 0
        ? await supabase.from('user_profiles').select('user_id, display_name, handle, email').in('user_id', sellerIds)
        : { data: [] as { user_id: string; display_name: string | null; handle: string | null; email: string | null }[] };
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      setPurchases((rows || []).map(r => {
        const profile = profileMap.get(r.seller_id);
        const email = profile?.email || '';
        return {
          ...r,
          seller_name: profile?.display_name || profile?.handle || (email ? email.split('@')[0] : '—'),
          seller_email: email,
        };
      }) as Purchase[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const counts = {
    unpaid: purchases.filter(p => p.status === 'unpaid').length,
    paid: purchases.filter(p => p.status === 'paid').length,
    shipped: purchases.filter(p => p.status === 'shipped').length,
    completed: purchases.filter(p => p.status === 'completed').length,
    cancelled: purchases.filter(p => p.status === 'cancelled').length,
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return purchases;
    return purchases.filter(p => p.status === filter);
  }, [purchases, filter]);

  async function markReceived(p: Purchase) {
    if (!confirm('Mark this item as received? This finalizes the transaction.')) return;
    setWorking(p.id);
    const supabase = createClient();
    const { error } = await supabase.from('purchases').update({ status: 'completed' }).eq('id', p.id);
    setWorking(null);
    if (error) { alert('Update failed: ' + error.message); return; }
    setPurchases(prev => prev.map(x => x.id === p.id ? { ...x, status: 'completed' } : x));
  }

  async function cancel(p: Purchase) {
    if (!confirm('Cancel this purchase? The listing will go back on the marketplace and the seller will be notified.')) return;
    setWorking(p.id);
    const supabase = createClient();
    const { error } = await supabase.rpc('cancel_purchase', { p_purchase_id: p.id });
    setWorking(null);
    if (error) { alert('Cancel failed: ' + error.message); return; }
    setPurchases(prev => prev.map(x => x.id === p.id
      ? { ...x, status: 'cancelled', cancelled_by: 'buyer', cancelled_at: new Date().toISOString() }
      : x));
  }

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ My Purchases ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/marketplace" className="btn btn-ghost btn-sm">Marketplace</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>
                ({f === 'all' ? purchases.length : counts[f as Exclude<StatusFilter, 'all'>]})
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No {filter === 'all' ? '' : filter} purchases</div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
              Browse the <Link href="/marketplace" style={{ color: 'var(--orange)', fontWeight: 700 }}>Marketplace</Link> to find cards to buy.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filtered.map(p => {
              const photo = p.listing?.photos?.[0];
              return (
                <div key={p.id} className="panel-bordered" style={{ padding: 0, overflow: 'hidden', display: 'flex', alignItems: 'stretch' }}>
                  <div style={{
                    width: 130, height: 130, flexShrink: 0,
                    background: 'var(--paper)',
                    display: 'grid', placeItems: 'center', overflow: 'hidden',
                    borderRight: '2px solid var(--plum)',
                  }}>
                    {photo ? (
                      <img src={photo} alt={p.listing?.title || 'Listing'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <span className="eyebrow" style={{ color: 'var(--ink-mute)', fontSize: 10 }}>No photo</span>
                    )}
                  </div>

                  <div style={{ flex: 1, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>{p.listing?.title || 'Listing'}</div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                        background: statusBg(p.status), color: statusFg(p.status),
                      }}>
                        {p.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
                      Ordered {fmtDate(p.created_at)} · Seller:{' '}
                      {p.seller_email ? (
                        <a href={`mailto:${p.seller_email}?subject=${encodeURIComponent(`Sports Collective purchase: ${p.listing?.title || 'order'}`)}`} style={{ color: 'var(--orange)' }}>
                          {p.seller_name}
                        </a>
                      ) : (
                        p.seller_name
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                      Ship to {p.ship_to_name}, {p.ship_to_address1}{p.ship_to_address2 ? `, ${p.ship_to_address2}` : ''}, {p.ship_to_city}, {p.ship_to_state} {p.ship_to_zip}, {p.ship_to_country}
                    </div>
                    {p.tracking_number && (
                      <div className="mono" style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 700 }}>
                        Tracking: {p.tracking_number}
                      </div>
                    )}
                    {p.status === 'cancelled' && p.cancelled_at && (
                      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
                        Cancelled by {p.cancelled_by || '—'} on {fmtDate(p.cancelled_at)}
                      </div>
                    )}
                  </div>

                  <div style={{
                    padding: '14px 18px',
                    display: 'flex', flexDirection: 'column', gap: 8,
                    alignItems: 'flex-end', justifyContent: 'space-between',
                    minWidth: 160, borderLeft: '1.5px solid var(--rule)',
                  }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
                        {fmtMoney(p.item_price)} + {fmtMoney(p.shipping_cost)}
                      </div>
                      <div className="display" style={{ fontSize: 18, color: 'var(--plum)', fontWeight: 700 }}>
                        {fmtMoney(p.total)}
                      </div>
                      <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-mute)' }}>{p.shipping_label}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', width: '100%' }}>
                      {p.status === 'shipped' && (
                        <button type="button" onClick={() => markReceived(p)} disabled={working === p.id}
                          className="btn btn-primary btn-sm" style={{ justifyContent: 'center' }}>
                          {working === p.id ? '…' : '✓ Mark Received'}
                        </button>
                      )}
                      {p.status === 'unpaid' && (
                        <button type="button" onClick={() => cancel(p)} disabled={working === p.id}
                          className="btn btn-sm" style={{
                            justifyContent: 'center',
                            background: 'transparent', color: 'var(--rust)',
                            border: '1.5px solid var(--rust)',
                          }}>
                          {working === p.id ? '…' : '✕ Cancel'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
