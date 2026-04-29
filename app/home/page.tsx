'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import WantListHitsFeed from '@/components/WantListHitsFeed';
import EbayHitsFeed from '@/components/EbayHitsFeed';

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
  share_token: string | null;
};

function LogoShowcase() {
  return (
    <section style={{ margin: '28px 0 0', padding: 0 }}>
      <div style={{
        position: 'relative', background: 'var(--cream)', border: '2px solid var(--plum)',
        borderRadius: 0, boxShadow: '0 4px 0 var(--plum)', padding: '24px 28px',
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
            A home for collectors. Manage your binders, chase want lists, and sell your extras.
          </p>
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="chip chip-rust">Collect</span>
          <span className="chip chip-gold">Trade</span>
          <span className="chip chip-forest">Connect</span>
        </div>
      </div>
    </section>
  );
}

function Hero({ userId, avatar, cover, profile, onAvatarChange, onCoverChange, onCoverPositionChange }: {
  userId: string;
  avatar: string | null; cover: string | null;
  profile: CollectorProfile;
  onAvatarChange: (url: string) => void; onCoverChange: (url: string) => void;
  onCoverPositionChange: (x: number, y: number) => void;
}) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverContainerRef = useRef<HTMLDivElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [adjustingCover, setAdjustingCover] = useState(false);
  const [posX, setPosX] = useState<number>(profile.cover_position_x);
  const [posY, setPosY] = useState<number>(profile.cover_position_y);
  const dragStartRef = useRef<{ x: number; y: number; startPosX: number; startPosY: number } | null>(null);

  useEffect(() => {
    if (!adjustingCover) {
      setPosX(profile.cover_position_x);
      setPosY(profile.cover_position_y);
    }
  }, [profile.cover_position_x, profile.cover_position_y, adjustingCover]);

  function startReposition() {
    setPosX(profile.cover_position_x);
    setPosY(profile.cover_position_y);
    setAdjustingCover(true);
  }

  async function saveCoverPosition() {
    onCoverPositionChange(posX, posY);
    setAdjustingCover(false);
    if (userId) {
      const supabase = createClient();
      await supabase.from('user_profiles').upsert({
        user_id: userId,
        cover_position_x: posX,
        cover_position_y: posY,
      });
    }
  }

  function cancelReposition() {
    setPosX(profile.cover_position_x);
    setPosY(profile.cover_position_y);
    setAdjustingCover(false);
  }

   function onCoverPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!adjustingCover) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY, startPosX: posX, startPosY: posY };
  }
  function onCoverPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!adjustingCover || !dragStartRef.current) return;
    const rect = coverContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const deltaXPct = (dx / rect.width) * 100;
    const deltaYPct = (dy / rect.height) * 100;
    setPosX(Math.max(0, Math.min(100, dragStartRef.current.startPosX - deltaXPct)));
    setPosY(Math.max(0, Math.min(100, dragStartRef.current.startPosY - deltaYPct)));
  }
  function onCoverPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
  }

  async function handleUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    storagePath: string,
    profileKey: 'avatar_url' | 'cover_url',
    cb: (url: string) => void,
    setUploading: (v: boolean) => void,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const supabase = createClient();
    const { error } = await supabase.storage.from('card-images').upload(storagePath, file, { upsert: true });
    if (error) { alert('Upload failed: ' + error.message); setUploading(false); return; }
    const { data } = supabase.storage.from('card-images').getPublicUrl(storagePath);
    const url = data.publicUrl + `?t=${Date.now()}`;
    cb(url);
    await supabase.from('user_profiles').upsert({ user_id: userId, [profileKey]: url });
    setUploading(false);
    e.target.value = '';
  }

  const name = profile.display_name || 'YOUR NAME';
  const handle = profile.handle || 'handle';
  const city = profile.city || 'City';
  const team = profile.team || 'Your Team';
  const initials = name !== 'YOUR NAME'
    ? name.split(' ').map((s) => s[0]).slice(0, 2).join('')
    : 'YN';

  return (
    <section>
      <div ref={coverContainerRef} className="halftone"
        onPointerDown={onCoverPointerDown}
        onPointerMove={onCoverPointerMove}
        onPointerUp={onCoverPointerUp}
        style={{
          position: 'relative', height: 360,
          background: cover
            ? `url(${cover}) ${posX}% ${posY}% / cover no-repeat`
            : 'linear-gradient(135deg, #3d1f4a 0%, #2a1434 40%, #1f5a50 100%)',
          borderBottom: '3px solid var(--plum)', overflow: 'hidden',
          cursor: adjustingCover ? (dragStartRef.current ? 'grabbing' : 'grab') : 'default',
          touchAction: adjustingCover ? 'none' : 'auto',
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
          <span className="chip chip-gold"><DiamondIcon size={10} /> Charter Member · Est. 2023</span>
        </div>
        <div style={{ position: 'absolute', top: 18, right: 22, display: 'flex', gap: 8 }}>
          {adjustingCover ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={saveCoverPosition}
                style={{ background: 'var(--teal)', color: 'var(--cream)', borderColor: 'var(--teal)' }}>
                ✓ Save position
              </button>
              <button className="btn btn-ghost btn-sm" onClick={cancelReposition}
                style={{ background: 'rgba(245,233,208,0.95)' }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {cover && (
                <button className="btn btn-ghost btn-sm" onClick={startReposition}
                  style={{ background: 'rgba(245,233,208,0.95)' }}>
                  ↕ Reposition
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
                style={{ background: 'rgba(245,233,208,0.95)' }}>
                <CameraIcon size={13} /> {uploadingCover ? 'Uploading…' : 'Change cover'}
              </button>
              <input ref={coverInputRef} type="file" accept="image/*"
                onChange={(e) => handleUpload(e, `${userId}/cover`, 'cover_url', onCoverChange, setUploadingCover)}
                style={{ display: 'none' }} />
            </>
          )}
        </div>
        {adjustingCover && (
          <div style={{
            position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(42,20,52,0.85)', color: 'var(--cream)',
            padding: '8px 16px', borderRadius: 100, fontSize: 12, fontWeight: 600,
            letterSpacing: '0.05em', pointerEvents: 'none',
          }}>
            Drag the cover to reposition
          </div>
        )}
      </div>

      <div style={{
        maxWidth: 1280, margin: '0 auto', padding: '0 28px',
        display: 'flex', alignItems: 'flex-start', gap: 24, marginTop: -86, position: 'relative',
      }}>
        <div style={{ position: 'relative', width: 172, height: 172, flexShrink: 0 }}>
          <div className="avatar" data-shape="circle" style={{ width: 172, height: 172 }}>
            {avatar ? <img src={avatar} alt={name} /> : (
              <div style={{
                width: '100%', height: '100%', display: 'grid', placeItems: 'center',
                background: 'linear-gradient(135deg, var(--plum) 0%, var(--plum-deep) 100%)',
                color: 'var(--mustard)', fontFamily: 'var(--font-display)', fontSize: 62,
              }}>{initials}</div>
            )}
          </div>
          <button onClick={() => avatarInputRef.current?.click()} title="Change profile picture" disabled={uploadingAvatar} style={{
            position: 'absolute', right: 4, bottom: 4, width: 38, height: 38, borderRadius: '50%',
            background: 'var(--orange)', color: 'var(--cream)', display: 'grid', placeItems: 'center',
            border: '2.5px solid var(--plum)', boxShadow: '0 2px 0 var(--plum)',
            opacity: uploadingAvatar ? 0.6 : 1,
          }}><CameraIcon size={16} /></button>
          <input ref={avatarInputRef} type="file" accept="image/*"
            onChange={(e) => handleUpload(e, `${userId}/avatar`, 'avatar_url', onAvatarChange, setUploadingAvatar)}
            style={{ display: 'none' }} />
        </div>

        <div style={{ flex: 1, paddingTop: 96 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--orange)' }}>★ Collector · {city} ★</div>
              <h1 className="display" style={{ fontSize: 62, margin: 0, color: 'var(--plum)', lineHeight: 0.95 }}>{name}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, fontSize: 13, color: 'var(--ink-soft)', fontWeight: 500 }}>
                <span className="mono" style={{ fontWeight: 600 }}>@{handle}</span>
                <span style={{ color: 'var(--rule)' }}>●</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><PinIcon size={12} /> {city}</span>
                <span style={{ color: 'var(--rule)' }}>●</span>
                <span>Rooting for the <strong style={{ color: 'var(--plum)' }}>{team}</strong></span>
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

type WantCard = { year: number; brand: string; description: string; targetPrice: string; targetConditionLow: string; targetConditionHigh: string };
type StatItem = { label: string; value: string; sub: string; onClick?: () => void };

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
            <div key={s.label} style={{ flex: 1, cursor: s.onClick ? 'pointer' : undefined }} onClick={s.onClick}>
              <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 6 }}>{s.label}</div>
              <div className="stat-num" style={{ fontSize: 38, color: s.onClick ? 'var(--orange)' : undefined }}>{s.value}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)', marginTop: 3, fontWeight: 600 }}>{s.sub}</div>
            </div>,
          ])}
        </div>
      </div>
    </section>
  );
}

