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
};

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function activityLabel(a: ActivityRow): string {
  const parts = [
    a.listing_year ? String(a.listing_year) : '',
    a.listing_brand || '',
    a.listing_card_number ? `#${a.listing_card_number}` : '',
    a.listing_player || '',
  ].filter(Boolean);
  return parts.join(' ').trim() || '(card details missing)';
}

export default function BidderProfilePage() {
  const router = useRouter();
  const params = useParams();
  const bidderId = String(params?.id || '');

  const [loading, setLoading] = useState(true);
  const [bidder, setBidder] = useState<Bidder | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [editName, setEditName] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const [bRes, aRes] = await Promise.all([
        supabase.from('fb_bidders').select('id, name, fb_handle, notes').eq('id', bidderId).eq('user_id', user.id).maybeSingle(),
        supabase.from('fb_bidder_activity')
          .select('id, auction_id, lot_id, bid_amount, is_winner, is_paid, listing_year, listing_brand, listing_player, listing_card_number, created_at, updated_at, fb_auctions(title, status)')
          .eq('user_id', user.id).eq('bidder_id', bidderId)
          .order('updated_at', { ascending: false }),
      ]);
      if (!bRes.data) { router.push('/fb-auctions/bidders'); return; }
      const b = bRes.data as Bidder;
      setBidder(b);
      setEditName(b.name);
      setEditHandle(b.fb_handle || '');
      setEditNotes(b.notes || '');
      setActivity(((aRes.data || []) as unknown) as ActivityRow[]);
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
    const { error } = await supabase.from('fb_bidders').update({
      name: editName.trim(),
      fb_handle: editHandle.trim() || null,
      notes: editNotes.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', bidder.id);
    setSaving(false);
    if (error) { alert(error.message); return; }
    setBidder({ ...bidder, name: editName.trim(), fb_handle: editHandle.trim() || null, notes: editNotes.trim() || null });
  }

  async function deleteBidder() {
    if (!bidder) return;
    if (!confirm(`Delete bidder "${bidder.name}"? Their activity rows will also be removed. Lots will keep the typed name but lose the link.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('fb_bidders').delete().eq('id', bidder.id);
    if (error) { alert(error.message); return; }
    router.push('/fb-auctions/bidders');
  }

  if (loading || !bidder) {
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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Bidder Profile ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">← All Bidders</Link>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">FB Auctions</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>
          <div>
            <section className="panel-bordered" style={{ padding: '18px 22px', marginBottom: 16 }}>
              <div className="display" style={{ fontSize: 24, color: 'var(--plum)', marginBottom: 4 }}>{bidder.name}</div>
              {bidder.fb_handle && (
                <div className="mono" style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>@{bidder.fb_handle}</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
                <Stat label="Bids" value={String(stats.bidCount)} />
                <Stat label="Won" value={String(stats.wonCount)} />
                <Stat label="Paid" value={String(stats.paidCount)} />
                <Stat label="$ Spent" value={fmtMoney(stats.totalSpend)} accent />
              </div>
            </section>

            <section className="panel-bordered" style={{ padding: '18px 22px' }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>Activity ({activity.length})</div>
              {activity.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                  No bid activity yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activity.map(a => (
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
              )}
            </section>
          </div>

          <section className="panel-bordered" style={{ padding: '18px 22px', position: 'sticky', top: 80 }}>
            <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 12 }}>Edit profile</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="input-label">Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} className="input-sc" style={{ width: '100%' }} />
              </div>
              <div>
                <label className="input-label">FB handle</label>
                <input value={editHandle} onChange={e => setEditHandle(e.target.value)} placeholder="lee.cho.42" className="input-sc" style={{ width: '100%' }} />
              </div>
              <div>
                <label className="input-label">Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={4}
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ padding: '8px 10px', background: 'var(--paper)', borderRadius: 6, border: '1px solid var(--rule)', textAlign: 'center' }}>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 2 }}>{label}</div>
      <div className="display" style={{ fontSize: 18, color: accent ? 'var(--orange)' : 'var(--plum)', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
