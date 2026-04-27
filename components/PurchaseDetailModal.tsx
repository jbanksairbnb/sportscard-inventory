'use client';

import React, { useState } from 'react';

export type PurchaseDetail = {
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
  payment_method: string | null;
  created_at: string;
  listing?: { title: string; photos: string[] } | null;
};

type Counterparty = { name: string; email: string };

const PAYMENT_METHODS = ['Venmo', 'PayPal', 'Zelle', 'Cash', 'Check', 'Other'] as const;

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
  return 'var(--rust)';
}
function statusFg(s: string) {
  if (s === 'paid') return 'var(--plum)';
  return 'var(--cream)';
}

export default function PurchaseDetailModal({
  purchase, mode, counterparty, onClose, onUpdated,
}: {
  purchase: PurchaseDetail;
  mode: 'buyer' | 'seller';
  counterparty: Counterparty;
  onClose: () => void;
  onUpdated: (updated: PurchaseDetail) => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Venmo');
  const [trackingNumber, setTrackingNumber] = useState<string>('');

  async function transition(action: 'paid' | 'shipped' | 'received' | 'cancelled', extra?: Record<string, string>) {
    setError('');
    setWorking(action);
    try {
      const res = await fetch('/api/purchase/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseId: purchase.id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      if (data.purchase) onUpdated(data.purchase as PurchaseDetail);
      else onUpdated({ ...purchase, status: action === 'received' ? 'completed' : action });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setWorking(null);
    }
  }

  const photo = purchase.listing?.photos?.[0];
  const subject = encodeURIComponent(`Sports Collective: ${purchase.listing?.title || 'order'}`);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 250,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 620, padding: 0, background: 'var(--cream)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1, lineHeight: 1.2 }}>
            {purchase.listing?.title || 'Purchase'}
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 100,
            background: statusBg(purchase.status), color: statusFg(purchase.status), whiteSpace: 'nowrap', marginTop: 4,
          }}>
            {purchase.status.toUpperCase()}
          </span>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {photo && (
            <div style={{
              width: '100%', height: 240, background: 'var(--paper)',
              border: '2px solid var(--plum)', borderRadius: 10, overflow: 'hidden',
              display: 'grid', placeItems: 'center',
            }}>
              <img src={photo} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
          )}

          <div style={{
            border: '1.5px solid var(--rule)', borderRadius: 10, padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>
              {mode === 'buyer' ? 'SELLER' : 'BUYER'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--plum)' }}>{counterparty.name}</div>
              {counterparty.email && (
                <a href={`mailto:${counterparty.email}?subject=${subject}`}
                  style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 600 }}>
                  {counterparty.email}
                </a>
              )}
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              <tr>
                <td style={{ padding: '6px 0', color: 'var(--ink-mute)' }}>Item</td>
                <td style={{ padding: '6px 0', textAlign: 'right' }}>{fmtMoney(purchase.item_price)}</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 0', color: 'var(--ink-mute)' }}>Shipping ({purchase.shipping_label})</td>
                <td style={{ padding: '6px 0', textAlign: 'right' }}>{fmtMoney(purchase.shipping_cost)}</td>
              </tr>
              <tr style={{ borderTop: '2px solid var(--rule)' }}>
                <td style={{ padding: '8px 0', fontWeight: 700, color: 'var(--plum)' }}>Total</td>
                <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700, color: 'var(--teal)', fontSize: 16 }}>
                  {fmtMoney(purchase.total)}
                </td>
              </tr>
            </tbody>
          </table>

          <div>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>SHIP TO</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--plum)' }}>
              {purchase.ship_to_name}<br/>
              {purchase.ship_to_address1}{purchase.ship_to_address2 ? <>, {purchase.ship_to_address2}</> : null}<br/>
              {purchase.ship_to_city}, {purchase.ship_to_state} {purchase.ship_to_zip}<br/>
              {purchase.ship_to_country}
            </div>
          </div>

          <div>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>TIMELINE</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--plum)' }}>
              <div>Ordered: <strong>{fmtDate(purchase.created_at)}</strong></div>
              {purchase.paid_at && <div>Paid: <strong>{fmtDate(purchase.paid_at)}</strong>{purchase.payment_method ? <span style={{ color: 'var(--ink-mute)' }}> · via {purchase.payment_method}</span> : null}</div>}
              {purchase.shipped_at && <div>Shipped: <strong>{fmtDate(purchase.shipped_at)}</strong>{purchase.tracking_number ? <span style={{ color: 'var(--ink-mute)' }}> · tracking <span className="mono">{purchase.tracking_number}</span></span> : null}</div>}
              {purchase.status === 'completed' && <div>Completed</div>}
              {purchase.status === 'cancelled' && purchase.cancelled_at && <div>Cancelled: <strong>{fmtDate(purchase.cancelled_at)}</strong>{purchase.cancelled_by ? <span style={{ color: 'var(--ink-mute)' }}> · by {purchase.cancelled_by}</span> : null}</div>}
            </div>
          </div>

          {mode === 'seller' && purchase.status === 'unpaid' && (
            <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>RECORD PAYMENT</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Method:</label>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                  style={{
                    flex: 1, border: '1.5px solid var(--plum)', borderRadius: 6,
                    padding: '6px 10px', fontFamily: 'var(--font-body)', fontSize: 13,
                    color: 'var(--plum)', background: 'var(--cream)',
                  }}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => transition('paid', { paymentMethod })} disabled={working !== null}
                  className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  {working === 'paid' ? 'Saving…' : '$ Mark Paid'}
                </button>
                <button type="button" onClick={() => { if (confirm('Cancel this purchase? The listing goes back on the marketplace and the buyer is notified.')) transition('cancelled'); }}
                  disabled={working !== null}
                  className="btn btn-sm" style={{
                    background: 'transparent', color: 'var(--rust)',
                    border: '1.5px solid var(--rust)', padding: '8px 14px',
                  }}>
                  {working === 'cancelled' ? '…' : '✕ Cancel'}
                </button>
              </div>
            </div>
          )}
          {mode === 'seller' && purchase.status === 'paid' && (
            <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>SHIP IT</div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }}>
                  Tracking number (optional)
                </label>
                <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)}
                  placeholder="9400 1000 0000 0000 0000 00"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    border: '1.5px solid var(--plum)', borderRadius: 6,
                    padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: 13,
                    color: 'var(--plum)', background: 'var(--cream)',
                  }} />
              </div>
              <button type="button" onClick={() => transition('shipped', trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : undefined)}
                disabled={working !== null}
                className="btn btn-primary" style={{ justifyContent: 'center' }}>
                {working === 'shipped' ? 'Saving…' : '📦 Mark Shipped'}
              </button>
            </div>
          )}

          {mode === 'buyer' && purchase.status === 'shipped' && (
            <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 14 }}>
              <button type="button" onClick={() => { if (confirm('Mark this item as received? This finalizes the transaction.')) transition('received'); }}
                disabled={working !== null}
                className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                {working === 'received' ? 'Saving…' : '✓ Mark Received'}
              </button>
            </div>
          )}
          {mode === 'buyer' && purchase.status === 'unpaid' && (
            <div style={{ borderTop: '1.5px solid var(--rule)', paddingTop: 14 }}>
              <button type="button" onClick={() => { if (confirm('Cancel this purchase? The listing goes back on the marketplace and the seller is notified.')) transition('cancelled'); }}
                disabled={working !== null}
                className="btn btn-sm" style={{
                  width: '100%', justifyContent: 'center',
                  background: 'transparent', color: 'var(--rust)',
                  border: '1.5px solid var(--rust)', padding: '10px 14px',
                }}>
                {working === 'cancelled' ? '…' : '✕ Cancel Purchase'}
              </button>
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600,
            }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