function WantListModal({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<WantCard[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: setsData } = await supabase.from('sets').select('year, brand, rows').eq('user_id', user.id);
      if (!setsData) { setLoading(false); return; }
      const unowned: WantCard[] = [];
      for (const s of setsData) {
        for (const row of (s.rows || [])) {
          if (String(row['Owned'] || '') !== 'Yes') {
            unowned.push({
              year: s.year || 0,
              brand: s.brand || '',
              description: String(row['Player'] || row['Description'] || ''),
              targetPrice: String(row['Target Price'] || ''),
                            targetConditionLow: String(row['Target Condition - Low'] || row['Target Condition'] || ''),
              targetConditionHigh: String(row['Target Condition - High'] || ''),
            });
          }
        }
      }
      setCards(unowned);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = search.trim()
    ? cards.filter((c) => {
        const q = search.toLowerCase();
        return (
          String(c.year).includes(q) ||
          c.brand.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.targetPrice.toLowerCase().includes(q)
        );
      })
    : cards;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(42,20,52,0.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '60px 24px 24px', overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--cream)', border: '3px solid var(--plum)',
          borderRadius: 16, boxShadow: '0 8px 0 var(--plum)',
          width: '100%', maxWidth: 860, padding: 28,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 26, color: 'var(--plum)', flex: 1 }}>Want List</div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700 }}>{filtered.length} cards</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={onClose}>✕ Close</button>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', border: '2px solid var(--plum)',
          borderRadius: 100, background: 'var(--cream)', marginBottom: 20,
        }}>
          <SearchIcon size={14} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by year, brand, description…"
            autoFocus
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'var(--font-body)', fontSize: 13, flex: 1, color: 'var(--plum)',
            }}
          />
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-mute)' }} className="eyebrow">Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-mute)' }} className="eyebrow">No cards found</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--plum)' }}>
                                    {['Year', 'Brand', 'Player', 'Target Price', 'Target Condition - Low', 'Target Condition - High'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left',
                      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--mustard)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={i} style={{
                    borderTop: '1.5px solid var(--cream-warm)',
                    background: i % 2 === 0 ? 'var(--cream)' : 'var(--paper)',
                  }}>
                    <td className="mono" style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{c.year || '—'}</td>
                    <td className="eyebrow" style={{ padding: '9px 14px', fontSize: 10.5, color: 'var(--orange)', whiteSpace: 'nowrap' }}>{c.brand || '—'}</td>
                    <td className="display" style={{ padding: '9px 14px', fontSize: 13, color: 'var(--plum)' }}>{c.description || '—'}</td>
                    <td className="mono" style={{ padding: '9px 14px', fontSize: 12, color: 'var(--teal)', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.targetPrice || '—'}</td>
                     <td className="eyebrow" style={{ padding: '9px 14px', fontSize: 10.5, color: 'var(--orange)', whiteSpace: 'nowrap' }}>{c.targetConditionLow || '—'}</td>
                    <td className="eyebrow" style={{ padding: '9px 14px', fontSize: 10.5, color: 'var(--orange)', whiteSpace: 'nowrap' }}>{c.targetConditionHigh || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function HeartIcon({ size = 14, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function CommentIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

type FeedEntry = {
  id: string;
  kind: 'wantlist-hit' | 'comment' | 'post';
  time: string;
  user: { name: string; handle: string; av: string; verified?: boolean };
  card?: { year: number; player: string; set: string; num: string; grade: string; colors: string[] };
  price?: number;
  action?: string;
  auctionEnds?: string;
  note?: string;
  target?: string;
  body?: string;
  photo?: boolean;
  likes: number;
  comments: number;
};

const MOCK_FEED: FeedEntry[] = [
  {
    id: 'p1', kind: 'wantlist-hit', time: '12 min ago',
    user: { name: 'Marcy Fernandez', handle: 'mfdiamond', av: 'M' },
    card: { year: 1968, player: 'Nolan Ryan RC', set: 'Topps', num: '#177', grade: 'PSA 4', colors: ['#b4462b', '#1b2a49'] },
    price: 2450, action: 'listed',
    note: 'Fresh from PSA. Open to trades for \'53 Topps hi-numbers.',
    likes: 24, comments: 6,
  },
  {
    id: 'p2', kind: 'comment', time: '1 hr ago',
    user: { name: 'Dale Rutherford', handle: 'drutherford', av: 'D' },
    target: 'your 1955 Koufax RC',
    body: 'That corner is sharper than any \'55 I\'ve seen. What book are you using on this one?',
    likes: 3, comments: 2,
  },
  {
    id: 'p3', kind: 'wantlist-hit', time: '3 hr ago',
    user: { name: 'Topps Vault', handle: 'toppsvault', av: 'T', verified: true },
    card: { year: 1953, player: 'Satchel Paige', set: 'Topps', num: '#220', grade: 'SGC 3', colors: ['#2f4a32', '#d9b668'] },
    price: 8900, action: 'auction', auctionEnds: '2d 14h',
    likes: 142, comments: 38,
  },
  {
    id: 'p4', kind: 'post', time: '5 hr ago',
    user: { name: 'Ellis Park', handle: 'ellispk', av: 'E' },
    body: 'Finally completed the \'75 Topps mini set. Eight years. Trading partner shoutout to @jbanks53 who sent me the last three needs.',
    photo: true, likes: 89, comments: 17,
  },
  {
    id: 'p5', kind: 'wantlist-hit', time: 'Yesterday',
    user: { name: 'Iris Nakamura', handle: 'irisn', av: 'I' },
    card: { year: 1962, player: 'Maury Wills', set: 'Topps', num: '#489', grade: 'Raw EX', colors: ['#1b2a49', '#f3ead3'] },
    price: 185, action: 'listed',
    note: 'Centering is off but corners are clean. Priced to move.',
    likes: 11, comments: 3,
  },
];

function FeedAvatar({ u, size = 38 }: { u: { name: string; av: string }; size?: number }) {
  const palette = ['#3d1f4a', '#e8742c', '#2d7a6e', '#c54a2c', '#e5b53d'];
  const color = palette[u.av.charCodeAt(0) % palette.length];
  const textColor = color === '#e5b53d' ? '#3d1f4a' : '#f5e9d0';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, color: textColor,
      display: 'grid', placeItems: 'center',
      fontFamily: 'var(--font-display)', fontSize: size * 0.44,
      border: '2px solid var(--plum)', boxShadow: '0 2px 0 var(--plum)',
      flexShrink: 0,
    }}>
      {u.av}
    </div>
  );
}

function FeedItem({ item }: { item: FeedEntry }) {
  const [liked, setLiked] = useState(false);
  const likes = item.likes + (liked ? 1 : 0);

  if (item.kind === 'wantlist-hit' && item.card) {
    return (
      <article className="panel" style={{ padding: 16, display: 'flex', gap: 16 }}>
        <CardFace card={item.card} width={115} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span className="chip chip-rust" style={{ fontSize: 10 }}>◆ Want-list match</span>
            {item.action === 'auction' && (
              <span className="chip chip-navy" style={{ fontSize: 10 }}>Auction · ends {item.auctionEnds}</span>
            )}
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginLeft: 'auto', fontWeight: 600 }}>{item.time}</span>
          </div>
          <h3 className="display" style={{ fontSize: 22, margin: '4px 0 2px', color: 'var(--plum)' }}>
            {item.card.year} {item.card.set} — {item.card.player}
          </h3>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8, fontWeight: 500 }}>
            {item.card.num} · {item.card.grade} · listed by{' '}
            <strong style={{ color: 'var(--plum)' }}>@{item.user.handle}</strong>
            {item.user.verified && <span style={{ color: 'var(--mustard)', marginLeft: 4 }}>✓</span>}
          </div>
          {item.note && (
            <p style={{ margin: '8px 0', fontSize: 13.5, color: 'var(--ink-soft)', fontStyle: 'italic', borderLeft: '3px solid var(--mustard)', paddingLeft: 12 }}>
              "{item.note}"
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <div className="stat-num" style={{ fontSize: 26, color: 'var(--orange)' }}>${item.price?.toLocaleString()}</div>
            <button className="btn btn-primary btn-sm">View listing</button>
            <button className="btn btn-outline btn-sm">Make offer</button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 12, fontWeight: 600 }}>
              <button onClick={() => setLiked(!liked)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: liked ? 'var(--orange)' : 'var(--ink-mute)' }}>
                <HeartIcon size={13} filled={liked} /> {likes}
              </button>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-mute)' }}>
                <CommentIcon size={13} /> {item.comments}
              </span>
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === 'comment') {
    return (
      <article className="panel" style={{ padding: 16, display: 'flex', gap: 12 }}>
        <FeedAvatar u={item.user} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong style={{ color: 'var(--plum)' }}>{item.user.name}</strong>{' '}
            <span style={{ color: 'var(--ink-mute)' }}>commented on {item.target}</span>
            <span className="mono" style={{ float: 'right', fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600 }}>{item.time}</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>"{item.body}"</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11.5, fontWeight: 700, color: 'var(--ink-mute)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <button style={{ color: 'inherit' }}>Reply</button>
            <button style={{ color: 'inherit' }}>Like</button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <FeedAvatar u={item.user} size={38} />
        <div>
          <div style={{ fontSize: 13 }}>
            <strong style={{ color: 'var(--plum)' }}>{item.user.name}</strong>
            <span style={{ color: 'var(--ink-mute)' }}> · @{item.user.handle}</span>
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600 }}>{item.time}</div>
        </div>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{item.body}</p>
      {item.photo && (
        <div className="halftone" style={{
          height: 220, borderRadius: 8, border: '2px solid var(--plum)',
          background: 'linear-gradient(135deg, #2d7a6e 0%, #3d1f4a 100%)',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)', color: 'rgba(245,233,208,0.35)', fontSize: 32,
          marginBottom: 12,
        }}>
          [ photo ]
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><HeartIcon size={13} /> {item.likes}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CommentIcon size={13} /> {item.comments}</span>
      </div>
    </article>
  );
}

