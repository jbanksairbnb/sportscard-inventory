'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { applyOwnedTransition } from '@/lib/inventory';
import { replaceImageBg } from '@/lib/collageBg';
import { setListingsStatus } from '@/lib/listingStatusSync';
import SCLogo from '@/components/SCLogo';

type Status = 'draft' | 'live' | 'closed' | 'settled';
type ClaimStatus = 'open' | 'claimed' | 'sold' | 'paid';

type Sale = {
  id: string;
  user_id: string;
  title: string;
  status: Status;
  post_url: string | null;
  post_body: string | null;
  payment_text: string | null;
  shipping_text: string | null;
  default_shipping_cost: number | null;
  created_at: string;
};

type ListingLite = {
  id: string;
  title: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  photos: string[] | null;
  source_set_slug: string | null;
  source_card_number: string | null;
};

type Item = {
  id: string;
  lot_id: string;
  position: number;
  listing_id: string | null;
  price: number | null;
  claim_buyer_id: string | null;
  claim_buyer_name: string | null;
  claim_status: ClaimStatus;
  notes: string | null;
  listing: ListingLite | null;
};

type Lot = {
  id: string;
  lot_number: number;
  kind: 'single' | 'group';
  comment_body: string | null;
  comment_url: string | null;
  collage_url: string | null;
  back_collage_url: string | null;
  group_price: number | null;
  notes: string | null;
};

type BidderRow = { id: string; name: string; fb_handle: string | null; member_user_id: string | null };

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}
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
function saleStatusLabel(s: Status): string {
  if (s === 'draft') return 'Draft';
  if (s === 'live') return 'Open';
  if (s === 'closed') return 'Claimed';
  if (s === 'settled') return 'Paid';
  return s;
}
function deriveSaleStatus(current: Status, items: { claim_status: ClaimStatus }[]): Status {
  if (current === 'draft') return 'draft';
  if (items.length === 0) return current;
  if (items.some(i => i.claim_status === 'open')) return 'live';
  if (items.every(i => i.claim_status === 'paid')) return 'settled';
  return 'closed';
}
async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

async function downloadJpeg(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

async function buildSideBySideSingle(item: ListingLite, bgColor: string = '#ffffff'): Promise<Blob | null> {
  const frontUrl = item.photos?.[0];
  const backUrl = item.photos?.[1] || null;
  if (!frontUrl) return null;
  try {
    const front = await loadImage(frontUrl);
    const back = backUrl ? await loadImage(backUrl).catch(() => null) : null;
    const frontSrc = replaceImageBg(front, bgColor);
    const backSrc = back ? replaceImageBg(back, bgColor) : null;
    const fw = frontSrc.width, fh = frontSrc.height;
    const bw = backSrc?.width || 0, bh = backSrc?.height || 0;
    const gap = backSrc ? 60 : 0;
    const outer = 120;
    const innerW = fw + (backSrc ? bw + gap : 0);
    const innerH = Math.max(fh, bh);
    const canvas = document.createElement('canvas');
    canvas.width = innerW + outer * 2;
    canvas.height = innerH + outer * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frontSrc, outer, outer + (innerH - fh) / 2);
    if (backSrc) ctx.drawImage(backSrc, outer + fw + gap, outer + (innerH - bh) / 2);
    return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.95));
  } catch {
    return null;
  }
}

