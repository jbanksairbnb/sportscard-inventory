'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Status = 'draft' | 'live' | 'ended' | 'settled';

type LotRow = {
  id: string;
  lot_number: number;
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

  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const [editBuffer, setEditBuffer] = useState<Record<string, Partial<LotRow>>>({});
  const [savingLots, setSavingLots] = useState<Set<string>>(new Set());
  const [savingPostUrls, setSavingPostUrls] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const [bidders, setBidders] = useState<BidderRow[]>([]);
  const [dupeWarnings, setDupeWarnings] = useState<Record<string, BidderRow[]>>({});

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const [aucRes, bidderRes] = await Promise.all([
        supabase
          .from('fb_auctions')
          .select('id, title, status, post_url, ends_at, created_at, fb_auction_lots(id, lot_number, current_bid, bidder_name, bidder_fb_handle, bidder_id, status, listing:listings(title, year, brand, card_number, player))')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('fb_bidders')
          .select('id, name, fb_handle')
          .eq('user_id', user.id)
          .order('name'),
      ]);
      if (aucRes.error) {
        console.error('fb_auctions query failed:', aucRes.error);
      }
      if (bidderRes.error) {
        console.error('fb_bidders query failed:', bidderRes.error);
      }
      setAuctions(((aucRes.data || []) as unknown) as AuctionRow[]);
      setBidders((bidderRes.data || []) as BidderRow[]);
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

  const filtered = useMemo(
    () => filter === 'all' ? auctions : auctions.filter(a => a.status === filter),
    [auctions, filter]
  );
  const counts: Record<string, number> = { draft: 0, live: 0, ended: 0, settled: 0 };
  auctions.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

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
    setSelectedDrafts(new Set());
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

    const { error } = await supabase.from('fb_auction_lots').update(payload).eq('id', lotId);
    if (error) alert(error.message);
    else {
      setAuctions(prev => prev.map(a => ({
        ...a,
        fb_auction_lots: a.fb_auction_lots.map(l => l.id === lotId ? { ...l, ...buf, bidder_id: bidderId } : l),
      })));
      setEditBuffer(prev => { const next = { ...prev }; delete next[lotId]; return next; });
    }
    setSavingLots(prev => { const next = new Set(prev); next.delete(lotId); return next; });
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
            <Link href="/fb-auctions/templates" className="btn btn-ghost btn-sm">Templates</Link>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">Bidders</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
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

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => { setFilter(f); setSelectedDrafts(new Set()); }}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>
                ({f === 'all' ? auctions.length : (counts[f] || 0)})
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
                        }}>{a.status}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
                        {a.fb_auction_lots.length} lot{a.fb_auction_lots.length === 1 ? '' : 's'} · created {new Date(a.created_at).toLocaleDateString()}
                        {a.ends_at && ` · ends ${new Date(a.ends_at).toLocaleString()}`}
                      </div>
                    </div>
                    <Link href={`/fb-auctions/${a.id}`} className="btn btn-ghost btn-sm">Manage →</Link>
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
                          return (
                            <div key={lot.id} style={{
                              display: 'grid', gridTemplateColumns: '60px 1fr 110px 1fr 80px',
                              gap: 8, alignItems: 'center', padding: '6px 8px',
                              background: 'var(--paper)', borderRadius: 6, border: '1px solid var(--rule)',
                            }}>
                              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--plum)' }}>#{lot.lot_number}</div>
                              <div style={{ fontSize: 12, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {shortLotLabel(lot)}
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
