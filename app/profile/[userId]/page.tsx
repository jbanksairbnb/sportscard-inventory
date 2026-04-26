'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Profile = {
  display_name: string | null;
  handle: string | null;
  bio: string | null;
  city: string | null;
  team: string | null;
  favorite_players: string | null;
  chasing: string | null;
};

type SharedSet = {
  share_token: string;
  title: string;
  year: number | null;
  brand: string;
  row_count: number;
  owned_count: number;
  owned_pct: number;
};

const SET_COLORS = ['#e8742c', '#2d7a6e', '#3d1f4a', '#e5b53d', '#c54a2c'];

export default function ProfilePage() {
  const params = useParams();
  const userId = String(params?.userId || '');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [sets, setSets] = useState<SharedSet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    async function load() {
      const [{ data: profileData }, { data: setsData }] = await Promise.all([
        supabase.from('user_profiles')
          .select('display_name, handle, bio, city, team, favorite_players, chasing')
          .eq('user_id', userId).single(),
        supabase.from('sets')
          .select('share_token, title, year, brand, row_count, owned_count, owned_pct')
          .eq('user_id', userId)
          .not('share_token', 'is', null)
          .order('year', { ascending: true }),
      ]);
      setProfile(profileData as Profile | null);
      setSets((setsData || []) as SharedSet[]);
      setLoading(false);
    }
    load();
  }, [userId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <SCLogo size={80} />
          <p className="eyebrow" style={{ marginTop: 20, color: 'var(--ink-mute)' }}>Loading profile…</p>
        </div>
      </div>
    );
  }

  const name = profile?.display_name || profile?.handle || 'Collector';
  const players = profile?.favorite_players
    ? profile.favorite_players.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/shared" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <Link href="/shared" className="btn btn-outline btn-sm">← Community</Link>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '40px 28px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 32, alignItems: 'start' }}>
          <aside>
            <div className="panel-bordered" style={{ padding: 24 }}>
              <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--orange)' }}>★ The Collector ★</div>
              <div className="display" style={{ fontSize: 26, color: 'var(--plum)', marginBottom: 4 }}>{name}</div>
              {profile?.handle && (
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 12 }}>@{profile.handle}</div>
              )}
              {profile?.bio && (
                <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                  "{profile.bio}"
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 14px', fontSize: 12.5 }}>
                {profile?.city && <>
                  <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', alignSelf: 'center' }}>Home</span>
                  <span style={{ fontWeight: 500 }}>{profile.city}</span>
                </>}
                {profile?.team && <>
                  <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', alignSelf: 'center' }}>Team</span>
                  <span style={{ fontWeight: 500 }}>{profile.team}</span>
                </>}
                {players.length > 0 && <>
                  <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', alignSelf: 'start', paddingTop: 2 }}>Roster</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {players.map(p => <span key={p} className="chip" style={{ fontSize: 9.5 }}>{p}</span>)}
                  </div>
                </>}
                {profile?.chasing && <>
                  <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', alignSelf: 'center' }}>Chasing</span>
                  <span style={{ fontWeight: 500 }}>{profile.chasing}</span>
                </>}
              </div>
            </div>
          </aside>

          <main>
            <div className="section-head" style={{ marginBottom: 20 }}>
              <span className="eyebrow" style={{ fontSize: 12 }}>★ Shared Sets ★</span>
            </div>
            {sets.length === 0 ? (
              <div className="panel-bordered" style={{ padding: '40px 32px', textAlign: 'center' }}>
                <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>No shared sets</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {sets.map((s, i) => {
                  const color = SET_COLORS[i % SET_COLORS.length];
                  const pct = s.owned_pct || 0;
                  const yearShort = s.year ? `'${String(s.year).slice(2)}` : '—';
                  return (
                    <Link key={s.share_token} href={`/share/${s.share_token}`} style={{ textDecoration: 'none' }}>
                      <div className="panel" style={{ padding: '16px 18px', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                          <div style={{
                            width: 44, height: 44, background: color, color: 'var(--cream)',
                            display: 'grid', placeItems: 'center',
                            fontFamily: 'var(--font-display)', fontSize: 16,
                            borderRadius: 8, border: '2px solid var(--plum)',
                            boxShadow: '0 2px 0 var(--plum)', flexShrink: 0,
                          }}>{yearShort}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="eyebrow" style={{ fontSize: 8.5, color: 'var(--orange)', marginBottom: 2 }}>
                              {[s.year, s.brand].filter(Boolean).join(' · ')}
                            </div>
                            <div className="display" style={{ fontSize: 14, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.title}
                            </div>
                          </div>
                        </div>
                        <div className="progress" style={{ marginBottom: 5 }}>
                          <span style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
                          <span>{s.owned_count} / {s.row_count} cards</span>
                          <span style={{ color: 'var(--teal)' }}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </main>
        </div>
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
        <Link href="/shared" style={{ color: 'inherit', textDecoration: 'none' }}>← Community Sets</Link>
      </footer>
    </div>
  );
}