// Composite all of one side (front or back) onto a single canvas, tightly
// packed. 600x840 cells (standard card aspect) with 8px padding.
async function buildSideCollage(items: ListingLite[], side: 'front' | 'back', bgColor: string = '#ffffff'): Promise<Blob | null> {
  if (items.length === 0) return null;
  const photoIdx = side === 'front' ? 0 : 1;
  const processed: HTMLCanvasElement[] = [];
  for (const item of items) {
    const url = item.photos?.[photoIdx];
    if (!url) continue;
    try {
      const img = await loadImage(url);
      processed.push(replaceImageBg(img, bgColor));
    } catch { /* skip */ }
  }
  if (processed.length === 0) return null;
  let cols = 1;
  if (processed.length === 2) cols = 2;
  else if (processed.length <= 4) cols = 2;
  else if (processed.length <= 9) cols = 3;
  else cols = 4;
  const rows = Math.ceil(processed.length / cols);
  const pad = 24;
  const outer = pad * 2;

  const targetH = Math.max(...processed.map(p => p.height));
  const scaled = processed.map(p => {
    const ratio = targetH / p.height;
    return { src: p, w: Math.round(p.width * ratio), h: targetH };
  });
  const rowWidths: number[] = [];
  for (let r = 0; r < rows; r++) {
    const start = r * cols;
    const items = scaled.slice(start, start + cols);
    rowWidths.push(items.reduce((s, it) => s + it.w, 0) + (items.length - 1) * pad);
  }
  const innerW = Math.max(...rowWidths);
  const innerH = rows * targetH + (rows - 1) * pad;

  const canvas = document.createElement('canvas');
  canvas.width = innerW + outer * 2;
  canvas.height = innerH + outer * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < rows; r++) {
    const start = r * cols;
    const items = scaled.slice(start, start + cols);
    let x = outer + Math.round((innerW - rowWidths[r]) / 2);
    const y = outer + r * (targetH + pad);
    for (const it of items) {
      ctx.drawImage(it.src, x, y, it.w, it.h);
      x += it.w + pad;
    }
  }
  return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.92));
}

