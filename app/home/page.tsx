'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BellIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CameraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function TradeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PinIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function DiamondIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <rect x="4" y="4" width="16" height="16" transform="rotate(45 12 12)" />
    </svg>
  );
}

const MOCK_USER = {
  name: 'Jonathan Banks',
  handle: 'jbanks53',
  city: 'Vienna, VA',
  team: 'Los Angeles Dodgers',
  joined: 'Est. 2023',
};

type SetRow = {
  slug: string;
  title: string;
  year: number;
  brand: string;
  row_count: number;
  owned_count: number;
  owned_pct: number;
  total_value: number;
  updated_at: number;
};

function RainbowArc({ width = 200, height = 44 }: { width?: number; height?: number }) {
  const arcs = [
    { c: '#c54a2c', r: 42 },
    { c: '#e8742c', r: 34 },
    { c: '#e5b53d', r: 26 },
    { c: '#2d7a6e', r: 18 },
  ];
  return (
    <svg width={width} height={height} viewBox="0 0 200 44" style={{ display: 'block' }}>
      {arcs.map((b, i) => (
        <path key={i} d={`M ${100 - b.r} 44 A ${b.r} ${b.r} 0 0 1 ${100 + b.r} 44`}
          fill="none" stroke={b.c} strokeWidth="7" strokeLinecap="butt" />
      ))}
    </svg>
  );
}

