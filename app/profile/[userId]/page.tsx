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
  avatar_url: string | null;
  favorite_cards: (string | null)[] | null;
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

type Stats = { cards_owned: number; sets_tracked: number; want_list: number };

const SET_COLORS = ['#e8742c', '#2d7a6e', '#3d1f4a', '#e5b53d', '#c54a2c'];

export default function ProfilePage() {
  const params = useParams();
  const userId = String(params?.userId || '');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [sets, setSets] = useState<SharedSet[]>([]);
  const [stats, setStats] = useState<Stats>({ cards_owned: 0, sets_tracked: 0, want_list: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    async function load() {
      const [{ data: profileData }, { data: setsData }, { data: allSets }] = await Promise.all([
        supabase.from('user_profiles')
          .select('display_name, handle, bio, city, team, favorite_players, chasing, avatar_url, favorite_cards')
          .eq('user_id', userId).single(),
        supabase.from('sets')
          .select('share_token, title, year, brand, row_count, owned_count, owned_pct')
          .eq('user_id', userId)
          .not('share_token', 'is', null)
          .order('year', { ascending: true }),
        supabase.from('sets')
          .select('row_count, owned_count')
          .eq('user_id', userId),
      ]);
      setProfile(profileData as Profile | null);
      setSets((setsData || []) as SharedSet[]);
      const arr = (allSets || []) as { row_count: number | null; owned_count: number | null }[];
      setStats({
        cards_owned: arr.reduce((n, s) => n + (s.owned_count || 0), 0),
        sets_tracked: arr.length,
        want_list: arr.reduce((n, s) => n + Math.max(0, (s.row_count || 0) - (s.owned_count || 0)), 0),
      });
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
  const favorites = (profile?.favorite_cards || []).filter((u): u is string => !!u);

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/members" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <Link href="/members" className="btn btn-outline btn-sm">← Members</Link>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '40px 28px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 32, alignItems: 'start' }}>
          <aside>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <div style={{
                width: 140, height: 140, borderRadius: '50%',
                border: '3px solid var(--plum)', boxShadow: '0 4px 0 var(--plum)',
                background: profile?.avatar_url
                  ? `var(--cream) url(${profile.avatar_url}) center/cover no-repeat`
                  : 'var(--mustard)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontSize: 48, color: 'var(--plum)', fontWeight: 700,
              }}>
                {!profile?.avatar_url && name.slice(0, 1).toUpperCase()}
              </div>
            </div>
            <div className="panel-bordered" style={{ padding: 24 }}>
              <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--orange)' }}>★ The Collector ★</div>
              <div className="display" style={{ fontSize: 26, color: 'var(--plum)', marginBottom: 4 }}>{name}</div>
              {profile?.handle && (
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 12 }}>@{profile.handle}</div>
              )}
              {profile?.bio && (
                <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                  &quot;{profile.bio}&quot;
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
            {favorites.length > 0 && (
              <FavoritesShowcaseReadonly images={profile?.favorite_cards || []} />
            )}

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

        <section style={{ marginTop: 40 }}>
          <div className="panel-bordered" style={{ padding: '24px 28px', position: 'relative' }}>
            <div style={{
              position: 'absolute', top: -13, left: 24, background: 'var(--orange)', color: 'var(--cream)',
              padding: '3px 14px', border: '2px solid var(--plum)', borderRadius: 100,
              fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700,
              letterSpacing: '0.18em', textTransform: 'uppercase', boxShadow: '0 2px 0 var(--plum)',
            }}>★ The Record ★</div>
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              <RecordStat label="Cards Owned" value={stats.cards_owned.toLocaleString()} sub="across the collection" />
              <div style={{ width: 1, borderLeft: '2px dotted var(--plum)', margin: '0 24px', flexShrink: 0 }} />
              <RecordStat label="Sets Tracked" value={stats.sets_tracked.toLocaleString()} sub="binders in motion" />
              <div style={{ width: 1, borderLeft: '2px dotted var(--plum)', margin: '0 24px', flexShrink: 0 }} />
              <RecordStat label="Want List" value={stats.want_list.toLocaleString()} sub="chasing" />
            </div>
          </div>
        </section>
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
        <Link href="/members" style={{ color: 'inherit', textDecoration: 'none' }}>← Members</Link>
      </footer>
    </div>
  );
}

function RecordStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 6 }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 38 }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)', marginTop: 3, fontWeight: 600 }}>{sub}</div>
    </div>
  );
}

function FavoritesShowcaseReadonly({ images }: { images: (string | null)[] }) {
  const slots = Array.from({ length: 6 }, (_, i) => images[i] ?? null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const filled = slots.filter((u): u is string => !!u);

  return (
    <section style={{ marginBottom: 32 }}>
      <div className="section-head" style={{ marginBottom: 14 }}>
        <span className="eyebrow" style={{ fontSize: 12 }}>★ Favorite Cards ★</span>
      </div>
      <div style={{
        position: 'relative', padding: '28px 20px 22px',
        background: 'var(--plum)', border: '2px solid var(--plum)',
        borderRadius: 16, boxShadow: '0 4px 0 var(--plum-deep)', overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
          {slots.map((url, i) => {
            const w = 130;
            const h = Math.round(w * 1.4);
            const tilt = (i % 2 === 0 ? -1 : 1) * (1.2 + (i % 3) * 0.5);
            if (!url) {
              return (
                <div key={i} style={{ transform: `rotate(${tilt}deg)` }}>
                  <div style={{
                    width: w, height: h, borderRadius: 8,
                    border: '2px dashed rgba(248,236,208,0.4)',
                    background: 'rgba(248,236,208,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'rgba(248,236,208,0.45)', fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.16em', textTransform: 'uppercase',
                  }}>
                    Empty
                  </div>
                </div>
              );
            }
            return (
              <div key={i} style={{ transform: `rotate(${tilt}deg)` }}>
                <div onClick={() => setLightbox(i)}
                  style={{
                    width: w, height: h, borderRadius: 8, overflow: 'hidden',
                    border: '2px solid var(--plum)', boxShadow: '0 3px 0 var(--plum)',
                    background: `var(--cream) url(${url}) center/cover no-repeat`,
                    cursor: 'pointer',
                  }} />
              </div>
            );
          })}
        </div>
      </div>
      {lightbox !== null && (
        <FavoriteLightboxReadonly images={filled} startUrl={slots[lightbox]!} onClose={() => setLightbox(null)} />
      )}
    </section>
  );
}

function FavoriteLightboxReadonly({ images, startUrl, onClose }: {
  images: string[]; startUrl: string; onClose: () => void;
}) {
  const [idx, setIdx] = useState(Math.max(0, images.indexOf(startUrl)));
  const url = images[idx];
  if (!url) return null;
  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(42,20,52,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '85vh' }}>
        <img src={url} alt="Favorite card" style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 12, display: 'block' }} />
        {images.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button type="button" onClick={() => setIdx((idx - 1 + images.length) % images.length)} className="btn btn-sm">← Prev</button>
            <span className="mono" style={{ color: 'var(--cream)', fontSize: 12, alignSelf: 'center' }}>{idx + 1} / {images.length}</span>
            <button type="button" onClick={() => setIdx((idx + 1) % images.length)} className="btn btn-sm">Next →</button>
          </div>
        )}
        <button type="button" onClick={onClose}
          style={{
            position: 'absolute', top: -16, right: -16,
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--cream)', border: '2px solid var(--plum)',
            cursor: 'pointer', fontSize: 16, color: 'var(--plum)', fontWeight: 700,
          }}>✕</button>
      </div>
    </div>
  );
}