const FEED_FILTERS = ['All activity', 'Want-list hits', 'eBay hits', 'Comments', 'Following', 'Auctions'];

function FeedSection() {
  const [activeFilter, setActiveFilter] = useState('Want-list hits');
  const showWantListHits = activeFilter === 'Want-list hits' || activeFilter === 'All activity';
  const showEbayHits = activeFilter === 'eBay hits' || activeFilter === 'All activity';
  const mockNonWantList = MOCK_FEED.filter(i => i.kind !== 'wantlist-hit');
  return (
    <section>
      <div className="section-head">
        <span className="eyebrow" style={{ fontSize: 12 }}>★ Your Feed ★</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FEED_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`chip${f === activeFilter ? ' chip-rust' : ''}`}
          >
            {f}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {showWantListHits && <WantListHitsFeed />}
        {showEbayHits && <EbayHitsFeed />}
        {activeFilter === 'All activity' && mockNonWantList.map((item) => <FeedItem key={item.id} item={item} />)}
        {activeFilter !== 'All activity' && activeFilter !== 'Want-list hits' && activeFilter !== 'eBay hits' && (
          <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
            <strong style={{ color: 'var(--plum)' }}>{activeFilter}</strong> is coming soon.
          </div>
        )}
      </div>
    </section>
  );
}
const FAVORITE_CARDS = [
  { id: 'f1', year: 1955, player: 'Sandy Koufax',     team: 'BKN', num: '#123',   grade: 'PSA 5',   colors: ['#c2342a', '#f4d06f'] },
  { id: 'f2', year: 1972, player: 'Roberto Clemente', team: 'PIT', num: '#309',   grade: 'SGC 7',   colors: ['#1b2a49', '#d9b668'] },
  { id: 'f3', year: 1975, player: 'Ron Cey',          team: 'LAD', num: '#390',   grade: 'PSA 8',   colors: ['#2f4a32', '#ece0be'] },
  { id: 'f4', year: 1954, player: 'Ted Williams',     team: 'BOS', num: '#1',     grade: 'PSA 4',   colors: ['#b4462b', '#1b2a49'] },
  { id: 'f5', year: 2001, player: 'Albert Pujols RC', team: 'STL', num: '#340',   grade: 'BGS 9.5', colors: ['#8f331d', '#f3ead3'] },
  { id: 'f6', year: 2011, player: 'Mike Trout RC',    team: 'LAA', num: '#US175', grade: 'PSA 10',  colors: ['#b8923a', '#1b2a49'] },
];

