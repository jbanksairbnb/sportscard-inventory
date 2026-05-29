'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSellerStatus } from '@/lib/sellerGuard';
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
  itemLabel: string | null; // what was purchased, when we can resolve it
};

type BidEvent = {
  date: string;
  bidderKey: string | null;
};

// One recorded auction bid — sourced from the bid-event log (plus imported
// historical bids). Powers the "Unique bidders" drill-down: everyone who bid in
// the auctions, not just winners.
type BidderRecord = {
  date: string;
  key: string;
  name: string;
  handle: string | null;
  lotKey: string; // distinct lots-bid-on counter
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
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
function sourceLabel(s: SaleEvent['source']): string {
  return s === 'auction' ? 'Auction' : s === 'claim' ? 'Claim sale' : 'Marketplace';
}
// Build a short "2019 Topps #50 Mike Trout" style label from a listing join.
function shortItemLabel(l: { year?: number | null; brand?: string | null; card_number?: string | null; player?: string | null; title?: string | null } | null | undefined): string | null {
  if (!l) return null;
  const parts = [
    l.year ? String(l.year) : '',
    l.brand || '',
    l.card_number ? `#${l.card_number}` : '',
    l.player || '',
  ].filter(Boolean);
  const label = parts.join(' ').trim();
  return label || l.title || null;
}
// Same grouping key the buyer rollups use, with a name fallback for un-linked rows.
function buyerKeyOf(e: SaleEvent): string {
  return e.buyerKey || `__nameless__${e.buyerName || 'Unknown'}`;
}

// What the details overlay is currently showing.
type Drill =
  | { kind: 'sales'; title: string; events: SaleEvent[]; showProfit: boolean }
  | { kind: 'buyers'; title: string }
  | { kind: 'bidders'; title: string };

export default function SalesMetricsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<SaleEvent[]>([]);
  const [bidEvents, setBidEvents] = useState<BidEvent[]>([]);
  const [bidderRecords, setBidderRecords] = useState<BidderRecord[]>([]);
  const [range, setRange] = useState<DateRange>('6month');
  const [drill, setDrill] = useState<Drill | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      { const _ss = await getSellerStatus(supabase, user.id); if (!_ss.canSell) { router.replace('/marketplace'); return; } if (!_ss.termsAccepted) { router.replace('/seller-terms'); return; } }
      const [aucsRes, lotsRes, salesRes, itemsRes, marketRes, historicalRes, bidEventsRes] = await Promise.all([
        supabase.from('fb_auctions').select('id, created_at').eq('user_id', user.id),
        supabase.from('fb_auction_lots')
          .select('auction_id, current_bid, status, bidder_id, bidder_name, listing:listings(cost, year, brand, card_number, player, title)')
          .eq('user_id', user.id),
        supabase.from('fb_claim_sales').select('id, created_at').eq('user_id', user.id),
        supabase.from('fb_claim_sale_items')
          .select('lot_id, price, claim_status, claim_buyer_id, claim_buyer_name, listing:listings(cost, year, brand, card_number, player, title)')
          .eq('user_id', user.id),
        supabase.from('listings')
          .select('sold_at, sold_price, cost, status, year, brand, card_number, player, title')
          .eq('user_id', user.id)
          .eq('status', 'sold'),
        supabase.from('historical_transactions')
          .select('occurred_at, created_at, amount, cost, channel, engagement_type, bidder_id, bidder_name')
          .eq('user_id', user.id),
        supabase.from('fb_auction_bid_events')
          .select('lot_id, bidder_id, bidder_name, bidder_fb_handle, created_at')
          .eq('user_id', user.id),
      ]);

      type AucRow = { id: string; created_at: string };
      type ListingJoin = { cost: number | null; year: number | null; brand: string | null; card_number: string | null; player: string | null; title: string | null };
      type LotJoin = { auction_id: string; current_bid: number | null; status: string; bidder_id: string | null; bidder_name: string | null; listing: ListingJoin | null };
      type SaleRow = { id: string; created_at: string };
      type ClaimLotRow = { id: string; sale_id: string };
      type ItemJoin = { lot_id: string; price: number | null; claim_status: string; claim_buyer_id: string | null; claim_buyer_name: string | null; listing: ListingJoin | null };

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
      const bidderRecs: BidderRecord[] = [];

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
            itemLabel: shortItemLabel(l.listing),
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
            itemLabel: shortItemLabel(it.listing),
          });
        }
      }
      type MarketRow = ListingJoin & { sold_at: string | null; sold_price: number | null; status: string };
      for (const row of (marketRes.data || []) as MarketRow[]) {
        if (!row.sold_price) continue;
        evs.push({
          source: 'marketplace',
          date: row.sold_at || new Date().toISOString(),
          revenue: row.sold_price,
          cost: row.cost ?? 0,
          buyerKey: null,
          buyerName: null,
          itemLabel: shortItemLabel(row),
        });
      }
      // Imported historical transactions feed both revenue (won only) and the
      // bidder-activity charts (any engagement counts).
      type HistRow = { occurred_at: string | null; created_at: string; amount: number | null; cost: number | null; channel: string | null; engagement_type: 'won' | 'bid' | 'tag_request'; bidder_id: string | null; bidder_name: string | null };
      let histSeq = 0;
      for (const h of (historicalRes.data || []) as HistRow[]) {
        const date = h.occurred_at ? `${h.occurred_at}T00:00:00Z` : h.created_at;
        const buyerKey = h.bidder_id ? `id:${h.bidder_id}`
          : (h.bidder_name ? `name:${h.bidder_name.trim().toLowerCase()}` : null);
        if (h.engagement_type === 'won' && h.amount) {
          evs.push({
            source: h.channel === 'fb_claim' ? 'claim' : h.channel === 'fb_auction' ? 'auction' : 'marketplace',
            date,
            revenue: h.amount,
            cost: h.cost ?? 0,
            buyerKey,
            buyerName: h.bidder_name,
            itemLabel: null,
          });
        }
        if (buyerKey) bids.push({ date, bidderKey: buyerKey });
        // Historical auction engagements count toward "all bidders who bid".
        if (buyerKey && (h.engagement_type === 'bid' || h.engagement_type === 'won')
          && (h.channel === 'fb_auction' || h.channel === 'fb_claim')) {
          bidderRecs.push({ date, key: buyerKey, name: h.bidder_name || '(unnamed)', handle: null, lotKey: `hist:${histSeq++}` });
        }
      }

      // The authoritative bid log: every recorded bid, named where known.
      type BidEventRow = { lot_id: string; bidder_id: string | null; bidder_name: string | null; bidder_fb_handle: string | null; created_at: string };
      for (const ev of (bidEventsRes.data || []) as BidEventRow[]) {
        const key = ev.bidder_id ? `id:${ev.bidder_id}`
          : (ev.bidder_name ? `name:${ev.bidder_name.trim().toLowerCase()}` : null);
        if (!key) continue;
        bidderRecs.push({ date: ev.created_at, key, name: ev.bidder_name || '(unnamed)', handle: ev.bidder_fb_handle || null, lotKey: ev.lot_id });
      }

      setEvents(evs);
      setBidEvents(bids);
      setBidderRecords(bidderRecs);
      setLoading(false);
    }
    load();
  }, [router]);

  const cutoffTs = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range);
    if (!cfg || cfg.months === null) return null;
    return Date.now() - cfg.months * 30 * 24 * 60 * 60 * 1000;
  }, [range]);

  const filteredEvents = useMemo(() => {
    if (cutoffTs === null) return events;
    return events.filter(e => new Date(e.date).getTime() >= cutoffTs);
  }, [events, cutoffTs]);

  const filteredBids = useMemo(() => {
    if (cutoffTs === null) return bidEvents;
    return bidEvents.filter(b => new Date(b.date).getTime() >= cutoffTs);
  }, [bidEvents, cutoffTs]);

  const filteredBidderRecords = useMemo(() => {
    if (cutoffTs === null) return bidderRecords;
    return bidderRecords.filter(b => new Date(b.date).getTime() >= cutoffTs);
  }, [bidderRecords, cutoffTs]);

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

  // Buyers (by total spend in range). Full list backs the "Unique buyers"
  // drill-down; the first 10 are shown in the Top buyers table.
  const buyersAgg = useMemo(() => {
    const map = new Map<string, { key: string; name: string; spend: number; count: number; auction: number; claim: number }>();
    for (const e of filteredEvents) {
      const key = buyerKeyOf(e);
      const r = map.get(key) || { key, name: e.buyerName || 'Unknown', spend: 0, count: 0, auction: 0, claim: 0 };
      r.spend += e.revenue;
      r.count += 1;
      if (e.source === 'auction') r.auction += 1; else if (e.source === 'claim') r.claim += 1;
      map.set(key, r);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [filteredEvents]);
  const topBuyers = useMemo(() => buyersAgg.slice(0, 10), [buyersAgg]);

  // Unique bidders across the auctions (everyone who bid, not just winners).
  const uniqueBidders = useMemo(() => {
    const map = new Map<string, { name: string; handle: string | null; bids: number; lots: Set<string> }>();
    for (const b of filteredBidderRecords) {
      const r = map.get(b.key) || { name: b.name, handle: b.handle, bids: 0, lots: new Set<string>() };
      r.bids += 1;
      r.lots.add(b.lotKey);
      if ((!r.name || r.name === '(unnamed)') && b.name && b.name !== '(unnamed)') r.name = b.name;
      if (!r.handle && b.handle) r.handle = b.handle;
      map.set(b.key, r);
    }
    return Array.from(map.values())
      .map(r => ({ name: r.name, handle: r.handle, bids: r.bids, lots: r.lots.size }))
      .sort((a, b) => b.bids - a.bids || a.name.localeCompare(b.name));
  }, [filteredBidderRecords]);

  function openBuyerDrill(key: string, name: string) {
    setDrill({ kind: 'sales', title: `${name} — purchases`, events: filteredEvents.filter(e => buyerKeyOf(e) === key), showProfit: false });
  }

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
          <button type="button" onClick={() => setDrill({ kind: 'bidders', title: 'Unique bidders' })}
            className="btn btn-primary btn-sm" title="See everyone who bid in your auctions">
            👤 Unique bidders ({uniqueBidders.length})
          </button>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
            Profit assumes $0 cost when a listing&apos;s cost is missing.
          </span>
        </div>

        {/* KPI cards — click any card to drill into the underlying transactions */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 22 }}>
          <Kpi label="Revenue" value={fmtMoneyLong(kpis.revenue)} accent
            onClick={() => setDrill({ kind: 'sales', title: 'Revenue — all transactions', events: filteredEvents, showProfit: false })} />
          <Kpi label="Profit" value={fmtMoneyLong(kpis.profit)} sub={kpis.cost > 0 ? `${fmtMoney(kpis.cost)} cost` : 'no cost data'}
            onClick={() => setDrill({ kind: 'sales', title: 'Profit — all transactions', events: filteredEvents, showProfit: true })} />
          <Kpi label="Auction $" value={fmtMoney(kpis.auctionRev)}
            onClick={() => setDrill({ kind: 'sales', title: 'Auction transactions', events: filteredEvents.filter(e => e.source === 'auction'), showProfit: false })} />
          <Kpi label="Claim sale $" value={fmtMoney(kpis.claimRev)}
            onClick={() => setDrill({ kind: 'sales', title: 'Claim sale transactions', events: filteredEvents.filter(e => e.source === 'claim'), showProfit: false })} />
          <Kpi label="Marketplace $" value={fmtMoney(kpis.marketRev)}
            onClick={() => setDrill({ kind: 'sales', title: 'Marketplace transactions', events: filteredEvents.filter(e => e.source === 'marketplace'), showProfit: false })} />
          <Kpi label="Sales (count)" value={String(kpis.sales)}
            onClick={() => setDrill({ kind: 'sales', title: 'All sales', events: filteredEvents, showProfit: false })} />
          <Kpi label="Unique buyers" value={String(kpis.uniqueBuyers)}
            onClick={() => setDrill({ kind: 'buyers', title: 'Unique buyers' })} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>Bidder activity</div>
            <button type="button" onClick={() => setDrill({ kind: 'bidders', title: 'Unique bidders' })}
              className="btn btn-ghost btn-sm">View bidders →</button>
          </div>
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
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>Top buyers</div>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>click a buyer to see what they purchased</span>
          </div>
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
                  <tr key={i} onClick={() => openBuyerDrill(b.key, b.name)}
                    style={{ borderTop: '1px solid var(--rule)', cursor: 'pointer' }}
                    title={`See ${b.name}'s purchases`}>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--teal)', fontWeight: 700, textDecoration: 'underline' }}>{b.name}</td>
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

      {drill && (
        <DrillOverlay
          drill={drill}
          buyers={buyersAgg}
          bidders={uniqueBidders}
          onClose={() => setDrill(null)}
          onSelectBuyer={openBuyerDrill}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, sub, accent, onClick }: { label: string; value: string; sub?: string; accent?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="panel-bordered"
      title={onClick ? 'Click for details' : undefined}
      style={{
        padding: '12px 16px', textAlign: 'left', font: 'inherit', width: '100%',
        background: 'var(--paper)', cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
      }}>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, color: accent ? 'var(--orange)' : 'var(--plum)', fontWeight: 700 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>}
      {onClick && <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 11, color: 'var(--ink-mute)' }}>›</div>}
    </button>
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

