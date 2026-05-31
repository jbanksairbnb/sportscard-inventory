'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Line = {
  id: string;
  listing_id: string;
  item_price: number;
  status: string;
  listing?: { title: string; photos: string[] } | null;
};

type Order = {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: string;
  ship_to_name: string;
  ship_to_address1: string;
  ship_to_address2: string | null;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
  ship_to_country: string;
  shipping_label: string | null;
  shipping_cost: number;
  subtotal: number;
  total: number;
  payment_method: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  tracking_number: string | null;
  created_at: string;
};

const PAYMENT_METHODS = ['Venmo', 'PayPal', 'Zelle', 'Cash', 'Check', 'Other'] as const;

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n));
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
  return 'var(--rust)';
}
function statusFg(s: string) {
  return s === 'paid' ? 'var(--plum)' : 'var(--cream)';
}
// Buyer-facing label for the order's stage (matches the Claimed/Sold/Shipped
// buckets sellers see on My Listings).
function stageLabel(s: string) {
  if (s === 'unpaid') return 'CLAIMED';
  if (s === 'paid') return 'SOLD';
  if (s === 'shipped' || s === 'completed') return 'SHIPPED';
  return s.toUpperCase();
}

export default function OrderInvoicePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = params?.id;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [role, setRole] = useState<'buyer' | 'seller' | null>(null);
  const [counterparty, setCounterparty] = useState<{ name: string; email: string }>({ name: '—', email: '' });
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Venmo');
  const [trackingNumber, setTrackingNumber] = useState<string>('');

  async function load() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    if (!orderId) { setLoading(false); return; }

    const { data: ord } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (!ord) { setOrder(null); setLoading(false); return; }
    const o = ord as Order;
    setOrder(o);

    const viewerRole = user.id === o.seller_id ? 'seller' : user.id === o.buyer_id ? 'buyer' : null;
    setRole(viewerRole);

    const { data: lineRows } = await supabase
      .from('purchases')
      .select('id, listing_id, item_price, status, listing:listings(title, photos)')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    setLines((lineRows || []) as unknown as Line[]);

    const otherId = viewerRole === 'seller' ? o.buyer_id : o.seller_id;
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('display_name, handle, email')
      .eq('user_id', otherId)
      .maybeSingle();
    const email = prof?.email || '';
    setCounterparty({
      name: prof?.display_name || prof?.handle || (email ? email.split('@')[0] : '—'),
      email,
    });

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, router]);

  async function transition(action: 'paid' | 'shipped' | 'received' | 'cancelled', extra?: Record<string, string>) {
    setError('');
    setWorking(action);
    try {
      const res = await fetch('/api/orders/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setWorking(null);
    }
  }

  const mailSubject = useMemo(
    () => encodeURIComponent(`Sports Collective order ${orderId ? orderId.slice(0, 8) : ''}`),
    [orderId],
  );

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="panel-bordered" style={{ padding: '40px 32px', textAlign: 'center', maxWidth: 420 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>Invoice not found</div>
          <p style={{ color: 'var(--ink-mute)', fontSize: 13, marginBottom: 16 }}>
            This order doesn&apos;t exist or you don&apos;t have access to it.
          </p>
          <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
        </div>
      </div>
    );
  }

  const shortId = order.id.slice(0, 8).toUpperCase();

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Invoice ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href={role === 'seller' ? '/listings' : '/purchases'} className="btn btn-outline btn-sm">
              ← {role === 'seller' ? 'My Listings' : 'My Purchases'}
            </Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div className="panel-bordered" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header band */}
          <div style={{ padding: '24px 28px', borderBottom: '2px solid var(--plum)', display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>INVOICE</div>
              <div className="display" style={{ fontSize: 26, color: 'var(--plum)' }}>Order #{shortId}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4 }}>
                Placed {fmtDate(order.created_at)} · {lines.length} card{lines.length === 1 ? '' : 's'}
              </div>
            </div>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', padding: '5px 12px', borderRadius: 100,
              background: statusBg(order.status), color: statusFg(order.status), whiteSpace: 'nowrap',
            }}>
              {stageLabel(order.status)}
            </span>
          </div>

          <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
            {/* Parties + ship-to */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>
                  {role === 'seller' ? 'BUYER' : 'SELLER'}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--plum)' }}>{counterparty.name}</div>
                {counterparty.email && (
                  <a href={`mailto:${counterparty.email}?subject=${mailSubject}`} style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 600 }}>
                    {counterparty.email}
                  </a>
                )}
              </div>
              <div>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>SHIP TO</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--plum)' }}>
                  {order.ship_to_name}<br />
                  {order.ship_to_address1}{order.ship_to_address2 ? <>, {order.ship_to_address2}</> : null}<br />
                  {order.ship_to_city}, {order.ship_to_state} {order.ship_to_zip}<br />
                  {order.ship_to_country}
                </div>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 8 }}>CARDS IN THIS ORDER</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lines.map(l => {
                  const photo = l.listing?.photos?.[0];
                  return (
                    <div key={l.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      border: '1.5px solid var(--rule)', borderRadius: 8, padding: '8px 12px',
                    }}>
                      <div style={{ width: 44, height: 44, flexShrink: 0, background: 'var(--paper)', borderRadius: 6, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                        {photo
                          ? <img loading="lazy" decoding="async" src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <span className="eyebrow" style={{ fontSize: 8, color: 'var(--ink-mute)' }}>No photo</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--plum)', fontWeight: 600 }}>
                        {l.listing?.title || 'Listing'}
                        {l.status === 'cancelled' && (
                          <span className="mono" style={{ marginLeft: 8, fontSize: 10, color: 'var(--ink-mute)' }}>(cancelled)</span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--plum)' }}>{fmtMoney(l.item_price)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Totals */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, maxWidth: 320, marginLeft: 'auto' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 0', color: 'var(--ink-mute)' }}>Subtotal</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>{fmtMoney(order.subtotal)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 0', color: 'var(--ink-mute)' }}>Shipping{order.shipping_label ? ` (${order.shipping_label})` : ''}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>{fmtMoney(order.shipping_cost)}</td>
                </tr>
                <tr style={{ borderTop: '2px solid var(--rule)' }}>
                  <td style={{ padding: '8px 0', fontWeight: 700, color: 'var(--plum)' }}>Total</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700, color: 'var(--teal)', fontSize: 17 }}>{fmtMoney(order.total)}</td>
                </tr>
              </tbody>
            </table>

            {/* Timeline */}
            <div>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>TIMELINE</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--plum)' }}>
                <div>Placed: <strong>{fmtDate(order.created_at)}</strong></div>
                {order.paid_at && <div>Paid: <strong>{fmtDate(order.paid_at)}</strong>{order.payment_method ? <span style={{ color: 'var(--ink-mute)' }}> · via {order.payment_method}</span> : null}</div>}
                {order.shipped_at && <div>Shipped: <strong>{fmtDate(order.shipped_at)}</strong>{order.tracking_number ? <span style={{ color: 'var(--ink-mute)' }}> · tracking <span className="mono">{order.tracking_number}</span></span> : null}</div>}
                {order.status === 'completed' && <div>Completed</div>}
              </div>
            </div>

            {/* Seller actions */}
            {role === 'seller' && order.status === 'unpaid' && (
              <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>RECORD PAYMENT</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Method:</label>
                  <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                    style={{ flex: 1, maxWidth: 220, border: '1.5px solid var(--plum)', borderRadius: 6, padding: '6px 10px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', background: 'var(--cream)' }}>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => transition('paid', { paymentMethod })} disabled={working !== null}
                    className="btn btn-primary" style={{ justifyContent: 'center' }}>
                    {working === 'paid' ? 'Saving…' : '$ Mark Order Paid'}
                  </button>
                  <button type="button" onClick={() => { if (confirm('Cancel this whole order? Every card goes back on the marketplace and the buyer is notified.')) transition('cancelled'); }}
                    disabled={working !== null}
                    className="btn btn-sm" style={{ background: 'transparent', color: 'var(--rust)', border: '1.5px solid var(--rust)', padding: '8px 14px' }}>
                    {working === 'cancelled' ? '…' : '✕ Cancel Order'}
                  </button>
                </div>
              </div>
            )}
            {role === 'seller' && order.status === 'paid' && (
              <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>SHIP IT</div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }}>Tracking number (optional)</label>
                  <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)}
                    placeholder="9400 1000 0000 0000 0000 00"
                    style={{ width: '100%', maxWidth: 360, boxSizing: 'border-box', border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, color: 'var(--plum)', background: 'var(--cream)' }} />
                </div>
                <button type="button" onClick={() => transition('shipped', trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : undefined)}
                  disabled={working !== null}
                  className="btn btn-primary" style={{ justifyContent: 'center', alignSelf: 'flex-start' }}>
                  {working === 'shipped' ? 'Saving…' : '📦 Mark Order Shipped'}
                </button>
              </div>
            )}

            {/* Buyer actions */}
            {role === 'buyer' && order.status === 'unpaid' && (
              <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
                  The seller will reach out about payment via their preferred method (Venmo, PayPal, Zelle, etc.).
                </p>
                <button type="button" onClick={() => { if (confirm('Cancel this whole order? Every card goes back on the marketplace and the seller is notified.')) transition('cancelled'); }}
                  disabled={working !== null}
                  className="btn btn-sm" style={{ background: 'transparent', color: 'var(--rust)', border: '1.5px solid var(--rust)', padding: '10px 14px' }}>
                  {working === 'cancelled' ? '…' : '✕ Cancel Order'}
                </button>
              </div>
            )}
            {role === 'buyer' && order.status === 'shipped' && (
              <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 16 }}>
                <button type="button" onClick={() => { if (confirm('Mark this order as received? This finalizes the transaction.')) transition('received'); }}
                  disabled={working !== null}
                  className="btn btn-primary" style={{ justifyContent: 'center' }}>
                  {working === 'received' ? 'Saving…' : '✓ Mark Order Received'}
                </button>
              </div>
            )}

            {error && (
              <div style={{ background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600 }}>
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