function CardFace({ card, width = 130 }: {
  card: typeof FAVORITE_CARDS[0];
  width?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [c1, c2] = card.colors;
  const height = Math.round(width * 1.4);
  const initials = card.player.replace(' RC', '').split(' ').map((s) => s[0]).slice(0, 2).join('');

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width, height, position: 'relative',
        background: 'var(--cream)',
        border: '2px solid var(--plum)',
        borderRadius: 8,
        overflow: 'hidden',
        transition: 'transform 0.18s, box-shadow 0.18s',
        transform: hovered ? 'translateY(-4px) rotate(-0.8deg)' : undefined,
        boxShadow: hovered ? '0 10px 0 var(--plum), 0 16px 24px rgba(42,20,52,0.2)' : '0 3px 0 var(--plum)',
      }}
    >
      <div style={{ position: 'absolute', inset: 5, border: `1.5px solid ${c1}`, borderRadius: 5 }} />
      <div className="halftone" style={{
        position: 'absolute', top: 10, left: 10, right: 10,
        height: height * 0.6,
        background: `radial-gradient(circle at 30% 30%, ${c2} 0%, ${c1} 100%)`,
        display: 'grid', placeItems: 'center',
        overflow: 'hidden', borderRadius: 3,
      }}>
        <span style={{ fontFamily: 'var(--font-display)', color: 'rgba(255,255,255,0.85)', fontSize: width * 0.34, mixBlendMode: 'overlay' }}>
          {initials}
        </span>
      </div>
      <div style={{
        position: 'absolute', left: 10, right: 10, top: height * 0.6 + 14,
        background: c1, color: 'var(--cream)', padding: '4px 6px',
        fontFamily: 'var(--font-display)', fontSize: Math.max(9, width * 0.095),
        lineHeight: 1.05, borderRadius: 4, textAlign: 'center',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        border: '1px solid var(--plum)',
      }}>
        {card.player.replace(' RC', '')}
      </div>
      <div style={{
        position: 'absolute', left: 10, right: 10, bottom: 8,
        display: 'flex', justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)', fontSize: Math.max(7, width * 0.07),
        color: 'var(--plum)', fontWeight: 700, letterSpacing: '0.05em',
      }}>
        <span>{card.team}</span><span>{card.num}</span>
      </div>
      <div style={{
        position: 'absolute', top: 8, left: 12,
        fontFamily: 'var(--font-display)', fontSize: Math.max(8, width * 0.08),
        color: 'var(--plum)', background: 'var(--mustard)',
        padding: '1px 5px', border: '1px solid var(--plum)', borderRadius: 3,
      }}>
        '{String(card.year).slice(2)}
      </div>
      {card.grade && (
        <div style={{
          position: 'absolute', top: 8, right: 12,
          fontFamily: 'var(--font-mono)', fontSize: Math.max(7, width * 0.06),
          color: 'var(--cream)', background: c1,
          padding: '2px 5px', borderRadius: 3, fontWeight: 700,
        }}>
          {card.grade}
        </div>
      )}
    </div>
  );
}

