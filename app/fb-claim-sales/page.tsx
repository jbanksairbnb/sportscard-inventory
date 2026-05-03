'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Status = 'draft' | 'live' | 'closed' | 'settled';

type SaleRow = {
  id: string;
  title: string;
  status: Status;
  post_url: string | null;
  created_at: string;
};

type LotRow = {
  id: string;
  sale_id: string;
  kind: 'single' | 'group';
};

type ItemRow = {
  id: string;
  lot_id: string;
  claim_status: 'open' | 'claimed' | 'sold' | 'paid';
  price: number | null;
};

const STATUS_FILTERS = ['all', 'draft', 'live', 'closed', 'settled'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function statusBg(s: Status) {
  if (s === 'live') return 'var(--teal)';
  if (s === 'closed') return 'var(--mustard)';
  if (s === 'settled') return 'var(--plum)';
  return 'var(--ink-mute)';
}
function statusFg(s: Status) {
  if (s === 'closed') return 'var(--plum)';
  return 'var(--cream)';
}

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

export default function ClaimSalesPage() {
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [lotsBySale, setLotsBySale] = useState<Record<string, LotRow[]>>({});
  const [itemsBySale, setItemsBySale] = useState<Record<string, ItemRow[]>>({});
  const [filter, setFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: salesData } = await supabase
        .from('fb_claim_sales')
        .select('id, title, status, post_url, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      const list = (salesData || []) as SaleRow[];
      setSales(list);

      const ids = list.map(s => s.id);
      if (ids.length > 0) {
        const [lotsRes, itemsRes] = await Promise.all([
          supabase.from('fb_claim_sale_lots')
            .select('id, sale_id, kind').in('sale_id', ids),
          supabase.from('fb_claim_sale_items')
            .select('id, lot_id, claim_status, price').in('user_id', [user.id]),
        ]);
        const lots = (lotsRes.data || []) as LotRow[];
        const items = (itemsRes.data || []) as ItemRow[];
        const lotMap: Record<string, LotRow[]> = {};
        const itemMap: Record<string, ItemRow[]> = {};
        const lotToSale = new Map<string, string>();
        for (const l of lots) {
          lotToSale.set(l.id, l.sale_id);
          (lotMap[l.sale_id] ??= []).push(l);
        }
        for (const it of items) {
          const sid = lotToSale.get(it.lot_id);
          if (!sid) continue;
          (itemMap[sid] ??= []).push(it);
        }
        setLotsBySale(lotMap);
        setItemsBySale(itemMap);
      }
      setLoading(false);
    }
    load();
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { draft: 0, live: 0, closed: 0, settled: 0 };
    for (const s of sales) c[s.status] = (c[s.status] || 0) + 1;
    return c;
  }, [sales]);

  const filtered = filter === 'all' ? sales : sales.filter(s => s.status === filter);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ FB Claim Sales ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-claim-sales/new" className="btn btn-primary btn-sm">+ New Claim Sale</Link>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">Auctions</Link>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">Buyers</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Click <strong>+ New Claim Sale</strong>. Add the sale title, payment / shipping info.</li>
            <li>Add lots — one per FB comment. A lot is either a <strong>single</strong> card or a <strong>group</strong> of up to 6.</li>
            <li>Click <strong>Generate</strong>. Copy the parent post and each comment into Facebook.</li>
            <li>Drop in the post URL, mark the sale <strong>Live</strong> — source set rows go out of inventory automatically.</li>
            <li>As buyers claim, type their name next to each item. We&apos;ll auto-link them to your contacts.</li>
            <li>When you&apos;re done, click <strong>Settle</strong> for combined invoices per buyer.</li>
          </ol>
        </section>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>
                ({f === 'all' ? sales.length : (counts[f] || 0)})
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 6 }}>No claim sales{filter === 'all' ? '' : ` in "${filter}"`}</div>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Click <strong>+ New Claim Sale</strong> to start one.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(s => {
              const lots = lotsBySale[s.id] || [];
              const items = itemsBySale[s.id] || [];
              const itemCount = items.length;
              const claimedCount = items.filter(i => i.claim_status !== 'open').length;
              const total = items.reduce((sum, i) => sum + (i.price || 0), 0);
              return (
                <Link key={s.id} href={`/fb-claim-sales/${s.id}`} style={{ textDecoration: 'none' }}>
                  <div className="panel-bordered" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center', cursor: 'pointer' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <div className="display" style={{ fontSize: 17, color: 'var(--plum)' }}>{s.title}</div>
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                          background: statusBg(s.status), color: statusFg(s.status),
                          padding: '2px 8px', borderRadius: 100, textTransform: 'uppercase',
                        }}>{s.status}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                        {lots.length} lot{lots.length === 1 ? '' : 's'} · {itemCount} item{itemCount === 1 ? '' : 's'} · {claimedCount} claimed · created {new Date(s.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="stat-num" style={{ fontSize: 22, color: 'var(--orange)' }}>{fmtMoney(total)}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>list value</div>
                    </div>
                    <span style={{ color: 'var(--plum)', fontSize: 18 }}>→</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
