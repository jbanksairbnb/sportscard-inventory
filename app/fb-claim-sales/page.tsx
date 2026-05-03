'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type SaleStatus = 'draft' | 'live' | 'closed' | 'settled';
type ClaimStatus = 'open' | 'claimed' | 'sold' | 'paid';

type SaleRow = {
  id: string;
  title: string;
  status: SaleStatus;
  post_url: string | null;
  group_id: string | null;
  created_at: string;
};

type LotRow = {
  id: string;
  sale_id: string;
  lot_number: number;
  kind: 'single' | 'group';
};

type ListingLite = {
  id: string;
  title: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  photos: string[] | null;
};

type ItemRow = {
  id: string;
  lot_id: string;
  position: number;
  listing_id: string | null;
  price: number | null;
  claim_buyer_id: string | null;
  claim_buyer_name: string | null;
  claim_status: ClaimStatus;
  listing: ListingLite | null;
};

type GroupRow = { id: string; name: string };
type BidderRow = { id: string; name: string; fb_handle: string | null };

const STATUS_FILTERS = ['all', 'draft', 'live', 'closed', 'settled'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function statusBg(s: SaleStatus) {
  if (s === 'live') return 'var(--teal)';
  if (s === 'closed') return 'var(--mustard)';
  if (s === 'settled') return 'var(--plum)';
  return 'var(--ink-mute)';
}
function statusFg(s: SaleStatus) {
  if (s === 'closed') return 'var(--plum)';
  return 'var(--cream)';
}
function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

export default function ClaimSalesPage() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [groupsById, setGroupsById] = useState<Record<string, GroupRow>>({});
  const [bidders, setBidders] = useState<BidderRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [savingItems, setSavingItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const [salesRes, lotsRes, itemsRes, groupsRes, biddersRes] = await Promise.all([
        supabase.from('fb_claim_sales')
          .select('id, title, status, post_url, group_id, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase.from('fb_claim_sale_lots')
          .select('id, sale_id, lot_number, kind')
          .eq('user_id', user.id)
          .order('lot_number'),
        supabase.from('fb_claim_sale_items')
          .select('id, lot_id, position, listing_id, price, claim_buyer_id, claim_buyer_name, claim_status, listing:listings(id, title, year, brand, card_number, player, photos)')
          .eq('user_id', user.id)
          .order('position'),
        supabase.from('fb_groups').select('id, name').eq('user_id', user.id),
        supabase.from('fb_bidders').select('id, name, fb_handle').eq('user_id', user.id).order('name'),
      ]);

      setSales((salesRes.data || []) as SaleRow[]);
      setLots((lotsRes.data || []) as LotRow[]);
      setItems((itemsRes.data || []) as unknown as ItemRow[]);
      const gMap: Record<string, GroupRow> = {};
      for (const g of (groupsRes.data || []) as GroupRow[]) gMap[g.id] = g;
      setGroupsById(gMap);
      setBidders((biddersRes.data || []) as BidderRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const lotsBySale = useMemo(() => {
    const m: Record<string, LotRow[]> = {};
    for (const l of lots) (m[l.sale_id] ??= []).push(l);
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.lot_number - b.lot_number);
    return m;
  }, [lots]);

  const itemsByLot = useMemo(() => {
    const m: Record<string, ItemRow[]> = {};
    for (const it of items) (m[it.lot_id] ??= []).push(it);
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.position - b.position);
    return m;
  }, [items]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: sales.length, draft: 0, live: 0, closed: 0, settled: 0 };
    for (const s of sales) c[s.status] = (c[s.status] || 0) + 1;
    return c;
  }, [sales]);

  const visibleSales = filter === 'all' ? sales : sales.filter(s => s.status === filter);

  const biddersByLowerName = useMemo(() => {
    const m = new Map<string, BidderRow>();
    for (const b of bidders) m.set(b.name.toLowerCase(), b);
    return m;
  }, [bidders]);

  async function ensureBidder(name: string): Promise<BidderRow | null> {
    if (!userId) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = biddersByLowerName.get(trimmed.toLowerCase());
    if (existing) return existing;
    const supabase = createClient();
    const { data, error } = await supabase
      .from('fb_bidders').insert({ user_id: userId, name: trimmed })
      .select('id, name, fb_handle').single();
    if (error || !data) return null;
    const b = data as BidderRow;
    setBidders(prev => [...prev, b].sort((a, b) => a.name.localeCompare(b.name)));
    return b;
  }

  async function setItemBuyer(item: ItemRow, name: string) {
    setSavingItems(prev => new Set(prev).add(item.id));
    const trimmed = name.trim();
    let buyerId: string | null = null;
    let buyerName: string | null = trimmed || null;
    if (buyerName) {
      const b = await ensureBidder(buyerName);
      buyerId = b?.id || null;
      if (b) buyerName = b.name;
    }
    const claim_status: ClaimStatus = buyerName
      ? (item.claim_status === 'open' ? 'claimed' : item.claim_status)
      : 'open';
    const supabase = createClient();
    const { error } = await supabase.from('fb_claim_sale_items')
      .update({ claim_buyer_id: buyerId, claim_buyer_name: buyerName, claim_status })
      .eq('id', item.id);
    if (!error) {
      setItems(prev => prev.map(i => i.id === item.id
        ? { ...i, claim_buyer_id: buyerId, claim_buyer_name: buyerName, claim_status }
        : i));
    } else {
      alert(error.message);
    }
    setSavingItems(prev => { const n = new Set(prev); n.delete(item.id); return n; });
  }

  async function setItemStatus(item: ItemRow, claim_status: ClaimStatus) {
    const supabase = createClient();
    const { error } = await supabase.from('fb_claim_sale_items').update({ claim_status }).eq('id', item.id);
    if (!error) setItems(prev => prev.map(i => i.id === item.id ? { ...i, claim_status } : i));
    else alert(error.message);
  }

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
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
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

      <datalist id="claim-buyers-list">
        {bidders.map(b => <option key={b.id} value={b.name}>{b.fb_handle ? `@${b.fb_handle}` : ''}</option>)}
      </datalist>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 18 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Every card in every claim sale appears below, grouped by sale. As buyers claim, type their name next
            to each row — it&apos;ll auto-link to your contacts and the status flips to <strong>Claimed</strong>. Open the
            sale&apos;s Manage page for FB URLs, status changes, and per-buyer invoices.
          </p>
        </section>

        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>({counts[f] || 0})</span>
            </button>
          ))}
        </div>

        {visibleSales.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 6 }}>No claim sales{filter === 'all' ? '' : ` in "${filter}"`}</div>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Click <strong>+ New Claim Sale</strong> to start one.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {visibleSales.map(sale => {
              const saleLots = lotsBySale[sale.id] || [];
              const allItems: { item: ItemRow; lot: LotRow }[] = [];
              for (const lot of saleLots) {
                for (const it of (itemsByLot[lot.id] || [])) allItems.push({ item: it, lot });
              }
              const groupName = sale.group_id ? (groupsById[sale.group_id]?.name || '') : '';
              const totalList = allItems.reduce((s, x) => s + (x.item.price || 0), 0);
              const totalClaimed = allItems
                .filter(x => x.item.claim_status !== 'open')
                .reduce((s, x) => s + (x.item.price || 0), 0);
              return (
                <section key={sale.id} className="panel-bordered" style={{ padding: 0, overflow: 'hidden' }}>
                  {/* Sale header */}
                  <div style={{
                    padding: '14px 18px', background: 'var(--plum)', color: 'var(--cream)',
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="display" style={{ fontSize: 16, color: 'var(--mustard)' }}>{sale.title}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'rgba(248,236,208,0.7)', marginTop: 3 }}>
                        Posted {new Date(sale.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        {groupName ? ` · in ${groupName}` : ''}
                        {' '}· {saleLots.length} lot{saleLots.length === 1 ? '' : 's'}
                        {' '}· {allItems.length} item{allItems.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                      background: statusBg(sale.status), color: statusFg(sale.status),
                      padding: '3px 10px', borderRadius: 100, textTransform: 'uppercase',
                      border: '1.5px solid var(--mustard)',
                    }}>{sale.status === 'closed' ? 'Sold' : sale.status}</span>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--mustard)', fontWeight: 700 }}>
                      {fmtMoney(totalClaimed)} <span style={{ opacity: 0.7, fontWeight: 500 }}>/ {fmtMoney(totalList)}</span>
                    </div>
                    {sale.post_url && (
                      <a href={sale.post_url} target="_blank" rel="noreferrer" className="btn btn-sm"
                        style={{ background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--mustard)' }}>
                        FB ↗
                      </a>
                    )}
                    <Link href={`/fb-claim-sales/${sale.id}`} className="btn btn-sm"
                      style={{ background: 'var(--orange)', color: 'var(--cream)', border: '1.5px solid var(--orange)' }}>
                      Manage →
                    </Link>
                  </div>

                  {allItems.length === 0 ? (
                    <div style={{ padding: 22, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                      No items in this sale yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--paper)' }}>
                            {['Lot', 'Pos', 'Card', 'Price', 'Buyer', 'Status'].map(h => (
                              <th key={h} className="eyebrow" style={{
                                padding: '10px 14px', textAlign: 'left', fontSize: 10,
                                letterSpacing: '0.16em', fontWeight: 700, color: 'var(--orange)',
                                borderBottom: '2px solid var(--rule)',
                              }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {allItems.map(({ item, lot }, idx) => {
                            const cardLabel = item.listing
                              ? [item.listing.year, item.listing.brand, item.listing.card_number ? `#${item.listing.card_number}` : '', item.listing.player].filter(Boolean).join(' ')
                              : 'Listing missing';
                            const photo = item.listing?.photos?.[0];
                            const isSaving = savingItems.has(item.id);
                            return (
                              <tr key={item.id} style={{
                                borderTop: '1px solid var(--cream-warm)',
                                background: item.claim_status === 'open'
                                  ? (idx % 2 === 0 ? 'var(--cream)' : 'var(--paper)')
                                  : 'rgba(45, 122, 110, 0.08)',
                              }}>
                                <td className="mono" style={{ padding: '8px 14px', fontSize: 12, color: 'var(--plum)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  #{lot.lot_number}
                                  <span style={{ color: 'var(--ink-mute)', marginLeft: 4, fontWeight: 500 }}>
                                    {lot.kind === 'group' ? ' · grp' : ''}
                                  </span>
                                </td>
                                <td className="mono" style={{ padding: '8px 14px', fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                                  {lot.kind === 'group' ? item.position : '—'}
                                </td>
                                <td style={{ padding: '8px 14px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {photo && <img src={photo} alt="" style={{ width: 28, height: 39, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />}
                                    <span className="display" style={{ fontSize: 12.5, color: 'var(--plum)' }}>{cardLabel}</span>
                                  </div>
                                </td>
                                <td className="mono" style={{ padding: '8px 14px', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  {fmtMoney(item.price)}
                                </td>
                                <td style={{ padding: '6px 14px' }}>
                                  <input
                                    list="claim-buyers-list"
                                    defaultValue={item.claim_buyer_name || ''}
                                    placeholder="Buyer name…"
                                    onBlur={e => {
                                      const v = e.target.value;
                                      if ((v.trim() || null) !== (item.claim_buyer_name || null)) setItemBuyer(item, v);
                                    }}
                                    className="input-sc" style={{ width: 170, fontSize: 12 }} />
                                </td>
                                <td style={{ padding: '6px 14px', whiteSpace: 'nowrap' }}>
                                  <select value={item.claim_status} onChange={e => setItemStatus(item, e.target.value as ClaimStatus)}
                                    className="input-sc" style={{ width: 100, fontSize: 11.5 }}>
                                    <option value="open">Open</option>
                                    <option value="claimed">Claimed</option>
                                    <option value="sold">Sold</option>
                                    <option value="paid">Paid</option>
                                  </select>
                                  {isSaving && <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginLeft: 6 }}>…</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
