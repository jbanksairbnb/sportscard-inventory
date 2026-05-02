'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
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
};

type Lot = {
  id: string;
  lot_number: number;
  listing_id: string | null;
  starting_bid: number | null;
  current_bid: number | null;
  bidder_name: string | null;
  bidder_fb_handle: string | null;
  comment_url: string | null;
  status: 'open' | 'sold' | 'no_sale' | 'paid';
  notes: string | null;
  listing: Listing | null;
};

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
  fb_auction_templates?: { name: string; post_footer: string } | null;
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
  const [lots, setLots] = useState<Lot[]>([]);

  const [editBuffer, setEditBuffer] = useState<Record<string, Partial<Lot>>>({});
  const [savingLots, setSavingLots] = useState<Set<string>>(new Set());

  const [paymentText, setPaymentText] = useState<string>('PayPal F&F to: your-paypal@email.com\nVenmo: @your-venmo');
  const [shippingByBuyer, setShippingByBuyer] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);

      const [aucRes, lotsRes] = await Promise.all([
        supabase.from('fb_auctions')
          .select('*, fb_groups(name, url), fb_auction_templates(name, post_footer)')
          .eq('id', auctionId).eq('user_id', user.id).maybeSingle(),
        supabase.from('fb_auction_lots')
          .select('*, listing:listings(id, title, year, brand, card_number, player, photos, condition_type, raw_grade, grading_company, grade)')
          .eq('auction_id', auctionId).order('lot_number'),
      ]);

      if (!aucRes.data) { router.push('/fb-auctions'); return; }
      setAuction(aucRes.data as Auction);
      setLots((lotsRes.data || []) as Lot[]);
      setLoading(false);
    }
    load();
  }, [auctionId, router]);

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
    const payload: Record<string, unknown> = {};
    if ('current_bid' in buf) payload.current_bid = buf.current_bid;
    if ('bidder_name' in buf) payload.bidder_name = buf.bidder_name?.toString().trim() || null;
    if ('bidder_fb_handle' in buf) payload.bidder_fb_handle = buf.bidder_fb_handle?.toString().trim() || null;
    if ('comment_url' in buf) payload.comment_url = buf.comment_url?.toString().trim() || null;
    if ('status' in buf) payload.status = buf.status;
    if ('notes' in buf) payload.notes = buf.notes?.toString().trim() || null;
    const { error } = await supabase.from('fb_auction_lots').update(payload).eq('id', id);
    if (error) { alert(error.message); }
    else {
      setLots(prev => prev.map(l => l.id === id ? { ...l, ...buf } : l));
      setEditBuffer(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
    setSavingLots(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function setStatus(s: Status) {
    if (!auction) return;
    const supabase = createClient();
    const { error } = await supabase.from('fb_auctions').update({ status: s }).eq('id', auction.id);
    if (error) { alert(error.message); return; }
    setAuction(a => a ? { ...a, status: s } : a);
  }

  async function setPostUrl(url: string) {
    if (!auction) return;
    const supabase = createClient();
    const trimmed = url.trim() || null;
    await supabase.from('fb_auctions').update({ post_url: trimmed }).eq('id', auction.id);
    setAuction(a => a ? { ...a, post_url: trimmed } : a);
  }

  async function quickSetSold(lot: Lot) {
    const supabase = createClient();
    await supabase.from('fb_auction_lots').update({ status: 'sold' }).eq('id', lot.id);
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, status: 'sold' } : l));
  }
  async function quickSetNoSale(lot: Lot) {
    const supabase = createClient();
    await supabase.from('fb_auction_lots').update({ status: 'no_sale' }).eq('id', lot.id);
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, status: 'no_sale' } : l));
  }
  async function quickReopen(lot: Lot) {
    const supabase = createClient();
    await supabase.from('fb_auction_lots').update({ status: 'open' }).eq('id', lot.id);
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, status: 'open' } : l));
  }

  async function markBuyerPaid(bidderName: string) {
    if (!confirm(`Mark all of ${bidderName}'s lots as PAID?`)) return;
    const supabase = createClient();
    const ids = lots.filter(l => (l.bidder_name || '').trim().toLowerCase() === bidderName.toLowerCase() && l.status === 'sold').map(l => l.id);
    if (ids.length === 0) return;
    await supabase.from('fb_auction_lots').update({ status: 'paid' }).in('id', ids);
    setLots(prev => prev.map(l => ids.includes(l.id) ? { ...l, status: 'paid' } : l));
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
    const lines = group.lots.map(l => {
      const ttl = l.listing?.title || `Lot #${l.lot_number}`;
      return `· ${ttl} — ${fmtMoney(l.current_bid)}`;
    });
    return [
      `Hi ${group.name}!`,
      '',
      `Congrats on winning these from my ${auction?.title || 'auction'}:`,
      '',
      ...lines,
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
  const soldLots = lots.filter(l => l.status === 'sold' || l.status === 'paid').length;
  const noSaleLots = lots.filter(l => l.status === 'no_sale').length;
  const paidLots = lots.filter(l => l.status === 'paid').length;
  const grossSales = lots.filter(l => l.status === 'sold' || l.status === 'paid').reduce((s, l) => s + (l.current_bid || 0), 0);

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Manage Auction ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">All Auctions</Link>
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
            }}>{auction.status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Stat label="Lots" value={String(totalLots)} />
            <Stat label="Open" value={String(openLots)} />
            <Stat label="Sold" value={String(soldLots)} />
            <Stat label="Paid" value={String(paidLots)} />
            <Stat label="No Sale" value={String(noSaleLots)} />
            <Stat label="Gross" value={fmtMoney(grossSales)} />
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', fontWeight: 600 }}>
            Created {new Date(auction.created_at).toLocaleString()}
            {auction.fb_groups?.name && ` · Group: ${auction.fb_groups.name}`}
            {auction.ends_at && ` · Ends ${new Date(auction.ends_at).toLocaleString()}`}
          </div>
        </section>

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
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4, fontStyle: 'italic' }}>
                Draft → Live (after posting) → Ended (24h up) → Settled (paid out).
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lots.map(lot => {
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
                          }}>{lot.status.replace('_', ' ')}</span>
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
                          <div>
                            <label className="input-label" style={{ fontSize: 9 }}>Bidder name</label>
                            <input type="text"
                              defaultValue={bidder || ''}
                              onChange={e => patchLot(lot.id, { bidder_name: e.target.value })}
                              onBlur={() => flushLot(lot.id)}
                              placeholder="Lee Cho"
                              className="input-sc" style={{ width: '100%' }} />
                          </div>
                          <div>
                            <label className="input-label" style={{ fontSize: 9 }}>FB handle (optional)</label>
                            <input type="text"
                              defaultValue={handle || ''}
                              onChange={e => patchLot(lot.id, { bidder_fb_handle: e.target.value })}
                              onBlur={() => flushLot(lot.id)}
                              placeholder="@lee.cho"
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
                          {lot.status !== 'sold' && lot.status !== 'paid' && (
                            <button onClick={() => quickSetSold(lot)} className="btn btn-sm" style={{ background: 'var(--orange)', color: 'var(--cream)', border: '1.5px solid var(--orange)' }}>✓ Mark Sold</button>
                          )}
                          {lot.status !== 'no_sale' && lot.status !== 'paid' && (
                            <button onClick={() => quickSetNoSale(lot)} className="btn btn-sm" style={{ background: 'transparent', color: 'var(--rust)', border: '1.5px solid var(--rust)' }}>✗ No Sale</button>
                          )}
                          {(lot.status === 'sold' || lot.status === 'no_sale') && (
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
          )}
        </section>

        {(auction.status === 'ended' || auction.status === 'settled') && (
          <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 20 }}>
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
                No sold lots with bidder names yet. Mark winning lots as <strong>Sold</strong> and fill in the bidder name on each.
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
                          {group.name} {allPaid && <span style={{ fontSize: 10, color: 'var(--teal)', fontWeight: 700, letterSpacing: '0.1em', marginLeft: 8 }}>✓ PAID</span>}
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
                            ✓ Mark all paid
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