function FavoriteLightbox({ images, startSlot, onClose }: {
  images: (string | null)[];
  startSlot: number;
  onClose: () => void;
}) {
  const filled = images
    .map((url, i) => ({ url, i }))
    .filter((x): x is { url: string; i: number } => x.url !== null);
  const [pos, setPos] = useState(() => {
    const idx = filled.findIndex(f => f.i === startSlot);
    return idx >= 0 ? idx : 0;
  });
  if (filled.length === 0) return null;
  const current = filled[pos];
  const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'rgba(42,20,52,0.7)', color: 'var(--cream)',
    border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 24,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.25 : 1, lineHeight: 1,
  });
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(42,20,52,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ position: 'relative', padding: 16 }} onClick={e => e.stopPropagation()}>
        <img src={current.url} alt="Favorite card" style={{ maxWidth: '80vw', maxHeight: '80vh', borderRadius: 12, display: 'block' }} />
        {filled.length > 1 && (
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <button type="button" onClick={e => { e.stopPropagation(); setPos(p => Math.max(0, p - 1)); }} disabled={pos === 0} style={arrowBtn(pos === 0)}>‹</button>
            <button type="button" onClick={e => { e.stopPropagation(); setPos(p => Math.min(filled.length - 1, p + 1)); }} disabled={pos === filled.length - 1} style={arrowBtn(pos === filled.length - 1)}>›</button>
          </div>
        )}
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
          {filled.length > 1 && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--cream)', fontWeight: 700, padding: '3px 8px', background: 'rgba(42,20,52,0.7)', borderRadius: 6 }}>
              {pos + 1} / {filled.length}
            </span>
          )}
          <button type="button" onClick={onClose} className="btn btn-sm">✕ Close</button>
        </div>
      </div>
    </div>
  );
}

