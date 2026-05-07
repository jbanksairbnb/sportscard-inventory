'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

// A single sale event — a paid auction lot, a paid claim sale item, or a
// marketplace listing that was marked sold. Date is the parent auction/sale's
// created_at for FB events (precise per-lot paid_at not yet stored) and
// listings.sold_at for marketplace.
type SaleEvent = {
  source: 'auction' | 'claim' | 'marketplace';
  date: string;       // ISO timestamp
  revenue: number;
  cost: number;       // 0 if unknown (per the agreed rule: missing cost => 0 profit contribution)
  buyerKey: string | null;
  buyerName: string | null;
};

type BidEvent = {
  date: string;
  bidderKey: string | null;
};

type DateRange = 'month' | '3month' | '6month' | 'year' | 'all';
const RANGES: { key: DateRange; label: string; months: number | null }[] = [
  { key: 'month', label: 'Past month', months: 1 },
  { key: '3month', label: 'Past 3 months', months: 3 },
  { key: '6month', label: 'Past 6 months', months: 6 },
  { key: 'year', label: 'Past year', months: 12 },
  { key: 'all', label: 'All time', months: null },
];

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtMoneyLong(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}
function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: 'short', year: '2-digit' });
}

export default function SalesMetricsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<SaleEvent[]>([]);
  const [bidEvents, setBidEvents] = useState<BidEvent[]>([]);
  const [range, setRange] = useState<DateRange>('6month');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const [aucsRes, lotsRes, salesRes, itemsRes, marketRes, historicalRes] = await Promise.all([
        supabase.from('fb_auctions').select('id, created_at').eq('user_id', user.id),
        supabase.from('fb_auction_lots')
          .select('auction_id, current_bid, status, bidder_id, bidder_name, listing:listings(cost)')
          .eq('user_id', user.id),
        supabase.from('fb_claim_sales').select('id, created_at').eq('user_id', user.id),
        supabase.from('fb_claim_sale_items')
          .select('lot_id, price, claim_status, claim_buyer_id, claim_buyer_name, listing:listings(cost)')
          .eq('user_id', user.id),
        supabase.from('listings')
          .select('sold_at, sold_price, cost, status')
          .eq('user_id', user.id)
          .eq('status', 'sold'),
        supabase.from('historical_transactions')
          .select('occurred_at, created_at, amount, channel, engagement_type, bidder_id, bidder_name')
          .eq('user_id', user.id),
      ]);

      type AucRow = { id: string; created_at: string };
      type LotJoin = { auction_id: string; current_bid: number | null; status: string; bidder_id: string | null; bidder_name: string | null; listing: { cost: number | null } | null };
      type SaleRow = { id: string; created_at: string };
      type ClaimLotRow = { id: string; sale_id: string };
      type ItemJoin = { lot_id: string; price: number | null; claim_status: string; claim_buyer_id: string | null; claim_buyer_name: string | null; listing: { cost: number | null } | null };

      const aucsById = new Map<string, AucRow>();
      for (const a of (aucsRes.data || []) as AucRow[]) aucsById.set(a.id, a);
      const lotRows = (lotsRes.data || []) as unknown as LotJoin[];

      const salesById = new Map<string, SaleRow>();
      for (const s of (salesRes.data || []) as SaleRow[]) salesById.set(s.id, s);

      // Need to map claim items → claim sale via claim_sale_lots.
      const { data: claimLotRows } = await supabase
        .from('fb_claim_sale_lots').select('id, sale_id').eq('user_id', user.id);
      const claimLotsById = new Map<string, ClaimLotRow>();
      for (const r of (claimLotRows || []) as ClaimLotRow[]) claimLotsById.set(r.id, r);
      const itemRows = (itemsRes.data || []) as unknown as ItemJoin[];

      const evs: SaleEvent[] = [];
      const bids: BidEvent[] = [];

      for (const l of lotRows) {
        const auc = aucsById.get(l.auction_id);
        if (!auc) continue;
        const buyerKey = l.bidder_id ? `id:${l.bidder_id}`
          : (l.bidder_name ? `name:${l.bidder_name.trim().toLowerCase()}` : null);
        // A bid event for activity charts: count any non-null bidder, regardless of status.
        if (buyerKey) bids.push({ date: auc.created_at, bidderKey: buyerKey });
        // A sale event for revenue/profit: paid lots only (collected $).
        if (l.status === 'paid' && l.current_bid) {
          evs.push({
            source: 'auction',
            date: auc.created_at,
            revenue: l.current_bid,
            cost: l.listing?.cost ?? 0,
            buyerKey,
            buyerName: l.bidder_name,
          });
        }
      }
      for (const it of itemRows) {
        const lot = claimLotsById.get(it.lot_id);
        if (!lot) continue;
        const sale = salesById.get(lot.sale_id);
        if (!sale) continue;
        if (it.claim_status === 'paid' && it.price) {
          const buyerKey = it.claim_buyer_id ? `id:${it.claim_buyer_id}`
            : (it.claim_buyer_name ? `name:${it.claim_buyer_name.trim().toLowerCase()}` : null);
          evs.push({
            source: 'claim',
            date: sale.created_at,
            revenue: it.price,
            cost: it.listing?.cost ?? 0,
            buyerKey,
            buyerName: it.claim_buyer_name,
          });
        }
      }
      type MarketRow = { sold_at: string | null; sold_price: number | null; cost: number | null; status: string };
      for (const row of (marketRes.data || []) as MarketRow[]) {
        if (!row.sold_price) continue;
        evs.push({
          source: 'marketplace',
          date: row.sold_at || new Date().toISOString(),
          revenue: row.sold_price,
          cost: row.cost ?? 0,
          buyerKey: null,
          buyerName: null,
        });
      }
      // Imported historical transactions feed both revenue (won only) and the
      // bidder-activity charts (any engagement counts).
      type HistRow = { occurred_at: string | null; created_at: string; amount: number | null; channel: string | null; engagement_type: 'won' | 'bid' | 'tag_request'; bidder_id: string | null; bidder_name: string | null };
      for (const h of (historicalRes.data || []) as HistRow[]) {
        const date = h.occurred_at ? `${h.occurred_at}T00:00:00Z` : h.created_at;
        const buyerKey = h.bidder_id ? `id:${h.bidder_id}`
          : (h.bidder_name ? `name:${h.bidder_name.trim().toLowerCase()}` : null);
        if (h.engagement_type === 'won' && h.amount) {
          evs.push({
            source: h.channel === 'fb_claim' ? 'claim' : h.channel === 'fb_auction' ? 'auction' : 'marketplace',
            date,
            revenue: h.amount,
            cost: 0,
            buyerKey,
            buyerName: h.bidder_name,
          });
        }
        if (buyerKey) bids.push({ date, bidderKey: buyerKey });
      }
      setEvents(evs);
      setBidEvents(bids);
      setLoading(false);
    }
    load();
  }, [router]);

  const filteredEvents = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range);
    if (!cfg || cfg.months === null) return events;
    const cutoff = Date.now() - cfg.months * 30 * 24 * 60 * 60 * 1000;
    return events.filter(e => new Date(e.date).getTime() >= cutoff);
  }, [events, range]);

  const filteredBids = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range);
    if (!cfg || cfg.months === null) return bidEvents;
    const cutoff = Date.now() - cfg.months * 30 * 24 * 60 * 60 * 1000;
    return bidEvents.filter(b => new Date(b.date).getTime() >= cutoff);
  }, [bidEvents, range]);

  // KPI rollups
  const kpis = useMemo(() => {
    let revenue = 0, cost = 0, auctionRev = 0, claimRev = 0, marketRev = 0;
    const buyers = new Set<string>();
    for (const e of filteredEvents) {
      revenue += e.revenue;
      cost += e.cost;
      if (e.source === 'auction') auctionRev += e.revenue;
      else if (e.source === 'claim') claimRev += e.revenue;
      else marketRev += e.revenue;
      if (e.buyerKey) buyers.add(e.buyerKey);
    }
    const profit = revenue - cost;
    return { revenue, cost, profit, auctionRev, claimRev, marketRev, uniqueBuyers: buyers.size, sales: filteredEvents.length };
  }, [filteredEvents]);

  // Monthly buckets — for the current range plus a previous matching window
  // (so we can compute MoM delta on revenue/profit).
  const monthly = useMemo(() => {
    const buckets = new Map<string, { revenue: number; profit: number; auction: number; claim: number; marketplace: number; bidders: Set<string>; bids: number }>();
    function bucket(k: string) {
      let b = buckets.get(k);
      if (!b) { b = { revenue: 0, profit: 0, auction: 0, claim: 0, marketplace: 0, bidders: new Set<string>(), bids: 0 }; buckets.set(k, b); }
      return b;
    }
    for (const e of filteredEvents) {
      const b = bucket(monthKey(e.date));
      b.revenue += e.revenue;
      b.profit += (e.revenue - e.cost);
      if (e.source === 'auction') b.auction += e.revenue;
      else if (e.source === 'claim') b.claim += e.revenue;
      else b.marketplace += e.revenue;
      if (e.buyerKey) b.bidders.add(e.buyerKey);
    }
    for (const bd of filteredBids) {
      const b = bucket(monthKey(bd.date));
      b.bids += 1;
      if (bd.bidderKey) b.bidders.add(bd.bidderKey);
    }
    return Array.from(buckets.entries())
      .map(([key, b]) => ({ key, ...b, biddersCount: b.bidders.size }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [filteredEvents, filteredBids]);

  // MoM delta — last full month vs prior month
  const momDelta = useMemo(() => {
    if (monthly.length < 2) return null;
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const rev = prev.revenue === 0 ? null : ((last.revenue - prev.revenue) / prev.revenue) * 100;
    const profit = prev.profit === 0 ? null : ((last.profit - prev.profit) / prev.profit) * 100;
    return { rev, profit, lastKey: last.key, prevKey: prev.key };
  }, [monthly]);

  // Top buyers (by total spend in range)
  const topBuyers = useMemo(() => {
    const map = new Map<string, { name: string; spend: number; count: number; auction: number; claim: number }>();
    for (const e of filteredEvents) {
      const key = e.buyerKey || `__nameless__${e.buyerName || 'Unknown'}`;
      const r = map.get(key) || { name: e.buyerName || 'Unknown', spend: 0, count: 0, auction: 0, claim: 0 };
      r.spend += e.revenue;
      r.count += 1;
      if (e.source === 'auction') r.auction += 1; else r.claim += 1;
      map.set(key, r);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [filteredEvents]);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  const maxRev = Math.max(1, ...monthly.map(m => m.revenue));
  const maxBidders = Math.max(1, ...monthly.map(m => m.biddersCount));
  const maxBids = Math.max(1, ...monthly.map(m => m.bids));

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ 📊 Sales Metrics ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/sales-metrics/historical" className="btn btn-ghost btn-sm">📜 Historical</Link>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">FB Auctions</Link>
            <Link href="/fb-claim-sales" className="btn btn-ghost btn-sm">Claim Sales</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <span className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700 }}>★ Range ★</span>
          <select value={range} onChange={e => setRange(e.target.value as DateRange)}
            style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', color: 'var(--plum)', fontFamily: 'var(--font-body)', cursor: 'pointer' }}>
            {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
            Profit assumes $0 cost when a listing&apos;s cost is missing.
          </span>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 22 }}>
          <Kpi label="Revenue" value={fmtMoneyLong(kpis.revenue)} accent />
          <Kpi label="Profit" value={fmtMoneyLong(kpis.profit)} sub={kpis.cost > 0 ? `${fmtMoney(kpis.cost)} cost` : 'no cost data'} />
          <Kpi label="Auction $" value={fmtMoney(kpis.auctionRev)} />
          <Kpi label="Claim sale $" value={fmtMoney(kpis.claimRev)} />
          <Kpi label="Marketplace $" value={fmtMoney(kpis.marketRev)} />
          <Kpi label="Sales (count)" value={String(kpis.sales)} />
          <Kpi label="Unique buyers" value={String(kpis.uniqueBuyers)} />
        </div>

        {/* Monthly revenue / profit chart */}
        <section className="panel-bordered" style={{ padding: '20px 22px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>Monthly revenue</div>
            {momDelta && (
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
                MoM revenue:{' '}
                <span style={{ color: (momDelta.rev ?? 0) >= 0 ? 'var(--teal)' : 'var(--rust)', fontWeight: 700 }}>
                  {momDelta.rev === null ? '—' : `${momDelta.rev >= 0 ? '+' : ''}${momDelta.rev.toFixed(1)}%`}
                </span>
                {' · '}
                profit:{' '}
                <span style={{ color: (momDelta.profit ?? 0) >= 0 ? 'var(--teal)' : 'var(--rust)', fontWeight: 700 }}>
                  {momDelta.profit === null ? '—' : `${momDelta.profit >= 0 ? '+' : ''}${momDelta.profit.toFixed(1)}%`}
                </span>
              </div>
            )}
          </div>
          {monthly.length === 0 ? (
            <EmptyState text="No sales recorded in this range yet." />
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', minHeight: 180, padding: '10px 0' }}>
              {monthly.map(m => {
                const aucH = (m.auction / maxRev) * 160;
                const claimH = (m.claim / maxRev) * 160;
                const mktH = (m.marketplace / maxRev) * 160;
                return (
                  <div key={m.key} style={{ flex: 1, minWidth: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                    title={`${monthLabel(m.key)} · Revenue ${fmtMoneyLong(m.revenue)} · Profit ${fmtMoneyLong(m.profit)} · Auctions ${fmtMoney(m.auction)} · Claims ${fmtMoney(m.claim)} · Marketplace ${fmtMoney(m.marketplace)}`}>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)', fontWeight: 700 }}>
                      {fmtMoney(m.revenue)}
                    </div>
                    <div style={{ height: 160, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderBottom: '1.5px solid var(--rule)' }}>
                      {mktH > 0 && <div style={{ height: mktH, background: 'var(--teal)' }} />}
                      {claimH > 0 && <div style={{ height: claimH, background: 'var(--mustard)' }} />}
                      {aucH > 0 && <div style={{ height: aucH, background: 'var(--orange)' }} />}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{monthLabel(m.key)}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--orange)', borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Auctions</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--mustard)', borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Claim sales</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--teal)', borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Marketplace</span>
          </div>
        </section>

        {/* Bidder activity chart */}
        <section className="panel-bordered" style={{ padding: '20px 22px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>Bidder activity</div>
          {monthly.length === 0 ? (
            <EmptyState text="No bid activity in this range yet." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <Mini chart="Unique bidders" rows={monthly.map(m => ({ key: m.key, value: m.biddersCount }))} max={maxBidders} color="var(--teal)" />
              <Mini chart="Total bids" rows={monthly.map(m => ({ key: m.key, value: m.bids }))} max={maxBids} color="var(--plum)" />
            </div>
          )}
        </section>

        {/* Top buyers */}
        <section className="panel-bordered" style={{ padding: '20px 22px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>Top buyers</div>
          {topBuyers.length === 0 ? (
            <EmptyState text="No paid sales in this range yet." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Buyer</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Sales</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Auction</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Claim</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Spend</th>
                </tr>
              </thead>
              <tbody>
                {topBuyers.map((b, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--rule)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--plum)', fontWeight: 600 }}>{b.name}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: 'var(--plum)' }}>{b.count}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: 'var(--ink-soft)' }}>{b.auction}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: 'var(--ink-soft)' }}>{b.claim}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13, color: 'var(--orange)', fontWeight: 700 }}>{fmtMoneyLong(b.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="panel-bordered" style={{ padding: '12px 16px' }}>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, color: accent ? 'var(--orange)' : 'var(--plum)', fontWeight: 700 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>{text}</div>;
}

function Mini({ chart, rows, max, color }: { chart: string; rows: { key: string; value: number }[]; max: number; color: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>{chart}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', minHeight: 120, padding: '6px 0' }}>
        {rows.map(r => {
          const h = (r.value / max) * 100;
          return (
            <div key={r.key} title={`${monthLabel(r.key)} · ${r.value}`}
              style={{ flex: 1, minWidth: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)', fontWeight: 700 }}>{r.value}</div>
              <div style={{ height: 100, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderBottom: '1px solid var(--rule)' }}>
                <div style={{ height: h, background: color }} />
              </div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>{monthLabel(r.key)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
