'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type ConditionType = 'raw' | 'graded';

type ListingHit = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: ConditionType;
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  photos: string[];
  seller_handle: string | null;
  seller_display_name: string | null;
};

type PersonHit = {
  user_id: string;
  display_name: string | null;
  handle: string | null;
  city: string | null;
  team: string | null;
  bio: string | null;
};

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQ);
  const [committedQuery, setCommittedQuery] = useState(initialQ);
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<ListingHit[]>([]);
  const [people, setPeople] = useState<PersonHit[]>([]);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const [{ data: rows }, { data: profiles }] = await Promise.all([
        supabase
          .from('listings')
          .select('id, user_id, title, description, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, asking_price, photos')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('user_profiles')
          .select('user_id, display_name, handle, city, team, bio')
          .limit(500),
      ]);

      const sellerIds = Array.from(new Set((rows || []).map(r => r.user_id)));
      const { data: sellerProfiles } = sellerIds.length > 0
        ? await supabase.from('user_profiles').select('user_id, handle, display_name').in('user_id', sellerIds)
        : { data: [] as { user_id: string; handle: string | null; display_name: string | null }[] };
      const sellerMap = new Map((sellerProfiles || []).map(p => [p.user_id, p]));

      setListings((rows || []).map(r => ({
        ...r,
        seller_handle: sellerMap.get(r.user_id)?.handle || null,
        seller_display_name: sellerMap.get(r.user_id)?.display_name || null,
      })) as ListingHit[]);
      setPeople((profiles || []) as PersonHit[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const filteredListings = useMemo(() => {
    const q = committedQuery.trim();
    if (!q) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return listings.filter(l => {
      const hay = [l.title, l.player, l.brand, l.card_number, l.description, l.seller_handle, l.seller_display_name].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [listings, committedQuery]);

  const filteredPeople = useMemo(() => {
    const q = committedQuery.trim();
    if (!q) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return people.filter(p => {
      const hay = [p.display_name, p.handle, p.city, p.team, p.bio].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [people, committedQuery]);

  function submitSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const q = query.trim();
    setCommittedQuery(q);
    const url = q ? `/search?q=${encodeURIComponent(q)}` : '/search';
    window.history.replaceState(null, '', url);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    );
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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Search ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px' }}>
        <form onSubmit={submitSearch} style={{ marginBottom: 24 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
            border: '2px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
          }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search listings or people — multiple terms supported (e.g. 1971 Topps Munson)"
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontFamily: 'var(--font-body)', fontSize: 14, flex: 1, color: 'var(--plum)',
              }}
            />
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
          </div>
        </form>

        {!committedQuery.trim() && (
          <div className="panel-bordered" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              Type a few words to search across <strong>active marketplace listings</strong> and <strong>collector profiles</strong>.<br />
              All terms must appear in the result. Examples: <span className="mono">1971 Topps Munson</span> or <span className="mono">Jonathan Vienna</span>.
            </p>
          </div>
        )}

        {committedQuery.trim() && (
          <>
            <section style={{ marginBottom: 32 }}>
              <div className="section-head" style={{ marginBottom: 14 }}>
                <span className="eyebrow" style={{ fontSize: 12 }}>★ Listings ({filteredListings.length}) ★</span>
              </div>
              {filteredListings.length === 0 ? (
                <div className="panel" style={{ padding: 18, fontSize: 13, color: 'var(--ink-mute)' }}>
                  No marketplace listings matched all of those terms.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
                  {filteredListings.slice(0, 60).map(l => {
                    const photo = l.photos?.[0];
                    return (
                      <Link key={l.id} href={`/marketplace?q=${encodeURIComponent(committedQuery)}`} className="panel-bordered" style={{
                        textDecoration: 'none', color: 'inherit', padding: 0, overflow: 'hidden',
                        display: 'flex', flexDirection: 'column',
                      }}>
                        <div style={{ aspectRatio: '4 / 5', background: 'var(--paper)', display: 'grid', placeItems: 'center', overflow: 'hidden', borderBottom: '1.5px solid var(--rule)' }}>
                          {photo ? (
                            <img src={photo} alt={l.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span className="eyebrow" style={{ color: 'var(--ink-mute)', fontSize: 10 }}>No photo</span>
                          )}
                        </div>
                        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                          <div className="display" style={{ fontSize: 14, color: 'var(--plum)', lineHeight: 1.3 }}>{l.title}</div>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 600 }}>
                            {l.seller_display_name || l.seller_handle || '—'}
                          </div>
                          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--orange)' }}>{fmtMoney(l.asking_price)}</span>
                            <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>View →</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
              {filteredListings.length > 60 && (
                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <Link href={`/marketplace?q=${encodeURIComponent(committedQuery)}`} className="btn btn-outline btn-sm">
                    See all {filteredListings.length} in Marketplace →
                  </Link>
                </div>
              )}
            </section>

            <section>
              <div className="section-head" style={{ marginBottom: 14 }}>
                <span className="eyebrow" style={{ fontSize: 12 }}>★ People ({filteredPeople.length}) ★</span>
              </div>
              {filteredPeople.length === 0 ? (
                <div className="panel" style={{ padding: 18, fontSize: 13, color: 'var(--ink-mute)' }}>
                  No collectors matched all of those terms.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredPeople.slice(0, 30).map(p => (
                    <Link key={p.user_id} href={`/profile/${p.user_id}`} className="panel" style={{
                      padding: 14, textDecoration: 'none', color: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 14,
                    }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: '50%',
                        background: 'var(--mustard)', color: 'var(--plum)',
                        display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 16,
                        border: '2px solid var(--plum)', flexShrink: 0,
                      }}>
                        {(p.display_name || p.handle || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--plum)' }}>{p.display_name || p.handle || 'Collector'}</div>
                        {p.handle && <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>@{p.handle}</div>}
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                          {[p.city, p.team].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>View →</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
