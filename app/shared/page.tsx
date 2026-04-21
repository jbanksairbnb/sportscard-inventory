'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type SharedSet = {
  share_token: string;
  title: string;
  year: number | null;
  brand: string;
  owner_email: string;
  owned_pct: number;
  row_count: number;
  owned_count: number;
};

const SET_COLORS = ['#e8742c', '#2d7a6e', '#3d1f4a', '#e5b53d', '#c54a2c'];

export default function CommunityPage() {
  const [sets, setSets] = useState<SharedSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [listView, setListView] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data } = await supabase
        .from('sets')
        .select('share_token, title, year, brand, owner_email, owned_pct, row_count, owned_count')
        .not('share_token', 'is', null)
        .order('title', { ascending: true });
      if (data) setSets(data as SharedSet[]);
      setLoading(false);
    }
    load();
  }, []);

  const displayed = sets.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (s.title || '').toLowerCase().includes(q) ||
      (s.owner_email || '').toLowerCase().includes(q) ||
      (s.brand || '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <SCLogo size={80} />
          <p className="eyebrow" style={{ marginTop: 20, color: 'var(--ink-mute)' }}>
            Loading community sets…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto', padding: '10px 28px',
          display: 'flex', alignItems: 'center', gap: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <SCLogo size={44} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 22, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 13, color: 'var(--plum)', letterSpacing: '0.04em' }}>
                COLLECTIVE
              </div>
            </div>
          </div>

          <nav style={{
            display: 'flex', gap: 22, fontSize: 11.5, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-soft)',
          }}>
            <Link href="/" style={{ color: 'inherit' }}>My Shelf</Link>
            <span style={{
              color: 'var(--plum)', borderBottom: '3px solid var(--orange)',
              paddingBottom: 4, cursor: 'default',
            }}>
              Community
            </span>
          </nav>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', border: '2px solid var(--plum)',
              borderRadius: 100, background: 'var(--cream)', width: 240,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: 'var(--plum)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sets…"
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)',
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setListView((v) => !v)}
              className={`btn btn-sm ${listView ? 'btn-primary' : 'btn-ghost'}`}
            >
              {listView ? 'Grid' : 'List'}
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, marginBottom: 32,
        }}>
          <div className="section-head" style={{ flex: 1, marginBottom: 0 }}>
            <span className="eyebrow" style={{ fontSize: 12 }}>★ Community Sets ★</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 700 }}>
              {displayed.length} {displayed.length === 1 ? 'set' : 'sets'}
            </span>
            <Link href="/" className="btn btn-outline btn-sm">← My Shelf</Link>
          </div>
        </div>

        {displayed.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <SCLogo size={60} />
            </div>
            <div className="display" style={{ fontSize: 24, color: 'var(--plum)', marginBottom: 8 }}>
              {sets.length === 0 ? 'No shared sets yet' : 'No sets match your search'}
            </div>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: 0 }}>
              {sets.length === 0 ? 'Be the first to share your collection!' : 'Try a different search term.'}
            </p>
          </div>
        ) : listView ? (
          <div className="panel-bordered" style={{ overflow: 'hidden', padding: 0 }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--plum)' }}>
                  {['Owner', 'Set Title', 'Cards', '% Owned', ''].map((h) => (
                    <th key={h} style={{
                      padding: '10px 16px', textAlign: 'left',
                      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      color: 'var(--mustard)', whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((s, i) => (
                  <tr key={s.share_token} style={{
                    borderTop: '1.5px solid var(--cream-warm)',
                    background: i % 2 === 0 ? 'var(--cream)' : 'var(--paper)',
                  }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--ink-soft)', fontWeight: 500 }}>
                      {s.owner_email || 'Unknown'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span className="display" style={{ fontSize: 14, color: 'var(--plum)' }}>{s.title}</span>
                      {(s.year || s.brand) && (
                        <span className="eyebrow" style={{ marginLeft: 8, fontSize: 9, color: 'var(--ink-mute)' }}>
                          {[s.year, s.brand].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
                      {s.owned_count} / {s.row_count}
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--teal)', fontWeight: 700 }}>
                      {(s.owned_pct || 0).toFixed(1)}%
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Link href={`/share/${s.share_token}`} className="btn btn-primary btn-sm">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {displayed.map((s, i) => {
              const color = SET_COLORS[i % SET_COLORS.length];
              const pct = s.owned_pct || 0;
              const yearShort = s.year ? `'${String(s.year).slice(2)}` : '—';
              return (
                <Link key={s.share_token} href={`/share/${s.share_token}`} style={{ textDecoration: 'none' }}>
                  <div
                    className="panel"
                    style={{ padding: '16px 18px', transition: 'transform 0.15s, box-shadow 0.15s', cursor: 'pointer' }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 0 var(--plum)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.transform = '';
                      (e.currentTarget as HTMLElement).style.boxShadow = '';
                    }}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
                      <div style={{
                        width: 46, height: 46, background: color, color: 'var(--cream)',
                        display: 'grid', placeItems: 'center',
                        fontFamily: 'var(--font-display)', fontSize: 16,
                        borderRadius: 8, border: '2px solid var(--plum)',
                        boxShadow: '0 2px 0 var(--plum)', flexShrink: 0,
                      }}>
                        {yearShort}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="eyebrow" style={{ fontSize: 8.5, color: 'var(--orange)', marginBottom: 3 }}>
                          {[s.year, s.brand].filter(Boolean).join(' · ')}
                        </div>
                        <div className="display" style={{ fontSize: 15, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2, fontWeight: 500 }}>
                          {s.owner_email || 'Unknown'}
                        </div>
                      </div>
                    </div>
                    <div className="progress" style={{ marginBottom: 6 }}>
                      <span style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                    </div>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontFamily: 'var(--font-mono)', fontSize: 10.5,
                      color: 'var(--ink-soft)', fontWeight: 600,
                    }}>
                      <span>{s.owned_count} / {s.row_count} cards</span>
                      <span style={{ color: 'var(--teal)' }}>{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <footer style={{
        borderTop: '3px solid var(--plum)', padding: '24px 28px',
        maxWidth: 1280, margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: 'var(--plum)', fontSize: 11.5, letterSpacing: '0.12em',
        textTransform: 'uppercase', fontWeight: 700,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SCLogo size={32} />
          <div style={{ lineHeight: 0.9 }}>
            <div className="wordmark" style={{ fontSize: 16, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 10, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <span>Est. 2023</span>
          <span>Keep on collectin&apos;</span>
        </div>
      </footer>
    </div>
  );
}
