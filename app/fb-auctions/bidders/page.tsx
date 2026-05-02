'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Bidder = {
  id: string;
  name: string;
  fb_handle: string | null;
  email: string | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
};

type Activity = {
  id: string;
  bidder_id: string;
  auction_id: string | null;
  lot_id: string | null;
  bid_amount: number | null;
  is_winner: boolean | null;
  is_paid: boolean | null;
  listing_year: number | null;
  listing_brand: string | null;
  listing_player: string | null;
  listing_card_number: string | null;
  updated_at: string | null;
};

type AuctionMeta = { id: string; title: string; group_id: string | null };
type GroupMeta = { id: string; name: string };

const EDITABLE_FIELDS = ['name', 'fb_handle', 'email', 'address', 'phone', 'notes'] as const;
type EditField = typeof EDITABLE_FIELDS[number];

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function cardLabel(a: Activity): string {
  const parts = [
    a.listing_year ? String(a.listing_year) : '',
    a.listing_brand || '',
    a.listing_card_number ? `#${a.listing_card_number}` : '',
    a.listing_player || '',
  ].filter(Boolean);
  return parts.join(' ').trim() || '—';
}

export default function BiddersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [auctions, setAuctions] = useState<Map<string, AuctionMeta>>(new Map());
  const [groups, setGroups] = useState<Map<string, GroupMeta>>(new Map());

  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Record<string, Partial<Bidder>>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const [bRes, aRes, aucRes, gRes] = await Promise.all([
        supabase.from('fb_bidders').select('id, name, fb_handle, email, address, phone, notes').eq('user_id', user.id).order('name'),
        supabase.from('fb_bidder_activity').select('id, bidder_id, auction_id, lot_id, bid_amount, is_winner, is_paid, listing_year, listing_brand, listing_player, listing_card_number, updated_at').eq('user_id', user.id),
        supabase.from('fb_auctions').select('id, title, group_id').eq('user_id', user.id),
        supabase.from('fb_groups').select('id, name').eq('user_id', user.id),
      ]);
      if (bRes.error) console.error('fb_bidders load failed:', bRes.error);
      if (aRes.error) console.error('fb_bidder_activity load failed:', aRes.error);
      setBidders((bRes.data || []) as Bidder[]);
      setActivities((aRes.data || []) as Activity[]);
      const am = new Map<string, AuctionMeta>();
      for (const a of (aucRes.data || []) as AuctionMeta[]) am.set(a.id, a);
      setAuctions(am);
      const gm = new Map<string, GroupMeta>();
      for (const g of (gRes.data || []) as GroupMeta[]) gm.set(g.id, g);
      setGroups(gm);
      setLoading(false);
    }
    load();
  }, [router]);

  const activitiesByBidder = useMemo(() => {
    const m = new Map<string, Activity[]>();
    for (const a of activities) {
      const arr = m.get(a.bidder_id) || [];
      arr.push(a);
      m.set(a.bidder_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort((x, y) => (y.updated_at || '').localeCompare(x.updated_at || ''));
    }
    return m;
  }, [activities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bidders;
    return bidders.filter(b =>
      b.name.toLowerCase().includes(q) ||
      (b.fb_handle || '').toLowerCase().includes(q) ||
      (b.email || '').toLowerCase().includes(q)
    );
  }, [bidders, search]);

  function bidderValue(b: Bidder, field: EditField): string {
    const buf = editBuffer[b.id];
    const v = buf && field in buf ? (buf as Bidder)[field] : b[field];
    return (v ?? '') as string;
  }

  function patch(id: string, field: EditField, value: string) {
    setEditBuffer(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  }

  async function flush(id: string) {
    const buf = editBuffer[id];
    if (!buf) return;
    setSavingIds(prev => new Set(prev).add(id));
    const supabase = createClient();
    const payload: Record<string, unknown> = {};
    for (const k of EDITABLE_FIELDS) {
      if (k in buf) {
        const raw = (buf as Bidder)[k];
        const trimmed = typeof raw === 'string' ? raw.trim() : raw;
        payload[k] = trimmed === '' ? null : trimmed;
      }
    }
    if (Object.keys(payload).length === 0) {
      setSavingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }
    const { error } = await supabase.from('fb_bidders').update(payload).eq('id', id);
    if (error) {
      alert(error.message);
    } else {
      setBidders(prev => prev.map(b => b.id === id ? { ...b, ...payload } as Bidder : b));
      setEditBuffer(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
    setSavingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  }

  function aggregates(bidderId: string) {
    const acts = activitiesByBidder.get(bidderId) || [];
    let bid = 0, won = 0, paid = 0;
    const groupIds = new Set<string>();
    for (const a of acts) {
      bid += 1;
      if (a.is_winner) won += 1;
      if (a.is_paid) paid += 1;
      if (a.auction_id) {
        const auc = auctions.get(a.auction_id);
        if (auc?.group_id) groupIds.add(auc.group_id);
      }
    }
    const groupNames = Array.from(groupIds).map(gid => groups.get(gid)?.name || '').filter(Boolean);
    return { bid, won, paid, groupNames };
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <Header />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ Customer book ★</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
            Everyone who has bid on your auctions. Click a row to edit contact info or see what they&apos;ve bid on.
            This data feeds the suggested-tag list when you generate a new auction.
          </p>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
            flex: 1, minWidth: 240, maxWidth: 420,
          }}>
            <span style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 700 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, handle, or email"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)' }} />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'transparent', border: 'none', color: 'var(--plum)', cursor: 'pointer', fontSize: 14 }}>×</button>
            )}
          </div>
          <span className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {filtered.length} {filtered.length === 1 ? 'bidder' : 'bidders'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>
              {bidders.length === 0 ? 'No bidders yet' : 'No bidders match your search'}
            </div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 13, marginBottom: 14 }}>
              {bidders.length === 0
                ? 'Bidders are created automatically when you enter a high-bidder name on a live auction.'
                : 'Try a different search term.'}
            </p>
            {bidders.length === 0 && (
              <Link href="/fb-auctions" className="btn btn-primary">→ Go to FB Auctions</Link>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1.6fr 1fr 70px 70px 70px 1.4fr 90px',
              gap: 8, padding: '8px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--mustard)', background: 'var(--plum)', borderRadius: 8,
            }}>
              <div>Name</div>
              <div>FB Handle</div>
              <div style={{ textAlign: 'right' }}>Bid</div>
              <div style={{ textAlign: 'right' }}>Won</div>
              <div style={{ textAlign: 'right' }}>Paid</div>
              <div>Groups</div>
              <div style={{ textAlign: 'right' }}></div>
            </div>
            {filtered.map(b => {
              const agg = aggregates(b.id);
              const isExpanded = expandedId === b.id;
              const acts = activitiesByBidder.get(b.id) || [];
              const dirty = !!editBuffer[b.id] && Object.keys(editBuffer[b.id]).length > 0;
              const isSaving = savingIds.has(b.id);
              return (
                <div key={b.id} className="panel-bordered" style={{ padding: 0, overflow: 'hidden' }}>
                  <div onClick={() => setExpandedId(isExpanded ? null : b.id)}
                    style={{
                      display: 'grid', gridTemplateColumns: '1.6fr 1fr 70px 70px 70px 1.4fr 90px',
                      gap: 8, padding: '12px 14px', cursor: 'pointer', alignItems: 'center',
                      background: isExpanded ? 'rgba(184,146,58,0.12)' : 'transparent',
                    }}>
                    <div className="display" style={{ fontSize: 15, color: 'var(--plum)' }}>{b.name}</div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{b.fb_handle ? `@${b.fb_handle}` : '—'}</div>
                    <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--plum)', textAlign: 'right' }}>{agg.bid}</div>
                    <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: agg.won > 0 ? 'var(--teal)' : 'var(--ink-mute)', textAlign: 'right' }}>{agg.won}</div>
                    <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: agg.paid > 0 ? 'var(--orange)' : 'var(--ink-mute)', textAlign: 'right' }}>{agg.paid}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agg.groupNames.length > 0 ? agg.groupNames.join(', ') : <span style={{ color: 'var(--ink-mute)' }}>—</span>}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink-mute)' }}>
                      {isExpanded ? '▲ Collapse' : '▼ Expand'}
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '14px 18px 18px', borderTop: '1px dashed var(--rule)', background: 'var(--cream)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
                        <Field label="Name" value={bidderValue(b, 'name')} onChange={v => patch(b.id, 'name', v)} onBlur={() => flush(b.id)} />
                        <Field label="FB Handle" value={bidderValue(b, 'fb_handle')} onChange={v => patch(b.id, 'fb_handle', v)} onBlur={() => flush(b.id)} placeholder="without the @" />
                        <Field label="Email" value={bidderValue(b, 'email')} onChange={v => patch(b.id, 'email', v)} onBlur={() => flush(b.id)} type="email" />
                        <Field label="Phone" value={bidderValue(b, 'phone')} onChange={v => patch(b.id, 'phone', v)} onBlur={() => flush(b.id)} />
                        <Field label="Mailing Address" value={bidderValue(b, 'address')} onChange={v => patch(b.id, 'address', v)} onBlur={() => flush(b.id)} multiline />
                        <Field label="Notes" value={bidderValue(b, 'notes')} onChange={v => patch(b.id, 'notes', v)} onBlur={() => flush(b.id)} multiline />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 10, fontStyle: 'italic' }}>
                        {isSaving ? 'Saving…' : dirty ? 'Unsaved changes (saves on blur)' : 'Saved'}
                      </div>

                      <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 8 }}>
                        Activity ({acts.length} {acts.length === 1 ? 'card' : 'cards'})
                      </div>
                      {acts.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No activity yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {acts.map(a => {
                            const auc = a.auction_id ? auctions.get(a.auction_id) : null;
                            const groupName = auc?.group_id ? groups.get(auc.group_id)?.name : null;
                            return (
                              <div key={a.id} style={{
                                display: 'grid', gridTemplateColumns: '2fr 1.4fr 90px 80px',
                                gap: 8, alignItems: 'center', padding: '6px 10px',
                                background: 'var(--paper)', borderRadius: 6, border: '1px solid var(--rule)', fontSize: 12,
                              }}>
                                <div style={{ color: 'var(--plum)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {cardLabel(a)}
                                </div>
                                <div style={{ color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {auc?.title || <span style={{ color: 'var(--ink-mute)' }}>—</span>}
                                  {groupName && <span style={{ color: 'var(--ink-mute)' }}> · {groupName}</span>}
                                </div>
                                <div className="mono" style={{ textAlign: 'right', color: 'var(--orange)', fontWeight: 700 }}>{fmtMoney(a.bid_amount)}</div>
                                <div style={{ textAlign: 'right', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>
                                  {a.is_paid ? <span style={{ color: 'var(--teal)' }}>PAID</span>
                                    : a.is_winner ? <span style={{ color: 'var(--orange)' }}>WON</span>
                                    : <span style={{ color: 'var(--ink-mute)' }}>BID</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
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

function Field({ label, value, onChange, onBlur, placeholder, type, multiline }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    border: '1.5px solid var(--plum)', borderRadius: 6, padding: '6px 10px',
    fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--plum)',
    background: 'var(--paper)',
  };
  return (
    <div>
      <label className="input-label">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder}
          rows={2} style={{ ...baseStyle, resize: 'vertical' }} />
      ) : (
        <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder}
          style={baseStyle} />
      )}
    </div>
  );
}

function Header() {
  return (
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
          <Link href="/fb-auctions" className="btn btn-ghost btn-sm">Auctions</Link>
          <Link href="/fb-auctions/templates" className="btn btn-ghost btn-sm">Templates</Link>
          <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
          <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
        </div>
      </div>
    </header>
  );
}
