'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type BidderRow = {
  id: string;
  name: string;
  fb_handle: string | null;
  notes: string | null;
};

type ActivityRow = {
  bidder_id: string;
  is_winner: boolean;
  is_paid: boolean;
  bid_amount: number | null;
};

type BidderStats = BidderRow & {
  bidCount: number;
  wonCount: number;
  paidCount: number;
  totalSpend: number;
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

export default function BiddersListPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [bidders, setBidders] = useState<BidderRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'spend' | 'won'>('spend');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const [bRes, aRes] = await Promise.all([
        supabase.from('fb_bidders').select('id, name, fb_handle, notes').eq('user_id', user.id).order('name'),
        supabase.from('fb_bidder_activity').select('bidder_id, is_winner, is_paid, bid_amount').eq('user_id', user.id),
      ]);
      setBidders((bRes.data || []) as BidderRow[]);
      setActivity((aRes.data || []) as ActivityRow[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const stats: BidderStats[] = useMemo(() => {
    const byBidder = new Map<string, { bidCount: number; wonCount: number; paidCount: number; totalSpend: number }>();
    for (const a of activity) {
      const e = byBidder.get(a.bidder_id) || { bidCount: 0, wonCount: 0, paidCount: 0, totalSpend: 0 };
      e.bidCount += 1;
      if (a.is_winner) e.wonCount += 1;
      if (a.is_paid) {
        e.paidCount += 1;
        if (a.bid_amount) e.totalSpend += a.bid_amount;
      }
      byBidder.set(a.bidder_id, e);
    }
    return bidders.map(b => ({
      ...b,
      ...(byBidder.get(b.id) || { bidCount: 0, wonCount: 0, paidCount: 0, totalSpend: 0 }),
    }));
  }, [bidders, activity]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = q
      ? stats.filter(s => s.name.toLowerCase().includes(q) || (s.fb_handle || '').toLowerCase().includes(q))
      : stats.slice();
    arr.sort((a, b) => {
      if (sort === 'spend') return b.totalSpend - a.totalSpend;
      if (sort === 'won') return b.wonCount - a.wonCount;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [stats, search, sort]);

  // Group bidders by lower(name) to spot dupes
  const dupeGroups = useMemo(() => {
    const map = new Map<string, BidderStats[]>();
    for (const s of stats) {
      const k = s.name.toLowerCase();
      const arr = map.get(k) || [];
      arr.push(s);
      map.set(k, arr);
    }
    return Array.from(map.entries()).filter(([, arr]) => arr.length > 1);
  }, [stats]);

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Bidders ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">← FB Auctions</Link>
            <Link href="/home" className="btn btn-outline btn-sm">Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search bidders…"
            className="input-sc" style={{ flex: 1, minWidth: 240, maxWidth: 360, fontSize: 13 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            {(['spend', 'won', 'name'] as const).map(opt => (
              <button key={opt} onClick={() => setSort(opt)}
                className={sort === opt ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}>
                Sort: {opt === 'spend' ? '$ spent' : opt === 'won' ? '# won' : 'A→Z'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {bidders.length} bidder{bidders.length === 1 ? '' : 's'}
          </span>
        </section>

        {dupeGroups.length > 0 && (
          <section className="panel-bordered" style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(184,146,58,0.12)', border: '1.5px solid var(--mustard)' }}>
            <div className="eyebrow" style={{ fontSize: 11, color: 'var(--mustard)', marginBottom: 6 }}>⚠ Possible duplicates</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {dupeGroups.map(([name, arr]) => (
                <div key={name} style={{ marginBottom: 4 }}>
                  <strong>{arr[0].name}</strong> — {arr.length} entries: {arr.map(s => s.fb_handle ? `@${s.fb_handle}` : '(no handle)').join(', ')}
                </div>
              ))}
            </div>
          </section>
        )}

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>
              {bidders.length === 0 ? 'No bidders yet' : 'No bidders match.'}
            </div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
              {bidders.length === 0
                ? 'Bidders are created automatically when you enter a name as high bidder on a lot.'
                : 'Try a different search.'}
            </p>
          </div>
        ) : (
          <div className="panel-bordered" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Name</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>FB Handle</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Bids</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Won</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Paid</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>$ Spent</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} onClick={() => router.push(`/fb-auctions/bidders/${s.id}`)}
                    style={{ borderTop: '1px solid var(--rule)', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 14px', fontSize: 13.5, color: 'var(--plum)', fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--teal)' }} className="mono">
                      {s.fb_handle ? `@${s.fb_handle}` : <span style={{ color: 'var(--ink-mute)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--plum)' }}>{s.bidCount}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--plum)' }}>{s.wonCount}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--plum)' }}>{s.paidCount}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--orange)', fontWeight: 700 }}>
                      {s.totalSpend > 0 ? fmtMoney(s.totalSpend) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
