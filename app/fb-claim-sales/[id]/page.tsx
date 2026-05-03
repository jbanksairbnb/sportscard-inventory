'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { applyOwnedTransition } from '@/lib/inventory';
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
async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

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
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

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
    } else {
      alert(error.message);
    }
    setSavingItems(prev => { const n = new Set(prev); n.delete(item.id); return n; });
  }

  async function setItemStatus(item: Item, claim_status: ClaimStatus) {
    const supabase = createClient();
    const { error } = await supabase.from('fb_claim_sale_items').update({ claim_status }).eq('id', item.id);
    if (!error) setItems(prev => prev.map(i => i.id === item.id ? { ...i, claim_status } : i));
    else alert(error.message);
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
      const lot = lots.find(l => l.id === a.lot_id)?.lot_number ?? 0;
      const lotB = lots.find(l => l.id === b.lot_id)?.lot_number ?? 0;
      return lot - lotB || a.position - b.position;
    })) {
      const lot = lots.find(l => l.id === it.lot_id);
      const cardLabel = it.listing
        ? `${it.listing.year || ''} ${it.listing.brand || ''} #${it.listing.card_number || ''} ${it.listing.player || ''}`.trim()
        : 'Card';
      const price = it.price ?? 0;
      subtotal += price;
      lines.push(`· Lot #${lot?.lot_number || '?'}${lot?.kind === 'group' ? ` pos ${it.position}` : ''} — ${cardLabel} — ${fmtMoney(price)}`);
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
            <Link href="/fb-claim-sales" className="btn btn-ghost btn-sm">All Claim Sales</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
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
            }}>{sale.status}</span>
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 6 }}>
            {lots.length} lot{lots.length === 1 ? '' : 's'} · {items.length} item{items.length === 1 ? '' : 's'} · List value {fmtMoney(totalList)} · Claimed {fmtMoney(totalClaimed)}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['draft', 'live', 'closed', 'settled'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`btn btn-sm ${sale.status === s ? 'btn-primary' : 'btn-ghost'}`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
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
                          <select value={it.claim_status} onChange={e => setItemStatus(it, e.target.value as ClaimStatus)}
                            className="input-sc" style={{ width: 100, fontSize: 11.5 }}>
                            <option value="open">Open</option>
                            <option value="claimed">Claimed</option>
                            <option value="sold">Sold</option>
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
          <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
            <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 12 }}>
              Buyer Invoices ({buyers.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {buyers.map(b => {
                const subtotal = b.items.reduce((s, i) => s + (i.price || 0), 0);
                const shipping = sale.default_shipping_cost ?? 0;
                const total = subtotal + shipping;
                const tag = `inv:${b.id || b.name}`;
                return (
                  <div key={tag} className="panel" style={{ padding: 14, border: '1.5px solid var(--rule)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div className="display" style={{ fontSize: 14, color: 'var(--plum)', flex: 1 }}>{b.name}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{b.items.length} item{b.items.length === 1 ? '' : 's'}</div>
                      <div className="stat-num" style={{ fontSize: 18, color: 'var(--orange)' }}>{fmtMoney(total)}</div>
                      <button onClick={() => copyTag(buildBuyerInvoice(b), tag)} className="btn btn-outline btn-sm">
                        {copiedTag === tag ? '✓ Copied' : '📋 Copy invoice'}
                      </button>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                      Subtotal {fmtMoney(subtotal)} + Shipping {fmtMoney(shipping)}
                    </div>
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
