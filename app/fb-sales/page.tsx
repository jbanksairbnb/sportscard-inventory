'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Kind = 'auction' | 'claim';
type Status = 'draft' | 'live' | 'closed' | 'settled';

type Entry = {
  id: string;
  kind: Kind;
  title: string;
  status: Status;       // unified label space across both tables
  rawStatus: string;    // original DB value
  postUrl: string | null;
  createdAt: string;
  endsAt: string | null;
  itemCount: number;
  claimedCount: number;
  listValue: number;
};

type FilterKind = 'all' | Kind;
type FilterStatus = 'all' | Status;

const KIND_FILTERS: { id: FilterKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'auction', label: 'Auctions' },
  { id: 'claim', label: 'Claim Sales' },
];
const STATUS_FILTERS: { id: FilterStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'live', label: 'Live' },
  { id: 'closed', label: 'Sold' },        // both auction "ended" and claim sale "closed" map here
  { id: 'settled', label: 'Settled' },
];

// Normalize each table's status into the same set so the filter works for both.
function unifyStatus(kind: Kind, raw: string): Status {
  if (raw === 'ended') return 'closed';   // auctions: "ended" === "Sold" in our UI
  if (raw === 'draft' || raw === 'live' || raw === 'closed' || raw === 'settled') return raw;
  return 'draft';
}
function statusLabel(s: Status) {
  if (s === 'closed') return 'Sold';
  return s.charAt(0).toUpperCase() + s.slice(1);
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
function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}
function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (d < 1) return 'today';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function FbSalesPage() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kindFilter, setKindFilter] = useState<FilterKind>('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [aucRes, lotRes, claimRes, claimLotRes, claimItemRes] = await Promise.all([
        supabase.from('fb_auctions')
          .select('id, title, status, post_url, ends_at, created_at')
          .eq('user_id', user.id),
        supabase.from('fb_auction_lots')
          .select('id, auction_id, current_bid, starting_bid, status')
          .eq('user_id', user.id),
        supabase.from('fb_claim_sales')
          .select('id, title, status, post_url, ends_at, created_at')
          .eq('user_id', user.id),
        supabase.from('fb_claim_sale_lots')
          .select('id, sale_id')
          .eq('user_id', user.id),
        supabase.from('fb_claim_sale_items')
          .select('id, lot_id, price, claim_status')
          .eq('user_id', user.id),
      ]);

      const aucLotsBy = new Map<string, { current_bid: number | null; starting_bid: number | null; status: string }[]>();
      for (const l of (lotRes.data || []) as { auction_id: string; current_bid: number | null; starting_bid: number | null; status: string }[]) {
        const arr = aucLotsBy.get(l.auction_id) || [];
        arr.push(l);
        aucLotsBy.set(l.auction_id, arr);
      }

      const claimLotToSale = new Map<string, string>();
      for (const l of (claimLotRes.data || []) as { id: string; sale_id: string }[]) {
        claimLotToSale.set(l.id, l.sale_id);
      }
      const claimItemsBy = new Map<string, { price: number | null; claim_status: string }[]>();
      for (const it of (claimItemRes.data || []) as { lot_id: string; price: number | null; claim_status: string }[]) {
        const sid = claimLotToSale.get(it.lot_id);
        if (!sid) continue;
        const arr = claimItemsBy.get(sid) || [];
        arr.push(it);
        claimItemsBy.set(sid, arr);
      }

      const out: Entry[] = [];
      for (const a of (aucRes.data || []) as { id: string; title: string; status: string; post_url: string | null; ends_at: string | null; created_at: string }[]) {
        const lots = aucLotsBy.get(a.id) || [];
        const claimed = lots.filter(l => l.status === 'sold' || l.status === 'paid').length;
        const list = lots.reduce((s, l) => s + (l.current_bid ?? l.starting_bid ?? 0), 0);
        out.push({
          id: a.id, kind: 'auction',
          title: a.title,
          rawStatus: a.status, status: unifyStatus('auction', a.status),
          postUrl: a.post_url, createdAt: a.created_at, endsAt: a.ends_at,
          itemCount: lots.length, claimedCount: claimed,
          listValue: list,
        });
      }
      for (const s of (claimRes.data || []) as { id: string; title: string; status: string; post_url: string | null; ends_at: string | null; created_at: string }[]) {
        const items = claimItemsBy.get(s.id) || [];
        const claimed = items.filter(i => i.claim_status !== 'open').length;
        const list = items.reduce((sum, i) => sum + (i.price || 0), 0);
        out.push({
          id: s.id, kind: 'claim',
          title: s.title,
          rawStatus: s.status, status: unifyStatus('claim', s.status),
          postUrl: s.post_url, createdAt: s.created_at, endsAt: s.ends_at,
          itemCount: items.length, claimedCount: claimed,
          listValue: list,
        });
      }
      out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setEntries(out);
      setLoading(false);
    }
    load();
  }, []);

  const kindCounts = useMemo(() => {
    const c: Record<FilterKind, number> = { all: entries.length, auction: 0, claim: 0 };
    for (const e of entries) c[e.kind]++;
    return c;
  }, [entries]);
  const statusCounts = useMemo(() => {
    const c: Record<FilterStatus, number> = { all: 0, draft: 0, live: 0, closed: 0, settled: 0 };
    const matching = kindFilter === 'all' ? entries : entries.filter(e => e.kind === kindFilter);
    c.all = matching.length;
    for (const e of matching) c[e.status]++;
    return c;
  }, [entries, kindFilter]);

  const filtered = useMemo(() => {
    let arr = entries;
    if (kindFilter !== 'all') arr = arr.filter(e => e.kind === kindFilter);
    if (statusFilter !== 'all') arr = arr.filter(e => e.status === statusFilter);
    return arr;
  }, [entries, kindFilter, statusFilter]);

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ FB Sales ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions/new" className="btn btn-primary btn-sm">+ Auction</Link>
            <Link href="/fb-claim-sales/new" className="btn btn-primary btn-sm">+ Claim Sale</Link>
            <Link href="/fb-auctions/templates" className="btn btn-ghost btn-sm">Templates</Link>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">Buyers</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ One stop for FB sales ★</div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Both your <strong>Auctions</strong> and <strong>Claim Sales</strong> show up here.
            Use the filter chips below to narrow by type or status. Tap a row to manage it.
          </p>
        </section>

        {/* Type tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {KIND_FILTERS.map(f => (
            <button key={f.id} onClick={() => setKindFilter(f.id)}
              className={`btn btn-sm ${kindFilter === f.id ? 'btn-primary' : 'btn-ghost'}`}>
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>({kindCounts[f.id]})</span>
            </button>
          ))}
        </div>

        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)}
              className={`btn btn-sm ${statusFilter === f.id ? 'btn-primary' : 'btn-ghost'}`}>
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>({statusCounts[f.id]})</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 6 }}>Nothing here yet</div>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 14 }}>
              Start your first FB sale — an <strong>auction</strong> for bidding or a <strong>claim sale</strong> for fixed-price.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Link href="/fb-auctions/new" className="btn btn-primary btn-sm">+ New Auction</Link>
              <Link href="/fb-claim-sales/new" className="btn btn-primary btn-sm">+ New Claim Sale</Link>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(e => (
              <Link key={`${e.kind}:${e.id}`}
                href={e.kind === 'auction' ? `/fb-auctions/${e.id}` : `/fb-claim-sales/${e.id}`}
                style={{ textDecoration: 'none' }}>
                <div className="panel-bordered" style={{
                  padding: 14, display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer',
                }}>
                  <div style={{
                    width: 56, height: 56, flexShrink: 0,
                    background: e.kind === 'auction' ? 'var(--orange)' : 'var(--teal)',
                    color: 'var(--cream)',
                    display: 'grid', placeItems: 'center', borderRadius: 10,
                    border: '2px solid var(--plum)', boxShadow: '0 2px 0 var(--plum)',
                    fontSize: 22,
                  }}>
                    {e.kind === 'auction' ? '🔨' : '🏷'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span className="eyebrow" style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
                        color: e.kind === 'auction' ? 'var(--orange)' : 'var(--teal)',
                      }}>
                        {e.kind === 'auction' ? '◆ AUCTION' : '◆ CLAIM SALE'}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                        background: statusBg(e.status), color: statusFg(e.status),
                        padding: '2px 8px', borderRadius: 100, textTransform: 'uppercase',
                      }}>{statusLabel(e.status)}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginLeft: 'auto' }}>
                        {fmtRel(e.createdAt)}
                      </span>
                    </div>
                    <div className="display" style={{ fontSize: 15, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.title}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 3 }}>
                      {e.itemCount} {e.kind === 'auction' ? 'lot' : 'item'}{e.itemCount === 1 ? '' : 's'}
                      {e.claimedCount > 0 ? ` · ${e.claimedCount} ${e.kind === 'auction' ? 'sold' : 'claimed'}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="stat-num" style={{ fontSize: 20, color: 'var(--orange)' }}>{fmtMoney(e.listValue)}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>list value</div>
                  </div>
                  <span style={{ color: 'var(--plum)', fontSize: 18 }}>→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
