'use client';

// Owner-only list of offers buyers sent from the set's public page.

import React, { useCallback, useEffect, useState } from 'react';
import { fmtMoney, fmtDate } from '@/lib/setShowcase';

type Offer = {
  id: string;
  amount: number;
  buyer_name: string;
  buyer_contact: string;
  message: string | null;
  status: 'new' | 'accepted' | 'declined';
  created_at: string;
};

const STATUS_COLOR: Record<Offer['status'], string> = { new: 'var(--orange)', accepted: 'var(--teal)', declined: 'var(--ink-mute)' };

export default function SetOffersPanel({ slug }: { slug: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/set-offers?slug=${encodeURIComponent(slug)}`);
    const j = await res.json().catch(() => ({}));
    setOffers(Array.isArray(j.offers) ? j.offers : []);
    setLoaded(true);
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: Offer['status']) {
    setOffers(list => list.map(o => (o.id === id ? { ...o, status } : o)));
    await fetch('/api/set-offers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
  }

  if (!loaded || offers.length === 0) return null;
  const fresh = offers.filter(o => o.status === 'new').length;
  return (
    <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 20, background: 'var(--paper)' }}>
      <div className="display" style={{ fontSize: 15, color: 'var(--plum)', marginBottom: 8 }}>
        💬 Offers <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{offers.length} total{fresh ? ` · ${fresh} new` : ''}</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {offers.map(o => (
          <div key={o.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--cream)' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', minWidth: 110 }}>{fmtMoney(Number(o.amount))}</div>
            <div style={{ flex: '1 1 240px', minWidth: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
              <div><strong>{o.buyer_name}</strong> · <span style={{ wordBreak: 'break-all' }}>{o.buyer_contact}</span></div>
              {o.message && <div style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>{o.message}</div>}
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 3 }}>{fmtDate(o.created_at)}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="eyebrow" style={{ fontSize: 10, color: STATUS_COLOR[o.status] }}>{o.status}</span>
              {o.status !== 'accepted' && <button type="button" className="btn btn-outline btn-sm" onClick={() => setStatus(o.id, 'accepted')}>Accept</button>}
              {o.status !== 'declined' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatus(o.id, 'declined')}>Decline</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 8 }}>
        Accept or decline just tracks the offer here. Reach out to the buyer with the contact details they gave.
      </div>
    </section>
  );
}