function FavoriteFrame({ card, imageUrl, slotIdx, userId, onImageChange, onLightboxOpen }: {
  card: typeof FAVORITE_CARDS[0];
  imageUrl: string | null;
  slotIdx: number;
  userId: string;
  onImageChange: (slotIdx: number, url: string | null) => void;
  onLightboxOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const width = 130;
  const height = Math.round(width * 1.4);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const supabase = createClient();
    const path = `${userId}/favorites/${slotIdx}`;
    const { error } = await supabase.storage.from('card-images').upload(path, file, { upsert: true });
    if (error) { alert('Upload failed: ' + error.message); setUploading(false); return; }
    const { data } = supabase.storage.from('card-images').getPublicUrl(path);
    onImageChange(slotIdx, data.publicUrl + `?t=${Date.now()}`);
    setUploading(false);
    e.target.value = '';
  }

  async function handleDelete() {
    const supabase = createClient();
    await supabase.storage.from('card-images').remove([`${userId}/favorites/${slotIdx}`]);
    onImageChange(slotIdx, null);
  }

  const btnStyle: React.CSSProperties = {
    background: 'var(--cream)', color: 'var(--plum)',
    border: '2px solid var(--plum)', borderRadius: '50%',
    width: 34, height: 34, display: 'grid', placeItems: 'center',
    cursor: 'pointer', fontSize: 15,
  };

  if (imageUrl) {
    return (
      <div style={{ width, height, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '2px solid var(--plum)', boxShadow: '0 3px 0 var(--plum)' }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <img src={imageUrl} alt="Favorite card" onClick={onLightboxOpen}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
        {hovered && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(42,20,52,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <button type="button" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }} style={btnStyle} title="Change image">
              <CameraIcon size={14} />
            </button>
            <button type="button" onClick={e => { e.stopPropagation(); handleDelete(); }} style={btnStyle} title="Remove">✕</button>
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <CardFace card={card} width={width} />
      {(hovered || uploading) && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(42,20,52,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            style={{ ...btnStyle, width: 40, height: 40 }}>
            {uploading ? '…' : <CameraIcon size={16} />}
          </button>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
    </div>
  );
}

function FavoritesShowcase({ userId }: { userId: string }) {
  const [images, setImages] = useState<(string | null)[]>(Array(6).fill(null));
  const [lightboxSlot, setLightboxSlot] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    async function load() {
      const { data } = await supabase
        .from('user_profiles')
        .select('favorite_cards')
        .eq('user_id', userId)
        .single();
      if (data?.favorite_cards && Array.isArray(data.favorite_cards)) {
        setImages(Array(6).fill(null).map((_, i) => (data.favorite_cards as (string | null)[])[i] ?? null));
      }
    }
    load();
  }, [userId]);

  async function handleImageChange(slotIdx: number, url: string | null) {
    const next = images.map((u, i) => (i === slotIdx ? url : u));
    setImages(next);
    const supabase = createClient();
    await supabase.from('user_profiles').upsert({ user_id: userId, favorite_cards: next });
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <div className="section-head">
        <span className="eyebrow" style={{ fontSize: 12 }}>★ The Showcase ★</span>
      </div>
      <div style={{
        position: 'relative', padding: '32px 20px 24px',
        background: 'var(--plum)', border: '2px solid var(--plum)',
        borderRadius: 16, boxShadow: '0 4px 0 var(--plum-deep)', overflow: 'hidden',
      }}>
        <svg viewBox="0 0 800 320" preserveAspectRatio="xMidYMid slice"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55 }}>
          <g transform="translate(400 320)">
            {Array.from({ length: 14 }).map((_, i) => {
              const a = -Math.PI + (i / 13) * Math.PI;
              const c = i % 2 === 0 ? '#e5b53d' : '#e8742c';
              return <polygon key={i} points="-42,0 42,0 0,-700" fill={c} opacity="0.35"
                transform={`rotate(${(a * 180) / Math.PI})`} />;
            })}
          </g>
          {([[60,40,8],[740,60,10],[120,180,6],[700,200,7]] as [number,number,number][]).map(([x,y,s],i) => (
            <polygon key={i}
              points={`${x},${y-s} ${x+s/3},${y-s/3} ${x+s},${y} ${x+s/3},${y+s/3} ${x},${y+s} ${x-s/3},${y+s/3} ${x-s},${y} ${x-s/3},${y-s/3}`}
              fill="#e5b53d" />
          ))}
        </svg>
        <div style={{ position: 'relative', textAlign: 'center', marginBottom: 20 }}>
          <div className="wordmark" style={{ fontSize: 52, color: 'var(--orange)', textShadow: '3px 3px 0 var(--mustard), 6px 6px 0 var(--plum-deep)' }}>
            Favorite Cards
          </div>
        </div>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
          {FAVORITE_CARDS.map((card, i) => (
            <div key={card.id} style={{ transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (1.2 + (i % 3) * 0.5)}deg)` }}>
              <FavoriteFrame
                card={card}
                imageUrl={images[i]}
                slotIdx={i}
                userId={userId}
                onImageChange={handleImageChange}
                onLightboxOpen={() => setLightboxSlot(i)}
              />
            </div>
          ))}
        </div>
      </div>
      {lightboxSlot !== null && (
        <FavoriteLightbox images={images} startSlot={lightboxSlot} onClose={() => setLightboxSlot(null)} />
      )}
    </section>
  );
}

const SET_COLORS = ['#e8742c', '#2d7a6e', '#3d1f4a', '#e5b53d', '#c54a2c', '#2d7a6e', '#e8742c', '#3d1f4a'];

function SetsInProgress({ sets }: { sets: SetRow[] }) {
  if (sets.length === 0) return null;
  const sorted = [...sets].sort((a, b) => (a.year || 0) - (b.year || 0) || (a.brand || '').localeCompare(b.brand || ''));
  return (
    <section style={{ marginBottom: 32 }}>
      <div className="section-head">
        <span className="eyebrow" style={{ fontSize: 12 }}>★ Sets in Progress ★</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {sorted.map((s, i) => {
          const color = SET_COLORS[i % SET_COLORS.length];
          const pct = s.owned_pct || 0;
          const yearShort = s.year ? `'${String(s.year).slice(2)}` : '—';
          const inner = (
              <div className="panel" style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'center', cursor: s.share_token ? 'pointer' : 'default' }}>
                <div style={{
                  width: 58, height: 58,
                  background: color, color: 'var(--cream)',
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--font-display)', fontSize: 22,
                  borderRadius: 10,
                  border: '2px solid var(--plum)',
                  boxShadow: '0 2px 0 var(--plum)',
                  flexShrink: 0,
                }}>
                  {yearShort}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {s.title}
                    </div>
                    {s.share_token && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                        background: 'var(--teal)', color: 'var(--cream)',
                        padding: '2px 6px', borderRadius: 100, flexShrink: 0,
                      }}>SHARED</span>
                    )}
                  </div>
                  <div className="progress">
                    <span style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', marginTop: 5,
                    fontFamily: 'var(--font-mono)', fontSize: 10.5,
                    color: 'var(--ink-soft)', fontWeight: 600, letterSpacing: '0.04em',
                  }}>
                    <span>{s.owned_count} / {s.row_count}</span>
                    <span>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
          );
          return s.share_token
            ? <Link key={s.slug} href={`/set/${encodeURIComponent(s.slug)}/view`} style={{ textDecoration: 'none' }}>{inner}</Link>
            : <div key={s.slug}>{inner}</div>;
        })}
      </div>
    </section>
  );
}

