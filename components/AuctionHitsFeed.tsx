'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const RAW_GRADES = ['Gem Mint', 'Mint', 'NM-MT', 'NM', 'EXMT', 'EX', 'VG-EX', 'VG', 'G', 'P'];

const RAW_GRADE_RANKS: Record<string, number> = {
  'P': 0, 'G': 1, 'VG': 2, 'VG-EX': 3, 'EX': 4, 'EX+': 5,
  'EXMT': 6, 'EX-MT': 6, 'NM': 7, 'NM+': 8, 'NM-MT': 9,
  'Mint': 10, 'MINT': 10, 'Gem Mint': 11, 'GEM MINT': 11,
};

function rawRank(label: string | null | undefined): number | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (trimmed in RAW_GRADE_RANKS) return RAW_GRADE_RANKS[trimmed];
  const upper = trimmed.toUpperCase();
  for (const k of Object.keys(RAW_GRADE_RANKS)) {
    if (k.toUpperCase() === upper) return RAW_GRADE_RANKS[k];
  }
  return null;
}

function gradedNumeric(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

type WantRow = {
  setSlug: string;
  setTitle: string;
  year: number;
  brand: string;
  cardNumber: string;
  player: string;
  targetConditionLow: string;
  targetConditionHigh: string;
  targetType: string;
  targetGradingCompanies: string[];
};

type AuctionLot = {
  lot_id: string;
  lot_number: number;
  starting_bid: number | null;
  current_bid: number | null;
  comment_url: string | null;
  leading_bidder_name: string | null;
  leading_bidder_fb_handle: string | null;
  auction_id: string;
  auction_title: string;
  auction_post_url: string | null;
  auction_ends_at: string | null;
  auction_created_at: string;
  seller_user_id: string;
  seller_name: string;
  seller_handle: string;
  seller_email: string;
  listing_id: string;
  listing_title: string;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: 'raw' | 'graded' | null;
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  photos: string[];
};

type Hit = AuctionLot & { matched_set_title: string };

type OutbidNotification = {
  id: string;
  read_at: string | null;
  created_at: string;
  link: string | null;
  payload: {
    lot_id: string;
    auction_id: string;
    auction_title: string;
    auction_post_url: string | null;
    lot_number: number;
    current_bid: number | null;
    listing: {
      title: string | null;
      year: number | null;
      brand: string | null;
      card_number: string | null;
      player: string | null;
      photos: string[] | null;
    } | null;
  };
};

function fmtMoney(n: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function fmtRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'Yesterday' : `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtEndsIn(iso: string | null): string {
  if (!iso) return '';
  const ends = new Date(iso).getTime();
  const diff = ends - Date.now();
  if (diff <= 0) return 'ended';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `ends in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `ends in ${h}h`;
  const d = Math.floor(h / 24);
  return `ends in ${d}d`;
}

function classifyTarget(target: string): 'raw' | 'graded' | 'blank' {
  const t = (target || '').trim();
  if (!t) return 'blank';
  if (RAW_GRADES.includes(t)) return 'raw';
  if (/^\d+(\.\d+)?$/.test(t)) return 'graded';
  return 'graded';
}

function matchesCondition(lot: AuctionLot, want: WantRow): boolean {
  let targetType: 'raw' | 'graded' | 'blank';
  if (want.targetType === 'Raw') targetType = 'raw';
  else if (want.targetType === 'Graded') targetType = 'graded';
  else {
    const lowT = classifyTarget(want.targetConditionLow);
    const highT = classifyTarget(want.targetConditionHigh);
    if (lowT === 'blank' && highT === 'blank') return true;
    targetType = lowT !== 'blank' ? lowT : highT;
  }

  const lowBlank = !want.targetConditionLow.trim();
  const highBlank = !want.targetConditionHigh.trim();
  if (lowBlank && highBlank && want.targetType) {
    if (targetType === 'raw') return lot.condition_type === 'raw';
    if (targetType === 'graded') {
      if (lot.condition_type !== 'graded') return false;
      if (want.targetGradingCompanies.length > 0 && !want.targetGradingCompanies.includes(lot.grading_company || '')) return false;
      return true;
    }
  }

  if (targetType === 'raw') {
    if (lot.condition_type !== 'raw') return false;
    const lotRank = rawRank(lot.raw_grade);
    if (lotRank === null) return false;
    const lowRank = lowBlank ? 0 : rawRank(want.targetConditionLow);
    const highRank = highBlank ? 999 : rawRank(want.targetConditionHigh);
    if (lowRank === null || highRank === null) return false;
    return lotRank >= lowRank && lotRank <= highRank;
  }

  if (targetType === 'graded') {
    if (lot.condition_type !== 'graded' || !lot.grade) return false;
    if (want.targetGradingCompanies.length > 0 && !want.targetGradingCompanies.includes(lot.grading_company || '')) return false;
    const grade = parseFloat(lot.grade);
    if (Number.isNaN(grade)) return false;
    const low = lowBlank ? 1 : gradedNumeric(want.targetConditionLow);
    const high = highBlank ? 10 : gradedNumeric(want.targetConditionHigh);
    if (low === null || high === null) return false;
    return grade >= low && grade <= high;
  }
  return false;
}

export default function AuctionHitsFeed() {
  const [loading, setLoading] = useState(true);
  const [hits, setHits] = useState<Hit[]>([]);
  const [outbids, setOutbids] = useState<OutbidNotification[]>([]);

  async function dismissOutbid(id: string) {
    setOutbids(prev => prev.filter(n => n.id !== id));
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {});
  }

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Outbid notifications (unread first, fall back to recent)
      try {
        const res = await fetch('/api/notifications?kind=outbid');
        if (res.ok) {
          const { notifications } = await res.json();
          const unread = (notifications || []).filter((n: OutbidNotification) => !n.read_at);
          setOutbids(unread.slice(0, 10));
        }
      } catch {}

      const { data: setsData } = await supabase
        .from('sets')
        .select('slug, title, year, brand, rows, default_target')
        .eq('user_id', user.id);

      const wants: WantRow[] = [];
      for (const s of (setsData || [])) {
        const setDefault = (s.default_target || {}) as { type?: string; low?: string; high?: string; companies?: string };
        for (const row of (s.rows || [])) {
          if (String(row['Owned'] || '') === 'Yes') continue;
          const player = String(row['Player'] || row['Description'] || '').trim();
          const cardNumber = String(row['Card #'] || '').trim();
          if (!player || !cardNumber) continue;

          const explicitType = String(row['Target Type'] || '').trim();
          const explicitLow = String(row['Target Condition - Low'] || row['Target Condition'] || '').trim();
          const explicitHigh = String(row['Target Condition - High'] || '').trim();
          const explicitCompaniesRaw = String(row['Target Grading Companies'] || '').trim();
          const hasExplicit = !!(explicitType || explicitLow || explicitHigh || explicitCompaniesRaw);

          const targetType = hasExplicit ? explicitType : (setDefault.type || '').trim();
          const targetLow = hasExplicit ? explicitLow : (setDefault.low || '').trim();
          const targetHigh = hasExplicit ? explicitHigh : (setDefault.high || '').trim();
          const targetCompaniesRaw = hasExplicit ? explicitCompaniesRaw : (setDefault.companies || '').trim();
          const targetGradingCompanies = targetCompaniesRaw
            ? targetCompaniesRaw.split(',').map(s => s.trim()).filter(Boolean)
            : [];

          wants.push({
            setSlug: s.slug,
            setTitle: s.title || `${s.year} ${s.brand}`,
            year: s.year || 0,
            brand: s.brand || '',
            cardNumber,
            player,
            targetConditionLow: targetLow,
            targetConditionHigh: targetHigh,
            targetType,
            targetGradingCompanies,
          });
        }
      }

      if (wants.length === 0) {
        setHits([]);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/feed/auction-hits');
      if (!res.ok) { setHits([]); setLoading(false); return; }
      const { lots } = await res.json() as { lots: AuctionLot[] };

      const wantIndex = new Map<string, WantRow[]>();
      for (const w of wants) {
        const key = `${w.year}|${w.brand.trim().toLowerCase()}|${w.cardNumber.trim()}|${w.player.trim().toLowerCase()}`;
        const arr = wantIndex.get(key) || [];
        arr.push(w);
        wantIndex.set(key, arr);
      }

      const matched: Hit[] = [];
      for (const l of lots) {
        const key = `${l.year}|${(l.brand || '').trim().toLowerCase()}|${(l.card_number || '').trim()}|${(l.player || '').trim().toLowerCase()}`;
        const matchingWants = wantIndex.get(key);
        if (!matchingWants) continue;
        for (const w of matchingWants) {
          if (matchesCondition(l, w)) {
            matched.push({ ...l, matched_set_title: w.setTitle });
            break;
          }
        }
      }

      // Newest first
      matched.sort((a, b) => new Date(b.auction_created_at).getTime() - new Date(a.auction_created_at).getTime());
      setHits(matched);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
        Scanning live Facebook auctions…
      </div>
    );
  }

  if (hits.length === 0 && outbids.length === 0) {
    return (
      <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>No auction hits right now</div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          When another collector starts a Facebook auction with a card on your <strong>want list</strong>, it&apos;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {outbids.map(n => <OutbidItem key={n.id} notification={n} onDismiss={() => dismissOutbid(n.id)} />)}
      {hits.map(h => <AuctionHitItem key={h.lot_id} hit={h} />)}
    </div>
  );
}