function LogoShowcase() {
  return (
    <section style={{ maxWidth: 1280, margin: '28px auto 0', padding: '0 28px' }}>
      <div style={{
        position: 'relative', background: 'var(--cream)', border: '2px solid var(--plum)',
        borderRadius: 16, boxShadow: '0 4px 0 var(--plum)', padding: '24px 28px',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 28, alignItems: 'center', overflow: 'hidden',
      }}>
        <svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid slice"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.25, pointerEvents: 'none' }}>
          <g transform="translate(400 100)">
            {Array.from({ length: 20 }).map((_, i) => {
              const a = (i / 20) * Math.PI * 2;
              return <polygon key={i} points="-18,0 18,0 0,-500"
                fill={i % 2 === 0 ? '#e5b53d' : '#e8742c'} transform={`rotate(${(a * 180) / Math.PI})`} />;
            })}
          </g>
        </svg>
        <div style={{ position: 'relative' }}><SCLogo size={150} /></div>
        <div style={{ position: 'relative' }}>
          <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--orange)' }}>★ Introducing ★</div>
          <div className="wordmark" style={{ fontSize: 60, color: 'var(--orange)', lineHeight: 1, textShadow: '3px 3px 0 var(--mustard), 5px 5px 0 var(--plum)' }}>Sports</div>
          <div className="display" style={{ fontSize: 44, color: 'var(--plum)', letterSpacing: '0.04em', marginTop: -4 }}>COLLECTIVE</div>
          <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--ink-soft)', maxWidth: 460, lineHeight: 1.5, fontWeight: 500 }}>
            A home for collectors. Manage your binder, chase want lists, and swap doubles with the crew.
          </p>
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <RainbowArc width={200} height={44} />
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="chip chip-rust">Collect</span>
            <span className="chip chip-gold">Trade</span>
            <span className="chip chip-forest">Connect</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Hero({ avatar, cover, onAvatarChange, onCoverChange }: {
  avatar: string | null; cover: string | null;
  onAvatarChange: (url: string) => void; onCoverChange: (url: string) => void;
}) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>, cb: (url: string) => void) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => cb(reader.result as string);
    reader.readAsDataURL(file);
  }

  const initials = MOCK_USER.name.split(' ').map((s) => s[0]).slice(0, 2).join('');

  return (
    <section>
      <div className="halftone" style={{
        position: 'relative', height: 360,
        background: cover ? `url(${cover}) center/cover` : 'linear-gradient(135deg, #3d1f4a 0%, #2a1434 40%, #1f5a50 100%)',
        borderBottom: '3px solid var(--plum)', overflow: 'hidden',
      }}>
        {!cover && (
          <svg viewBox="0 0 1280 360" preserveAspectRatio="xMidYMid slice"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <g transform="translate(640 360)">
              {Array.from({ length: 16 }).map((_, i) => {
                const a = -Math.PI + (i / 15) * Math.PI;
                const fill = i % 2 === 0 ? 'rgba(229,181,61,0.25)' : 'rgba(232,116,44,0.18)';
                return <polygon key={i} points="-40,0 40,0 0,-700" fill={fill} transform={`rotate(${(a * 180) / Math.PI})`} />;
              })}
            </g>
            {[{ c: '#c54a2c', r: 220 }, { c: '#e8742c', r: 190 }, { c: '#e5b53d', r: 160 }, { c: '#2d7a6e', r: 130 }].map((b, i) => (
              <path key={i} d={`M ${640 - b.r} 360 A ${b.r} ${b.r} 0 0 1 ${640 + b.r} 360`} fill="none" stroke={b.c} strokeWidth="22" />
            ))}
            {([[120,60,14],[220,120,8],[1100,80,16],[1180,160,10],[90,200,10],[1200,260,12],[1060,220,7]] as [number,number,number][]).map(([x,y,s],i) => (
              <polygon key={i}
                points={`${x},${y-s} ${x+s/3},${y-s/3} ${x+s},${y} ${x+s/3},${y+s/3} ${x},${y+s} ${x-s/3},${y+s/3} ${x-s},${y} ${x-s/3},${y-s/3}`}
                fill="#e5b53d" opacity="0.8" />
            ))}
            <text x="640" y="90" textAnchor="middle" fontFamily="Pacifico, cursive" fontSize="38" fill="rgba(245,233,208,0.3)">
              Welcome to the Collective
            </text>
          </svg>
        )}
        <div style={{ position: 'absolute', top: 18, left: 22 }}>
          <span className="chip chip-gold"><DiamondIcon size={10} /> Charter Member · {MOCK_USER.joined}</span>
        </div>
        <div style={{ position: 'absolute', top: 18, right: 22 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => coverInputRef.current?.click()}
            style={{ background: 'rgba(245,233,208,0.95)' }}>
            <CameraIcon size={13} /> Change cover
          </button>
          <input ref={coverInputRef} type="file" accept="image/*" onChange={(e) => handleFile(e, onCoverChange)} style={{ display: 'none' }} />
        </div>
      </div>

      <div style={{
        maxWidth: 1280, margin: '0 auto', padding: '0 28px',
        display: 'flex', alignItems: 'flex-start', gap: 24, marginTop: -86, position: 'relative',
      }}>
        <div style={{ position: 'relative', width: 172, height: 172, flexShrink: 0 }}>
          <div className="avatar" data-shape="circle" style={{ width: 172, height: 172 }}>
            {avatar ? <img src={avatar} alt={MOCK_USER.name} /> : (
              <div style={{
                width: '100%', height: '100%', display: 'grid', placeItems: 'center',
                background: 'linear-gradient(135deg, var(--plum) 0%, var(--plum-deep) 100%)',
                color: 'var(--mustard)', fontFamily: 'var(--font-display)', fontSize: 62,
              }}>{initials}</div>
            )}
          </div>
          <button onClick={() => avatarInputRef.current?.click()} title="Change profile picture" style={{
            position: 'absolute', right: 4, bottom: 4, width: 38, height: 38, borderRadius: '50%',
            background: 'var(--orange)', color: 'var(--cream)', display: 'grid', placeItems: 'center',
            border: '2.5px solid var(--plum)', boxShadow: '0 2px 0 var(--plum)',
          }}><CameraIcon size={16} /></button>
          <input ref={avatarInputRef} type="file" accept="image/*" onChange={(e) => handleFile(e, onAvatarChange)} style={{ display: 'none' }} />
        </div>

        <div style={{ flex: 1, paddingTop: 96 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--orange)' }}>★ Collector · Vienna, Virginia ★</div>
              <h1 className="display" style={{ fontSize: 62, margin: 0, color: 'var(--plum)', lineHeight: 0.95 }}>{MOCK_USER.name}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, fontSize: 13, color: 'var(--ink-soft)', fontWeight: 500 }}>
                <span className="mono" style={{ fontWeight: 600 }}>@{MOCK_USER.handle}</span>
                <span style={{ color: 'var(--rule)' }}>●</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><PinIcon size={12} /> {MOCK_USER.city}</span>
                <span style={{ color: 'var(--rule)' }}>●</span>
                <span>Rooting for the <strong style={{ color: 'var(--plum)' }}>{MOCK_USER.team}</strong></span>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-outline"><TradeIcon size={13} /> Propose trade</button>
              <button className="btn btn-primary"><PlusIcon size={13} /> Follow</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type StatItem = { label: string; value: string; sub: string };

function StatsStrip({ stats }: { stats: StatItem[] }) {
  return (
    <section style={{ maxWidth: 1280, margin: '0 auto', padding: '0 28px', marginBottom: 28 }}>
      <div className="panel-bordered" style={{ padding: '24px 28px', position: 'relative' }}>
        <div style={{
          position: 'absolute', top: -13, left: 24, background: 'var(--orange)', color: 'var(--cream)',
          padding: '3px 14px', border: '2px solid var(--plum)', borderRadius: 100,
          fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase', boxShadow: '0 2px 0 var(--plum)',
        }}>★ The Record ★</div>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {stats.flatMap((s, i) => [
            i > 0 ? <div key={`div-${i}`} style={{ width: 1, borderLeft: '2px dotted var(--plum)', margin: '0 24px', flexShrink: 0 }} /> : null,
            <div key={s.label} style={{ flex: 1 }}>
              <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 6 }}>{s.label}</div>
              <div className="stat-num" style={{ fontSize: 38 }}>{s.value}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)', marginTop: 3, fontWeight: 600 }}>{s.sub}</div>
            </div>,
          ])}
        </div>
      </div>
    </section>
  );
}

