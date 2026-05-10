'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSellerStatus } from '@/lib/sellerGuard';
import { logBidEvent, fetchLotBidStats, fetchLotBidHistory, type LotBidStats, type BidHistoryEvent } from '@/lib/fbBidEvents';
import { syncAuctionListings } from '@/lib/listingStatusSync';
import SCLogo from '@/components/SCLogo';

type Status = 'draft' | 'live' | 'ended' | 'settled';

type LotRow = {
  id: string;
  lot_number: number;
  listing_id: string | null;
  current_bid: number | null;
  bidder_name: string | null;
  bidder_fb_handle: string | null;
  bidder_id: string | null;
  status: 'open' | 'sold' | 'no_sale' | 'paid';
  listing: {
    title: string | null;
    year: number | null;
    brand: string | null;
    card_number: string | null;
    player: string | null;
  } | null;
};

type BidderRow = {
  id: string;
  name: string;
  fb_handle: string | null;
};

type AuctionRow = {
  id: string;
  title: string;
  status: Status;
  post_url: string | null;
  ends_at: string | null;
  created_at: string;
  fb_auction_lots: LotRow[];
};

const STATUS_FILTERS = ['all', 'draft', 'live', 'ended', 'settled'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const DATE_RANGES = ['all', 'day', 'week', 'month'] as const;
type DateRange = typeof DATE_RANGES[number];

function dateRangeLabel(r: DateRange): string {
  if (r === 'day') return 'Past day';
  if (r === 'week') return 'Past week';
  if (r === 'month') return 'Past month';
  return 'All time';
}
function dateRangeMs(r: DateRange): number | null {
  if (r === 'day') return 24 * 60 * 60 * 1000;
  if (r === 'week') return 7 * 24 * 60 * 60 * 1000;
  if (r === 'month') return 30 * 24 * 60 * 60 * 1000;
  return null;
}

function statusLabel(s: string) {
  if (s === 'settled') return 'Sold';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusBg(s: string) {
  if (s === 'live') return 'var(--teal)';
  if (s === 'ended') return 'var(--mustard)';
  if (s === 'settled') return 'var(--plum)';
  return 'var(--ink-mute)';
}
function statusFg(s: string) {
  if (s === 'ended') return 'var(--plum)';
  return 'var(--cream)';
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function shortLotLabel(lot: LotRow): string {
  const l = lot.listing;
  if (!l) return `Lot #${lot.lot_number}`;
  const parts = [
    l.year ? String(l.year) : '',
    l.brand || '',
    l.card_number ? `#${l.card_number}` : '',
    l.player || '',
  ].filter(Boolean);
  const label = parts.join(' ').trim();
  return label || l.title || `Lot #${lot.lot_number}`;
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export default function FbAuctionsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [dateRange, setDateRange] = useState<DateRange>('all');

  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const [editBuffer, setEditBuffer] = useState<Record<string, Partial<LotRow>>>({});
  const [savingLots, setSavingLots] = useState<Set<string>>(new Set());
  const [savingPostUrls, setSavingPostUrls] = useState<Set<string>>(new Set());
  const [lotStats, setLotStats] = useState<Map<string, LotBidStats>>(new Map());
  const [userId, setUserId] = useState<string | null>(null);
  const [bidders, setBidders] = useState<BidderRow[]>([]);
  const [dupeWarnings, setDupeWarnings] = useState<Record<string, BidderRow[]>>({});
  const [historicalSales, setHistoricalSales] = useState<{ amount: number; occurred_at: string | null }[]>([]);
  const [historyLotId, setHistoryLotId] = useState<string | null>(null);
  const [historyEvents, setHistoryEvents] = useState<BidHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      { const _ss = await getSellerStatus(supabase, user.id); if (!_ss.canSell) { router.replace('/marketplace'); return; } if (!_ss.termsAccepted) { router.replace('/seller-terms'); return; } }
      setUserId(user.id);
      // Auctions: try the bidder-aware select first; fall back if `bidder_id` column doesn't exist yet.
      let aucData: AuctionRow[] = [];
      const { data: aucWithBidder, error: aucErr } = await supabase
        .from('fb_auctions')
        .select('id, title, status, post_url, ends_at, created_at, fb_auction_lots(id, lot_number, listing_id, current_bid, bidder_name, bidder_fb_handle, bidder_id, status, listing:listings(title, year, brand, card_number, player))')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (aucErr) {
        const fallback = await supabase
          .from('fb_auctions')
          .select('id, title, status, post_url, ends_at, created_at, fb_auction_lots(id, lot_number, listing_id, current_bid, bidder_name, bidder_fb_handle, status, listing:listings(title, year, brand, card_number, player))')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        aucData = (fallback.data || []).map((a: { fb_auction_lots?: unknown[] }) => ({
          ...a,
          fb_auction_lots: (a.fb_auction_lots || []).map((l: object) => ({ ...l, bidder_id: null })),
        })) as unknown as AuctionRow[];
        if (fallback.error) console.error('fb_auctions load error:', fallback.error);
      } else {
        aucData = (aucWithBidder || []) as unknown as AuctionRow[];
      }
      // If the listings join returned null on any lot (FK not defined → PostgREST can't auto-resolve),
      // fetch the listings separately and merge client-side so the lot labels render with card details.
      const missingListingIds = new Set<string>();
      let lotsWithNullId = 0;
      for (const a of aucData) {
        for (const l of (a.fb_auction_lots || [])) {
          if (!l.listing && l.listing_id) missingListingIds.add(l.listing_id);
          if (!l.listing && !l.listing_id) lotsWithNullId++;
        }
      }
      console.log('[fb-auctions] lot diagnostics:', {
        totalAuctions: aucData.length,
        lotsWithMissingJoin: missingListingIds.size,
        lotsWithNullListingId: lotsWithNullId,
      });
      if (missingListingIds.size > 0) {
        const { data: listingRows, error: listingErr } = await supabase
          .from('listings')
          .select('id, title, year, brand, card_number, player')
          .in('id', Array.from(missingListingIds));
        if (listingErr) console.error('[fb-auctions] listings backfill error:', listingErr);
        console.log('[fb-auctions] backfilled listings:', listingRows?.length ?? 0, 'of', missingListingIds.size);
        const byId = new Map((listingRows || []).map((r: { id: string }) => [r.id, r]));
        aucData = aucData.map(a => ({
          ...a,
          fb_auction_lots: (a.fb_auction_lots || []).map(l => l.listing
            ? l
            : { ...l, listing: l.listing_id ? (byId.get(l.listing_id) as LotRow['listing'] | undefined) || null : null }),
        }));
      }
      // Bidders: skip silently if the table doesn't exist yet.
      const { data: bidderData, error: bidderErr } = await supabase
        .from('fb_bidders')
        .select('id, name, fb_handle')
        .eq('user_id', user.id)
        .order('name');
      if (bidderErr) console.warn('fb_bidders not available (Phase A SQL not run?):', bidderErr.message);
      setAuctions(aucData);
      setBidders((bidderData || []) as BidderRow[]);
      const allLotIds = aucData.flatMap(a => a.fb_auction_lots.map(l => l.id));
      const stats = await fetchLotBidStats(supabase, allLotIds);
      setLotStats(stats);
      // Imported historical FB auction sales (won) — fold into Sales $.
      const { data: histRows } = await supabase
        .from('historical_transactions')
        .select('amount, occurred_at, channel, engagement_type')
        .eq('user_id', user.id)
        .eq('engagement_type', 'won')
        .eq('channel', 'fb_auction');
      const rows = ((histRows || []) as { amount: number | null; occurred_at: string | null }[])
        .filter(r => r.amount != null)
        .map(r => ({ amount: r.amount as number, occurred_at: r.occurred_at }));
      setHistoricalSales(rows);
      setLoading(false);
    }
    load();
  }, [router]);

  const biddersByLowerName = useMemo(() => {
    const map = new Map<string, BidderRow[]>();
    for (const b of bidders) {
      const k = b.name.toLowerCase();
      const arr = map.get(k) || [];
      arr.push(b);
      map.set(k, arr);
    }
    return map;
  }, [bidders]);

  async function ensureBidderForLot(lot: LotRow, name: string | null, handle: string | null): Promise<string | null> {
    if (!userId) return null;
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const supabase = createClient();
    const lname = trimmed.toLowerCase();
    const matches = biddersByLowerName.get(lname) || [];
    let bidder: BidderRow | null = null;
    if (handle && handle.trim()) {
      bidder = matches.find(b => (b.fb_handle || '').toLowerCase() === handle.trim().toLowerCase()) || null;
    } else if (matches.length === 1) {
      bidder = matches[0];
    } else if (matches.length > 1) {
      // dupe — surface a warning, fall back to first match for now
      setDupeWarnings(prev => ({ ...prev, [lot.id]: matches }));
      bidder = matches[0];
    }
    if (!bidder) {
      const { data, error } = await supabase
        .from('fb_bidders')
        .insert({ user_id: userId, name: trimmed, fb_handle: handle?.trim() || null })
        .select('id, name, fb_handle')
        .single();
      if (error || !data) return null;
      bidder = data as BidderRow;
      setBidders(prev => [...prev, bidder!].sort((a, b) => a.name.localeCompare(b.name)));
    }
    // upsert activity row for (lot, bidder)
    const auction = auctions.find(a => a.fb_auction_lots.some(l => l.id === lot.id));
    const isWinner = lot.status === 'sold' || lot.status === 'paid';
    const isPaid = lot.status === 'paid';
    await supabase.from('fb_bidder_activity').upsert({
      user_id: userId,
      bidder_id: bidder.id,
      auction_id: auction?.id,
      lot_id: lot.id,
      bid_amount: lot.current_bid,
      is_winner: isWinner,
      is_paid: isPaid,
      listing_year: lot.listing?.year ?? null,
      listing_brand: lot.listing?.brand ?? null,
      listing_player: lot.listing?.player ?? null,
      listing_card_number: lot.listing?.card_number ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lot_id,bidder_id' });
    return bidder.id;
  }

  const filtered = useMemo(() => {
    const cutoff = dateRangeMs(dateRange);
    const since = cutoff ? Date.now() - cutoff : null;
    return auctions.filter(a => {
      // 'all' includes every status — including 'settled' (fully-paid
      // auctions) — so the snapshot Sales $ on the ALL tab correctly
      // sums every paid lot, not just paid lots inside auctions that
      // still have open or unpaid lots.
      if (filter !== 'all' && a.status !== filter) {
        return false;
      }
      if (since !== null) {
        const t = a.created_at ? new Date(a.created_at).getTime() : 0;
        if (t < since) return false;
      }
      return true;
    });
  }, [auctions, filter, dateRange]);
  const counts: Record<string, number> = { draft: 0, live: 0, ended: 0, settled: 0 };
  auctions.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

  // Quick-glance metrics across whatever's currently filtered. Each $ figure
  // answers a different question for the seller:
  //   activeBids = $ in flight on still-open lots
  //   outstanding = $ owed by buyers whose lots ended without payment
  //   sales = $ that has actually been collected (paid lots)
  const metrics = useMemo(() => {
    let totalLots = 0;
    let activeBids = 0;
    let outstanding = 0;
    let sales = 0;
    const bidderKeys = new Set<string>();
    for (const a of filtered) {
      totalLots += a.fb_auction_lots.length;
      for (const l of a.fb_auction_lots) {
        const v = l.current_bid || 0;
        if (l.status === 'open') activeBids += v;
        if (l.status === 'sold') outstanding += v;
        if (l.status === 'paid') sales += v;
        if (l.bidder_id) bidderKeys.add(`id:${l.bidder_id}`);
        else if (l.bidder_name && l.bidder_name.trim()) bidderKeys.add(`name:${l.bidder_name.trim().toLowerCase()}`);
      }
    }
    // Fold imported historical FB auction sales into Sales $ within the same date window.
    const cutoff = dateRangeMs(dateRange);
    const since = cutoff ? Date.now() - cutoff : null;
    for (const h of historicalSales) {
      if (since !== null) {
        const t = h.occurred_at ? new Date(`${h.occurred_at}T00:00:00Z`).getTime() : 0;
        if (t < since) continue;
      }
      sales += h.amount;
    }
    return { totalLots, activeBids, outstanding, sales, uniqueBidders: bidderKeys.size };
  }, [filtered, historicalSales, dateRange]);

  function toggleDraftSelect(id: string) {
    setSelectedDrafts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkActivateDrafts() {
    if (selectedDrafts.size === 0) return;
    if (!confirm(`Mark ${selectedDrafts.size} auction${selectedDrafts.size === 1 ? '' : 's'} as Live?`)) return;
    setBulkWorking(true);
    const supabase = createClient();
    const ids = Array.from(selectedDrafts);
    const { error } = await supabase.from('fb_auctions').update({ status: 'live' }).in('id', ids);
    setBulkWorking(false);
    if (error) { alert(error.message); return; }
    setAuctions(prev => prev.map(a => ids.includes(a.id) ? { ...a, status: 'live' } : a));
    if (userId) {
      for (const id of ids) {
        const a = auctions.find(x => x.id === id);
        if (a) await syncAuctionListings(supabase, userId, 'live', a.fb_auction_lots);
      }
    }
    setSelectedDrafts(new Set());
  }
  async function deleteAuction(a: AuctionRow) {
    const lotCount = a.fb_auction_lots?.length || 0;
    const warning = [
      `⚠ DELETE AUCTION "${a.title}"`,
      ``,
      `This will permanently remove:`,
      `  · the auction itself`,
      `  · all ${lotCount} lot${lotCount === 1 ? '' : 's'} (bids, winners, settlement state)`,
      `  · this auction's contribution to every bidder's history (Bids / Won / Spent counts on the Bidders page will drop)`,
      ``,
      `Bidder profiles in your Bidders list are kept — only the activity tied to this auction is wiped.`,
      ``,
      `This cannot be undone. Continue?`,
    ].join('\n');
    if (!confirm(warning)) return;
    const supabase = createClient();
    // Delete in dependency order: bidder activity → lots → auction
    await supabase.from('fb_bidder_activity').delete().eq('auction_id', a.id);
    await supabase.from('fb_auction_lots').delete().eq('auction_id', a.id);
    const { error } = await supabase.from('fb_auctions').delete().eq('id', a.id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    setAuctions(prev => prev.filter(x => x.id !== a.id));
  }
  function getLotValue<K extends keyof LotRow>(lot: LotRow, key: K): LotRow[K] {
    const buf = editBuffer[lot.id];
    if (buf && key in buf) return (buf as LotRow)[key];
    return lot[key];
  }
  function patchLot(id: string, patch: Partial<LotRow>) {
    setEditBuffer(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  }
  async function flushLot(lotId: string) {
    const buf = editBuffer[lotId];
    if (!buf) return;
    setSavingLots(prev => new Set(prev).add(lotId));
    const supabase = createClient();
    // find the lot for context
    let lotRef: LotRow | undefined;
    for (const a of auctions) {
      const l = a.fb_auction_lots.find(x => x.id === lotId);
      if (l) { lotRef = l; break; }
    }
    const merged: LotRow | undefined = lotRef ? { ...lotRef, ...buf } as LotRow : undefined;
    const payload: Record<string, unknown> = {};
    if ('current_bid' in buf) payload.current_bid = buf.current_bid;
    if ('bidder_name' in buf) payload.bidder_name = buf.bidder_name?.toString().trim() || null;
    if ('bidder_fb_handle' in buf) payload.bidder_fb_handle = buf.bidder_fb_handle?.toString().trim() || null;

    let bidderId: string | null = lotRef?.bidder_id ?? null;
    if (merged && (merged.bidder_name || '').toString().trim()) {
      bidderId = await ensureBidderForLot(merged, merged.bidder_name, merged.bidder_fb_handle);
      if (bidderId) payload.bidder_id = bidderId;
    } else if ('bidder_name' in buf && (!buf.bidder_name || !buf.bidder_name.toString().trim())) {
      payload.bidder_id = null;
      bidderId = null;
    }

    const previousBidderId = lotRef?.bidder_id ?? null;
    const previousBid = lotRef?.current_bid ?? null;
    const auctionForLot = auctions.find(a => a.fb_auction_lots.some(l => l.id === lotId));
    const { error } = await supabase.from('fb_auction_lots').update(payload).eq('id', lotId);
    if (error) alert(error.message);
    else {
      setAuctions(prev => prev.map(a => ({
        ...a,
        fb_auction_lots: a.fb_auction_lots.map(l => l.id === lotId ? { ...l, ...buf, bidder_id: bidderId } : l),
      })));
      setEditBuffer(prev => { const next = { ...prev }; delete next[lotId]; return next; });
      const newBid = 'current_bid' in buf ? (buf.current_bid ?? null) : (lotRef?.current_bid ?? null);
      const newName = 'bidder_name' in buf ? (buf.bidder_name?.toString().trim() || null) : (lotRef?.bidder_name ?? null);
      const newHandle = 'bidder_fb_handle' in buf ? (buf.bidder_fb_handle?.toString().trim() || null) : (lotRef?.bidder_fb_handle ?? null);
      const bidChanged = ('current_bid' in buf) && newBid !== previousBid;
      const bidderChanged = bidderId !== previousBidderId;
      if ((bidChanged || bidderChanged) && (newBid != null || newName) && userId && auctionForLot) {
        const evtErr = await logBidEvent(supabase, {
          userId, auctionId: auctionForLot.id, lotId,
          amount: newBid, bidderId, bidderName: newName, bidderFbHandle: newHandle,
        });
        if (evtErr) {
          alert(`Bid event log failed: ${evtErr}\nThe lot was saved but the bid history did NOT record this change.`);
        } else {
          const fresh = await fetchLotBidStats(supabase, [lotId]);
          const stat = fresh.get(lotId);
          if (stat) setLotStats(prev => { const next = new Map(prev); next.set(lotId, stat); return next; });
        }
      }
    }
    setSavingLots(prev => { const next = new Set(prev); next.delete(lotId); return next; });
  }

  async function openBidHistory(lotId: string) {
    setHistoryLotId(lotId);
    setHistoryEvents([]);
    setHistoryLoading(true);
    const supabase = createClient();
    const events = await fetchLotBidHistory(supabase, lotId);
    setHistoryEvents(events);
    setHistoryLoading(false);
  }

  async function savePostUrl(auctionId: string, url: string) {
    const supabase = createClient();
    const trimmed = url.trim() || null;
    setSavingPostUrls(prev => new Set(prev).add(auctionId));
    const { error } = await supabase.from('fb_auctions').update({ post_url: trimmed }).eq('id', auctionId);
    setSavingPostUrls(prev => { const next = new Set(prev); next.delete(auctionId); return next; });
    if (error) { alert(error.message); return; }
    setAuctions(prev => prev.map(a => a.id === auctionId ? { ...a, post_url: trimmed } : a));
  }

  // Mirror the detail-page derivation: once an auction is past draft, its
  // top-level status follows the lot states.
  function deriveAuctionStatus(currentStatus: Status, ls: LotRow[]): Status {
    if (currentStatus === 'draft') return currentStatus;
    if (ls.length === 0) return currentStatus;
    if (ls.some(l => l.status === 'open')) return 'live';
    if (ls.some(l => l.status === 'sold')) return 'ended';
    return 'settled';
  }
  async function setLotStatus(auctionId: string, lotId: string, next: LotRow['status']) {
    const supabase = createClient();
    const target = auctions.find(a => a.id === auctionId);
    if (!target) return;
    const { error } = await supabase.from('fb_auction_lots').update({ status: next }).eq('id', lotId);
    if (error) { alert('Could not update lot status: ' + error.message); return; }
    const nextLots = target.fb_auction_lots.map(l => l.id === lotId ? { ...l, status: next } : l);
    const desiredAuctionStatus = deriveAuctionStatus(target.status, nextLots);
    setAuctions(prev => prev.map(a => a.id === auctionId
      ? { ...a, fb_auction_lots: nextLots, status: desiredAuctionStatus }
      : a));
    if (desiredAuctionStatus !== target.status) {
      const { error: aErr } = await supabase.from('fb_auctions').update({ status: desiredAuctionStatus }).eq('id', auctionId);
      if (aErr) console.warn('auction status auto-advance failed:', aErr.message);
    }
    if (userId) await syncAuctionListings(supabase, userId, desiredAuctionStatus, nextLots);
  }

  function buildBidUpdate(auction: AuctionRow): string {
    const lines = auction.fb_auction_lots
      .sort((a, b) => a.lot_number - b.lot_number)
      .map(lot => {
        const label = shortLotLabel(lot);
        const bid = getLotValue(lot, 'current_bid');
        const bidder = getLotValue(lot, 'bidder_name');
        if (bid !== null && bid !== undefined) {
          return `#${lot.lot_number} ${label} — ${fmtMoney(bid)}${bidder ? ` (${bidder})` : ''}`;
        }
        return `#${lot.lot_number} ${label} — no bids yet`;
      });
    return [
      `🔥 ${auction.title} — Bid Update 🔥`,
      '',
      ...lines,
      '',
      `Updated ${new Date().toLocaleString()}`,
    ].join('\n');
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
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ FB Auctions ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions/new" className="btn btn-primary btn-sm">+ New Auction</Link>
            <Link href="/fb-claim-sales" className="btn btn-ghost btn-sm">Claim Sales</Link>
            <Link href="/fb-auctions/templates" className="btn btn-ghost btn-sm">Templates</Link>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">Bidders</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/sales-metrics" className="btn btn-ghost btn-sm">📊 Metrics</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <datalist id="fb-bidders-list">
        {bidders.map(b => (
          <option key={b.id} value={b.name}>{b.fb_handle ? `@${b.fb_handle}` : ''}</option>
        ))}
      </datalist>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Click <strong>+ New Auction</strong>, pick listings + template + group, click <strong>Generate</strong>.</li>
            <li>Paste the post and lot comments into Facebook with the side-by-side images.</li>
            <li>Drop the post URL into the auction, then mark it <strong>Live</strong>. Track current high bids inline below — no need to open each auction.</li>
            <li>Use <strong>📋 Copy bid update</strong> to paste a fresh leaderboard back into your FB post body when bids change.</li>
            <li>When the auction ends, click <strong>Manage →</strong> to settle: get Messenger-ready combined invoices per buyer.</li>
          </ol>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700 }}>★ Snapshot ★</span>
          <select value={dateRange} onChange={e => setDateRange(e.target.value as DateRange)}
            style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700, border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', color: 'var(--plum)', fontFamily: 'var(--font-body)', cursor: 'pointer' }}>
            {DATE_RANGES.map(r => <option key={r} value={r}>{dateRangeLabel(r)}</option>)}
          </select>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18,
        }}>
          <MetricCard label={`${filter === 'all' ? 'All' : statusLabel(filter)} · Auctions`} value={String(filtered.length)} />
          <MetricCard label="Lots" value={String(metrics.totalLots)} />
          {(filter === 'all' || filter === 'live') && (
            <MetricCard label="Active bids $" value={fmtMoney(metrics.activeBids)} />
          )}
          {(filter === 'all' || filter === 'ended') && (
            <MetricCard label="Ended, unpaid $" value={fmtMoney(metrics.outstanding)} accent={filter === 'ended'} />
          )}
          {(filter === 'all' || filter === 'live' || filter === 'settled') && (
            <MetricCard label="Sales $" value={fmtMoney(metrics.sales)} accent={filter !== 'ended'} />
          )}
          <MetricCard label="Unique bidders" value={String(metrics.uniqueBidders)} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => { setFilter(f); setSelectedDrafts(new Set()); }}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}>
              {f === 'all' ? 'All' : statusLabel(f)}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>
                ({f === 'all' ? (auctions.length - (counts.settled || 0)) : (counts[f] || 0)})
              </span>
            </button>
          ))}
        </div>

        {selectedDrafts.size > 0 && (
          <div style={{
            position: 'sticky', top: 64, zIndex: 40,
            background: 'var(--plum)', color: 'var(--mustard)',
            padding: '10px 18px', marginBottom: 14,
            borderRadius: 12, border: '2px solid var(--plum)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span className="eyebrow" style={{ color: 'var(--mustard)', fontSize: 11 }}>
              {selectedDrafts.size} draft{selectedDrafts.size === 1 ? '' : 's'} selected
            </span>
            <button onClick={bulkActivateDrafts} disabled={bulkWorking}
              className="btn btn-sm" style={{ background: 'var(--teal)', color: 'var(--cream)', border: '1.5px solid var(--teal)' }}>
              {bulkWorking ? 'Working…' : `Mark ${selectedDrafts.size} Live`}
            </button>
            <button onClick={() => setSelectedDrafts(new Set())}
              className="btn btn-sm" style={{ background: 'transparent', color: 'var(--mustard)', border: '1.5px solid var(--mustard)', marginLeft: 'auto' }}>
              Clear
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>
              {auctions.length === 0 ? 'No auctions yet' : `No ${filter} auctions`}
            </div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 13, marginBottom: 14 }}>
              {auctions.length === 0
                ? 'Click + New Auction to create your first one.'
                : 'Try a different status filter.'}
            </p>
            {auctions.length === 0 && (
              <Link href="/fb-auctions/new" className="btn btn-primary">+ New Auction</Link>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(a => {
              const isDraft = a.status === 'draft';
              const isLive = a.status === 'live';
              const expanded = isLive;
              const isSelected = selectedDrafts.has(a.id);
              const endedUnpaid = a.fb_auction_lots.filter(l => l.status === 'sold').length;
              const soldPaid = a.fb_auction_lots.filter(l => l.status === 'paid').length;
              return (
                <div key={a.id} className="panel-bordered" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    {isDraft && (
                      <input type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleDraftSelect(a.id)}
                        style={{ accentColor: 'var(--plum)', cursor: 'pointer', width: 16, height: 16 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                        <div className="display" style={{ fontSize: 17, color: 'var(--plum)' }}>{a.title}</div>
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                          background: statusBg(a.status), color: statusFg(a.status), textTransform: 'uppercase',
                        }}>{statusLabel(a.status)}</span>
                        {endedUnpaid > 0 && (
                          <Link href={`/fb-auctions/${a.id}#settlement`} style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 100,
                            background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--plum)',
                            textDecoration: 'none', textTransform: 'uppercase', whiteSpace: 'nowrap',
                          }}>★ {endedUnpaid} ended → settle</Link>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
                        {a.fb_auction_lots.length} lot{a.fb_auction_lots.length === 1 ? '' : 's'}
                        {endedUnpaid > 0 && <> · <span style={{ color: 'var(--rust)' }}>{endedUnpaid} ended unpaid</span></>}
                        {soldPaid > 0 && <> · <span style={{ color: 'var(--teal)' }}>{soldPaid} sold</span></>}
                        {' · '}created {new Date(a.created_at).toLocaleDateString()}
                        {a.ends_at && ` · ends ${new Date(a.ends_at).toLocaleString()}`}
                      </div>
                    </div>
                    <Link href={`/fb-auctions/${a.id}`} className="btn btn-ghost btn-sm">Manage →</Link>
                    <button onClick={() => deleteAuction(a)} className="btn btn-ghost btn-sm" style={{ color: 'var(--rust)', border: '1.5px solid var(--rust)' }}>🗑 Delete</button>
                  </div>

                  {/* Post URL — clickable when set, editable when blank */}
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', whiteSpace: 'nowrap' }}>FB POST</span>
                    {a.post_url ? (
                      <>
                        <a href={a.post_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11.5, color: 'var(--teal)', fontWeight: 700, textDecoration: 'underline', wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
                          🔗 {a.post_url}
                        </a>
                        <button onClick={() => savePostUrl(a.id, '')} className="btn btn-ghost btn-sm" title="Clear URL">✕</button>
                      </>
                    ) : (
                      <PostUrlInput auctionId={a.id} onSave={savePostUrl} saving={savingPostUrls.has(a.id)} />
                    )}
                  </div>

                  {expanded && a.fb_auction_lots.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--rule)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                        <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Lots in this post</div>
                        <CopyButton text={buildBidUpdate(a)} label="📋 Copy bid update" />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {a.fb_auction_lots.sort((x, y) => x.lot_number - y.lot_number).map(lot => {
                          const cur = getLotValue(lot, 'current_bid');
                          const bidder = getLotValue(lot, 'bidder_name');
                          const isSaving = savingLots.has(lot.id);
                          const buf = editBuffer[lot.id];
                          const dirty = !!buf && Object.keys(buf).length > 0;
                          const statusBgCol = lot.status === 'paid' ? 'var(--teal)'
                            : lot.status === 'sold' ? 'var(--orange)'
                            : lot.status === 'no_sale' ? 'var(--rust)'
                            : 'var(--cream)';
                          const statusFgCol = lot.status === 'open' ? 'var(--plum)' : 'var(--cream)';
                          return (
                            <div key={lot.id} style={{
                              display: 'grid', gridTemplateColumns: '60px 1fr 110px 1fr 110px 70px',
                              gap: 8, alignItems: 'center', padding: '6px 8px',
                              background: 'var(--paper)', borderRadius: 6,
                              border: lot.status === 'open' ? '1px solid var(--rule)'
                                : `1.5px solid ${statusBgCol}`,
                            }}>
                              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--plum)' }}>#{lot.lot_number}</div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {shortLotLabel(lot)}
                                </div>
                                {(() => {
                                  const s = lotStats.get(lot.id);
                                  if (!s || s.bid_count === 0) return null;
                                  return (
                                    <button type="button" onClick={() => openBidHistory(lot.id)}
                                      className="mono" style={{
                                        background: 'transparent', border: 0, padding: 0, marginTop: 2,
                                        fontSize: 10, color: 'var(--teal)', fontWeight: 700, cursor: 'pointer',
                                        textDecoration: 'underline', fontFamily: 'inherit',
                                      }}>
                                      🔨 {s.bid_count} bid{s.bid_count === 1 ? '' : 's'} · {s.unique_bidders} bidder{s.unique_bidders === 1 ? '' : 's'}
                                    </button>
                                  );
                                })()}
                              </div>
                              <input type="text" inputMode="decimal"
                                defaultValue={cur !== null && cur !== undefined ? String(cur) : ''}
                                onChange={e => patchLot(lot.id, { current_bid: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) })}
                                onBlur={() => flushLot(lot.id)}
                                placeholder="High bid $"
                                style={{ width: '100%', padding: '4px 8px', fontSize: 12, border: '1.5px solid var(--plum)', borderRadius: 4, background: 'var(--cream)', color: 'var(--plum)', fontFamily: 'var(--font-body)' }} />
                              <div style={{ position: 'relative' }}>
                                <input type="text"
                                  list="fb-bidders-list"
                                  defaultValue={bidder || ''}
                                  onChange={e => patchLot(lot.id, { bidder_name: e.target.value })}
                                  onBlur={() => flushLot(lot.id)}
                                  placeholder="High bidder"
                                  style={{ width: '100%', padding: '4px 8px', fontSize: 12, border: '1.5px solid var(--plum)', borderRadius: 4, background: 'var(--cream)', color: 'var(--plum)', fontFamily: 'var(--font-body)' }} />
                                {dupeWarnings[lot.id] && dupeWarnings[lot.id].length > 1 && (
                                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--plum)', borderRadius: 4, padding: '4px 6px', fontSize: 10, zIndex: 10 }}>
                                    ⚠ {dupeWarnings[lot.id].length} bidders named &ldquo;{bidder}&rdquo;. Add an FB handle to disambiguate.
                                    <button onClick={() => setDupeWarnings(prev => { const n = { ...prev }; delete n[lot.id]; return n; })}
                                      style={{ marginLeft: 6, background: 'transparent', border: 0, color: 'var(--plum)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                                  </div>
                                )}
                              </div>
                              <select
                                value={lot.status}
                                onChange={e => setLotStatus(a.id, lot.id, e.target.value as LotRow['status'])}
                                title="Lot status"
                                style={{
                                  width: '100%', padding: '4px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                                  border: `1.5px solid ${statusBgCol === 'var(--cream)' ? 'var(--plum)' : statusBgCol}`,
                                  borderRadius: 4,
                                  background: statusBgCol, color: statusFgCol,
                                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                                }}>
                                <option value="open">LIVE</option>
                                <option value="sold">ENDED</option>
                                <option value="paid">SOLD</option>
                                <option value="no_sale">NO SALE</option>
                              </select>
                              <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-mute)', textAlign: 'right' }}>
                                {isSaving ? 'Saving…' : dirty ? 'Unsaved' : ''}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {historyLotId && (
        <div onClick={() => setHistoryLotId(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(63, 27, 56, 0.55)', zIndex: 100,
            display: 'grid', placeItems: 'center', padding: 20,
          }}>
          <div onClick={e => e.stopPropagation()} className="panel-bordered"
            style={{ background: 'var(--cream)', maxWidth: 540, width: '100%', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', borderBottom: '2px solid var(--plum)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', flex: 1 }}>Bid history</div>
              <button onClick={() => setHistoryLotId(null)} className="btn btn-ghost btn-sm">✕ Close</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 0' }}>
              {historyLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>Loading…</div>
              ) : historyEvents.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>No bid events recorded for this lot.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      <th style={{ padding: '6px 14px', textAlign: 'left' }}>#</th>
                      <th style={{ padding: '6px 14px', textAlign: 'left' }}>When</th>
                      <th style={{ padding: '6px 14px', textAlign: 'left' }}>Bidder</th>
                      <th style={{ padding: '6px 14px', textAlign: 'right' }}>Bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyEvents.map((e, i) => (
                      <tr key={e.id} style={{ borderTop: '1px solid var(--rule)', fontSize: 12.5, color: 'var(--plum)' }}>
                        <td className="mono" style={{ padding: '6px 14px', color: 'var(--ink-mute)' }}>{i + 1}</td>
                        <td className="mono" style={{ padding: '6px 14px' }}>
                          {new Date(e.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '6px 14px' }}>
                          <div style={{ fontWeight: 600 }}>{e.bidder_name || <span style={{ color: 'var(--ink-mute)' }}>—</span>}</div>
                          {e.bidder_fb_handle && <div className="mono" style={{ fontSize: 10, color: 'var(--teal)' }}>@{e.bidder_fb_handle}</div>}
                        </td>
                        <td className="mono" style={{ padding: '6px 14px', textAlign: 'right', color: 'var(--orange)', fontWeight: 700 }}>
                          {e.amount != null ? fmtMoney(e.amount) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PostUrlInput({ auctionId, onSave, saving }: { auctionId: string; onSave: (id: string, url: string) => void; saving: boolean }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
      <input type="text" value={val} onChange={e => setVal(e.target.value)}
        onBlur={() => { if (val.trim()) onSave(auctionId, val); }}
        placeholder="Paste FB post URL — saves on blur"
        style={{ flex: 1, padding: '4px 8px', fontSize: 11.5, border: '1.5px solid var(--plum)', borderRadius: 4, background: 'var(--cream)', color: 'var(--plum)', fontFamily: 'var(--font-body)' }} />
      {saving && <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>saving…</span>}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => {
      const ok = await copyText(text);
      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
      else alert('Copy failed — please select and copy manually.');
    }} className="btn btn-primary btn-sm">
      {copied ? '✓ Copied' : label}
    </button>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel-bordered" style={{ padding: "12px 16px" }}>
      <div className="eyebrow" style={{ fontSize: 10, color: "var(--orange)", marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, color: accent ? "var(--orange)" : "var(--plum)", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
