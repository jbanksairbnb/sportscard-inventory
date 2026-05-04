'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Bidder = {
  id: string;
  name: string;
  fb_handle: string | null;
  notes: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

type ListingRef = {
  id: string;
  title: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
};

type LotRow = {
  id: string;
  auction_id: string;
  lot_number: number;
  current_bid: number | null;
  bidder_name: string | null;
  bidder_fb_handle: string | null;
  bidder_id: string | null;
  listing_id: string | null;
  status: 'open' | 'sold' | 'no_sale' | 'paid';
};

type AuctionRef = {
  id: string;
  title: string | null;
  status: string | null;
};

type ActivityItem = {
  lotId: string;
  auctionId: string;
  auctionTitle: string | null;
  bid: number | null;
  status: LotRow['status'];
  isWinner: boolean;
  isPaid: boolean;
  listing: ListingRef | null;
};

type ClaimItemRow = {
  id: string;
  lot_id: string;
  position: number;
  listing_id: string | null;
  price: number | null;
  claim_buyer_id: string | null;
  claim_buyer_name: string | null;
  claim_status: 'open' | 'claimed' | 'sold' | 'paid';
};

type ClaimLotRow = { id: string; sale_id: string; lot_number: number };
type ClaimSaleRef = { id: string; title: string | null; status: string | null };

type ClaimActivityItem = {
  itemId: string;
  saleId: string;
  saleTitle: string | null;
  lotNumber: number | null;
  price: number | null;
  claimStatus: ClaimItemRow['claim_status'];
  isPaid: boolean;
  listing: ListingRef | null;
};

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function activityLabel(item: ActivityItem): string {
  const r = item.listing;
  if (!r) return '(card details missing)';
  const parts = [
    r.year ? String(r.year) : '',
    r.brand || '',
    r.card_number ? `#${r.card_number}` : '',
    r.player || '',
  ].filter(Boolean);
  return parts.join(' ').trim() || r.title || '(card details missing)';
}

function fullAddress(b: Bidder): string {
  const parts = [
    b.address_line1,
    b.address_line2,
    [b.city, b.state, b.postal_code].filter(Boolean).join(', '),
    b.country,
  ].filter(Boolean) as string[];
  return parts.join('\n');
}