const MOCK_ACTIVITY = [
  { id: 'a1', text: "Dale commented on your 1955 Koufax", time: "1h", dot: "#b4462b" },
  { id: 'a2', text: "3 new want list matches", time: "3h", dot: "#b8923a" },
  { id: 'a3', text: "Ellis tagged you in a post", time: "5h", dot: "#2f4a32" },
  { id: 'a4', text: "Trade offer from @toppsvault", time: "1d", dot: "#1b2a49" },
  { id: 'a5', text: "Marcy liked your 1972 Clemente", time: "2d", dot: "#b4462b" },
];

type CollectorProfile = { display_name: string; handle: string; bio: string; city: string; team: string; favorite_players: string; chasing: string; value_private: boolean; cover_position_x: number; cover_position_y: number; };
const EMPTY_PROFILE: CollectorProfile = { display_name: '', handle: '', bio: '', city: '', team: '', favorite_players: '', chasing: '', value_private: false, cover_position_x: 50, cover_position_y: 50 };

function Sidebar({ userId, profile, onProfileSave }: { userId: string; profile: CollectorProfile; onProfileSave: (p: CollectorProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CollectorProfile>(profile);
  const [saving, setSaving] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwMessage, setPwMessage] = useState('');

  useEffect(() => { setDraft(profile); }, [profile]);

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    await supabase.from('user_profiles').upsert({ user_id: userId, ...draft });
    onProfileSave(draft);
    setEditing(false);
    setSaving(false);
  }

  async function handleChangePassword() {
    setPwError('');
    setPwMessage('');
    if (newPw.length < 6) { setPwError('Password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return; }
    setPwSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) {
      setPwError(error.message);
    } else {
      setPwMessage('Password updated.');
      setNewPw('');
      setConfirmPw('');
      setTimeout(() => { setPwOpen(false); setPwMessage(''); }, 1500);
    }
  }

  const players = profile.favorite_players ? profile.favorite_players.split(',').map(s => s.trim()).filter(Boolean) : [];

  const fieldStyle: React.CSSProperties = {
    border: '1.5px solid var(--plum)', borderRadius: 6, padding: '5px 8px',
    fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--plum)',
    background: 'var(--cream)', width: '100%', boxSizing: 'border-box',
  };

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'sticky', top: 20, alignSelf: 'start' }}>
      <div className="panel-bordered" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="eyebrow">★ The Collector ★</div>
          {!editing && <button type="button" onClick={() => { setDraft(profile); setEditing(true); }} className="btn btn-ghost btn-sm">Edit</button>}
        </div>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {([
              { key: 'display_name', label: 'Name' },
              { key: 'handle', label: 'Handle (@)' },
              { key: 'city', label: 'City' },
              { key: 'team', label: 'Favorite Team' },
              { key: 'chasing', label: 'Chasing' },
              { key: 'favorite_players', label: 'Roster (comma-separated)' },
            ] as { key: keyof CollectorProfile; label: string }[]).map(({ key, label }) => (
              <div key={key}>
                <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 3 }}>{label}</div>
                <input value={draft[key] as string} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} style={fieldStyle} />
              </div>
            ))}
            <div>
              <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 3 }}>Bio</div>
              <textarea value={draft.bio} onChange={e => setDraft(d => ({ ...d, bio: e.target.value }))}
                rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => { setDraft(profile); setEditing(false); }} className="btn btn-outline btn-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {profile.bio && (
              <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                "{profile.bio}"
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 14px', fontSize: 12.5 }}>
              {profile.city && <>
                <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: 'center', color: 'var(--orange)' }}>Home</span>
                <span style={{ fontWeight: 500 }}>{profile.city}</span>
              </>}
              {profile.team && <>
                <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: 'center', color: 'var(--orange)' }}>Team</span>
                <span style={{ fontWeight: 500 }}>{profile.team}</span>
              </>}
              {players.length > 0 && <>
                <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: 'start', paddingTop: 2, color: 'var(--orange)' }}>Roster</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {players.map(p => <span key={p} className="chip" style={{ fontSize: 9.5 }}>{p}</span>)}
                </div>
              </>}
              {profile.chasing && <>
                <span className="eyebrow" style={{ fontSize: 9.5, alignSelf: 'center', color: 'var(--orange)' }}>Chasing</span>
                <span style={{ fontWeight: 500 }}>{profile.chasing}</span>
              </>}
              {!profile.bio && !profile.city && !profile.team && !profile.chasing && (
                <span style={{ gridColumn: '1/-1', color: 'var(--ink-mute)', fontSize: 12, fontStyle: 'italic' }}>
                  Click Edit to add your collector profile.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="panel-bordered" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: pwOpen ? 14 : 0 }}>
          <div className="eyebrow">★ Account ★</div>
          {!pwOpen && (
            <button type="button" onClick={() => { setPwError(''); setPwMessage(''); setNewPw(''); setConfirmPw(''); setPwOpen(true); }} className="btn btn-ghost btn-sm">
              Change Password
            </button>
          )}
        </div>
        {pwOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 3 }}>New Password</div>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={6} style={fieldStyle} autoComplete="new-password" />
            </div>
            <div>
              <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 3 }}>Confirm Password</div>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} minLength={6} style={fieldStyle} autoComplete="new-password" />
            </div>
            {pwError && (
              <div style={{ background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--rust)', fontWeight: 600 }}>
                {pwError}
              </div>
            )}
            {pwMessage && (
              <div style={{ background: 'rgba(45,122,110,0.1)', border: '1.5px solid var(--teal)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>
                {pwMessage}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={handleChangePassword} disabled={pwSaving} className="btn btn-primary btn-sm">{pwSaving ? 'Saving…' : 'Update'}</button>
              <button type="button" onClick={() => { setPwOpen(false); setPwError(''); setPwMessage(''); setNewPw(''); setConfirmPw(''); }} className="btn btn-outline btn-sm">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

const PROFILE_TABS = ['Home', 'Collection', 'Want List', 'Activity'];

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

const NAV_LINKS = ['My Shelf', 'Discover', 'Sets'];

function TopNav({ isAdmin, onLogout }: { isAdmin: boolean; onLogout: () => void }) {
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
          {NAV_LINKS.map((label) => {
            const active = label === 'My Shelf';
            const style: React.CSSProperties = {
              color: active ? 'var(--plum)' : 'inherit',
              borderBottom: active ? '3px solid var(--orange)' : undefined,
              paddingBottom: active ? 4 : undefined,
              cursor: 'pointer',
              textDecoration: 'none',
            };
                return active
              ? <Link key={label} href="/" style={style}>{label}</Link>
              : <span key={label} style={style}>{label}</span>;
          })}
          <Link href="/marketplace" style={{
            color: 'inherit',
            cursor: 'pointer',
            textDecoration: 'none',
          }}>
            Marketplace
          </Link>
          <Link href="/listings" style={{
            color: 'inherit',
            cursor: 'pointer',
            textDecoration: 'none',
          }}>
            My Listings
          </Link>
          <Link href="/purchases" style={{
            color: 'inherit',
            cursor: 'pointer',
            textDecoration: 'none',
          }}>
            My Purchases
          </Link>
          {isAdmin && (
            <Link href="/admin" style={{
              color: 'var(--orange)',
              cursor: 'pointer',
              textDecoration: 'none',
            }}>
              ★ Admin
            </Link>
          )}
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
  const BOOTSTRAP_ADMIN_EMAIL = 'jbanks@sports-collective.com';
  const [userId, setUserId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('Home');
  const [showWantList, setShowWantList] = useState(false);
  const [profile, setProfile] = useState<CollectorProfile>(EMPTY_PROFILE);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
            const { data: profileData } = await supabase.from('user_profiles')
        .select('display_name, handle, bio, city, team, favorite_players, chasing, avatar_url, cover_url, is_admin, value_private, cover_position_x, cover_position_y')
        .eq('user_id', user.id).single();
      if (profileData) {
        setProfile({
          display_name: profileData.display_name || '', handle: profileData.handle || '',
          bio: profileData.bio || '', city: profileData.city || '',
          team: profileData.team || '', favorite_players: profileData.favorite_players || '',
          chasing: profileData.chasing || '',
          value_private: !!profileData.value_private,
          cover_position_x: profileData.cover_position_x != null ? Number(profileData.cover_position_x) : 50,
          cover_position_y: profileData.cover_position_y != null ? Number(profileData.cover_position_y) : 50,
        });
        if (profileData.avatar_url) setAvatar(profileData.avatar_url);
        if (profileData.cover_url) setCover(profileData.cover_url);
        setIsAdmin(!!profileData.is_admin || user.email === BOOTSTRAP_ADMIN_EMAIL);
      } else {
        setIsAdmin(user.email === BOOTSTRAP_ADMIN_EMAIL);
      }
      const { data } = await supabase
        .from('sets')
        .select('slug, title, year, brand, row_count, owned_count, owned_pct, total_value, updated_at, share_token')
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
            <TopNav isAdmin={isAdmin} onLogout={handleLogout} />
      <LogoShowcase />
            <Hero userId={userId} avatar={avatar} cover={cover} profile={profile}
        onAvatarChange={setAvatar} onCoverChange={setCover}
        onCoverPositionChange={(x, y) => setProfile(p => ({ ...p, cover_position_x: x, cover_position_y: y }))} />
      <SubNav active={activeTab} setActive={setActiveTab} />
      <StatsStrip stats={[
        { label: 'Cards owned', value: sets.reduce((n, s) => n + (s.owned_count || 0), 0).toLocaleString() || '—', sub: `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}` },
        { label: 'Sets tracked', value: sets.length.toString() || '—', sub: 'in progress' },
        { label: 'Want list', value: sets.reduce((n, s) => n + Math.max(0, (s.row_count || 0) - (s.owned_count || 0)), 0).toLocaleString() || '—', sub: 'chasing', onClick: () => setShowWantList(true) },
        {
          label: 'Est. value',
          value: profile.value_private
            ? '🔒 Private'
                        : '$' + Math.round(sets.reduce((n, s) => n + (s.total_value || 0), 0) / 1000) + 'k',
          sub: profile.value_private ? 'click to reveal' : 'book price · click to hide',
          onClick: async () => {
            const next = !profile.value_private;
            setProfile({ ...profile, value_private: next });
            if (userId) {
              const supabase = createClient();
              await supabase.from('user_profiles').upsert({ user_id: userId, value_private: next });
            }
          },
        },
      ]} />
      {showWantList && <WantListModal onClose={() => setShowWantList(false)} />}
      <div className="home-grid">
        <main style={{ minWidth: 0 }}>
          <SetsInProgress sets={sets} />
          <FavoritesShowcase userId={userId} />
          <FeedSection />
        </main>
        <Sidebar userId={userId} profile={profile} onProfileSave={setProfile} />
      </div>
    </div>
  );
}