function OutbidItem({ notification, onDismiss }: { notification: OutbidNotification; onDismiss: () => void }) {
  const p = notification.payload;
  const photo = p.listing?.photos?.[0];
  const cardLine = p.listing
    ? `${p.listing.year || ''} ${p.listing.brand || ''} #${p.listing.card_number || ''} ${p.listing.player || ''}`.trim()
    : '';
  const title = p.listing?.title || cardLine || `Lot #${p.lot_number}`;
  return (
    <article className="panel" style={{
      padding: 16, display: 'flex', gap: 16, alignItems: 'stretch',
      border: '2px solid var(--rust)', background: 'rgba(192,57,43,0.06)',
    }}>
      <div style={{
        width: 90, height: 126, flexShrink: 0,
        background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 8,
        overflow: 'hidden', display: 'grid', placeItems: 'center',
      }}>
        {photo ? (
          <img src={photo} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>No photo</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="chip" style={{ fontSize: 10, background: 'var(--rust)', color: 'var(--cream)', border: '1.5px solid var(--rust)', fontWeight: 700 }}>
            ⚠ You were outbid
          </span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginLeft: 'auto', fontWeight: 600 }}>
            {fmtRelativeTime(notification.created_at)}
          </span>
        </div>
        <h3 className="display" style={{ fontSize: 20, margin: '4px 0 2px', color: 'var(--plum)', lineHeight: 1.2 }}>
          {title}
        </h3>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>
          Lot #{p.lot_number} of <span style={{ color: 'var(--plum)', fontWeight: 700 }}>{p.auction_title}</span>
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="stat-num" style={{ fontSize: 22, color: 'var(--rust)' }}>
            {fmtMoney(p.current_bid)}
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
            new leading bid
          </span>
          {(notification.link || p.auction_post_url) && (
            <a href={(notification.link || p.auction_post_url)!} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
              Bid again on Facebook ↗
            </a>
          )}
          <button type="button" onClick={onDismiss} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
            ✕ Dismiss
          </button>
        </div>
      </div>
    </article>
  );
}

