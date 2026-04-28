'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const RAW_GRADES = ['Gem Mint', 'Mint', 'NM-MT', 'NM', 'EXMT', 'EX', 'VG-EX', 'VG', 'G', 'P'];
const GRADING_COMPANIES = ['PSA', 'SGC', 'BGS', 'CGC', 'TAG'];

type WantRow = {
  setSlug: string;
  setTitle: string;
  year: number;
  brand: string;
  cardNumber: string;
  player: string;
  targetConditionLow: string;
  targetConditionHigh: string;
  targetType: string; // "Raw" | "Graded" | ""
  targetGradingCompanies: string[]; // empty array = any company
};

type Listing = {
  id: string;
  user_id: string;
  title: string;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: 'raw' | 'graded';
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  shipping_options: { label: string; cost: number }[];
  photos: string[];
  status: string;
  created_at: string;
};

type Hit = Listing & {
  seller_name: string;
  seller_handle: string;
  seller_email: string;
  matched_set_title: string;
};

type FilterId = 'all' | 'raw' | 'PSA' | 'SGC' | 'BGS' | 'CGC' | 'TAG';

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

function classifyTarget(target: string): 'raw' | 'graded' | 'blank' {
  const t = (target || '').trim();
  if (!t) return 'blank';
  if (RAW_GRADES.includes(t)) return 'raw';
  if (/^\d+(\.\d+)?$/.test(t)) return 'graded';
  return 'graded';
}

function matchesCondition(listing: Listing, want: WantRow): boolean {
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
    if (targetType === 'raw') return listing.condition_type === 'raw';
    if (targetType === 'graded') {
      if (listing.condition_type !== 'graded') return false;
      if (want.targetGradingCompanies.length > 0 && !want.targetGradingCompanies.includes(listing.grading_company || '')) return false;
      return true;
    }
  }

  if (targetType === 'raw') {
    if (listing.condition_type !== 'raw') return false;
    const listingRank = rawRank(listing.raw_grade);
    if (listingRank === null) return false;
    const lowRank = lowBlank ? 0 : rawRank(want.targetConditionLow);
    const highRank = highBlank ? 999 : rawRank(want.targetConditionHigh);
    if (lowRank === null || highRank === null) return false;
    return listingRank >= lowRank && listingRank <= highRank;
  }

  if (targetType === 'graded') {
    if (listing.condition_type !== 'graded' || !listing.grade) return false;
    if (want.targetGradingCompanies.length > 0 && !want.targetGradingCompanies.includes(listing.grading_company || '')) return false;
    const grade = parseFloat(listing.grade);
    if (Number.isNaN(grade)) return false;
    const low = lowBlank ? 1 : gradedNumeric(want.targetConditionLow);
    const high = highBlank ? 10 : gradedNumeric(want.targetConditionHigh);
    if (low === null || high === null) return false;
    return grade >= low && grade <= high;
  }
  return false;
}
function matchesListing(listing: Listing, want: WantRow): boolean {
  if (listing.year !== want.year) return false;
  if ((listing.brand || '').trim().toLowerCase() !== want.brand.trim().toLowerCase()) return false;
  if ((listing.player || '').trim().toLowerCase() !== want.player.trim().toLowerCase()) return false;
  if ((listing.card_number || '').trim() !== want.cardNumber.trim()) return false;
  return matchesCondition(listing, want);
}

