'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { applyOwnedTransition } from '@/lib/inventory';
import { substitute, listingVars } from '@/lib/fbAuctionText';
import SCLogo from '@/components/SCLogo';

type Status = 'draft' | 'live' | 'ended' | 'settled';

type Listing = {
  id: string;
  title: string;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  photos: string[];
  condition_type: 'raw' | 'graded';
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  source_set_slug: string | null;
  source_card_number: string | null;
};

type Lot = {
  id: string;
  lot_number: number;
  listing_id: string | null;
  starting_bid: number | null;
  current_bid: number | null;
  bidder_name: string | null;
  bidder_fb_handle: string | null;
  bidder_id: string | null;
  comment_url: string | null;
  status: 'open' | 'sold' | 'no_sale' | 'paid';
  notes: string | null;
  listing: Listing | null;
};

type BidderRow = { id: string; name: string; fb_handle: string | null; member_user_id: string | null };
type MemberOption = { user_id: string; display_name: string | null; handle: string | null; fb_handle: string | null };

type Auction = {
  id: string;
  title: string;
  status: Status;
  post_url: string | null;
  ends_at: string | null;
  created_at: string;
  notes: string | null;
  group_id: string | null;
  template_id: string | null;
  fb_groups?: { name: string; url: string | null } | null;
  fb_auction_templates?: {
    name: string;
    template_type?: 'single' | 'multi' | 'winning' | null;
    post_header?: string | null;
    post_footer?: string | null;
    lot_template?: string | null;
  } | null;
};