function AuctionHitItem({ hit }: { hit: Hit }) {
  const photo = hit.photos?.[0];
  const conditionLabel = hit.condition_type === 'graded'
    ? `${hit.grading_company || ''} ${hit.grade || ''}`.trim()
    : (hit.raw_grade || 'Raw');
  const endsIn = fmtEndsIn(hit.auction_ends_at);

  return (
    <article className="panel" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'stretch' }}>
      <div style={{
        width: 115, height: 161, flexShrink: 0,
        background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 8,
        overflow: 'hidden', display: 'grid', placeItems: 'center',
      }}>
        {photo ? (
          <img src={photo} alt={hit.listing_title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>No photo</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="chip chip-rust" style={{ fontSize: 10 }}>◆ FB Auction match</span>
          <span className="chip" style={{ fontSize: 10, background: 'var(--paper)', color: 'var(--plum)', border: '1.5px solid var(--rule)' }}>
            from your {hit.matched_set_title} list
          </span>
          {endsIn && (
            <span className="chip" style={{ fontSize: 10, background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--plum)', fontWeight: 700 }}>
              ⏱ {endsIn}
            </span>
          )}
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginLeft: 'auto', fontWeight: 600 }}>
            {fmtRelativeTime(hit.auction_created_at)}
          </span>
        </div>

        <h3 className="display" style={{ fontSize: 22, margin: '4px 0 2px', color: 'var(--plum)', lineHeight: 1.2 }}>
          {hit.listing_title || `${hit.year} ${hit.brand} #${hit.card_number} ${hit.player}`}
        </h3>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 6, fontWeight: 500 }}>
          #{hit.card_number} · {conditionLabel} · Lot #{hit.lot_number} of{' '}
          <span style={{ color: 'var(--plum)', fontWeight: 700 }}>{hit.auction_title}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>
          Seller:{' '}
          {hit.seller_email ? (
            <a href={`mailto:${hit.seller_email}?subject=${encodeURIComponent(`Sports Collective: ${hit.listing_title}`)}`}
              style={{ color: 'var(--orange)', fontWeight: 700 }}>
              {hit.seller_handle ? `@${hit.seller_handle}` : hit.seller_name}
            </a>
          ) : (
            <strong style={{ color: 'var(--plum)' }}>{hit.seller_name}</strong>
          )}
          {hit.leading_bidder_name && (
            <>
              {' · Leading bid: '}
              <span className="mono" style={{ fontWeight: 700, color: 'var(--plum)' }}>
                {hit.leading_bidder_fb_handle ? `@${hit.leading_bidder_fb_handle}` : hit.leading_bidder_name}
              </span>
            </>
          )}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="stat-num" style={{ fontSize: 26, color: 'var(--orange)' }}>
            {fmtMoney(hit.current_bid ?? hit.starting_bid)}
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
            {hit.current_bid ? 'current bid' : 'opening bid'}
          </span>
          {hit.comment_url ? (
            <a href={hit.comment_url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
              Bid on Facebook ↗
            </a>
          ) : hit.auction_post_url ? (
            <a href={hit.auction_post_url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
              View auction on Facebook ↗
            </a>
          ) : (
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
              (no link provided)
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