export default function ManageClaimSalePage() {
  const router = useRouter();
  const params = useParams();
  const saleId = String(params?.id || '');

  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sale, setSale] = useState<Sale | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [bidders, setBidders] = useState<BidderRow[]>([]);
  const [savingItems, setSavingItems] = useState<Set<string>>(new Set());
  const [savingLots, setSavingLots] = useState<Set<string>>(new Set());
  const [buildingCollage, setBuildingCollage] = useState<string | null>(null);
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

  async function buildLotCollages(lot: Lot) {
    const items = (itemsByLot[lot.id] || []).map(i => i.listing).filter((l): l is ListingLite => !!l && (l.photos?.length ?? 0) > 0);
    if (items.length === 0) { alert('No items in this lot have photos.'); return; }
    setBuildingCollage(lot.id);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert('Not signed in.'); return; }
      const stamp = Date.now();
      const tag = Math.random().toString(36).slice(2, 8);

      if (items.length === 1) {
        const blob = await buildSideBySideSingle(items[0], collageBg);
        if (!blob) { alert('Could not build image — front photo missing or failed to load.'); return; }
        const path = `${user.id}/lot-collages/${stamp}-${tag}-combined.jpg`;
        const { error: upErr } = await supabase.storage.from('card-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (upErr) { alert('Upload failed: ' + upErr.message); return; }
        const url = supabase.storage.from('card-images').getPublicUrl(path).data.publicUrl;
        const patch = { collage_url: url, back_collage_url: null };
        const { error } = await supabase.from('fb_claim_sale_lots').update(patch).eq('id', lot.id);
        if (error) { alert('Save failed: ' + error.message); return; }
        setLots(prev => prev.map(l => l.id === lot.id ? { ...l, ...patch } as Lot : l));
        return;
      }

      async function uploadSide(side: 'front' | 'back'): Promise<string | null> {
        const blob = await buildSideCollage(items, side, collageBg);
        if (!blob) return null;
        const path = `${user!.id}/lot-collages/${stamp}-${tag}-${side}.jpg`;
        const { error } = await supabase.storage.from('card-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (error) { console.warn(`upload ${side} collage failed:`, error.message); return null; }
        return supabase.storage.from('card-images').getPublicUrl(path).data.publicUrl;
      }
      const [frontUrl, backUrl] = await Promise.all([uploadSide('front'), uploadSide('back')]);
      if (!frontUrl && !backUrl) { alert('Could not build collages — none of the items had usable photos.'); return; }
      const patch: { collage_url?: string; back_collage_url?: string } = {};
      if (frontUrl) patch.collage_url = frontUrl;
      if (backUrl) patch.back_collage_url = backUrl;
      const { error } = await supabase.from('fb_claim_sale_lots').update(patch).eq('id', lot.id);
      if (error) { alert('Save failed: ' + error.message); return; }
      setLots(prev => prev.map(l => l.id === lot.id ? { ...l, ...patch } as Lot : l));
    } finally {
      setBuildingCollage(null);
    }
  }
  async function clearLotCollage(lot: Lot, side: 'front' | 'back') {
    const supabase = createClient();
    const patch = side === 'front' ? { collage_url: null } : { back_collage_url: null };
    const { error } = await supabase.from('fb_claim_sale_lots').update(patch).eq('id', lot.id);
    if (error) { alert('Clear failed: ' + error.message); return; }
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, ...patch } as Lot : l));
  }
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [expandedBuyers, setExpandedBuyers] = useState<Set<string>>(new Set());
  const [editedInvoices, setEditedInvoices] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const [saleRes, lotsRes, itemsRes, biddersRes] = await Promise.all([
        supabase.from('fb_claim_sales').select('*').eq('id', saleId).eq('user_id', user.id).maybeSingle(),
        supabase.from('fb_claim_sale_lots').select('*').eq('sale_id', saleId).order('lot_number'),
        supabase.from('fb_claim_sale_items')
          .select('*, listing:listings(id, title, year, brand, card_number, player, photos, source_set_slug, source_card_number)')
          .eq('user_id', user.id),
        supabase.from('fb_bidders').select('id, name, fb_handle, member_user_id').eq('user_id', user.id).order('name'),
      ]);
      if (!saleRes.data) { router.push('/fb-claim-sales'); return; }
      setSale(saleRes.data as Sale);
      const lotList = (lotsRes.data || []) as Lot[];
      setLots(lotList);
      const lotIds = new Set(lotList.map(l => l.id));
      setItems(((itemsRes.data || []) as Item[]).filter(i => lotIds.has(i.lot_id)));
      setBidders((biddersRes.data || []) as BidderRow[]);
      setLoading(false);
    }
    load();
  }, [saleId, router]);

  const itemsByLot = useMemo(() => {
    const m: Record<string, Item[]> = {};
    for (const it of items) (m[it.lot_id] ??= []).push(it);
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.position - b.position);
    return m;
  }, [items]);

  const biddersByLowerName = useMemo(() => {
    const m = new Map<string, BidderRow[]>();
    for (const b of bidders) {
      const k = b.name.toLowerCase();
      const arr = m.get(k) || [];
      arr.push(b);
      m.set(k, arr);
    }
    return m;
  }, [bidders]);

  async function ensureBidder(name: string): Promise<BidderRow | null> {
    if (!userId) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const matches = biddersByLowerName.get(trimmed.toLowerCase()) || [];
    if (matches[0]) return matches[0];
    const supabase = createClient();
    const { data, error } = await supabase
      .from('fb_bidders')
      .insert({ user_id: userId, name: trimmed })
      .select('id, name, fb_handle, member_user_id')
      .single();
    if (error || !data) return null;
    const b = data as BidderRow;
    setBidders(prev => [...prev, b].sort((a, b) => a.name.localeCompare(b.name)));
    return b;
  }

  async function setItemBuyer(item: Item, name: string) {
    setSavingItems(prev => new Set(prev).add(item.id));
    const supabase = createClient();
    let buyerId: string | null = null;
    let buyerName: string | null = name.trim() || null;
    if (buyerName) {
      const b = await ensureBidder(buyerName);
      buyerId = b?.id || null;
      if (b) buyerName = b.name;
    }
    const claim_status: ClaimStatus = buyerName ? 'claimed' : 'open';
    const { error } = await supabase.from('fb_claim_sale_items')
      .update({ claim_buyer_id: buyerId, claim_buyer_name: buyerName, claim_status })
      .eq('id', item.id);
    if (!error) {
      setItems(prev => prev.map(i => i.id === item.id
        ? { ...i, claim_buyer_id: buyerId, claim_buyer_name: buyerName, claim_status }
        : i));
      await syncItemListing(supabase, item, claim_status);
      await syncSaleStatusAfter([{ id: item.id, claim_status }]);
    } else {
      alert(error.message);
    }
    setSavingItems(prev => { const n = new Set(prev); n.delete(item.id); return n; });
  }

  async function setItemStatus(item: Item, claim_status: ClaimStatus) {
    const supabase = createClient();
    const { error } = await supabase.from('fb_claim_sale_items').update({ claim_status }).eq('id', item.id);
    if (!error) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, claim_status } : i));
      await syncItemListing(supabase, item, claim_status);
      await syncSaleStatusAfter([{ id: item.id, claim_status }]);
    } else alert(error.message);
  }

  async function setBuyerStatus(buyerItems: Item[], claim_status: ClaimStatus) {
    if (buyerItems.length === 0) return;
    const supabase = createClient();
    const ids = buyerItems.map(i => i.id);
    const { error } = await supabase.from('fb_claim_sale_items').update({ claim_status }).in('id', ids);
    if (error) { alert(error.message); return; }
    const idSet = new Set(ids);
    setItems(prev => prev.map(i => idSet.has(i.id) ? { ...i, claim_status } : i));
    if (userId) {
      const lockIds = buyerItems
        .filter(i => i.claim_status === 'open' && claim_status !== 'open' && i.listing?.id)
        .map(i => i.listing!.id);
      const unlockIds = buyerItems
        .filter(i => i.claim_status !== 'open' && claim_status === 'open' && i.listing?.id)
        .map(i => i.listing!.id);
      if (lockIds.length > 0) await setListingsStatus(supabase, userId, lockIds, 'sold', 'active');
      if (unlockIds.length > 0) await setListingsStatus(supabase, userId, unlockIds, 'active', 'sold');
    }
    await syncSaleStatusAfter(ids.map(id => ({ id, claim_status })));
  }

  // Lock or unlock the listing in My Listings based on claim transitions.
  async function syncItemListing(supabase: ReturnType<typeof createClient>, item: Item, nextStatus: ClaimStatus) {
    if (!userId || !item.listing?.id) return;
    if (item.claim_status === nextStatus) return;
    if (item.claim_status === 'open' && nextStatus !== 'open') {
      await setListingsStatus(supabase, userId, [item.listing.id], 'sold', 'active');
    } else if (item.claim_status !== 'open' && nextStatus === 'open') {
      await setListingsStatus(supabase, userId, [item.listing.id], 'active', 'sold');
    }
  }

  // Apply pending item-status updates to an in-memory copy of items, then
  // recompute the parent sale's status. If it changed, persist it.
  async function syncSaleStatusAfter(pending: { id: string; claim_status: ClaimStatus }[]) {
    if (!sale || sale.status === 'draft') return;
    const pendingMap = new Map(pending.map(p => [p.id, p.claim_status]));
    const projected = items.map(i => pendingMap.has(i.id) ? { ...i, claim_status: pendingMap.get(i.id)! } : i);
    const next = deriveSaleStatus(sale.status, projected);
    if (next === sale.status) return;
    const supabase = createClient();
    const { error } = await supabase.from('fb_claim_sales').update({ status: next, updated_at: new Date().toISOString() }).eq('id', sale.id);
    if (error) { console.warn('[sale status auto-advance] failed:', error.message); return; }
    setSale(prev => prev ? { ...prev, status: next } : prev);
  }

  async function setLotCommentUrl(lot: Lot, url: string) {
    setSavingLots(prev => new Set(prev).add(lot.id));
    const supabase = createClient();
    const trimmed = url.trim() || null;
    await supabase.from('fb_claim_sale_lots').update({ comment_url: trimmed }).eq('id', lot.id);
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, comment_url: trimmed } : l));
    setSavingLots(prev => { const n = new Set(prev); n.delete(lot.id); return n; });
  }

  async function markInventory(targetItems: Item[], owned: boolean) {
    if (!userId) return;
    const supabase = createClient();
    const bySet = new Map<string, Set<string>>();
    for (const it of targetItems) {
      const slug = it.listing?.source_set_slug;
      const card = it.listing?.source_card_number;
      if (!slug || !card) continue;
      const set = bySet.get(slug) || new Set<string>();
      set.add(card);
      bySet.set(slug, set);
    }
    for (const [slug, cards] of bySet.entries()) {
      const { data: setRow } = await supabase
        .from('sets').select('rows').eq('user_id', userId).eq('slug', slug).maybeSingle();
      if (!setRow) continue;
      const rows = Array.isArray(setRow.rows) ? setRow.rows as Record<string, unknown>[] : [];
      const { nextRows, touched, ownedCount } = applyOwnedTransition(rows, cards, owned);
      if (!touched) continue;
      const ownedPct = nextRows.length > 0 ? (ownedCount / nextRows.length) * 100 : 0;
      await supabase.from('sets').update({
        rows: nextRows, owned_count: ownedCount, owned_pct: ownedPct, updated_at: Date.now(),
      }).eq('user_id', userId).eq('slug', slug);
    }
  }

  async function setStatus(s: Status) {
    if (!sale) return;
    const prev = sale.status;
    const supabase = createClient();
    const { error } = await supabase.from('fb_claim_sales').update({ status: s, updated_at: new Date().toISOString() }).eq('id', sale.id);
    if (error) { alert(error.message); return; }
    setSale({ ...sale, status: s });
    if (prev !== 'live' && s === 'live') {
      // All items go out of inventory.
      await markInventory(items, false);
    } else if (prev === 'live' && (s === 'draft')) {
      // Reverting to draft — restore everything that wasn't already sold/paid.
      await markInventory(items.filter(i => i.claim_status === 'open' || i.claim_status === 'claimed'), true);
    }
  }

  async function setPostUrl(url: string) {
    if (!sale) return;
    const supabase = createClient();
    const trimmed = url.trim() || null;
    await supabase.from('fb_claim_sales').update({ post_url: trimmed }).eq('id', sale.id);
    setSale({ ...sale, post_url: trimmed });
  }

  // Group items by buyer for invoice display.
  const buyers = useMemo(() => {
    const groups = new Map<string, { id: string | null; name: string; items: Item[] }>();
    for (const it of items) {
      if (!it.claim_buyer_name) continue;
      const key = it.claim_buyer_id || `name:${it.claim_buyer_name}`;
      const grp = groups.get(key) || { id: it.claim_buyer_id, name: it.claim_buyer_name, items: [] };
      grp.items.push(it);
      groups.set(key, grp);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  function buildBuyerInvoice(buyer: { name: string; items: Item[] }): string {
    if (!sale) return '';
    const ship = sale.default_shipping_cost ?? 0;
    const lines: string[] = [
      `Hi ${buyer.name} — invoice for ${sale.title}:`,
      '',
    ];
    let subtotal = 0;
    for (const it of buyer.items.slice().sort((a, b) => {
      const lotA = lots.find(l => l.id === a.lot_id)?.lot_number ?? 0;
      const lotB = lots.find(l => l.id === b.lot_id)?.lot_number ?? 0;
      return lotA - lotB || a.position - b.position;
    })) {
      const cardLabel = it.listing
        ? `${it.listing.year || ''} ${it.listing.brand || ''} #${it.listing.card_number || ''} ${it.listing.player || ''}`.trim()
        : 'Card';
      const price = it.price ?? 0;
      subtotal += price;
      lines.push(`· ${cardLabel} — ${fmtMoney(price)}`);
    }
    lines.push('');
    lines.push(`Subtotal: ${fmtMoney(subtotal)}`);
    lines.push(`Shipping: ${fmtMoney(ship)}`);
    lines.push(`Total: ${fmtMoney(subtotal + ship)}`);
    if (sale.payment_text?.trim()) {
      lines.push('');
      lines.push(sale.payment_text.trim());
    }
    return lines.join('\n');
  }

  async function copyTag(text: string, tag: string) {
    const ok = await copyText(text);
    if (ok) { setCopiedTag(tag); setTimeout(() => setCopiedTag(prev => prev === tag ? null : prev), 1600); }
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  if (!sale) return null;

  const totalList = items.reduce((s, i) => s + (i.price || 0), 0);
  const totalClaimed = items.filter(i => i.claim_status !== 'open').reduce((s, i) => s + (i.price || 0), 0);

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Manage Claim Sale ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {buyers.length > 0 && (
              <button type="button"
                onClick={() => document.getElementById('buyer-invoices')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="btn btn-primary btn-sm">
                🧾 Invoices ({buyers.length})
              </button>
            )}
            <Link href="/fb-claim-sales" className="btn btn-ghost btn-sm">All Claim Sales</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/sales-metrics" className="btn btn-ghost btn-sm">📊 Metrics</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <datalist id="fb-buyers-list">
        {bidders.map(b => <option key={b.id} value={b.name}>{b.fb_handle ? `@${b.fb_handle}` : ''}</option>)}
      </datalist>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px' }}>
        {/* Summary + Status */}
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1 }}>{sale.title}</div>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              background: statusBg(sale.status), color: statusFg(sale.status),
              padding: '3px 10px', borderRadius: 100, textTransform: 'uppercase',
            }}>{saleStatusLabel(sale.status)}</span>
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 6 }}>
            {lots.length} lot{lots.length === 1 ? '' : 's'} · {items.length} item{items.length === 1 ? '' : 's'} · List value {fmtMoney(totalList)} · Claimed {fmtMoney(totalClaimed)}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['draft', 'live', 'closed', 'settled'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`btn btn-sm ${sale.status === s ? 'btn-primary' : 'btn-ghost'}`}>
                {saleStatusLabel(s)}
              </button>
            ))}
          </div>
        </section>

        {/* Parent post URL + body */}
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>Parent FB Post</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input defaultValue={sale.post_url || ''} onBlur={e => setPostUrl(e.target.value)}
              placeholder="Paste FB post URL — saves on blur"
              className="input-sc" style={{ flex: 1 }} />
            {sale.post_url && <a href={sale.post_url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">Open ↗</a>}
          </div>
          <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 }}>Post body (paste this into FB)</div>
          <textarea value={sale.post_body || ''} readOnly rows={Math.max(6, (sale.post_body || '').split('\n').length + 1)}
            className="input-sc" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--paper)' }} />
          <div style={{ marginTop: 8 }}>
            <button onClick={() => copyTag(sale.post_body || '', 'post')} className="btn btn-outline btn-sm">
              {copiedTag === 'post' ? '✓ Copied' : '📋 Copy post body'}
            </button>
          </div>
        </section>

        {/* Lots + items */}
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 12 }}>Lots & Claims</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {lots.map(lot => {
              const lotItems = itemsByLot[lot.id] || [];
              return (
                <div key={lot.id} className="panel" style={{ padding: 14, border: '1.5px solid var(--rule)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{
                      width: 36, height: 36, background: 'var(--plum)', color: 'var(--mustard)',
                      display: 'grid', placeItems: 'center', borderRadius: 8,
                      fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
                    }}>#{lot.lot_number}</div>
                    <div className="display" style={{ fontSize: 13, color: 'var(--plum)' }}>
                      {lot.kind === 'single' ? 'Single card' : `Group · ${lotItems.length}`}
                      {lot.group_price ? ` · group price ${fmtMoney(lot.group_price)}` : ''}
                    </div>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => copyTag(lot.comment_body || '', `lot:${lot.id}`)} className="btn btn-ghost btn-sm">
                      {copiedTag === `lot:${lot.id}` ? '✓ Copied' : '📋 Copy comment text'}
                    </button>
                  </div>

                  {/* Comment URL */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                    <input defaultValue={lot.comment_url || ''}
                      onBlur={e => setLotCommentUrl(lot, e.target.value)}
                      placeholder="Paste FB comment URL for this lot"
                      className="input-sc" style={{ flex: 1, fontSize: 12 }} />
                    {savingLots.has(lot.id) && <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>saving…</span>}
                    {lot.comment_url && <a href={lot.comment_url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">↗</a>}
                  </div>

                  {/* Comment body preview */}
                  {lot.comment_body && (
                    <pre style={{
                      background: 'var(--paper)', border: '1.5px dashed var(--rule)',
                      borderRadius: 6, padding: 8, fontSize: 11.5, color: 'var(--ink-soft)',
                      whiteSpace: 'pre-wrap', margin: '0 0 10px',
                    }}>{lot.comment_body}</pre>
                  )}

                  {/* Collage section */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', padding: '8px 0', marginBottom: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700 }}>Collages</div>
                      <button type="button" disabled={buildingCollage === lot.id}
                        onClick={() => buildLotCollages(lot)}
                        className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
                        {buildingCollage === lot.id ? 'Building…' : '🖼 Auto-build front + back'}
                      </button>
                      <BgColorPicker value={collageBg} onChange={updateCollageBg} />
                    </div>
                    {(['front', 'back'] as const).map(side => {
                      const url = side === 'front' ? lot.collage_url : lot.back_collage_url;
                      if (!url) return null;
                      const isSingleCombined = lotItems.length === 1 && side === 'front' && !lot.back_collage_url;
                      const label = isSingleCombined ? 'Front + Back' : (side === 'front' ? 'Fronts' : 'Backs');
                      const fileTag = isSingleCombined ? 'front-back' : (side === 'front' ? 'fronts' : 'backs');
                      const filename = `lot-${lot.lot_number}-${fileTag}.jpg`;
                      const thumbWidth = isSingleCombined ? 220 : 160;
                      return (
                        <div key={side} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 700, textTransform: 'uppercase' }}>
                            {label}
                          </div>
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'block', width: thumbWidth, height: 110, background: 'var(--paper)', borderRadius: 6, border: '1.5px solid var(--rule)', overflow: 'hidden' }}>
                            <img src={url} alt={`${label} collage`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          </a>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button type="button" onClick={() => downloadJpeg(url, filename)}
                              className="btn btn-primary btn-sm" style={{ fontSize: 10.5, padding: '3px 8px' }}>⬇ Download</button>
                            <button type="button" onClick={() => clearLotCollage(lot, side)}
                              className="btn btn-ghost btn-sm" style={{ fontSize: 10.5, padding: '3px 8px' }}>✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Item rows */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {lotItems.map(it => {
                      const photo = it.listing?.photos?.[0];
                      const cardLabel = it.listing
                        ? `${it.listing.year || ''} ${it.listing.brand || ''} #${it.listing.card_number || ''} ${it.listing.player || ''}`.trim()
                        : 'Listing missing';
                      return (
                        <div key={it.id} style={{
                          display: 'flex', gap: 10, alignItems: 'center',
                          padding: 8, background: 'var(--cream)', borderRadius: 6,
                          border: it.claim_status === 'open' ? '1.5px dashed var(--rule)' : '1.5px solid var(--teal)',
                        }}>
                          {lot.kind === 'group' && (
                            <div style={{
                              width: 24, height: 24, background: 'var(--mustard)', color: 'var(--plum)',
                              display: 'grid', placeItems: 'center', borderRadius: 4,
                              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, flexShrink: 0,
                            }}>{it.position}</div>
                          )}
                          {photo && <img src={photo} alt="" style={{ width: 30, height: 42, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="display" style={{ fontSize: 12.5, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cardLabel}</div>
                            <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{fmtMoney(it.price)}</div>
                          </div>
                          <input
                            list="fb-buyers-list"
                            defaultValue={it.claim_buyer_name || ''}
                            placeholder="Buyer name…"
                            onBlur={e => {
                              const v = e.target.value;
                              if ((v.trim() || null) !== (it.claim_buyer_name || null)) setItemBuyer(it, v);
                            }}
                            className="input-sc" style={{ width: 160, fontSize: 12 }} />
                          <select value={it.claim_status === 'sold' ? 'claimed' : it.claim_status}
                            onChange={e => setItemStatus(it, e.target.value as ClaimStatus)}
                            className="input-sc" style={{ width: 100, fontSize: 11.5 }}>
                            <option value="open">Open</option>
                            <option value="claimed">Claimed</option>
                            <option value="paid">Paid</option>
                          </select>
                          {savingItems.has(it.id) && <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>…</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Per-buyer invoices */}
        {buyers.length > 0 && (
          <section id="buyer-invoices" className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18, scrollMarginTop: 80 }}>
            <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 12 }}>
              Buyer Invoices ({buyers.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {buyers.map(b => {
                const subtotal = b.items.reduce((s, i) => s + (i.price || 0), 0);
                const shipping = sale.default_shipping_cost ?? 0;
                const total = subtotal + shipping;
                const buyerKey = b.id || `name:${b.name}`;
                const tag = `inv:${buyerKey}`;
                const isOpen = expandedBuyers.has(buyerKey);
                const generated = buildBuyerInvoice(b);
                const messageText = editedInvoices[buyerKey] ?? generated;
                const isEdited = editedInvoices[buyerKey] !== undefined && editedInvoices[buyerKey] !== generated;
                const sortedItems = b.items.slice().sort((x, y) => {
                  const lx = lots.find(l => l.id === x.lot_id)?.lot_number ?? 0;
                  const ly = lots.find(l => l.id === y.lot_id)?.lot_number ?? 0;
                  return lx - ly || x.position - y.position;
                });
                return (
                  <div key={tag} className="panel" style={{ padding: 14, border: '1.5px solid var(--rule)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => setExpandedBuyers(prev => {
                        const next = new Set(prev);
                        if (next.has(buyerKey)) next.delete(buyerKey); else next.add(buyerKey);
                        return next;
                      })} aria-label={isOpen ? 'Collapse' : 'Expand'}
                        style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 14, color: 'var(--plum)', padding: '2px 6px' }}>
                        {isOpen ? '▼' : '▶'}
                      </button>
                      <div className="display" style={{ fontSize: 14, color: 'var(--plum)', flex: 1 }}>{b.name}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{b.items.length} item{b.items.length === 1 ? '' : 's'}</div>
                      <div className="stat-num" style={{ fontSize: 18, color: 'var(--orange)' }}>{fmtMoney(total)}</div>
                      <button onClick={() => copyTag(messageText, tag)} className="btn btn-outline btn-sm">
                        {copiedTag === tag ? '✓ Copied' : '📋 Copy invoice'}
                      </button>
                      {b.items.every(i => i.claim_status === 'paid') ? (
                        <span className="mono" style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', background: 'var(--teal)', color: 'var(--cream)', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.08em' }}>✓ Paid</span>
                      ) : (
                        <button type="button"
                          onClick={() => {
                            if (!confirm(`Mark all ${b.items.length} item${b.items.length === 1 ? '' : 's'} for ${b.name} as paid?`)) return;
                            setBuyerStatus(b.items, 'paid');
                          }}
                          className="btn btn-primary btn-sm">
                          ✓ Mark all paid
                        </button>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                      Subtotal {fmtMoney(subtotal)} + Shipping {fmtMoney(shipping)}
                    </div>
                    {isOpen && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--rule)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                          <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>Items</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {sortedItems.map(it => {
                              const lot = lots.find(l => l.id === it.lot_id);
                              const cardLabel = it.listing
                                ? `${it.listing.year || ''} ${it.listing.brand || ''} #${it.listing.card_number || ''} ${it.listing.player || ''}`.trim()
                                : 'Card';
                              return (
                                <div key={it.id} style={{
                                  display: 'grid', gridTemplateColumns: '90px 1fr 80px',
                                  gap: 8, alignItems: 'center', padding: '4px 8px',
                                  background: 'var(--paper)', borderRadius: 4, fontSize: 12, color: 'var(--plum)',
                                }}>
                                  <div className="mono" style={{ fontWeight: 700 }}>
                                    Lot #{lot?.lot_number || '?'}{lot?.kind === 'group' ? ` · ${it.position}` : ''}
                                  </div>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cardLabel}</div>
                                  <div className="mono" style={{ textAlign: 'right', color: 'var(--orange)', fontWeight: 700 }}>{fmtMoney(it.price ?? 0)}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Messenger Invoice</div>
                            {isEdited && (
                              <>
                                <span className="mono" style={{ fontSize: 10, color: 'var(--rust)', fontWeight: 700 }}>EDITED</span>
                                <button type="button" onClick={() => setEditedInvoices(prev => {
                                  const next = { ...prev }; delete next[buyerKey]; return next;
                                })} className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}>
                                  ↺ Reset to template
                                </button>
                              </>
                            )}
                          </div>
                          <textarea
                            value={messageText}
                            onChange={e => setEditedInvoices(prev => ({ ...prev, [buyerKey]: e.target.value }))}
                            rows={Math.min(20, Math.max(6, messageText.split('\n').length))}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              border: '1.5px solid var(--plum)', borderRadius: 6, padding: '10px 12px',
                              fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--plum)',
                              background: 'var(--paper)', resize: 'vertical',
                            }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bg</span>
      {BG_PRESETS.map(p => (
        <button key={p.color} type="button" onClick={() => onChange(p.color)} title={p.label}
          aria-label={`Background ${p.label}`}
          style={{
            width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', padding: 0,
            background: p.color,
            border: value.toLowerCase() === p.color.toLowerCase() ? '2.5px solid var(--orange)' : '1.5px solid var(--plum)',
          }} />
      ))}
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        title="Custom color"
        style={{ width: 18, height: 18, padding: 0, border: '1.5px solid var(--plum)', borderRadius: '50%', cursor: 'pointer', background: 'transparent' }} />
    </div>
  );
}
