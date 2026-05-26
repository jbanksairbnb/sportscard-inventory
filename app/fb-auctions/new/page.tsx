'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSellerStatus } from '@/lib/sellerGuard';
import { applyOwnedTransition } from '@/lib/inventory';
import { syncAuctionListings } from '@/lib/listingStatusSync';
import { replaceImageBg } from '@/lib/collageBg';
import SCLogo from '@/components/SCLogo';

type TemplateType = 'single' | 'multi';

type Listing = {
  id: string;
  title: string;
  description: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: 'raw' | 'graded';
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  photos: string[];
  status: string;
  source_set_slug: string | null;
  source_card_number: string | null;
};

type Template = {
  id: string;
  name: string;
  template_type: TemplateType;
  post_header: string;
  post_footer: string;
  lot_template: string;
  is_default: boolean;
};

type Group = { id: string; name: string; url: string | null };

type BidderRow = { id: string; name: string; fb_handle: string | null };

type LiveActivity = {
  bidder_id: string;
  source: 'auction' | 'claim';
  is_winner: boolean;
  is_paid: boolean;
  bid_amount: number | null;
  listing_year: number | null;
  listing_brand: string | null;
  listing_player: string | null;
};

type BidderSuggestion = {
  bidder: BidderRow;
  matchCount: number;
  wonCount: number;       // auction wins on matched listings
  claimCount: number;     // claim wins on matched listings
  totalSpend: number;
  matchedListingIds: string[];
};

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function conditionNote(l: Listing): string {
  if (l.condition_type === 'graded' && l.grading_company && l.grade) return `${l.grading_company} ${l.grade}`;
  if (l.condition_type === 'raw' && l.raw_grade) return l.raw_grade;
  return '';
}

function listingVars(l: Listing, lotNumber?: number, minBidOverride?: string): Record<string, string> {
  // Minimum bid is set per-auction by the user; never auto-pulled from the listing's asking price.
  const startingBid = minBidOverride !== undefined && minBidOverride !== '' ? minBidOverride : '';
  return {
    lot_number: lotNumber !== undefined ? String(lotNumber) : '',
    year: l.year ? String(l.year) : '',
    brand: l.brand || '',
    player: l.player || '',
    card_number: l.card_number || '',
    title: l.title || '',
    grade: l.grade || '',
    grading_company: l.grading_company || '',
    raw_grade: l.raw_grade || '',
    condition_note: conditionNote(l),
    starting_bid: startingBid,
    description: l.description || '',
  };
}

function defaultAuctionTitle(l: Listing): string {
  const parts = [
    l.year ? String(l.year) : '',
    l.brand || '',
    l.player || '',
    l.card_number ? `#${l.card_number}` : '',
  ].filter(Boolean);
  return parts.join(' ').trim();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

async function buildSideBySide(frontUrl: string, backUrl: string | null, bgColor: string = '#ffffff'): Promise<Blob | null> {
  try {
    const front = await loadImage(frontUrl);
    const back = backUrl ? await loadImage(backUrl).catch(() => null) : null;
    const frontSrc = replaceImageBg(front, bgColor);
    const backSrc = back ? replaceImageBg(back, bgColor) : null;
    const fw = frontSrc.width, fh = frontSrc.height;
    const bw = backSrc?.width || 0, bh = backSrc?.height || 0;
    const gap = backSrc ? 60 : 0;
    const outer = 60;
    const innerW = fw + (backSrc ? bw + gap : 0);
    const innerH = Math.max(fh, bh);
    const w = innerW + outer * 2;
    const h = innerH + outer * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(frontSrc, outer, outer + (innerH - fh) / 2);
    if (backSrc) {
      ctx.drawImage(backSrc, outer + fw + gap, outer + (innerH - bh) / 2);
    }
    return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.95));
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export default function NewFbAuctionPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>}>
      <NewFbAuctionPageInner />
    </Suspense>
  );
}

function NewFbAuctionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillIds = useMemo(() => {
    const raw = searchParams?.get('listing_ids') || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }, [searchParams]);
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  const [type, setType] = useState<TemplateType>('multi');
  const [templateId, setTemplateId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupUrl, setGroupUrl] = useState('');
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [endsAt, setEndsAt] = useState('');

  // Single-mode state
  const [singleListingId, setSingleListingId] = useState('');
  const [singleAuctionTitle, setSingleAuctionTitle] = useState('');
  const [singleBody, setSingleBody] = useState('');
  const [singleBodyTouched, setSingleBodyTouched] = useState(false);
  const [minBid, setMinBid] = useState('');

  // Multi-mode state
  const [multiTitle, setMultiTitle] = useState('');
  const [multiDescription, setMultiDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [bidders, setBidders] = useState<BidderRow[]>([]);
  const [activity, setActivity] = useState<LiveActivity[]>([]);
  const [bidderTotals, setBidderTotals] = useState<Map<string, { auctionWins: number; claimCount: number }>>(new Map());
  const [generated, setGenerated] = useState<{ auctionId: string; type: TemplateType; postBody: string; lots: Array<{ id: string; lot_number: number; listing: Listing; text: string; }> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [busyImage, setBusyImage] = useState<string | null>(null);
  const [collageBg, setCollageBg] = useState('#ffffff');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('sc-collage-bg');
    if (saved) setCollageBg(saved);
  }, []);
  function updateCollageBg(c: string) {
    setCollageBg(c);
    try { window.localStorage.setItem('sc-collage-bg', c); } catch {}
  }

  async function handleGoLive() {
    if (!generated || goingLive) return;
    setGoingLive(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('fb_auctions')
      .update({ status: 'live' })
      .eq('id', generated.auctionId);
    if (error) {
      setGoingLive(false);
      alert('Could not mark auction live: ' + error.message);
      return;
    }
    // Pull the source set rows out of inventory for every lot whose listing
    // came from a tracked set. Mirrors the logic in the auction manage page.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const bySet = new Map<string, Set<string>>();
      for (const lot of generated.lots) {
        const slug = lot.listing.source_set_slug;
        const card = lot.listing.source_card_number;
        if (!slug || !card) continue;
        const set = bySet.get(slug) || new Set<string>();
        set.add(card);
        bySet.set(slug, set);
      }
      for (const [slug, cards] of bySet.entries()) {
        const { data: setRow } = await supabase
          .from('sets').select('rows').eq('user_id', user.id).eq('slug', slug).maybeSingle();
        if (!setRow) continue;
        const rows = Array.isArray(setRow.rows) ? setRow.rows as Record<string, unknown>[] : [];
        const { nextRows, touched, ownedCount } = applyOwnedTransition(rows, cards, false);
        if (!touched) continue;
        const ownedPct = nextRows.length > 0 ? (ownedCount / nextRows.length) * 100 : 0;
        await supabase.from('sets').update({
          rows: nextRows, owned_count: ownedCount, owned_pct: ownedPct, updated_at: Date.now(),
        }).eq('user_id', user.id).eq('slug', slug);
      }
      // Lock the underlying listings now that the auction is live.
      const lotsForSync = generated.lots.map(l => ({ listing_id: l.listing.id, status: 'open' as const }));
      await syncAuctionListings(supabase, user.id, 'live', lotsForSync);
    }
    router.push('/fb-auctions');
  }

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      { const _ss = await getSellerStatus(supabase, user.id); if (!_ss.canSell) { router.replace('/marketplace'); return; } if (!_ss.termsAccepted) { router.replace('/seller-terms'); return; } }
      setUserId(user.id);
      const [listingsRes, templatesRes, groupsRes, biddersRes, lotsRes, eventsRes, claimsRes, historicalRes] = await Promise.all([
        supabase.from('listings').select('id, title, description, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, asking_price, photos, status, source_set_slug, source_card_number').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false }),
        supabase.from('fb_auction_templates').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
        supabase.from('fb_groups').select('id, name, url').eq('user_id', user.id).order('name'),
        supabase.from('fb_bidders').select('id, name, fb_handle').eq('user_id', user.id).order('name'),
        supabase.from('fb_auction_lots')
          .select('id, bidder_id, current_bid, status, listing:listings(year, brand, player)')
          .eq('user_id', user.id)
          .not('bidder_id', 'is', null),
        supabase.from('fb_auction_bid_events')
          .select('bidder_id, lot_id, amount, lot:fb_auction_lots(bidder_id, status, current_bid, listing:listings(year, brand, player))')
          .eq('user_id', user.id)
          .not('bidder_id', 'is', null),
        supabase.from('fb_claim_sale_items')
          .select('claim_buyer_id, price, claim_status, listing:listings(year, brand, player)')
          .eq('user_id', user.id)
          .not('claim_buyer_id', 'is', null),
        supabase.from('historical_transactions')
          .select('bidder_id, year, brand, player, amount, channel, engagement_type')
          .eq('user_id', user.id)
          .not('bidder_id', 'is', null),
      ]);
      const loadedListings = (listingsRes.data || []) as Listing[];
      setListings(loadedListings);
      setTemplates((templatesRes.data || []) as Template[]);
      setGroups((groupsRes.data || []) as Group[]);
      // Apply ?listing_ids=... pre-selection.
      if (prefillIds.length > 0) {
        const valid = prefillIds.filter(id => loadedListings.some(l => l.id === id));
        if (valid.length === 1) {
          setType('single');
          setSingleListingId(valid[0]);
        } else if (valid.length > 1) {
          setType('multi');
          setSelectedIds(valid);
        }
      }
      if (biddersRes.error) console.warn('fb_bidders not available:', biddersRes.error.message);
      setBidders((biddersRes.data || []) as BidderRow[]);

      // Fold all sources into a unified activity stream. Critical: we pull
      // every bid (fb_auction_bid_events), not just the current high bidder
      // (fb_auction_lots.bidder_id), so multi-bidder lots match all bidders.
      type LotRowJoin = { id: string; bidder_id: string; current_bid: number | null; status: 'open' | 'sold' | 'no_sale' | 'paid'; listing: { year: number | null; brand: string | null; player: string | null } | null };
      type EventRowJoin = { bidder_id: string; lot_id: string; amount: number | null; lot: { bidder_id: string | null; current_bid: number | null; status: 'open' | 'sold' | 'no_sale' | 'paid'; listing: { year: number | null; brand: string | null; player: string | null } | null } | null };
      type ClaimRowJoin = { claim_buyer_id: string; price: number | null; claim_status: 'open' | 'claimed' | 'sold' | 'paid'; listing: { year: number | null; brand: string | null; player: string | null } | null };
      const lotRows = (lotsRes.data || []) as unknown as LotRowJoin[];
      const eventRows = (eventsRes?.data || []) as unknown as EventRowJoin[];
      const claimRows = (claimsRes.data || []) as unknown as ClaimRowJoin[];

      // Dedupe (bidder_id, lot_id) so a bidder who placed five bids on a lot
      // counts once for matchCount but we still see them at all.
      const seenPairs = new Set<string>();
      const auctionActivity: LiveActivity[] = [];
      for (const e of eventRows) {
        const lot = e.lot;
        if (!lot) continue;
        const key = `${e.bidder_id}|${e.lot_id}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const isWinner = lot.bidder_id === e.bidder_id && (lot.status === 'sold' || lot.status === 'paid');
        const isPaid = lot.bidder_id === e.bidder_id && lot.status === 'paid';
        auctionActivity.push({
          bidder_id: e.bidder_id,
          source: 'auction' as const,
          is_winner: isWinner,
          is_paid: isPaid,
          bid_amount: isPaid ? (lot.current_bid ?? null) : null,
          listing_year: lot.listing?.year ?? null,
          listing_brand: lot.listing?.brand ?? null,
          listing_player: lot.listing?.player ?? null,
        });
      }
      // Pick up any current high bidders not covered by bid_events (e.g. data
      // recorded before bid-event logging shipped).
      for (const l of lotRows) {
        const key = `${l.bidder_id}|${l.id}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        auctionActivity.push({
          bidder_id: l.bidder_id,
          source: 'auction' as const,
          is_winner: l.status === 'sold' || l.status === 'paid',
          is_paid: l.status === 'paid',
          bid_amount: l.status === 'paid' ? (l.current_bid ?? null) : null,
          listing_year: l.listing?.year ?? null,
          listing_brand: l.listing?.brand ?? null,
          listing_player: l.listing?.player ?? null,
        });
      }
      type HistoricalRow = { bidder_id: string; year: number | null; brand: string | null; player: string | null; amount: number | null; channel: string | null; engagement_type: 'won' | 'bid' | 'tag_request' };
      const historicalRows = (historicalRes?.data || []) as HistoricalRow[];
      const liveActivity: LiveActivity[] = [
        ...auctionActivity,
        ...claimRows.map(c => ({
          bidder_id: c.claim_buyer_id,
          source: 'claim' as const,
          is_winner: c.claim_status === 'claimed' || c.claim_status === 'sold' || c.claim_status === 'paid',
          is_paid: c.claim_status === 'paid',
          bid_amount: c.price,
          listing_year: c.listing?.year ?? null,
          listing_brand: c.listing?.brand ?? null,
          listing_player: c.listing?.player ?? null,
        })),
        ...historicalRows.map(h => ({
          bidder_id: h.bidder_id,
          source: (h.channel === 'fb_claim' ? 'claim' : 'auction') as 'auction' | 'claim',
          // Only winning historical entries count as wins/paid; bids and tag
          // requests still count as "matches" for tag suggestions.
          is_winner: h.engagement_type === 'won',
          is_paid: h.engagement_type === 'won',
          bid_amount: h.engagement_type === 'won' ? h.amount : null,
          listing_year: h.year,
          listing_brand: h.brand,
          listing_player: h.player,
        })),
      ];
      setActivity(liveActivity);

      // Per-bidder totals across ALL their history (not just matched listings).
      // Used to skip recommendations for buyers who only ever do claim sales.
      const totals = new Map<string, { auctionWins: number; claimCount: number }>();
      for (const a of liveActivity) {
        const e = totals.get(a.bidder_id) || { auctionWins: 0, claimCount: 0 };
        if (a.source === 'auction' && a.is_winner) e.auctionWins += 1;
        if (a.source === 'claim' && a.is_winner) e.claimCount += 1;
        totals.set(a.bidder_id, e);
      }
      setBidderTotals(totals);

      setLoading(false);
    }
    load();
  }, [router]);

  const filteredTemplates = useMemo(() => templates.filter(t => (t.template_type || 'multi') === type), [templates, type]);

  // Auto-pick default template when type changes
  useEffect(() => {
    if (filteredTemplates.length === 0) { setTemplateId(''); return; }
    const def = filteredTemplates.find(t => t.is_default);
    setTemplateId((def || filteredTemplates[0]).id);
  }, [type, filteredTemplates]);

  // Auto-fill single-card body from listing + template
  useEffect(() => {
    if (type !== 'single') return;
    const l = listings.find(x => x.id === singleListingId);
    const t = templates.find(x => x.id === templateId);
    if (!l) {
      setSingleBody('');
      setSingleAuctionTitle('');
      return;
    }
    if (!singleBodyTouched && t) {
      setSingleBody(substitute(t.post_header || '', listingVars(l, undefined, minBid)));
    }
    if (!singleAuctionTitle) setSingleAuctionTitle(defaultAuctionTitle(l));
  }, [type, singleListingId, templateId, listings, templates, singleBodyTouched, singleAuctionTitle, minBid]);

  const filteredListings = useMemo(() => {
    const q = searchQuery.trim();
    const base = !q ? listings : (() => {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      return listings.filter(l => {
        const hay = [l.title, l.player, l.brand, l.card_number, l.year ? String(l.year) : '', l.description, l.raw_grade, l.grading_company, l.grade].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    })();
    // Default order: year ascending then numeric card # ascending. Set
    // breaks (e.g. filter "1967") land in card-number order so the seller
    // can scan the list the same way the cards sit in the binder.
    // card_number is a string (can be "234", "234A", "T1") — parseInt
    // strips the suffix and ties fall back to lexical compare. Rows
    // missing year or card # sink to the bottom so they don't scramble
    // the run when present.
    const cardNumKey = (s: string | null) => {
      if (!s) return { n: Number.POSITIVE_INFINITY, s: '' };
      const m = s.match(/^\s*(\d+)/);
      return { n: m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY, s };
    };
    return [...base].sort((a, b) => {
      const ay = a.year ?? Number.POSITIVE_INFINITY;
      const by = b.year ?? Number.POSITIVE_INFINITY;
      if (ay !== by) return ay - by;
      const ak = cardNumKey(a.card_number);
      const bk = cardNumKey(b.card_number);
      if (ak.n !== bk.n) return ak.n - bk.n;
      return ak.s.localeCompare(bk.s);
    });
  }, [listings, searchQuery]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function addGroup() {
    if (!groupName.trim() || !userId) return;
    const supabase = createClient();
    const { data, error } = await supabase.from('fb_groups').insert({
      user_id: userId, name: groupName.trim(), url: groupUrl.trim() || null,
    }).select().single();
    if (error) { alert(error.message); return; }
    setGroups(prev => [...prev, data as Group].sort((a, b) => a.name.localeCompare(b.name)));
    setGroupId(data.id); setGroupName(''); setGroupUrl(''); setShowAddGroup(false);
  }

  const selectedListings: Listing[] = useMemo(
    () => selectedIds.map(id => listings.find(l => l.id === id)).filter(Boolean) as Listing[],
    [selectedIds, listings]
  );

  const suggestionListings: Listing[] = useMemo(() => {
    if (type === 'single') {
      const l = listings.find(x => x.id === singleListingId);
      return l ? [l] : [];
    }
    return selectedListings;
  }, [type, listings, singleListingId, selectedListings]);

  const bidderSuggestions: BidderSuggestion[] = useMemo(() => {
    if (suggestionListings.length === 0 || activity.length === 0) return [];
    const YEAR_TOLERANCE = 5;
    const byBidder = new Map<string, BidderSuggestion>();
    for (const l of suggestionListings) {
      for (const a of activity) {
        const playerMatch = !!l.player && !!a.listing_player && l.player.toLowerCase() === a.listing_player.toLowerCase();
        const sameBrand = !!l.brand && !!a.listing_brand && l.brand.toLowerCase() === a.listing_brand.toLowerCase();
        const yearWithin = l.year !== null && a.listing_year !== null && Math.abs(l.year - a.listing_year) <= YEAR_TOLERANCE;
        const brandYearMatch = sameBrand && yearWithin;
        if (!playerMatch && !brandYearMatch) continue;
        const bidder = bidders.find(b => b.id === a.bidder_id);
        if (!bidder) continue;
        let entry = byBidder.get(bidder.id);
        if (!entry) {
          entry = { bidder, matchCount: 0, wonCount: 0, claimCount: 0, totalSpend: 0, matchedListingIds: [] };
          byBidder.set(bidder.id, entry);
        }
        entry.matchCount += 1;
        if (a.source === 'auction' && a.is_winner) entry.wonCount += 1;
        if (a.source === 'claim' && a.is_winner) entry.claimCount += 1;
        if (a.is_paid && a.bid_amount) entry.totalSpend += a.bid_amount;
        if (!entry.matchedListingIds.includes(l.id)) entry.matchedListingIds.push(l.id);
      }
    }
    // Filter out bidders who never bid in an auction but have racked up claim
    // sale activity — they're claim-only buyers and an auction tag is noise.
    const CLAIM_ONLY_THRESHOLD = 3;
    const filteredEntries = Array.from(byBidder.values()).filter(entry => {
      const totals = bidderTotals.get(entry.bidder.id);
      if (!totals) return true;
      if (totals.auctionWins === 0 && totals.claimCount >= CLAIM_ONLY_THRESHOLD) return false;
      return true;
    });
    return filteredEntries.sort((a, b) => {
      if (b.wonCount !== a.wonCount) return b.wonCount - a.wonCount;
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return b.totalSpend - a.totalSpend;
    }).slice(0, 12);
  }, [suggestionListings, activity, bidders, bidderTotals]);

  const canGenerate = type === 'single'
    ? !!templateId && !!singleListingId && singleAuctionTitle.trim().length > 0
    : !!templateId && multiTitle.trim().length > 0 && selectedListings.length > 0;

  async function handleGenerate() {
    if (!canGenerate || !userId) return;
    const t = templates.find(x => x.id === templateId);
    if (!t) return;
    setSaving(true);
    const supabase = createClient();

    if (type === 'single') {
      const l = listings.find(x => x.id === singleListingId);
      if (!l) { setSaving(false); return; }
      const auctionTitle = singleAuctionTitle.trim();
      const body = singleBody.trim();
      const footer = (t.post_footer || '').trim();
      const fullPost = [body, footer].filter(Boolean).join('\n\n');

      const { data: auc, error: aucErr } = await supabase.from('fb_auctions').insert({
        user_id: userId, title: auctionTitle,
        group_id: groupId || null, template_id: t.id,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        status: 'draft',
      }).select().single();
      if (aucErr || !auc) { alert(aucErr?.message || 'Failed to create auction'); setSaving(false); return; }

      const { data: lotData, error: lotErr } = await supabase.from('fb_auction_lots').insert({
        auction_id: auc.id, user_id: userId, listing_id: l.id, lot_number: 1,
        starting_bid: l.asking_price, status: 'open',
      }).select().single();
      if (lotErr) { alert(lotErr.message); setSaving(false); return; }

      setGenerated({
        auctionId: auc.id, type: 'single', postBody: fullPost,
        lots: [{ id: lotData.id, lot_number: 1, listing: l, text: fullPost }],
      });
      setSaving(false);
      return;
    }

    // multi
    const headerVars = {
      auction_title: multiTitle.trim(),
      lot_count: String(selectedListings.length),
      ends_at: endsAt ? new Date(endsAt).toLocaleString() : '',
    };
    const optionalIntro = substitute((t.post_header || '').trim(), headerVars);
    const footer = (t.post_footer || '').trim();
    const parentPost = [optionalIntro, multiTitle.trim(), multiDescription.trim(), footer].filter(Boolean).join('\n\n');

    const { data: auc, error: aucErr } = await supabase.from('fb_auctions').insert({
      user_id: userId, title: multiTitle.trim(),
      group_id: groupId || null, template_id: t.id,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      status: 'draft',
    }).select().single();
    if (aucErr || !auc) { alert(aucErr?.message || 'Failed to create auction'); setSaving(false); return; }

    const lotRows = selectedListings.map((l, idx) => ({
      auction_id: auc.id, user_id: userId, listing_id: l.id,
      lot_number: idx + 1, starting_bid: l.asking_price, status: 'open',
    }));
    const { data: insertedLots, error: lotsErr } = await supabase.from('fb_auction_lots').insert(lotRows).select();
    if (lotsErr) { alert(lotsErr.message); setSaving(false); return; }

    const lots = selectedListings.map((l, idx) => {
      const inserted = (insertedLots || []).find((x: { lot_number: number }) => x.lot_number === idx + 1);
      return {
        id: (inserted?.id as string) || '',
        lot_number: idx + 1,
        listing: l,
        text: substitute(t.lot_template || '', listingVars(l, idx + 1, minBid)),
      };
    });

    setGenerated({ auctionId: auc.id, type: 'multi', postBody: parentPost, lots });
    setSaving(false);
  }

  async function handleDownloadImage(lot: { lot_number: number; listing: Listing }) {
    const photos = lot.listing.photos || [];
    const front = photos[0];
    const back = photos[1] || null;
    if (!front) { alert('No photo on this listing.'); return; }
    setBusyImage(lot.listing.id);
    const blob = back ? await buildSideBySide(front, back, collageBg) : await fetch(front).then(r => r.blob()).catch(() => null);
    setBusyImage(null);
    if (!blob) { alert('Image generation failed (likely a CORS issue with the photo source).'); return; }
    const safe = `${lot.listing.year || 'card'}-${(lot.listing.player || 'player').replace(/[^a-z0-9]+/gi, '-')}-lot${lot.lot_number}.jpg`.toLowerCase();
    downloadBlob(blob, safe);
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;

  if (templates.length === 0) {
    return (
      <div style={{ minHeight: '100vh' }}>
        <Header />
        <div style={{ maxWidth: 720, margin: '60px auto', padding: '0 28px' }}>
          <div className="panel-bordered" style={{ padding: '40px 28px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No templates yet</div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 14, marginBottom: 18 }}>
              Create at least one template to start generating auctions.
            </p>
            <Link href="/fb-auctions/templates" className="btn btn-primary">Create your first template →</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <Header />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>

        {!generated && (
          <>
            <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>1. Auction Type</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={() => { setType('single'); setSelectedIds([]); setMultiTitle(''); setMultiDescription(''); setMinBid(''); }}
                  className={type === 'single' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                  Single Card
                </button>
                <button onClick={() => { setType('multi'); setSingleListingId(''); setSingleBody(''); setSingleAuctionTitle(''); setSingleBodyTouched(false); setMinBid(''); }}
                  className={type === 'multi' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                  Multi-Card
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                {type === 'single'
                  ? 'One card per Facebook post. Body auto-fills from the listing — you can edit before generating.'
                  : 'One parent post with each card pasted as a comment. You type the title and description; the template provides the auction info footer.'}
              </div>

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <div>
                  <label className="input-label">Template *</label>
                  {filteredTemplates.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--rust)', fontWeight: 600, padding: '8px 0' }}>
                      No {type} templates yet. <Link href="/fb-auctions/templates" style={{ color: 'var(--orange)' }}>Create one →</Link>
                    </div>
                  ) : (
                    <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="input-sc" style={{ width: '100%' }}>
                      {filteredTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' ★' : ''}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="input-label">Facebook Group</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={groupId} onChange={e => setGroupId(e.target.value)} className="input-sc" style={{ flex: 1 }}>
                      <option value="">— none —</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <button onClick={() => setShowAddGroup(s => !s)} className="btn btn-ghost btn-sm" type="button">+</button>
                  </div>
                  {showAddGroup && (
                    <div style={{ marginTop: 8, padding: 10, background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" className="input-sc" />
                      <input value={groupUrl} onChange={e => setGroupUrl(e.target.value)} placeholder="Group URL (optional)" className="input-sc" />
                      <button onClick={addGroup} className="btn btn-primary btn-sm" disabled={!groupName.trim()}>Add Group</button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="input-label">Ends At (optional)</label>
                  <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="input-sc" style={{ width: '100%' }} />
                </div>
              </div>
            </section>

            {type === 'single' && (
              <SingleCardForm
                listings={listings}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filteredListings={filteredListings}
                singleListingId={singleListingId}
                setSingleListingId={(id) => { setSingleListingId(id); setSingleBodyTouched(false); setSingleAuctionTitle(''); }}
                singleAuctionTitle={singleAuctionTitle}
                setSingleAuctionTitle={setSingleAuctionTitle}
                singleBody={singleBody}
                setSingleBody={(s) => { setSingleBody(s); setSingleBodyTouched(true); }}
                onResetBody={() => { setSingleBodyTouched(false); }}
                template={templates.find(x => x.id === templateId)}
                minBid={minBid}
                setMinBid={setMinBid}
              />
            )}

            {type === 'multi' && (
              <MultiCardForm
                multiTitle={multiTitle} setMultiTitle={setMultiTitle}
                multiDescription={multiDescription} setMultiDescription={setMultiDescription}
                listings={listings}
                searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                filteredListings={filteredListings}
                selectedIds={selectedIds} toggleSelect={toggleSelect}
                minBid={minBid} setMinBid={setMinBid}
              />
            )}

            {bidderSuggestions.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <BidderSuggestionsPanel suggestions={bidderSuggestions} />
              </div>
            )}

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={handleGenerate} disabled={!canGenerate || saving} className="btn btn-primary">
                {saving ? 'Generating…' : type === 'single' ? 'Generate Auction' : `Generate Auction (${selectedIds.length} lot${selectedIds.length === 1 ? '' : 's'})`}
              </button>
            </div>
          </>
        )}

        {generated && (
          <>
            <div style={{ padding: '14px 18px', marginBottom: 24, background: 'rgba(56,142,142,0.12)', border: '1.5px solid var(--teal)', borderRadius: 10, fontSize: 13, color: 'var(--teal)', fontWeight: 700 }}>
              ✓ Auction created. Copy the post and paste into your Facebook group.
              {generated.type === 'multi' && ` Then paste each lot as a comment with its image attached.`}
            </div>

            {bidderSuggestions.length > 0 && (
              <BidderSuggestionsPanel suggestions={bidderSuggestions} />
            )}

            <CopyBlock label={generated.type === 'single' ? '📋 Facebook Post' : '📋 Parent Post (paste as the FB post)'} text={generated.postBody} />

            {generated.type === 'single' && generated.lots[0] && (
              <div className="panel-bordered" style={{ padding: 18, marginTop: 16 }}>
                <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 8 }}>📷 Image (attach to the post)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {generated.lots[0].listing.photos?.[0] && (
                      <img loading="lazy" decoding="async" src={generated.lots[0].listing.photos[0]} alt="Front" style={{ width: 96, height: 134, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--plum)' }} />
                    )}
                    {generated.lots[0].listing.photos?.[1] && (
                      <img loading="lazy" decoding="async" src={generated.lots[0].listing.photos[1]} alt="Back" style={{ width: 96, height: 134, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--plum)' }} />
                    )}
                  </div>
                  <button onClick={() => handleDownloadImage(generated.lots[0])}
                    disabled={busyImage === generated.lots[0].listing.id || !generated.lots[0].listing.photos?.[0]}
                    className="btn btn-outline">
                    {busyImage === generated.lots[0].listing.id ? 'Building…' : '🖼 Download side-by-side image'}
                  </button>
                  <BgColorPicker value={collageBg} onChange={updateCollageBg} />
                </div>
              </div>
            )}

            {generated.type === 'multi' && (
              <>
                <div style={{ marginTop: 24, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>Lots — paste each as a comment with the image attached</div>
                  <BgColorPicker value={collageBg} onChange={updateCollageBg} />
                </div>
                {generated.lots.map(lot => (
                  <div key={lot.lot_number} className="panel-bordered" style={{ padding: 18, marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{
                        width: 64, height: 64, flexShrink: 0,
                        background: 'var(--plum)', color: 'var(--mustard)',
                        display: 'grid', placeItems: 'center', borderRadius: 8,
                        fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
                      }}>#{lot.lot_number}</div>
                      <div style={{ flex: 1, minWidth: 280 }}>
                        <div className="display" style={{ fontSize: 15, color: 'var(--plum)', marginBottom: 4 }}>{lot.listing.title}</div>
                        <pre style={{
                          background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
                          padding: '10px 12px', fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--plum)',
                          whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: '0 0 8px',
                        }}>{lot.text}</pre>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <CopyButton text={lot.text} label="📋 Copy lot text" />
                          <button onClick={() => handleDownloadImage(lot)} disabled={busyImage === lot.listing.id || !lot.listing.photos?.[0]}
                            className="btn btn-outline btn-sm">
                            {busyImage === lot.listing.id ? 'Building…' : '🖼 Download image'}
                          </button>
                          {lot.listing.photos?.length === 0 && (
                            <span style={{ fontSize: 11, color: 'var(--rust)', fontWeight: 700, alignSelf: 'center' }}>No photos</span>
                          )}
                          {lot.listing.photos?.length === 1 && (
                            <span style={{ fontSize: 11, color: 'var(--ink-mute)', alignSelf: 'center' }}>(1 photo only — front-only)</span>
                          )}
                        </div>
                      </div>
                      {lot.listing.photos?.[0] && (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <img loading="lazy" decoding="async" src={lot.listing.photos[0]} alt="Front" style={{ width: 72, height: 100, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--plum)' }} />
                          {lot.listing.photos[1] && (
                            <img loading="lazy" decoding="async" src={lot.listing.photos[1]} alt="Back" style={{ width: 72, height: 100, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--plum)' }} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
              <Link href="/fb-auctions" className="btn btn-outline">View all auctions →</Link>
              <button onClick={handleGoLive} disabled={goingLive}
                className="btn btn-primary"
                style={{ background: 'var(--teal)', borderColor: 'var(--teal)', color: 'var(--cream)' }}
                title="Mark this auction as Live (pulls each lot's source card out of your inventory) and return to All Auctions">
                {goingLive ? 'Going live…' : '▶ Go Live'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SingleCardForm({ listings, searchQuery, setSearchQuery, filteredListings, singleListingId, setSingleListingId, singleAuctionTitle, setSingleAuctionTitle, singleBody, setSingleBody, onResetBody, template, minBid, setMinBid }: {
  listings: Listing[];
  searchQuery: string; setSearchQuery: (s: string) => void;
  filteredListings: Listing[];
  singleListingId: string; setSingleListingId: (id: string) => void;
  singleAuctionTitle: string; setSingleAuctionTitle: (s: string) => void;
  singleBody: string; setSingleBody: (s: string) => void;
  onResetBody: () => void;
  template: Template | undefined;
  minBid: string; setMinBid: (s: string) => void;
}) {
  const selected = listings.find(l => l.id === singleListingId);

  return (
    <>
      <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>2. Pick a Listing</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
            flex: 1, minWidth: 240, maxWidth: 420,
          }}>
            <span style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 700 }}>🔍</span>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search active listings — multi-term"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)' }} />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', border: 'none', color: 'var(--plum)', cursor: 'pointer', fontSize: 14 }}>×</button>
            )}
          </div>
        </div>

        {filteredListings.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
            {listings.length === 0 ? 'You have no active listings. Create one first.' : 'No listings match your search.'}
          </div>
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--plum)', color: 'var(--mustard)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: 36 }}></th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: 64 }}>Photo</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Listing</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', width: 100 }}>Asking</th>
                </tr>
              </thead>
              <tbody>
                {filteredListings.map(l => {
                  const isSel = singleListingId === l.id;
                  return (
                    <tr key={l.id} onClick={() => setSingleListingId(l.id)}
                      style={{ borderTop: '1px solid var(--rule)', cursor: 'pointer', background: isSel ? 'rgba(184,146,58,0.18)' : 'transparent' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="radio" name="single-listing" checked={isSel} readOnly style={{ accentColor: 'var(--plum)' }} />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {l.photos && l.photos[0]
                          ? <img loading="lazy" decoding="async" src={l.photos[0]} alt="" style={{ width: 40, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--plum)' }} />
                          : <span style={{ fontSize: 9, color: 'var(--ink-mute)' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--plum)' }}>
                        <div style={{ fontWeight: 600 }}>{l.title}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
                          {l.year} {l.brand} #{l.card_number} {conditionNote(l) ? '· ' + conditionNote(l) : ''}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13, color: 'var(--orange)', fontWeight: 700 }}>
                        {l.asking_price !== null && l.asking_price !== undefined ? `$${l.asking_price}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 14 }}>3. Edit Post Body</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
              <div>
                <label className="input-label">Auction Title (internal label, also used as the auction record name) *</label>
                <input value={singleAuctionTitle} onChange={e => setSingleAuctionTitle(e.target.value)}
                  placeholder="1968 Topps Roberto Clemente #150" className="input-sc" style={{ width: '100%' }} />
              </div>
              <div>
                <label className="input-label">Minimum Bid (optional)</label>
                <input type="text" inputMode="decimal" value={minBid} onChange={e => setMinBid(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="e.g. 1" className="input-sc" style={{ width: '100%' }} />
                <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 3, fontStyle: 'italic' }}>
                  If your template uses <span className="mono">{'{starting_bid}'}</span>, this fills it. Leave blank to type SB manually in the body below.
                </div>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="input-label" style={{ marginBottom: 0 }}>Post Body — auto-filled, edit before generating</label>
                <button type="button" onClick={onResetBody} className="btn btn-ghost btn-sm">↺ Reset from template</button>
              </div>
              <textarea value={singleBody} onChange={e => setSingleBody(e.target.value)}
                rows={8}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px',
                  fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--plum)',
                  background: 'var(--paper)', resize: 'vertical',
                }} />
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4, fontStyle: 'italic' }}>
                The auction info from the template will be appended below this when you generate.
              </div>
            </div>
            {template?.post_footer && (
              <div>
                <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 4 }}>Auction info (from template, appended automatically)</div>
                <pre style={{
                  background: 'var(--paper)', border: '1px dashed var(--rule)', borderRadius: 6,
                  padding: '8px 10px', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--ink-soft)',
                  whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: 0,
                }}>{template.post_footer}</pre>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function MultiCardForm({ multiTitle, setMultiTitle, multiDescription, setMultiDescription, listings, searchQuery, setSearchQuery, filteredListings, selectedIds, toggleSelect, minBid, setMinBid }: {
  multiTitle: string; setMultiTitle: (s: string) => void;
  multiDescription: string; setMultiDescription: (s: string) => void;
  listings: Listing[];
  searchQuery: string; setSearchQuery: (s: string) => void;
  filteredListings: Listing[];
  selectedIds: string[]; toggleSelect: (id: string) => void;
  minBid: string; setMinBid: (s: string) => void;
}) {
  return (
    <>
      <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
        <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 14 }}>2. Parent Post Title & Description</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
            <div>
              <label className="input-label">Auction Title * (typed fresh each auction)</label>
              <input value={multiTitle} onChange={e => setMultiTitle(e.target.value)}
                placeholder="🌟 1971 Topps Mixed HOFers Auction 🌟" className="input-sc" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="input-label">Minimum Bid (optional, applies to all lots)</label>
              <input type="text" inputMode="decimal" value={minBid} onChange={e => setMinBid(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 1" className="input-sc" style={{ width: '100%' }} />
              <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 3, fontStyle: 'italic' }}>
                If set, every lot&apos;s <span className="mono">{'{starting_bid}'}</span> uses this. Leave blank to use each card&apos;s asking price.
              </div>
            </div>
          </div>
          <div>
            <label className="input-label">Description (above the auction info on your post)</label>
            <textarea value={multiDescription} onChange={e => setMultiDescription(e.target.value)}
              rows={5} placeholder="Carew · Yaz · Brooks · Marichal · Bid under each card in the comments. Photos front and back."
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px',
                fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)',
                background: 'var(--paper)', resize: 'vertical',
              }} />
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4, fontStyle: 'italic' }}>
              The auction info from the template will be appended below this when you generate.
            </div>
          </div>
        </div>
      </section>

      <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
          <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>3. Pick Listings ({selectedIds.length} selected)</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
            flex: 1, minWidth: 240, maxWidth: 420,
          }}>
            <span style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 700 }}>🔍</span>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search active listings — multi-term"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)' }} />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', border: 'none', color: 'var(--plum)', cursor: 'pointer', fontSize: 14 }}>×</button>
            )}
          </div>
        </div>

        {filteredListings.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
            {listings.length === 0 ? 'You have no active listings. Create one first.' : 'No listings match your search.'}
          </div>
        ) : (
          <div style={{ maxHeight: 480, overflowY: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--plum)', color: 'var(--mustard)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: 36 }}></th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: 64 }}>Lot</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: 64 }}>Photo</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Listing</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', width: 100 }}>Asking</th>
                </tr>
              </thead>
              <tbody>
                {filteredListings.map(l => {
                  const lotIdx = selectedIds.indexOf(l.id);
                  const isSel = lotIdx !== -1;
                  return (
                    <tr key={l.id} onClick={() => toggleSelect(l.id)}
                      style={{ borderTop: '1px solid var(--rule)', cursor: 'pointer', background: isSel ? 'rgba(184,146,58,0.18)' : 'transparent' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleSelect(l.id)} style={{ accentColor: 'var(--plum)' }} />
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--plum)', fontWeight: 700 }}>
                        {isSel ? `#${lotIdx + 1}` : ''}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {l.photos && l.photos[0]
                          ? <img loading="lazy" decoding="async" src={l.photos[0]} alt="" style={{ width: 40, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--plum)' }} />
                          : <span style={{ fontSize: 9, color: 'var(--ink-mute)' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--plum)' }}>
                        <div style={{ fontWeight: 600 }}>{l.title}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
                          {l.year} {l.brand} #{l.card_number} {conditionNote(l) ? '· ' + conditionNote(l) : ''}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13, color: 'var(--orange)', fontWeight: 700 }}>
                        {l.asking_price !== null && l.asking_price !== undefined ? `$${l.asking_price}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Header() {
  return (
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
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ New FB Auction ★</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/fb-auctions" className="btn btn-ghost btn-sm">All Auctions</Link>
          <Link href="/fb-auctions/templates" className="btn btn-ghost btn-sm">Templates</Link>
          <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
          <Link href="/sales-metrics" className="btn btn-ghost btn-sm">📊 Metrics</Link>
          <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
        </div>
      </div>
    </header>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="panel-bordered" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 8 }}>{label}</div>
      <pre style={{
        background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
        padding: '12px 14px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--plum)',
        whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: '0 0 8px',
      }}>{text}</pre>
      <CopyButton text={text} label="📋 Copy" />
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

function BidderSuggestionsPanel({ suggestions }: { suggestions: BidderSuggestion[] }) {
  const tagAllText = suggestions
    .map(s => s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name)
    .join(' ');
  return (
    <section className="panel-bordered" style={{
      padding: '18px 22px', marginTop: 24,
      background: 'rgba(56,142,142,0.06)', border: '1.5px solid var(--teal)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>★ Suggested past bidders ★</div>
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
          Based on past bids on similar player / brand-year matches.
        </span>
        <div style={{ flex: 1 }} />
        <CopyButton text={tagAllText} label={`📋 Copy all ${suggestions.length} tag${suggestions.length === 1 ? '' : 's'}`} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {suggestions.map(s => {
          const tag = s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name;
          return (
            <div key={s.bidder.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', background: 'var(--paper)',
              border: '1.5px solid var(--teal)', borderRadius: 100,
              fontSize: 12, color: 'var(--plum)',
            }}>
              <span style={{ fontWeight: 700 }}>{s.bidder.name}</span>
              {s.bidder.fb_handle && <span className="mono" style={{ fontSize: 10.5, color: 'var(--teal)' }}>@{s.bidder.fb_handle}</span>}
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                {s.matchCount} match{s.matchCount === 1 ? '' : 'es'}{s.wonCount > 0 ? ` · ${s.wonCount} won` : ''}
              </span>
              <CopyButton text={tag} label="📋" />
            </div>
          );
        })}
      </div>
    </section>
  );
}

const BG_PRESETS = [
  { color: '#ffffff', label: 'White' },
  { color: '#000000', label: 'Black' },
  { color: '#f8ecd0', label: 'Cream' },
  { color: '#3d1f4a', label: 'Plum' },
  { color: '#2d7a6e', label: 'Teal' },
  { color: '#e8742c', label: 'Orange' },
];

function BgColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bg</span>
      {BG_PRESETS.map(p => (
        <button key={p.color} type="button" onClick={() => onChange(p.color)} title={p.label}
          aria-label={`Background ${p.label}`}
          style={{
            width: 22, height: 22, borderRadius: '50%', cursor: 'pointer',
            background: p.color,
            border: value.toLowerCase() === p.color.toLowerCase() ? '2.5px solid var(--orange)' : '1.5px solid var(--plum)',
          }} />
      ))}
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        title="Custom color"
        style={{ width: 22, height: 22, padding: 0, border: '1.5px solid var(--plum)', borderRadius: '50%', cursor: 'pointer', background: 'transparent' }} />
    </div>
  );
}