function statusBg(s: Status) {
  if (s === 'live') return 'var(--teal)';
  if (s === 'ended') return 'var(--mustard)';
  if (s === 'settled') return 'var(--plum)';
  return 'var(--ink-mute)';
}
function statusFg(s: Status) {
  if (s === 'ended') return 'var(--plum)';
  return 'var(--cream)';
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function conditionNote(l: Listing | null): string {
  if (!l) return '';
  if (l.condition_type === 'graded' && l.grading_company && l.grade) return `${l.grading_company} ${l.grade}`;
  if (l.condition_type === 'raw' && l.raw_grade) return l.raw_grade;
  return '';
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export default function ManageFbAuctionPage() {
  const router = useRouter();
  const params = useParams();
  const auctionId = String(params?.id || '');

  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [winningTpl, setWinningTpl] = useState<{ post_header: string; post_footer: string } | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);

  const [editBuffer, setEditBuffer] = useState<Record<string, Partial<Lot>>>({});
  const [savingLots, setSavingLots] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  async function copyAndFlash(key: string, text: string) {
    if (await copyText(text)) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(prev => prev === key ? null : prev), 1600);
    }
  }
  const [postExpanded, setPostExpanded] = useState(true);

  const [bidders, setBidders] = useState<BidderRow[]>([]);
  const [dupeWarnings, setDupeWarnings] = useState<Record<string, BidderRow[]>>({});
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [memberPickerBidderId, setMemberPickerBidderId] = useState<string | null>(null);

  const [paymentText, setPaymentText] = useState<string>('PayPal F&F to: your-paypal@email.com\nVenmo: @your-venmo');
  const [shippingByBuyer, setShippingByBuyer] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);

      const [aucRes, lotsRes, biddersRes] = await Promise.all([
        supabase.from('fb_auctions')
          .select('*, fb_groups(name, url), fb_auction_templates(name, template_type, post_header, post_footer, lot_template)')
          .eq('id', auctionId).eq('user_id', user.id).maybeSingle(),
        supabase.from('fb_auction_lots')
          .select('*, listing:listings(id, title, year, brand, card_number, player, photos, condition_type, raw_grade, grading_company, grade, source_set_slug, source_card_number)')
          .eq('auction_id', auctionId).order('lot_number'),
        supabase.from('fb_bidders').select('id, name, fb_handle, member_user_id').eq('user_id', user.id).order('name'),
      ]);

      if (!aucRes.data) { router.push('/fb-auctions'); return; }
      setAuction(aucRes.data as Auction);
      let lotsRaw = (lotsRes.data || []) as Lot[];
      lotsRaw = lotsRaw.map(l => ({ ...l, bidder_id: l.bidder_id ?? null }));
      const missing = lotsRaw.filter(l => !l.listing && l.listing_id).map(l => l.listing_id as string);
      if (missing.length > 0) {
        const { data: listingRows } = await supabase
          .from('listings')
          .select('id, title, year, brand, card_number, player, photos, condition_type, raw_grade, grading_company, grade, source_set_slug, source_card_number')
          .in('id', missing);
        const byId = new Map((listingRows || []).map((r: { id: string }) => [r.id, r]));
        lotsRaw = lotsRaw.map(l => l.listing
          ? l
          : { ...l, listing: l.listing_id ? (byId.get(l.listing_id) as Lot['listing'] | undefined) || null : null });
      }
      setLots(lotsRaw);
      if (biddersRes.error) console.warn('fb_bidders not available:', biddersRes.error.message);
      setBidders((biddersRes.data || []) as BidderRow[]);

      const { data: memberData } = await supabase
        .from('user_profiles')
        .select('user_id, display_name, handle, fb_handle')
        .eq('application_status', 'approved');
      setMembers(((memberData || []) as MemberOption[]).filter(m => m.user_id !== user.id));

      // Pull the user's default winning-bid template (if they've made one).
      const { data: winRows } = await supabase
        .from('fb_auction_templates')
        .select('post_header, post_footer, is_default')
        .eq('user_id', user.id)
        .eq('template_type', 'winning')
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      if (winRows && winRows[0]) {
        setWinningTpl({ post_header: winRows[0].post_header || '', post_footer: winRows[0].post_footer || '' });
      }
      setLoading(false);
    }
    load();
  }, [auctionId, router]);

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

  async function ensureBidderForLot(lot: Lot, name: string | null, handle: string | null): Promise<string | null> {
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
    const isWinner = lot.status === 'sold' || lot.status === 'paid';
    const isPaid = lot.status === 'paid';
    await supabase.from('fb_bidder_activity').upsert({
      user_id: userId,
      bidder_id: bidder.id,
      auction_id: auctionId,
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

  async function linkBidderToMember(bidderId: string, memberUserId: string | null) {
    if (!userId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from('fb_bidders')
      .update({ member_user_id: memberUserId })
      .eq('id', bidderId)
      .eq('user_id', userId);
    if (error) { alert('Could not save member link: ' + error.message); return; }
    setBidders(prev => prev.map(b => b.id === bidderId ? { ...b, member_user_id: memberUserId } : b));
  }

  function getLotValue<K extends keyof Lot>(lot: Lot, key: K): Lot[K] {
    const buf = editBuffer[lot.id];
    if (buf && key in buf) return (buf as Lot)[key];
    return lot[key];
  }

  function patchLot(id: string, patch: Partial<Lot>) {
    setEditBuffer(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  }

  async function flushLot(id: string) {
    const buf = editBuffer[id];
    if (!buf) return;
    setSavingLots(prev => new Set(prev).add(id));
    const supabase = createClient();
    const lotRef = lots.find(l => l.id === id);
    const merged: Lot | undefined = lotRef ? ({ ...lotRef, ...buf } as Lot) : undefined;
    const payload: Record<string, unknown> = {};
    if ('current_bid' in buf) payload.current_bid = buf.current_bid;
    if ('bidder_name' in buf) payload.bidder_name = buf.bidder_name?.toString().trim() || null;
    if ('bidder_fb_handle' in buf) payload.bidder_fb_handle = buf.bidder_fb_handle?.toString().trim() || null;
    if ('comment_url' in buf) payload.comment_url = buf.comment_url?.toString().trim() || null;
    if ('status' in buf) payload.status = buf.status;
    if ('notes' in buf) payload.notes = buf.notes?.toString().trim() || null;

    let bidderId: string | null = lotRef?.bidder_id ?? null;
    if (merged && (merged.bidder_name || '').toString().trim()) {
      bidderId = await ensureBidderForLot(merged, merged.bidder_name, merged.bidder_fb_handle);
      if (bidderId) payload.bidder_id = bidderId;
    } else if ('bidder_name' in buf && (!buf.bidder_name || !buf.bidder_name.toString().trim())) {
      payload.bidder_id = null;
      bidderId = null;
    }

    const previousBidderId = lotRef?.bidder_id ?? null;
    const { error } = await supabase.from('fb_auction_lots').update(payload).eq('id', id);
    if (error) { alert(error.message); }
    else {
      setLots(prev => prev.map(l => l.id === id ? { ...l, ...buf, bidder_id: bidderId } : l));
      setEditBuffer(prev => { const next = { ...prev }; delete next[id]; return next; });
      if (previousBidderId && previousBidderId !== bidderId) {
        // Fire-and-forget — server will skip if previous bidder isn't linked to a member.
        fetch('/api/auctions/notify-outbid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lot_id: id, previous_bidder_id: previousBidderId, new_bidder_id: bidderId }),
        }).catch(() => {});
      }
    }
    setSavingLots(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  // Mark each lot's source set row Owned=Yes/No. Uses the requesting user's
  // own auth (they are the seller) and updates their own sets directly.
  async function markLotsInventory(targetLots: Lot[], owned: boolean) {
    if (!userId) return;
    const supabase = createClient();
    // Group source rows by set slug so we update each set once.
    const bySet = new Map<string, Set<string>>();
    for (const l of targetLots) {
      const slug = l.listing?.source_set_slug;
      const card = l.listing?.source_card_number;
      if (!slug || !card) continue;
      const set = bySet.get(slug) || new Set<string>();
      set.add(card);
      bySet.set(slug, set);
    }
    for (const [slug, cards] of bySet.entries()) {
      const { data: setRow } = await supabase
        .from('sets')
        .select('rows')
        .eq('user_id', userId)
        .eq('slug', slug)
        .maybeSingle();
      if (!setRow) continue;
      const rows = Array.isArray(setRow.rows) ? setRow.rows as Record<string, unknown>[] : [];
      const { nextRows, touched, ownedCount } = applyOwnedTransition(rows, cards, owned);
      if (!touched) continue;
      const ownedPct = nextRows.length > 0 ? (ownedCount / nextRows.length) * 100 : 0;
      await supabase
        .from('sets')
        .update({ rows: nextRows, owned_count: ownedCount, owned_pct: ownedPct, updated_at: Date.now() })
        .eq('user_id', userId)
        .eq('slug', slug);
    }
  }

  async function setStatus(s: Status) {
    if (!auction) return;
    const prev = auction.status;
    const supabase = createClient();
    const { error } = await supabase.from('fb_auctions').update({ status: s }).eq('id', auction.id);
    if (error) { alert(error.message); return; }
    setAuction(a => a ? { ...a, status: s } : a);

    // Inventory side-effects: when the auction goes live, every lot's source
    // row is removed from the seller's inventory. If the seller reverts to
    // draft (or back from settled), open lots are restored.
    if (prev !== 'live' && s === 'live') {
      await markLotsInventory(lots.filter(l => l.status === 'open'), false);
    } else if (prev === 'live' && s !== 'live') {
      // Restore the lots that ended unsold; sold/paid lots stay removed.
      await markLotsInventory(lots.filter(l => l.status === 'open' || l.status === 'no_sale'), true);
    }
  }

  async function setPostUrl(url: string) {
    if (!auction) return;
    const supabase = createClient();
    const trimmed = url.trim() || null;
    await supabase.from('fb_auctions').update({ post_url: trimmed }).eq('id', auction.id);
    setAuction(a => a ? { ...a, post_url: trimmed } : a);
  }

  // Once the auction is live, the auction-level status follows the lot states:
  // any lot still open → live · any lot sold-but-unpaid → ended · all paid or
  // no-sale → settled. We never auto-leave draft (the seller has to flip that
  // manually once their post is up).
  function deriveAuctionStatus(currentStatus: Status, ls: Lot[]): Status {
    if (currentStatus === 'draft') return 'draft';
    if (ls.length === 0) return currentStatus;
    if (ls.some(l => l.status === 'open')) return 'live';
    if (ls.some(l => l.status === 'sold')) return 'ended';
    return 'settled';
  }
  async function syncAuctionStatusFromLots(nextLots: Lot[]) {
    if (!auction) return;
    const desired = deriveAuctionStatus(auction.status, nextLots);
    if (desired === auction.status) return;
    const supabase = createClient();
    const { error } = await supabase.from('fb_auctions').update({ status: desired }).eq('id', auction.id);
    if (error) { console.warn('auction status auto-advance failed:', error.message); return; }
    setAuction(a => a ? { ...a, status: desired } : a);
  }

  async function applyLotStatus(lot: Lot, next: Lot['status'], failureLabel: string) {
    const supabase = createClient();
    const { error } = await supabase.from('fb_auction_lots').update({ status: next }).eq('id', lot.id);
    if (error) { alert(failureLabel + ': ' + error.message); return null; }
    const nextLots = lots.map(l => l.id === lot.id ? { ...l, status: next } : l);
    setLots(nextLots);
    await syncAuctionStatusFromLots(nextLots);
    return nextLots;
  }
  async function quickSetSold(lot: Lot) {
    await applyLotStatus(lot, 'sold', 'Could not mark ended');
    // Ended lot stays out of inventory — no further change.
  }
  async function quickSetPaid(lot: Lot) {
    await applyLotStatus(lot, 'paid', 'Could not mark sold');
  }
  async function quickSetNoSale(lot: Lot) {
    const next = await applyLotStatus(lot, 'no_sale', 'Could not mark no sale');
    if (next) await markLotsInventory([lot], true);
  }
  async function quickReopen(lot: Lot) {
    const next = await applyLotStatus(lot, 'open', 'Could not reopen');
    if (next && auction?.status === 'live') {
      await markLotsInventory([lot], false);
    }
  }

  async function markBuyerPaid(bidderName: string) {
    if (!confirm(`Mark all of ${bidderName}'s lots as SOLD (paid)?`)) return;
    const supabase = createClient();
    const ids = lots.filter(l => (l.bidder_name || '').trim().toLowerCase() === bidderName.toLowerCase() && l.status === 'sold').map(l => l.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from('fb_auction_lots').update({ status: 'paid' }).in('id', ids);
    if (error) { alert('Could not mark paid: ' + error.message); return; }
    const nextLots = lots.map(l => ids.includes(l.id) ? { ...l, status: 'paid' as const } : l);
    setLots(nextLots);
    await syncAuctionStatusFromLots(nextLots);
  }

  const buyerGroups = useMemo(() => {
    const map = new Map<string, { name: string; lots: Lot[] }>();
    for (const lot of lots) {
      if (lot.status !== 'sold' && lot.status !== 'paid') continue;
      const name = (lot.bidder_name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, lots: [] });
      map.get(key)!.lots.push(lot);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [lots]);

  function buildInvoice(group: { name: string; lots: Lot[] }, shipping: number): string {
    const subtotal = group.lots.reduce((s, l) => s + (l.current_bid || 0), 0);
    const total = subtotal + (Number.isFinite(shipping) ? shipping : 0);
    const lotLines = group.lots.map(l => {
      const ttl = l.listing?.title || `Lot #${l.lot_number}`;
      return `· ${ttl} — ${fmtMoney(l.current_bid)}`;
    });

    // If the user has a default Winning Bid template, render it; otherwise
    // fall back to the previous hardcoded format.
    const vars: Record<string, string> = {
      bidder_name: group.name,
      auction_title: auction?.title || 'auction',
      subtotal: fmtMoney(subtotal),
      shipping: fmtMoney(shipping),
      total: fmtMoney(total),
      payment_text: paymentText,
      lots: lotLines.join('\n'),
    };
    function fill(template: string): string {
      return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
    }

    if (winningTpl && (winningTpl.post_header.trim() || winningTpl.post_footer.trim())) {
      return [
        fill(winningTpl.post_header).trim(),
        '',
        ...lotLines,
        '',
        fill(winningTpl.post_footer).trim(),
      ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
    }

    return [
      `Hi ${group.name}!`,
      '',
      `Congrats on winning these from my ${auction?.title || 'auction'}:`,
      '',
      ...lotLines,
      '',
      `Subtotal: ${fmtMoney(subtotal)}`,
      `Shipping: ${fmtMoney(shipping)}`,
      `Total: ${fmtMoney(total)}`,
      '',
      paymentText,
      '',
      'Thanks!',
    ].join('\n');
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  if (!auction) return null;

  const totalLots = lots.length;
  const openLots = lots.filter(l => l.status === 'open').length;
  const endedLots = lots.filter(l => l.status === 'sold').length;
  const noSaleLots = lots.filter(l => l.status === 'no_sale').length;
  const paidLots = lots.filter(l => l.status === 'paid').length;
  const grossSales = lots.filter(l => l.status === 'sold' || l.status === 'paid').reduce((s, l) => s + (l.current_bid || 0), 0);

  const postDetails = useMemo(() => {
    if (!auction) return null;
    const tpl = auction.fb_auction_templates;
    const isSingle = (tpl?.template_type === 'single') || (lots.length === 1 && tpl?.template_type !== 'multi');
    const sortedLots = [...lots].sort((a, b) => a.lot_number - b.lot_number);
    const minBidStr = sortedLots[0]?.starting_bid != null ? String(sortedLots[0].starting_bid) : '';
    const lotComments = sortedLots.map(l => {
      const text = l.listing && tpl?.lot_template
        ? substitute(tpl.lot_template, listingVars(l.listing, l.lot_number, l.starting_bid != null ? String(l.starting_bid) : minBidStr))
        : '';
      return { lot_id: l.id, lot_number: l.lot_number, listing: l.listing, comment_url: l.comment_url, text };
    });
    let parentBody = '';
    if (isSingle && sortedLots[0]?.listing) {
      const body = tpl?.post_header
        ? substitute(tpl.post_header, listingVars(sortedLots[0].listing, undefined, minBidStr))
        : '';
      parentBody = [body, (tpl?.post_footer || '').trim()].filter(Boolean).join('\n\n');
    } else {
      const headerVars = {
        auction_title: auction.title,
        lot_count: String(sortedLots.length),
        ends_at: auction.ends_at ? new Date(auction.ends_at).toLocaleString() : '',
      };
      const intro = tpl?.post_header ? substitute(tpl.post_header, headerVars) : '';
      parentBody = [intro, auction.title, (tpl?.post_footer || '').trim()].filter(s => s && s.trim()).join('\n\n');
    }
    return { isSingle, parentBody, lotComments };
  }, [auction, lots]);

  // Group lots into sections so an "ended" (closed-but-unpaid) card moves out
  // of the Live list while its siblings keep running.
  const liveLots = lots.filter(l => l.status === 'open');
  const endedLotsList = lots.filter(l => l.status === 'sold');
  const soldLotsList = lots.filter(l => l.status === 'paid');
  const noSaleLotsList = lots.filter(l => l.status === 'no_sale');
  const lotSections: Array<{ key: string; title: string; lots: Lot[] }> = [
    { key: 'live', title: 'Live', lots: liveLots },
    { key: 'ended', title: 'Ended (closed, awaiting payment)', lots: endedLotsList },
    { key: 'sold', title: 'Sold (paid)', lots: soldLotsList },
    { key: 'no_sale', title: 'No Sale', lots: noSaleLotsList },
  ].filter(s => s.lots.length > 0);

  function lotStatusLabel(s: Lot['status']): string {
    if (s === 'open') return 'LIVE';
    if (s === 'sold') return 'ENDED';
    if (s === 'paid') return 'SOLD';
    return 'NO SALE';
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <datalist id="fb-bidders-list">
        {bidders.map(b => (
          <option key={b.id} value={b.name}>{b.fb_handle ? `@${b.fb_handle}` : ''}</option>
        ))}
      </datalist>
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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Manage Auction ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">All Auctions</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/sales-metrics" className="btn btn-ghost btn-sm">📊 Metrics</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="display" style={{ fontSize: 24, color: 'var(--plum)', flex: 1, minWidth: 240 }}>{auction.title}</div>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', padding: '4px 12px', borderRadius: 100,
              background: statusBg(auction.status), color: statusFg(auction.status), textTransform: 'uppercase',
            }}>{auction.status === 'settled' ? 'sold' : auction.status}</span>
            {(endedLots > 0 || paidLots > 0) && (
              <a href="#settlement" style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '4px 11px', borderRadius: 100,
                background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--plum)',
                textDecoration: 'none', textTransform: 'uppercase', whiteSpace: 'nowrap',
              }}>
                {endedLots > 0 && <>★ {endedLots} ended unpaid</>}
                {endedLots > 0 && paidLots > 0 && ' · '}
                {paidLots > 0 && <>{paidLots} sold</>}
                {endedLots > 0 && ' → settle'}
              </a>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Stat label="Lots" value={String(totalLots)} />
            <Stat label="Live" value={String(openLots)} />
            <Stat label="Ended" value={String(endedLots)} />
            <Stat label="Sold" value={String(paidLots)} />
            <Stat label="No Sale" value={String(noSaleLots)} />
            <Stat label="Gross" value={fmtMoney(grossSales)} />
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', fontWeight: 600 }}>
            Created {new Date(auction.created_at).toLocaleString()}
            {auction.fb_groups?.name && ` · Group: ${auction.fb_groups.name}`}
            {auction.ends_at && ` · Ends ${new Date(auction.ends_at).toLocaleString()}`}
          </div>
        </section>

        {postDetails && (
          <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: postExpanded ? 12 : 0 }}>
              <button type="button"
                onClick={() => setPostExpanded(v => !v)}
                aria-label={postExpanded ? 'Collapse' : 'Expand'}
                style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 14, color: 'var(--plum)', padding: '2px 6px' }}>
                {postExpanded ? '▼' : '▶'}
              </button>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', flex: 1 }}>
                {postDetails.isSingle ? 'Post Details — single-card auction' : `Post Details — ${postDetails.lotComments.length} lots`}
              </div>
              {auction.fb_auction_templates?.name && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                  Template: {auction.fb_auction_templates.name}
                </span>
              )}
            </div>
            {postExpanded && (
              <>
                <div style={{ marginTop: 4, marginBottom: 14 }}>
                  <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700, marginBottom: 6 }}>
                    Parent post body
                  </div>
                  <textarea readOnly value={postDetails.parentBody}
                    rows={Math.min(14, Math.max(4, postDetails.parentBody.split('\n').length + 1))}
                    className="input-sc"
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12.5, resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button type="button" onClick={() => copyAndFlash('parent', postDetails.parentBody)} className="btn btn-primary btn-sm">
                      {copiedKey === 'parent' ? '✓ Copied' : '📋 Copy post body'}
                    </button>
                    {auction.post_url && (
                      <a href={auction.post_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                        ↗ Open FB post
                      </a>
                    )}
                  </div>
                </div>

                {!postDetails.isSingle && postDetails.lotComments.length > 0 && (
                  <div style={{ borderTop: '1.5px dashed var(--rule)', paddingTop: 14 }}>
                    <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>
                      Per-lot comments — paste each as a comment under the parent post
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {postDetails.lotComments.map(lc => {
                        const key = `lot:${lc.lot_id}`;
                        const label = lc.listing
                          ? `${lc.listing.year || ''} ${lc.listing.brand || ''} ${lc.listing.player || ''} #${lc.listing.card_number || ''}`.trim()
                          : 'Listing missing';
                        return (
                          <div key={lc.lot_id} className="panel" style={{ padding: 12, border: '1.5px solid var(--rule)', background: 'var(--paper)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <div className="mono" style={{ fontSize: 11, color: 'var(--plum)', fontWeight: 700 }}>
                                Lot #{lc.lot_number}
                              </div>
                              <div className="display" style={{ fontSize: 12.5, color: 'var(--plum)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {label}
                              </div>
                              <button type="button" onClick={() => copyAndFlash(key, lc.text)}
                                disabled={!lc.text} className="btn btn-outline btn-sm">
                                {copiedKey === key ? '✓ Copied' : '📋 Copy'}
                              </button>
                              {lc.comment_url && (
                                <a href={lc.comment_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">↗</a>
                              )}
                            </div>
                            {lc.text ? (
                              <pre style={{
                                margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5,
                                color: 'var(--ink-soft)', whiteSpace: 'pre-wrap',
                                background: 'var(--cream)', padding: 8, borderRadius: 4, border: '1px dashed var(--rule)',
                              }}>{lc.text}</pre>
                            ) : (
                              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
                                No comment text — listing or template missing.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 12 }}>Auction Controls</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div>
              <label className="input-label">Facebook Post URL</label>
              <input
                defaultValue={auction.post_url || ''}
                onBlur={e => { if ((e.target.value.trim() || null) !== (auction.post_url || null)) setPostUrl(e.target.value); }}
                placeholder="https://www.facebook.com/groups/..."
                className="input-sc" style={{ width: '100%' }}
              />
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4, fontStyle: 'italic' }}>
                Paste here once your post is live. Saved on blur.
              </div>
            </div>
            <div>
              <label className="input-label">Status</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['draft', 'live', 'ended', 'settled'] as const).map(s => (
                  <button key={s} onClick={() => setStatus(s)}
                    className={`btn btn-sm ${auction.status === s ? 'btn-primary' : 'btn-ghost'}`}>
                    {s === 'settled' ? 'Sold' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4, fontStyle: 'italic' }}>
                Draft → Live (after posting) → Ended (24h up) → Sold (paid out).
              </div>
            </div>
          </div>
        </section>

        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 12 }}>
            Lots — track current high bids
          </div>
          {lots.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>No lots in this auction.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {lotSections.map(section => (
                <div key={section.key}>
                  <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>
                    ★ {section.title} · {section.lots.length}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {section.lots.map(lot => {
                const cur = getLotValue(lot, 'current_bid');
                const bidder = getLotValue(lot, 'bidder_name');
                const handle = getLotValue(lot, 'bidder_fb_handle');
                const commentUrl = getLotValue(lot, 'comment_url');
                const isSaving = savingLots.has(lot.id);
                const buf = editBuffer[lot.id];
                const dirty = !!buf && Object.keys(buf).length > 0;
                return (
                  <div key={lot.id} className="panel" style={{
                    padding: 14,
                    border: lot.status === 'paid' ? '1.5px solid var(--teal)' :
                            lot.status === 'sold' ? '1.5px solid var(--orange)' :
                            lot.status === 'no_sale' ? '1.5px dashed var(--rust)' : '1.5px solid var(--rule)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                      <div style={{
                        width: 50, height: 50, flexShrink: 0,
                        background: 'var(--plum)', color: 'var(--mustard)',
                        display: 'grid', placeItems: 'center', borderRadius: 8,
                        fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700,
                      }}>#{lot.lot_number}</div>
                      {lot.listing?.photos?.[0] && (
                        <img src={lot.listing.photos[0]} alt="" style={{ width: 44, height: 62, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--plum)', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div className="display" style={{ fontSize: 14, color: 'var(--plum)' }}>
                            {lot.listing?.title || 'Listing missing'}
                          </div>
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                            background: lot.status === 'paid' ? 'var(--teal)' : lot.status === 'sold' ? 'var(--orange)' : lot.status === 'no_sale' ? 'var(--rust)' : 'var(--ink-mute)',
                            color: 'var(--cream)', textTransform: 'uppercase',
                          }}>{lotStatusLabel(lot.status)}</span>
                        </div>
                        <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
                          {lot.listing?.year} {lot.listing?.brand} #{lot.listing?.card_number} {conditionNote(lot.listing) ? '· ' + conditionNote(lot.listing) : ''}
                          {lot.starting_bid !== null && ` · SB ${fmtMoney(lot.starting_bid)}`}
                        </div>

                        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
                          <div>
                            <label className="input-label" style={{ fontSize: 9 }}>Current bid ($)</label>
                            <input type="text" inputMode="decimal"
                              defaultValue={cur !== null && cur !== undefined ? String(cur) : ''}
                              onChange={e => patchLot(lot.id, { current_bid: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) })}
                              onBlur={() => flushLot(lot.id)}
                              placeholder="0"
                              className="input-sc" style={{ width: '100%' }} />
                          </div>
                          <div style={{ position: 'relative' }}>
                            <label className="input-label" style={{ fontSize: 9 }}>Bidder name</label>
                            <input type="text"
                              list="fb-bidders-list"
                              defaultValue={bidder || ''}
                              onChange={e => patchLot(lot.id, { bidder_name: e.target.value })}
                              onBlur={() => flushLot(lot.id)}
                              placeholder="Bidder name"
                              className="input-sc" style={{ width: '100%' }} />
                            {dupeWarnings[lot.id] && dupeWarnings[lot.id].length > 1 && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--plum)', borderRadius: 4, padding: '4px 6px', fontSize: 10, zIndex: 10 }}>
                                ⚠ {dupeWarnings[lot.id].length} bidders named &ldquo;{bidder}&rdquo;. Add an FB handle to disambiguate.
                                <button onClick={() => setDupeWarnings(prev => { const n = { ...prev }; delete n[lot.id]; return n; })}
                                  style={{ marginLeft: 6, background: 'transparent', border: 0, color: 'var(--plum)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="input-label" style={{ fontSize: 9 }}>FB handle (optional)</label>
                            <input type="text"
                              defaultValue={handle || ''}
                              onChange={e => patchLot(lot.id, { bidder_fb_handle: e.target.value })}
                              onBlur={() => flushLot(lot.id)}
                              placeholder="@facebook.handle"
                              className="input-sc" style={{ width: '100%' }} />
                          </div>
                          <div>
                            <label className="input-label" style={{ fontSize: 9 }}>Comment URL (optional)</label>
                            <input type="text"
                              defaultValue={commentUrl || ''}
                              onChange={e => patchLot(lot.id, { comment_url: e.target.value })}
                              onBlur={() => flushLot(lot.id)}
                              placeholder="https://www.facebook.com/..."
                              className="input-sc" style={{ width: '100%' }} />
                          </div>
                        </div>

                        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {(() => {
                            if (!lot.bidder_id) return null;
                            const linkedBidder = bidders.find(b => b.id === lot.bidder_id);
                            const linkedMember = linkedBidder?.member_user_id
                              ? members.find(m => m.user_id === linkedBidder.member_user_id) : null;
                            if (linkedMember) {
                              const label = linkedMember.handle ? `@${linkedMember.handle}` : (linkedMember.display_name || 'member');
                              return (
                                <button type="button" onClick={() => setMemberPickerBidderId(lot.bidder_id)}
                                  title="Click to change or unlink"
                                  style={{
                                    fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                                    padding: '4px 9px', borderRadius: 100,
                                    background: 'var(--teal)', color: 'var(--cream)',
                                    border: '1.5px solid var(--teal)', cursor: 'pointer',
                                  }}>
                                  ✓ Member: {label}
                                </button>
                              );
                            }
                            return (
                              <button type="button" onClick={() => setMemberPickerBidderId(lot.bidder_id)}
                                style={{
                                  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                                  padding: '4px 9px', borderRadius: 100,
                                  background: 'transparent', color: 'var(--orange)',
                                  border: '1.5px dashed var(--orange)', cursor: 'pointer',
                                }}>
                                🔗 Link to member
                              </button>
                            );
                          })()}
                          {lot.status !== 'sold' && lot.status !== 'paid' && (
                            <button onClick={() => quickSetSold(lot)} className="btn btn-sm" style={{ background: 'var(--orange)', color: 'var(--cream)', border: '1.5px solid var(--orange)' }}>✓ Mark Ended</button>
                          )}
                          {lot.status === 'sold' && (
                            <button onClick={() => quickSetPaid(lot)} className="btn btn-sm" style={{ background: 'var(--teal)', color: 'var(--cream)', border: '1.5px solid var(--teal)' }}>✓ Mark Sold</button>
                          )}
                          {lot.status !== 'no_sale' && lot.status !== 'paid' && (
                            <button onClick={() => quickSetNoSale(lot)} className="btn btn-sm" style={{ background: 'transparent', color: 'var(--rust)', border: '1.5px solid var(--rust)' }}>✗ No Sale</button>
                          )}
                          {(lot.status === 'sold' || lot.status === 'no_sale' || lot.status === 'paid') && (
                            <button onClick={() => quickReopen(lot)} className="btn btn-ghost btn-sm">↺ Reopen</button>
                          )}
                          {commentUrl && (
                            <a href={commentUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">🔗 View comment</a>
                          )}
                          {(isSaving || dirty) && (
                            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginLeft: 'auto' }}>
                              {isSaving ? 'Saving…' : 'Unsaved'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {(auction.status === 'ended' || auction.status === 'settled' || lots.some(l => l.status === 'sold' || l.status === 'paid')) && (
          <section id="settlement" className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 20, scrollMarginTop: 80 }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>Settlement — Buyer Invoices</div>
            <div style={{ marginBottom: 14 }}>
              <label className="input-label">Payment Instructions (used in every invoice)</label>
              <textarea value={paymentText} onChange={e => setPaymentText(e.target.value)} rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px',
                  fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--plum)',
                  background: 'var(--paper)', resize: 'vertical',
                }} />
            </div>

            {buyerGroups.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>
                No ended lots with bidder names yet. Mark winning lots as <strong>Ended</strong> and fill in the bidder name on each.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {buyerGroups.map(group => {
                  const shipping = Number(shippingByBuyer[group.name.toLowerCase()] || '0') || 0;
                  const subtotal = group.lots.reduce((s, l) => s + (l.current_bid || 0), 0);
                  const total = subtotal + shipping;
                  const allPaid = group.lots.every(l => l.status === 'paid');
                  const invoice = buildInvoice(group, shipping);
                  return (
                    <div key={group.name} className="panel" style={{
                      padding: 14,
                      border: allPaid ? '1.5px solid var(--teal)' : '1.5px solid var(--plum)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                        <div className="display" style={{ fontSize: 16, color: 'var(--plum)', flex: 1, minWidth: 180 }}>
                          {group.name} {allPaid && <span style={{ fontSize: 10, color: 'var(--teal)', fontWeight: 700, letterSpacing: '0.1em', marginLeft: 8 }}>✓ SOLD</span>}
                        </div>
                        <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                          {group.lots.length} lot{group.lots.length === 1 ? '' : 's'} · {fmtMoney(subtotal)} subtotal
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 }}>
                        <div style={{ flex: 1, minWidth: 280 }}>
                          <pre style={{
                            background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
                            padding: '12px 14px', fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--plum)',
                            whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: 0,
                          }}>{invoice}</pre>
                        </div>
                        <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <label className="input-label" style={{ fontSize: 10 }}>Shipping ($)</label>
                            <input type="text" inputMode="decimal"
                              value={shippingByBuyer[group.name.toLowerCase()] || ''}
                              onChange={e => setShippingByBuyer(prev => ({ ...prev, [group.name.toLowerCase()]: e.target.value.replace(/[^0-9.]/g, '') }))}
                              placeholder="5"
                              className="input-sc" style={{ width: '100%' }} />
                          </div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>
                            <div>Subtotal: {fmtMoney(subtotal)}</div>
                            <div>Shipping: {fmtMoney(shipping)}</div>
                            <div style={{ color: 'var(--orange)', fontSize: 14, marginTop: 2 }}>Total: {fmtMoney(total)}</div>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <CopyButton text={invoice} label="📋 Copy Messenger Invoice" />
                        {!allPaid && (
                          <button onClick={() => markBuyerPaid(group.name)} className="btn btn-sm" style={{ background: 'var(--teal)', color: 'var(--cream)', border: '1.5px solid var(--teal)' }}>
                            ✓ Mark all sold (paid)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {memberPickerBidderId && (
        <MemberPicker
          bidder={bidders.find(b => b.id === memberPickerBidderId) || null}
          members={members}
          onClose={() => setMemberPickerBidderId(null)}
          onSave={async (memberUserId) => {
            await linkBidderToMember(memberPickerBidderId, memberUserId);
            setMemberPickerBidderId(null);
          }}
        />
      )}
    </div>
  );
}

function MemberPicker({ bidder, members, onClose, onSave }: {
  bidder: BidderRow | null;
  members: MemberOption[];
  onClose: () => void;
  onSave: (memberUserId: string | null) => void | Promise<void>;
}) {
  const [search, setSearch] = useState('');
  if (!bidder) return null;

  const q = search.trim().toLowerCase();
  // Auto-suggest by matching the bidder's name or fb_handle against member fields
  const bidderName = (bidder.name || '').toLowerCase();
  const bidderHandle = (bidder.fb_handle || '').replace(/^@/, '').toLowerCase();
  const matches = (m: MemberOption) => {
    const fields = [m.display_name, m.handle, m.fb_handle].filter(Boolean).map(s => String(s).toLowerCase());
    if (q) return fields.some(f => f.includes(q));
    return fields.some(f => f === bidderName || f === bidderHandle || f.includes(bidderName));
  };
  const filtered = members.filter(matches).slice(0, 50);
  const others = !q ? members.filter(m => !matches(m)).slice(0, 50) : [];

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '60px 20px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 540, padding: 22, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>
            Link bidder to member
          </div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12, lineHeight: 1.5 }}>
          Mapping <strong style={{ color: 'var(--plum)' }}>{bidder.name}</strong>
          {bidder.fb_handle && <> (<span className="mono">@{bidder.fb_handle.replace(/^@/, '')}</span>)</>}
          {' '}to a Sports Collective member. Once linked, future bids by this bidder are tracked
          and they&apos;ll get an outbid notification when you raise the leading bid for someone else.
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
          border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', marginBottom: 12,
        }}>
          <span style={{ fontSize: 13, color: 'var(--plum)' }}>🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, handle, or FB handle…"
            autoFocus
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 13, color: 'var(--plum)' }} />
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.length === 0 && others.length === 0 ? (
            <div className="eyebrow" style={{ textAlign: 'center', padding: 20, color: 'var(--ink-mute)' }}>
              No members found.
            </div>
          ) : (
            <>
              {filtered.length > 0 && !q && (
                <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', padding: '4px 6px', fontWeight: 700 }}>
                  ★ Likely matches
                </div>
              )}
              {filtered.map(m => (
                <button key={m.user_id} type="button" onClick={() => onSave(m.user_id)}
                  style={{
                    textAlign: 'left', padding: '8px 12px',
                    border: '1.5px solid var(--rule)', borderRadius: 8,
                    background: 'var(--paper)', cursor: 'pointer',
                  }}>
                  <div className="display" style={{ fontSize: 13.5, color: 'var(--plum)' }}>
                    {m.display_name || m.handle || 'Member'}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
                    {m.handle ? `@${m.handle}` : ''}
                    {m.fb_handle ? `${m.handle ? ' · ' : ''}FB: ${m.fb_handle}` : ''}
                  </div>
                </button>
              ))}
              {others.length > 0 && (
                <>
                  <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', padding: '8px 6px 2px', fontWeight: 700 }}>
                    All members
                  </div>
                  {others.map(m => (
                    <button key={m.user_id} type="button" onClick={() => onSave(m.user_id)}
                      style={{
                        textAlign: 'left', padding: '8px 12px',
                        border: '1.5px solid var(--rule)', borderRadius: 8,
                        background: 'var(--paper)', cursor: 'pointer',
                      }}>
                      <div className="display" style={{ fontSize: 13.5, color: 'var(--plum)' }}>
                        {m.display_name || m.handle || 'Member'}
                      </div>
                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
                        {m.handle ? `@${m.handle}` : ''}
                        {m.fb_handle ? `${m.handle ? ' · ' : ''}FB: ${m.fb_handle}` : ''}
                      </div>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        {bidder.member_user_id && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1.5px solid var(--rule)' }}>
            <button type="button" onClick={() => onSave(null)}
              className="btn btn-ghost btn-sm">
              ✕ Unlink from member
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8, padding: '8px 12px' }}>
      <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', marginBottom: 2 }}>{label}</div>
      <div className="display" style={{ fontSize: 17, color: 'var(--plum)' }}>{value}</div>
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
