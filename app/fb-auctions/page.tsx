'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type AuctionRow = {
  id: string;
  title: string;
  status: 'draft' | 'live' | 'ended' | 'settled';
  post_url: string | null;
  ends_at: string | null;
  created_at: string;
  lot_count: number;
};

const STATUS_FILTERS = ['all', 'draft', 'live', 'ended', 'settled'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

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

export default function FbAuctionsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data } = await supabase
        .from('fb_auctions')
        .select('id, title, status, post_url, ends_at, created_at, fb_auction_lots(count)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      const rows: AuctionRow[] = (data || []).map((a: { id: string; title: string; status: 'draft' | 'live' | 'ended' | 'settled'; post_url: string | null; ends_at: string | null; created_at: string; fb_auction_lots: { count: number }[] }) => ({
        id: a.id, title: a.title, status: a.status,
        post_url: a.post_url, ends_at: a.ends_at, created_at: a.created_at,
        lot_count: a.fb_auction_lots?.[0]?.count || 0,
      }));
      setAuctions(rows);
      setLoading(false);
    }
    load();
  }, [router]);

  const filtered = filter === 'all' ? auctions : auctions.filter(a => a.status === filter);
  const counts: Record<string, number> = { draft: 0, live: 0, ended: 0, settled: 0 };
  auctions.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

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
            <Link href="/fb-auctions/templates" className="btn btn-ghost btn-sm">Templates</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Click <strong>+ New Auction</strong>, pick the listings you want to auction, choose a template + group, and click <strong>Generate</strong>.</li>
            <li>You&apos;ll get ready-to-paste Facebook post text and per-lot comment text + a downloadable side-by-side image (front + back) for each card.</li>
            <li>Paste the post into your Facebook group, attach the cover image, then post each lot as a comment with its image.</li>
            <li>Drop the post URL into the auction&apos;s manage page to track current high bids per lot during the 24-hour bidding window.</li>
            <li>When the auction ends, <strong>Settle</strong> it — the app generates a Messenger-ready combined invoice for each winning bidder.</li>
          </ol>
        </section>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>
                ({f === 'all' ? auctions.length : (counts[f] || 0)})
              </span>
            </button>
          ))}
        </div>

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
            {filtered.map(a => (
              <Link key={a.id} href={`/fb-auctions/${a.id}`} className="panel-bordered" style={{
                padding: '16px 20px', textDecoration: 'none', color: 'inherit',
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div className="display" style={{ fontSize: 17, color: 'var(--plum)' }}>{a.title}</div>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                      background: statusBg(a.status), color: statusFg(a.status), textTransform: 'uppercase',
                    }}>
                      {a.status}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
                    {a.lot_count} lot{a.lot_count === 1 ? '' : 's'} · created {new Date(a.created_at).toLocaleDateString()}
                    {a.ends_at && ` · ends ${new Date(a.ends_at).toLocaleString()}`}
                  </div>
                  {a.post_url && (
                    <div className="mono" style={{ fontSize: 11, color: 'var(--teal)', marginTop: 2 }}>
                      🔗 Post URL set
                    </div>
                  )}
                </div>
                <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Manage →</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