const PROFILE_TABS = ['Home', 'Collection', 'Want List', 'Trades', 'Activity'];

function SubNav({ active, setActive }: { active: string; setActive: (t: string) => void }) {
  return (
    <div style={{
      maxWidth: 1280, margin: '28px auto 0', padding: '0 28px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 28,
    }}>
      <div className="tabs">
        {PROFILE_TABS.map((t) => (
          <button key={t} className="tab" aria-selected={active === t} onClick={() => setActive(t)}>{t}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="chip">Share profile</button>
        <button className="chip">Edit page</button>
      </div>
    </div>
  );
}

const NAV_LINKS = ['My Shelf', 'Feed', 'Discover', 'Sets', 'Trades'];

function TopNav({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'rgba(248, 236, 208, 0.94)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)', borderBottom: '3px solid var(--plum)',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <SCLogo size={44} />
          <div style={{ lineHeight: 0.95 }}>
            <div className="wordmark" style={{ fontSize: 22, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 13, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 22, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
          {NAV_LINKS.map((label) => (
            <span key={label} style={{
              color: label === 'My Shelf' ? 'var(--plum)' : 'inherit',
              borderBottom: label === 'My Shelf' ? '3px solid var(--orange)' : undefined,
              paddingBottom: label === 'My Shelf' ? 4 : undefined, cursor: 'pointer',
            }}>{label}</span>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
            border: '2px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', width: 260,
          }}>
            <SearchIcon size={14} />
            <input placeholder="Find cards, sets, collectors…" style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)',
            }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--plum)', padding: '1px 5px', background: 'var(--mustard)', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>⌘K</span>
          </div>
          <button style={{ position: 'relative', padding: 8, color: 'var(--plum)' }} title="Notifications">
            <BellIcon size={18} />
            <span style={{ position: 'absolute', top: 5, right: 5, width: 9, height: 9, borderRadius: '50%', background: 'var(--orange)', border: '2px solid var(--cream)' }} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </header>
  );
}

export default function HomePage() {
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('Home');
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserEmail(user.email || '');
      const { data } = await supabase
        .from('sets')
        .select('slug, title, year, brand, row_count, owned_count, owned_pct, total_value, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (data) setSets(data as SetRow[]);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <SCLogo size={80} />
          <p className="eyebrow" style={{ marginTop: 20, color: 'var(--ink-mute)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav userEmail={userEmail} onLogout={handleLogout} />
      <LogoShowcase />
      <Hero avatar={avatar} cover={cover} onAvatarChange={setAvatar} onCoverChange={setCover} />
      <SubNav active={activeTab} setActive={setActiveTab} />
      <StatsStrip stats={[
        { label: 'Cards owned', value: sets.reduce((n, s) => n + (s.owned_count || 0), 0).toLocaleString() || '—', sub: `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}` },
        { label: 'Sets tracked', value: sets.length.toString() || '—', sub: 'in progress' },
        { label: 'Trades done', value: '87', sub: '100% feedback' },
        { label: 'Want list', value: '316', sub: 'chasing' },
        { label: 'Est. value', value: '$' + Math.round(sets.reduce((n, s) => n + (s.total_value || 0), 0) / 1000) + 'k', sub: 'book price' },
      ]} />
      <div style={{ maxWidth: 1280, margin: '40px auto', padding: '0 28px', textAlign: 'center' }}>
        <p className="eyebrow" style={{ color: 'var(--ink-mute)' }}>More sections coming soon…</p>
      </div>
    </div>
  );
}