export default function WantListHitsFeed() {
  const [loading, setLoading] = useState(true);
  const [hits, setHits] = useState<Hit[]>([]);
  const [filter, setFilter] = useState<FilterId>('all');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

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

          let targetType: string;
          let targetLow: string;
          let targetHigh: string;
          let targetCompaniesRaw: string;
          if (hasExplicit) {
            targetType = explicitType;
            targetLow = explicitLow;
            targetHigh = explicitHigh;
            targetCompaniesRaw = explicitCompaniesRaw;
          } else {
            targetType = (setDefault.type || '').trim();
            targetLow = (setDefault.low || '').trim();
            targetHigh = (setDefault.high || '').trim();
            targetCompaniesRaw = (setDefault.companies || '').trim();
          }

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

      const years = Array.from(new Set(wants.map(w => w.year).filter(y => y > 0)));
      const yearBrandKeys = new Set(wants.map(w => `${w.year}|${w.brand.trim().toLowerCase()}`));

      const { data: listings } = await supabase
        .from('listings')
        .select('*')
        .eq('status', 'active')
        .neq('user_id', user.id)
        .in('year', years)
        .order('created_at', { ascending: false })
        .limit(500);

      const candidates = (listings || []).filter(l => {
        const key = `${l.year}|${(l.brand || '').trim().toLowerCase()}`;
        return yearBrandKeys.has(key);
      }) as Listing[];

      const matched: { listing: Listing; want: WantRow }[] = [];
      for (const l of candidates) {
        const w = wants.find(want => matchesListing(l, want));
        if (w) matched.push({ listing: l, want: w });
      }

      const sellerIds = Array.from(new Set(matched.map(m => m.listing.user_id)));
      const { data: profiles } = sellerIds.length > 0
        ? await supabase.from('user_profiles').select('user_id, display_name, handle, email').in('user_id', sellerIds)
        : { data: [] as { user_id: string; display_name: string | null; handle: string | null; email: string | null }[] };
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      const enriched: Hit[] = matched.map(({ listing, want }) => {
        const profile = profileMap.get(listing.user_id);
        const email = profile?.email || '';
        return {
          ...listing,
          seller_name: profile?.display_name || profile?.handle || (email ? email.split('@')[0] : '—'),
          seller_handle: profile?.handle || '',
          seller_email: email,
          matched_set_title: want.setTitle,
        };
      });

      setHits(enriched);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return hits;
    if (filter === 'raw') return hits.filter(h => h.condition_type === 'raw');
    return hits.filter(h => h.condition_type === 'graded' && h.grading_company === filter);
  }, [hits, filter]);

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = { all: hits.length, raw: 0, PSA: 0, SGC: 0, BGS: 0, CGC: 0, TAG: 0 };
    for (const h of hits) {
      if (h.condition_type === 'raw') c.raw++;
      else if (h.grading_company && (GRADING_COMPANIES as readonly string[]).includes(h.grading_company)) {
        c[h.grading_company as FilterId]++;
      }
    }
    return c;
  }, [hits]);

  if (loading) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
        Scanning your want list…
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>No want-list hits yet</div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          Add unowned cards with target conditions to your <strong>sets</strong>. When another collector lists a matching card,
          it'll appear here automatically.
        </p>
      </div>
    );
  }

  const filterPills: { id: FilterId; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'raw', label: 'Raw' },
    { id: 'PSA', label: 'PSA' },
    { id: 'SGC', label: 'SGC' },
    { id: 'BGS', label: 'BGS' },
    { id: 'CGC', label: 'CGC' },
    { id: 'TAG', label: 'TAG' },
  ];

  return (
    <div>
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14,
        padding: '8px 12px', background: 'var(--paper)', borderRadius: 100, border: '1.5px solid var(--rule)',
        alignItems: 'center', alignSelf: 'flex-start', width: 'fit-content', maxWidth: '100%',
      }}>
        <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginRight: 6 }}>FILTER</span>
        {filterPills.map(p => {
          const count = counts[p.id];
          if (p.id !== 'all' && count === 0) return null;
          const active = filter === p.id;
          return (
            <button key={p.id} onClick={() => setFilter(p.id)}
              style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                padding: '4px 11px', borderRadius: 100,
                background: active ? 'var(--plum)' : 'transparent',
                color: active ? 'var(--mustard)' : 'var(--plum)',
                border: active ? '1.5px solid var(--plum)' : '1.5px solid transparent',
                cursor: 'pointer',
              }}>
              {p.label} <span style={{ opacity: 0.7, marginLeft: 2 }}>({count})</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {filtered.map(h => <HitItem key={h.id} hit={h} />)}
        {filtered.length === 0 && (
          <div className="panel" style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
            No matches with this filter. Try "All".
          </div>
        )}
      </div>
    </div>
  );
}

function HitItem({ hit }: { hit: Hit }) {
  const photo = hit.photos?.[0];
  const conditionLabel = hit.condition_type === 'graded'
    ? `${hit.grading_company || ''} ${hit.grade || ''}`.trim()
    : (hit.raw_grade || 'Raw');
  const minShipping = hit.shipping_options?.length
    ? Math.min(...hit.shipping_options.map(o => Number(o.cost) || 0))
    : null;

  return (
    <article className="panel" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'stretch' }}>
      <div style={{
        width: 115, height: 161, flexShrink: 0,
        background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 8,
        overflow: 'hidden', display: 'grid', placeItems: 'center',
      }}>
        {photo ? (
          <img src={photo} alt={hit.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>No photo</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="chip chip-rust" style={{ fontSize: 10 }}>◆ Want-list match</span>
          <span className="chip" style={{ fontSize: 10, background: 'var(--paper)', color: 'var(--plum)', border: '1.5px solid var(--rule)' }}>
            from your {hit.matched_set_title} list
          </span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginLeft: 'auto', fontWeight: 600 }}>
            {fmtRelativeTime(hit.created_at)}
          </span>
        </div>

        <h3 className="display" style={{ fontSize: 22, margin: '4px 0 2px', color: 'var(--plum)', lineHeight: 1.2 }}>
          {hit.title}
        </h3>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8, fontWeight: 500 }}>
          #{hit.card_number} · {conditionLabel} · listed by{' '}
          {hit.seller_email ? (
            <a href={`mailto:${hit.seller_email}?subject=${encodeURIComponent(`Sports Collective: ${hit.title}`)}`}
              style={{ color: 'var(--orange)', fontWeight: 700 }}>
              {hit.seller_handle ? `@${hit.seller_handle}` : hit.seller_name}
            </a>
          ) : (
            <strong style={{ color: 'var(--plum)' }}>{hit.seller_name}</strong>
          )}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="stat-num" style={{ fontSize: 26, color: 'var(--orange)' }}>
            {fmtMoney(hit.asking_price)}
          </div>
          {minShipping !== null && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
              + {fmtMoney(minShipping)} shipping
            </span>
          )}
          <Link href="/marketplace" className="btn btn-primary btn-sm">View on marketplace</Link>
        </div>
      </div>
    </article>
  );
}
