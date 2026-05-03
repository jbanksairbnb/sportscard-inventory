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

type ActivityRow = {
  id: string;
  auction_id: string;
  lot_id: string;
  bid_amount: number | null;
  is_winner: boolean;
  is_paid: boolean;
  listing_year: number | null;
  listing_brand: string | null;
  listing_player: string | null;
  listing_card_number: string | null;
  created_at: string;
  updated_at: string;
  fb_auctions?: { title: string | null; status: string | null } | null;
  // Resolved client-side via lot_id → fb_auction_lots.listing_id → listings:
  resolved?: ListingRef | null;
};

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function activityLabel(a: ActivityRow): string {
  const r = a.resolved;
  const year = r?.year ?? a.listing_year;
  const brand = r?.brand ?? a.listing_brand;
  const num = r?.card_number ?? a.listing_card_number;
  const player = r?.player ?? a.listing_player;
  const parts = [
    year ? String(year) : '',
    brand || '',
    num ? `#${num}` : '',
    player || '',
  ].filter(Boolean);
  const label = parts.join(' ').trim();
  if (label) return label;
  if (r?.title) return r.title;
  return '(card details missing)';
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
  const [activity, setActivity] = useState<ActivityRow[]>([]);
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
      const [bRes, aRes] = await Promise.all([
        supabase.from('fb_bidders')
          .select('id, name, fb_handle, notes, email, phone, address_line1, address_line2, city, state, postal_code, country')
          .eq('id', bidderId).eq('user_id', user.id).maybeSingle(),
        supabase.from('fb_bidder_activity')
          .select('id, auction_id, lot_id, bid_amount, is_winner, is_paid, listing_year, listing_brand, listing_player, listing_card_number, created_at, updated_at, fb_auctions(title, status)')
          .eq('user_id', user.id).eq('bidder_id', bidderId)
          .order('updated_at', { ascending: false }),
      ]);
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

      // Walk the FK chain to resolve listing details for each activity row,
      // so labels render even if the activity snapshot fields are null.
      let acts = ((aRes.data || []) as unknown) as ActivityRow[];
      const lotIds = Array.from(new Set(acts.map(a => a.lot_id).filter(Boolean)));
      if (lotIds.length > 0) {
        const { data: lotRows } = await supabase
          .from('fb_auction_lots')
          .select('id, listing_id')
          .in('id', lotIds);
        const lotToListingId = new Map<string, string>();
        for (const lot of (lotRows || []) as { id: string; listing_id: string | null }[]) {
          if (lot.listing_id) lotToListingId.set(lot.id, lot.listing_id);
        }
        const listingIds = Array.from(new Set(Array.from(lotToListingId.values())));
        let listingsById = new Map<string, ListingRef>();
        if (listingIds.length > 0) {
          const { data: listingRows } = await supabase
            .from('listings')
            .select('id, title, year, brand, card_number, player')
            .in('id', listingIds);
          listingsById = new Map(((listingRows || []) as ListingRef[]).map(r => [r.id, r]));
        }
        acts = acts.map(a => {
          const lid = lotToListingId.get(a.lot_id);
          return { ...a, resolved: lid ? listingsById.get(lid) || null : null };
        });
      }
      setActivity(acts);
      setLoading(false);
    }
    load();
  }, [bidderId, router]);

  const stats = useMemo(() => {
    let bidCount = 0, wonCount = 0, paidCount = 0, totalSpend = 0;
    for (const a of activity) {
      bidCount += 1;
      if (a.is_winner) wonCount += 1;
      if (a.is_paid) {
        paidCount += 1;
        if (a.bid_amount) totalSpend += a.bid_amount;
      }
    }
    return { bidCount, wonCount, paidCount, totalSpend };
  }, [activity]);

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
    if (!confirm(`Delete bidder "${bidder.name}"? Their activity rows will also be removed. Lots will keep the typed name but lose the link.`)) return;
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

  const winningActivity = activity.filter(a => a.is_winner);
  const losingActivity = activity.filter(a => !a.is_winner);

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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
                <Stat label="Bids" value={String(stats.bidCount)} />
                <Stat label="Won" value={String(stats.wonCount)} />
                <Stat label="Paid" value={String(stats.paidCount)} />
                <Stat label="$ Spent" value={fmtMoney(stats.totalSpend)} accent />
              </div>
            </section>

            {winningActivity.length > 0 && (
              <section className="panel-bordered" style={{ padding: '18px 22px', marginBottom: 16 }}>
                <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>🏆 Won ({winningActivity.length})</div>
                <ActivityList items={winningActivity} />
              </section>
            )}

            <section className="panel-bordered" style={{ padding: '18px 22px' }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>
                {winningActivity.length > 0 ? `Other bids (${losingActivity.length})` : `Bid activity (${activity.length})`}
              </div>
              {activity.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                  No bid activity yet.
                </div>
              ) : (
                <ActivityList items={winningActivity.length > 0 ? losingActivity : activity} />
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
              <Field label="FB handle" value={edit.fb_handle} onChange={v => setEdit(s => ({ ...s, fb_handle: v }))} placeholder="lee.cho.42" />
              <Field label="Email" value={edit.email} onChange={v => setEdit(s => ({ ...s, email: v }))} placeholder="lee@example.com" />
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

function ActivityList({ items }: { items: ActivityRow[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(a => (
        <div key={a.id} style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 90px 90px',
          gap: 10, padding: '8px 10px', alignItems: 'center',
          background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6,
        }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 600 }}>{activityLabel(a)}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
              {new Date(a.updated_at).toLocaleDateString()}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Link href={`/fb-auctions/${a.auction_id}`} style={{ color: 'var(--teal)', textDecoration: 'underline', fontWeight: 600 }}>
              {a.fb_auctions?.title || 'View auction'}
            </Link>
          </div>
          <div style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, textAlign: 'right' }}>
            {fmtMoney(a.bid_amount)}
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {a.is_winner && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100, background: 'var(--teal)', color: 'var(--cream)', textTransform: 'uppercase' }}>WON</span>}
            {a.is_paid && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100, background: 'var(--plum)', color: 'var(--cream)', textTransform: 'uppercase' }}>PAID</span>}
            {!a.is_winner && !a.is_paid && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-mute)' }}>BID</span>}
          </div>
        </div>
      ))}
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