export default function BidderProfilePage() {
  const router = useRouter();
  const params = useParams();
  const bidderId = String(params?.id || '');

  const [loading, setLoading] = useState(true);
  const [bidder, setBidder] = useState<Bidder | null>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [claimItems, setClaimItems] = useState<ClaimActivityItem[]>([]);
  const [edit, setEdit] = useState({
    name: '', fb_handle: '', email: '', phone: '',
    address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const bRes = await supabase.from('fb_bidders')
        .select('id, name, fb_handle, notes, email, phone, address_line1, address_line2, city, state, postal_code, country')
        .eq('id', bidderId).eq('user_id', user.id).maybeSingle();
      if (!bRes.data) { router.push('/fb-auctions/bidders'); return; }
      const b = bRes.data as Bidder;
      setBidder(b);
      setEdit({
        name: b.name || '',
        fb_handle: b.fb_handle || '',
        email: b.email || '',
        phone: b.phone || '',
        address_line1: b.address_line1 || '',
        address_line2: b.address_line2 || '',
        city: b.city || '',
        state: b.state || '',
        postal_code: b.postal_code || '',
        country: b.country || '',
        notes: b.notes || '',
      });

      // Pull every lot tied to this bidder (by bidder_id OR by typed name fallback).
      const { data: byIdLots, error: lotErr } = await supabase
        .from('fb_auction_lots')
        .select('id, auction_id, lot_number, current_bid, bidder_name, bidder_fb_handle, bidder_id, listing_id, status')
        .eq('user_id', user.id)
        .eq('bidder_id', bidderId);
      if (lotErr) console.warn('[bidder-profile] lot lookup error:', lotErr.message);

      const lots = (byIdLots || []) as LotRow[];
      const seen = new Set(lots.map(l => l.id));
      const nameMatch = b.name.trim();
      if (nameMatch) {
        const { data: byNameLots } = await supabase
          .from('fb_auction_lots')
          .select('id, auction_id, lot_number, current_bid, bidder_name, bidder_fb_handle, bidder_id, listing_id, status')
          .eq('user_id', user.id)
          .ilike('bidder_name', nameMatch);
        for (const l of ((byNameLots || []) as LotRow[])) {
          if (!seen.has(l.id) && (!l.bidder_id || l.bidder_id === bidderId)) {
            lots.push(l);
            seen.add(l.id);
          }
        }
      }

      // Resolve auction titles + listing details.
      const auctionIds = Array.from(new Set(lots.map(l => l.auction_id).filter(Boolean)));
      const listingIds = Array.from(new Set(lots.map(l => l.listing_id).filter(Boolean) as string[]));
      const [aucRes, lstRes] = await Promise.all([
        auctionIds.length > 0
          ? supabase.from('fb_auctions').select('id, title, status').in('id', auctionIds)
          : Promise.resolve({ data: [] as AuctionRef[] }),
        listingIds.length > 0
          ? supabase.from('listings').select('id, title, year, brand, card_number, player').in('id', listingIds)
          : Promise.resolve({ data: [] as ListingRef[] }),
      ]);
      const auctionsById = new Map((aucRes.data || []).map((a: AuctionRef) => [a.id, a]));
      const listingsById = new Map((lstRes.data || []).map((l: ListingRef) => [l.id, l]));

      const activityItems: ActivityItem[] = lots.map(l => {
        const a = auctionsById.get(l.auction_id);
        return {
          lotId: l.id,
          auctionId: l.auction_id,
          auctionTitle: a?.title || null,
          bid: l.current_bid,
          status: l.status,
          isWinner: l.status === 'sold' || l.status === 'paid',
          isPaid: l.status === 'paid',
          listing: l.listing_id ? listingsById.get(l.listing_id) || null : null,
        };
      });

      // Sort: winners first, then by bid amount desc
      activityItems.sort((a, b1) => {
        if (a.isWinner !== b1.isWinner) return a.isWinner ? -1 : 1;
        return (b1.bid ?? 0) - (a.bid ?? 0);
      });
      setItems(activityItems);

      // Pull claim sale items for this buyer (by id OR fallback by typed name).
      const { data: byIdClaims } = await supabase
        .from('fb_claim_sale_items')
        .select('id, lot_id, position, listing_id, price, claim_buyer_id, claim_buyer_name, claim_status')
        .eq('user_id', user.id)
        .eq('claim_buyer_id', bidderId);
      const claims = (byIdClaims || []) as ClaimItemRow[];
      const seenClaim = new Set(claims.map(c => c.id));
      if (nameMatch) {
        const { data: byNameClaims } = await supabase
          .from('fb_claim_sale_items')
          .select('id, lot_id, position, listing_id, price, claim_buyer_id, claim_buyer_name, claim_status')
          .eq('user_id', user.id)
          .ilike('claim_buyer_name', nameMatch);
        for (const c of ((byNameClaims || []) as ClaimItemRow[])) {
          if (!seenClaim.has(c.id) && (!c.claim_buyer_id || c.claim_buyer_id === bidderId)) {
            claims.push(c);
            seenClaim.add(c.id);
          }
        }
      }
      const claimLotIds = Array.from(new Set(claims.map(c => c.lot_id).filter(Boolean)));
      const claimListingIds = Array.from(new Set(claims.map(c => c.listing_id).filter(Boolean) as string[]));
      const [claimLotRes, claimSaleListingRes] = await Promise.all([
        claimLotIds.length > 0
          ? supabase.from('fb_claim_sale_lots').select('id, sale_id, lot_number').in('id', claimLotIds)
          : Promise.resolve({ data: [] as ClaimLotRow[] }),
        claimListingIds.length > 0
          ? supabase.from('listings').select('id, title, year, brand, card_number, player').in('id', claimListingIds)
          : Promise.resolve({ data: [] as ListingRef[] }),
      ]);
      const claimLotsById = new Map(((claimLotRes.data || []) as ClaimLotRow[]).map(l => [l.id, l]));
      const claimListingsById = new Map(((claimSaleListingRes.data || []) as ListingRef[]).map(l => [l.id, l]));
      const saleIds = Array.from(new Set(((claimLotRes.data || []) as ClaimLotRow[]).map(l => l.sale_id)));
      const { data: claimSaleRows } = saleIds.length > 0
        ? await supabase.from('fb_claim_sales').select('id, title, status').in('id', saleIds)
        : { data: [] };
      const claimSalesById = new Map(((claimSaleRows || []) as ClaimSaleRef[]).map(s => [s.id, s]));

      const claimActivityItems: ClaimActivityItem[] = claims.map(c => {
        const lot = claimLotsById.get(c.lot_id);
        const sale = lot ? claimSalesById.get(lot.sale_id) : undefined;
        return {
          itemId: c.id,
          saleId: lot?.sale_id || '',
          saleTitle: sale?.title || null,
          lotNumber: lot?.lot_number ?? null,
          price: c.price,
          claimStatus: c.claim_status,
          isPaid: c.claim_status === 'paid',
          listing: c.listing_id ? claimListingsById.get(c.listing_id) || null : null,
        };
      });
      claimActivityItems.sort((a, b1) => {
        const order = { paid: 0, sold: 1, claimed: 2, open: 3 } as const;
        const oa = order[a.claimStatus];
        const ob = order[b1.claimStatus];
        if (oa !== ob) return oa - ob;
        return (b1.price ?? 0) - (a.price ?? 0);
      });
      setClaimItems(claimActivityItems);

      setLoading(false);
    }
    load();
  }, [bidderId, router]);

  const stats = useMemo(() => {
    let bidCount = 0, wonCount = 0, paidCount = 0, totalSpend = 0;
    for (const i of items) {
      bidCount += 1;
      if (i.isWinner) wonCount += 1;
      if (i.isPaid) {
        paidCount += 1;
        if (i.bid) totalSpend += i.bid;
      }
    }
    let claimCount = 0;
    for (const c of claimItems) {
      if (c.claimStatus === 'claimed' || c.claimStatus === 'sold' || c.claimStatus === 'paid') claimCount += 1;
      if (c.isPaid) {
        paidCount += 1;
        if (c.price) totalSpend += c.price;
      }
    }
    return { bidCount, wonCount, paidCount, totalSpend, claimCount };
  }, [items, claimItems]);

  async function saveProfile() {
    if (!bidder) return;
    setSaving(true);
    const supabase = createClient();
    const payload: Record<string, string | null> = {
      name: edit.name.trim(),
      fb_handle: edit.fb_handle.trim() || null,
      email: edit.email.trim() || null,
      phone: edit.phone.trim() || null,
      address_line1: edit.address_line1.trim() || null,
      address_line2: edit.address_line2.trim() || null,
      city: edit.city.trim() || null,
      state: edit.state.trim() || null,
      postal_code: edit.postal_code.trim() || null,
      country: edit.country.trim() || null,
      notes: edit.notes.trim() || null,
    };
    const { error } = await supabase.from('fb_bidders').update({
      ...payload,
      updated_at: new Date().toISOString(),
    }).eq('id', bidder.id);
    setSaving(false);
    if (error) { alert(error.message); return; }
    setBidder({ ...bidder, ...payload } as Bidder);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  async function deleteBidder() {
    if (!bidder) return;
    if (!confirm(`Delete bidder "${bidder.name}"? Their bid history will not be deleted, but the link from lots to this profile will be removed.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('fb_bidders').delete().eq('id', bidder.id);
    if (error) { alert(error.message); return; }
    router.push('/fb-auctions/bidders');
  }

  async function copyAddress() {
    if (!bidder) return;
    const text = fullAddress(bidder);
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch {}
  }

  if (loading || !bidder) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  const winning = items.filter(i => i.isWinner);
  const losing = items.filter(i => !i.isWinner);

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Bidder Profile ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">← All Bidders</Link>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">FB Auctions</Link>
            <Link href="/sales-metrics" className="btn btn-ghost btn-sm">📊 Metrics</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 18, alignItems: 'start' }}>
          <div>
            <section className="panel-bordered" style={{ padding: '18px 22px', marginBottom: 16 }}>
              <div className="display" style={{ fontSize: 24, color: 'var(--plum)', marginBottom: 4 }}>{bidder.name}</div>
              {bidder.fb_handle && (
                <div className="mono" style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>@{bidder.fb_handle}</div>
              )}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: 'var(--ink-soft)' }}>
                {bidder.email && <span>✉ <a href={`mailto:${bidder.email}`} style={{ color: 'var(--teal)', fontWeight: 600 }}>{bidder.email}</a></span>}
                {bidder.phone && <span>☎ {bidder.phone}</span>}
                {fullAddress(bidder) && (
                  <button onClick={copyAddress} className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}>📋 Copy mailing address</button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 14 }}>
                <Stat label="Bids" value={String(stats.bidCount)} />
                <Stat label="Won" value={String(stats.wonCount)} />
                <Stat label="Claims" value={String(stats.claimCount)} />
                <Stat label="Paid" value={String(stats.paidCount)} />
                <Stat label="$ Spent" value={fmtMoney(stats.totalSpend)} accent />
              </div>
            </section>

            {winning.length > 0 && (
              <section className="panel-bordered" style={{ padding: '18px 22px', marginBottom: 16 }}>
                <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>🏆 Won ({winning.length})</div>
                <ActivityList items={winning} />
              </section>
            )}

            {claimItems.length > 0 && (
              <section className="panel-bordered" style={{ padding: '18px 22px', marginBottom: 16 }}>
                <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>🎯 Claims ({claimItems.length})</div>
                <ClaimActivityList items={claimItems} />
              </section>
            )}

            <section className="panel-bordered" style={{ padding: '18px 22px' }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>
                {winning.length > 0 ? `Other bids (${losing.length})` : `Bid activity (${items.length})`}
              </div>
              {items.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                  No bid activity yet. Activity is tracked when this name is entered as a high bidder on a live auction.
                </div>
              ) : (
                <ActivityList items={winning.length > 0 ? losing : items} />
              )}
            </section>
          </div>

          <section className="panel-bordered" style={{ padding: '18px 22px', position: 'sticky', top: 80 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>Edit profile</div>
              {savedFlash && <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>✓ Saved</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Name" value={edit.name} onChange={v => setEdit(s => ({ ...s, name: v }))} />
              <Field label="FB handle" value={edit.fb_handle} onChange={v => setEdit(s => ({ ...s, fb_handle: v }))} placeholder="facebook.handle" />
              <Field label="Email" value={edit.email} onChange={v => setEdit(s => ({ ...s, email: v }))} placeholder="name@example.com" />
              <Field label="Phone" value={edit.phone} onChange={v => setEdit(s => ({ ...s, phone: v }))} placeholder="(555) 123-4567" />
              <div style={{ marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--rule)' }}>
                <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', marginBottom: 6 }}>Mailing address</div>
                <Field label="Street" value={edit.address_line1} onChange={v => setEdit(s => ({ ...s, address_line1: v }))} placeholder="123 Main St" />
                <Field label="Apt / Unit" value={edit.address_line2} onChange={v => setEdit(s => ({ ...s, address_line2: v }))} placeholder="Apt 4B" />
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 6 }}>
                  <Field label="City" value={edit.city} onChange={v => setEdit(s => ({ ...s, city: v }))} />
                  <Field label="State" value={edit.state} onChange={v => setEdit(s => ({ ...s, state: v }))} placeholder="CA" />
                  <Field label="ZIP" value={edit.postal_code} onChange={v => setEdit(s => ({ ...s, postal_code: v }))} />
                </div>
                <Field label="Country" value={edit.country} onChange={v => setEdit(s => ({ ...s, country: v }))} placeholder="USA" />
              </div>
              <div style={{ marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--rule)' }}>
                <label className="input-label">Notes</label>
                <textarea value={edit.notes} onChange={e => setEdit(s => ({ ...s, notes: e.target.value }))} rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', background: 'var(--paper)', resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveProfile} disabled={saving} className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={deleteBidder} className="btn btn-ghost btn-sm" style={{ color: 'var(--rust)', border: '1.5px solid var(--rust)' }}>
                  Delete
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="input-sc" style={{ width: '100%' }} />
    </div>
  );
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => (
        <div key={item.lotId} style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 90px 90px',
          gap: 10, padding: '8px 10px', alignItems: 'center',
          background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6,
        }}>
          <div style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activityLabel(item)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Link href={`/fb-auctions/${item.auctionId}`} style={{ color: 'var(--teal)', textDecoration: 'underline', fontWeight: 600 }}>
              {item.auctionTitle || 'View auction'}
            </Link>
          </div>
          <div style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, textAlign: 'right' }}>
            {fmtMoney(item.bid)}
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {item.isWinner && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100, background: 'var(--teal)', color: 'var(--cream)', textTransform: 'uppercase' }}>WON</span>}
            {item.isPaid && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100, background: 'var(--plum)', color: 'var(--cream)', textTransform: 'uppercase' }}>PAID</span>}
            {!item.isWinner && !item.isPaid && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-mute)' }}>BID</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ClaimActivityList({ items }: { items: ClaimActivityItem[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => {
        const r = item.listing;
        const cardLabel = r
          ? [r.year ? String(r.year) : '', r.brand || '', r.card_number ? `#${r.card_number}` : '', r.player || '']
              .filter(Boolean).join(' ').trim()
          : '(card details missing)';
        return (
          <div key={item.itemId} style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 90px 90px',
            gap: 10, padding: '8px 10px', alignItems: 'center',
            background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6,
          }}>
            <div style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cardLabel || r?.title || '(card)'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.saleId ? (
                <Link href={`/fb-claim-sales/${item.saleId}`} style={{ color: 'var(--teal)', textDecoration: 'underline', fontWeight: 600 }}>
                  {item.saleTitle || 'View claim sale'}{item.lotNumber ? ` · Lot ${item.lotNumber}` : ''}
                </Link>
              ) : (item.saleTitle || '—')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, textAlign: 'right' }}>
              {fmtMoney(item.price)}
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {item.isPaid && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100, background: 'var(--plum)', color: 'var(--cream)', textTransform: 'uppercase' }}>PAID</span>}
              {!item.isPaid && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100, background: 'var(--teal)', color: 'var(--cream)', textTransform: 'uppercase' }}>
                  {item.claimStatus.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ padding: '8px 10px', background: 'var(--paper)', borderRadius: 6, border: '1px solid var(--rule)', textAlign: 'center' }}>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 2 }}>{label}</div>
      <div className="display" style={{ fontSize: 18, color: accent ? 'var(--orange)' : 'var(--plum)', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