type BuyerAgg = { key: string; name: string; spend: number; count: number; auction: number; claim: number };
type BidderAgg = { name: string; handle: string | null; bids: number; lots: number };

function DrillOverlay({ drill, buyers, bidders, onClose, onSelectBuyer }: {
  drill: Drill;
  buyers: BuyerAgg[];
  bidders: BidderAgg[];
  onClose: () => void;
  onSelectBuyer: (key: string, name: string) => void;
}) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(63, 27, 56, 0.55)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="panel-bordered"
        style={{ background: 'var(--cream)', maxWidth: 720, width: '100%', maxHeight: '82vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '2px solid var(--plum)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', flex: 1 }}>{drill.title}</div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕ Close</button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {drill.kind === 'sales' && <SalesTable events={drill.events} showProfit={drill.showProfit} />}
          {drill.kind === 'buyers' && <BuyersTable buyers={buyers} onSelectBuyer={onSelectBuyer} />}
          {drill.kind === 'bidders' && <BiddersTable bidders={bidders} />}
        </div>
      </div>
    </div>
  );
}

function SalesTable({ events, showProfit }: { events: SaleEvent[]; showProfit: boolean }) {
  if (events.length === 0) return <EmptyState text="No transactions in this view." />;
  const rows = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const totalRev = rows.reduce((s, e) => s + e.revenue, 0);
  const totalProfit = rows.reduce((s, e) => s + (e.revenue - e.cost), 0);
  const th: React.CSSProperties = { padding: '8px 14px', textAlign: 'left', position: 'sticky', top: 0 };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <tr>
          <th style={th}>Date</th>
          <th style={th}>Source</th>
          <th style={th}>Item</th>
          <th style={th}>Buyer</th>
          <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
          {showProfit && <th style={{ ...th, textAlign: 'right' }}>Profit</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((e, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--rule)', fontSize: 12.5, color: 'var(--plum)' }}>
            <td className="mono" style={{ padding: '7px 14px', whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</td>
            <td style={{ padding: '7px 14px' }}>{sourceLabel(e.source)}</td>
            <td style={{ padding: '7px 14px' }}>{e.itemLabel || <span style={{ color: 'var(--ink-mute)' }}>—</span>}</td>
            <td style={{ padding: '7px 14px' }}>{e.buyerName || <span style={{ color: 'var(--ink-mute)' }}>—</span>}</td>
            <td className="mono" style={{ padding: '7px 14px', textAlign: 'right', color: 'var(--orange)', fontWeight: 700 }}>{fmtMoneyLong(e.revenue)}</td>
            {showProfit && (
              <td className="mono" style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 700, color: (e.revenue - e.cost) >= 0 ? 'var(--teal)' : 'var(--rust)' }}>
                {e.cost > 0 ? fmtMoneyLong(e.revenue - e.cost) : <span title="No cost recorded — profit assumes $0 cost" style={{ color: 'var(--ink-mute)' }}>{fmtMoneyLong(e.revenue)}*</span>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ borderTop: '2px solid var(--plum)', background: 'var(--paper)' }}>
          <td colSpan={4} style={{ padding: '9px 14px', fontWeight: 700, fontSize: 12, color: 'var(--plum)' }}>{rows.length} transaction{rows.length === 1 ? '' : 's'}</td>
          <td className="mono" style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--orange)' }}>{fmtMoneyLong(totalRev)}</td>
          {showProfit && <td className="mono" style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--teal)' }}>{fmtMoneyLong(totalProfit)}</td>}
        </tr>
      </tfoot>
    </table>
  );
}

function BuyersTable({ buyers, onSelectBuyer }: { buyers: BuyerAgg[]; onSelectBuyer: (key: string, name: string) => void }) {
  if (buyers.length === 0) return <EmptyState text="No buyers in this range yet." />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <tr>
          <th style={{ padding: '8px 14px', textAlign: 'left' }}>Buyer</th>
          <th style={{ padding: '8px 14px', textAlign: 'right' }}>Sales</th>
          <th style={{ padding: '8px 14px', textAlign: 'right' }}>Auction</th>
          <th style={{ padding: '8px 14px', textAlign: 'right' }}>Claim</th>
          <th style={{ padding: '8px 14px', textAlign: 'right' }}>Spend</th>
        </tr>
      </thead>
      <tbody>
        {buyers.map((b, i) => (
          <tr key={i} onClick={() => onSelectBuyer(b.key, b.name)}
            style={{ borderTop: '1px solid var(--rule)', cursor: 'pointer' }} title={`See ${b.name}'s purchases`}>
            <td style={{ padding: '7px 14px', fontSize: 13, color: 'var(--teal)', fontWeight: 700, textDecoration: 'underline' }}>{b.name}</td>
            <td style={{ padding: '7px 14px', textAlign: 'right', fontSize: 12, color: 'var(--plum)' }}>{b.count}</td>
            <td style={{ padding: '7px 14px', textAlign: 'right', fontSize: 12, color: 'var(--ink-soft)' }}>{b.auction}</td>
            <td style={{ padding: '7px 14px', textAlign: 'right', fontSize: 12, color: 'var(--ink-soft)' }}>{b.claim}</td>
            <td className="mono" style={{ padding: '7px 14px', textAlign: 'right', fontSize: 13, color: 'var(--orange)', fontWeight: 700 }}>{fmtMoneyLong(b.spend)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BiddersTable({ bidders }: { bidders: BidderAgg[] }) {
  if (bidders.length === 0) return <EmptyState text="No recorded bids in this range yet." />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <tr>
          <th style={{ padding: '8px 14px', textAlign: 'left' }}>Bidder</th>
          <th style={{ padding: '8px 14px', textAlign: 'left' }}>FB handle</th>
          <th style={{ padding: '8px 14px', textAlign: 'right' }} title="Recorded bids placed">Bids</th>
          <th style={{ padding: '8px 14px', textAlign: 'right' }} title="Distinct lots bid on">Lots</th>
        </tr>
      </thead>
      <tbody>
        {bidders.map((b, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--rule)' }}>
            <td style={{ padding: '7px 14px', fontSize: 13, color: 'var(--plum)', fontWeight: 600 }}>{b.name}</td>
            <td className="mono" style={{ padding: '7px 14px', fontSize: 12, color: 'var(--teal)' }}>{b.handle ? `@${b.handle}` : <span style={{ color: 'var(--ink-mute)' }}>—</span>}</td>
            <td className="mono" style={{ padding: '7px 14px', textAlign: 'right', fontSize: 13, color: 'var(--plum)', fontWeight: 700 }}>{b.bids}</td>
            <td className="mono" style={{ padding: '7px 14px', textAlign: 'right', fontSize: 13, color: 'var(--ink-soft)' }}>{b.lots}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
