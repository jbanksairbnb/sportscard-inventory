'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import CartIcon from '@/components/CartIcon';

type SetRow = {
  slug: string;
  title: string;
  year: number;
  brand: string;
  description: string;
  row_count: number;
  owned_count: number;
  owned_pct: number;
  total_cost: number;
  total_value: number;
  gain_loss: number;
  updated_at: number;
  // Soft classification: 'personal' (collection), 'inventory' (building
  // to sell), 'for-sale' (currently a complete-set marketplace listing).
  // Drives the filter pills + tile badge on My Shelf.
  purpose?: 'personal' | 'inventory' | 'for-sale';
  // When non-null, the set is publicly viewable at /share/<token> and
  // appears in /shared (Community Sets). Toggled inline from My Shelf.
  share_token?: string | null;
};

type PurposeFilter = 'all' | 'personal' | 'inventory' | 'for-sale';

const PURPOSE_LABELS: Record<Exclude<PurposeFilter, 'all'>, string> = {
  personal: 'Personal',
  inventory: 'Inventory',
  'for-sale': 'For Sale',
};
const PURPOSE_BADGE_BG: Record<Exclude<PurposeFilter, 'all'>, string> = {
  personal: 'var(--teal)',
  inventory: 'var(--mustard)',
  'for-sale': 'var(--orange)',
};
const PURPOSE_BADGE_FG: Record<Exclude<PurposeFilter, 'all'>, string> = {
  personal: 'var(--cream)',
  inventory: 'var(--plum)',
  'for-sale': 'var(--cream)',
};

const SET_COLORS = ['#e8742c', '#2d7a6e', '#3d1f4a', '#e5b53d', '#c54a2c', '#2d7a6e', '#e8742c', '#3d1f4a'];
const DONUT_COLORS = ['#e8742c', '#ecdbb8'];

const fmtCurrency = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function TopNav({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      background: 'rgba(248, 236, 208, 0.94)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderBottom: '3px solid var(--plum)',
    }}>
      <div style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '10px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 28,
      }}>
        <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, textDecoration: 'none' }}>
          <SCLogo size={44} />
          <div style={{ lineHeight: 0.95 }}>
            <div className="wordmark" style={{ fontSize: 22, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 13, color: 'var(--plum)', letterSpacing: '0.04em' }}>
              COLLECTIVE
            </div>
          </div>
        </Link>

        <nav style={{
          display: 'flex',
          gap: 22,
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-soft)',
        }}>
          <Link href="/home" style={{
            color: 'var(--plum)',
            borderBottom: '3px solid var(--orange)',
            paddingBottom: 4,
            textDecoration: 'none',
          }}>
            My Shelf
          </Link>
          <Link href="/shared" style={{ color: 'inherit' }}>Community</Link>
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {userEmail && (
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', fontWeight: 600 }}>
              {userEmail}
            </span>
          )}
          <CartIcon />
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function SetCard({
  s,
  colorIndex,
  onDelete,
  onPurposeChange,
  onToggleShare,
}: {
  s: SetRow;
  colorIndex: number;
  onDelete: (slug: string, title: string) => void;
  onPurposeChange: (slug: string, next: Exclude<PurposeFilter, 'all'>) => void;
  onToggleShare: (slug: string, currentlyShared: boolean) => void;
}) {
  const color = SET_COLORS[colorIndex % SET_COLORS.length];
  const pct = s.owned_pct || 0;
  const owned = s.owned_count || 0;
  const gainLoss = s.gain_loss || 0;
  const yearShort = s.year ? `'${String(s.year).slice(2)}` : '—';
  const currentPurpose = (s.purpose || 'personal') as Exclude<PurposeFilter, 'all'>;
  const [pickerOpen, setPickerOpen] = useState(false);

  const donutData = [
    { name: 'Owned',  value: Math.round(pct * 10) / 10 },
    { name: 'Needed', value: Math.round(Math.max(0, 100 - pct) * 10) / 10 },
  ];

  return (
    <div className="panel-bordered" style={{ padding: '18px 20px', position: 'relative' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{
          width: 58, height: 58,
          background: color, color: 'var(--cream)',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)', fontSize: 20,
          borderRadius: 10, border: '2px solid var(--plum)',
          boxShadow: '0 2px 0 var(--plum)', flexShrink: 0,
        }}>
          {yearShort}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/set/${encodeURIComponent(s.slug)}`} style={{ textDecoration: 'none' }}>
            <div className="display" style={{
              fontSize: 17, color: 'var(--plum)', marginBottom: 2,
              lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {s.title}
            </div>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)' }}>
              {[s.year, s.brand].filter(Boolean).join(' · ')}
            </div>
            <div style={{ position: 'relative' }}>
              <button type="button"
                onClick={() => setPickerOpen(o => !o)}
                title="Click to change set category"
                style={{
                  fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em',
                  padding: '2px 8px 2px 6px', borderRadius: 100,
                  background: PURPOSE_BADGE_BG[currentPurpose], color: PURPOSE_BADGE_FG[currentPurpose],
                  textTransform: 'uppercase', border: 'none', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}>
                {PURPOSE_LABELS[currentPurpose]}
                <span style={{ fontSize: 7, opacity: 0.85, lineHeight: 1 }}>▾</span>
              </button>
              {pickerOpen && (
                <>
                  <div
                    onClick={() => setPickerOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 25 }}
                  />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                    background: 'var(--cream)', border: '1.5px solid var(--plum)',
                    borderRadius: 8, padding: 4, zIndex: 26,
                    boxShadow: '0 6px 18px rgba(42,20,52,0.2)',
                    display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130,
                  }}>
                    {(['personal', 'inventory', 'for-sale'] as const).map(opt => {
                      const isCurrent = opt === currentPurpose;
                      return (
                        <button key={opt} type="button"
                          onClick={() => { setPickerOpen(false); if (!isCurrent) onPurposeChange(s.slug, opt); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '6px 10px', borderRadius: 6, border: 'none',
                            background: isCurrent ? 'var(--paper)' : 'transparent',
                            fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700,
                            color: 'var(--plum)', cursor: isCurrent ? 'default' : 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={e => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = 'var(--paper)'; }}
                          onMouseLeave={e => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                          <span style={{
                            width: 9, height: 9, borderRadius: 100,
                            background: PURPOSE_BADGE_BG[opt],
                            border: '1px solid var(--plum)',
                            flexShrink: 0,
                          }} />
                          {PURPOSE_LABELS[opt]}
                          {isCurrent && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--teal)' }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="progress" style={{ marginBottom: 6 }}>
            <span style={{ width: `${Math.min(100, pct)}%`, background: color }} />
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: 'var(--ink-soft)', fontWeight: 600, letterSpacing: '0.04em',
          }}>
            <span>{owned} / {s.row_count || 0} cards</span>
            <span>{pct.toFixed(1)}%</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
            {[
              { label: 'Cost',      value: fmtCurrency(s.total_cost) },
              { label: 'Value',     value: fmtCurrency(s.total_value) },
              { label: 'Gain/Loss', value: fmtCurrency(gainLoss), gain: gainLoss },
            ].map(({ label, value, gain }) => (
              <div key={label} style={{
                background: 'var(--paper)', border: '1.5px solid var(--plum)',
                borderRadius: 10, padding: '7px 10px',
              }}>
                <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)', marginBottom: 2 }}>
                  {label}
                </div>
                <div className="mono" style={{
                  fontSize: 12, fontWeight: 700,
                  color: gain === undefined ? 'var(--ink)' : gain >= 0 ? 'var(--teal)' : 'var(--rust)',
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {s.updated_at && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 600, marginTop: 8 }}>
              Updated {new Date(s.updated_at).toLocaleString()}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, textAlign: 'center' }}>
          <div style={{ width: 80, height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={26} outerRadius={38} stroke="none">
                  {donutData.map((_, idx) => (
                    <Cell key={idx} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="eyebrow" style={{ fontSize: 8, color: 'var(--ink-mute)', marginTop: 2 }}>Owned</div>
        </div>
      </div>

      {(() => {
        const isShared = !!s.share_token;
        return (
          <button
            type="button"
            onClick={() => onToggleShare(s.slug, isShared)}
            title={isShared ? 'Public — click to make private' : 'Private — click to share with the community'}
            style={{
              position: 'absolute', top: 10, right: 46,
              padding: '4px 10px', height: 28,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
              lineHeight: 1, textTransform: 'uppercase',
              fontFamily: 'var(--font-mono)',
              color: isShared ? 'var(--cream)' : 'var(--ink-mute)',
              background: isShared ? 'var(--orange)' : 'var(--paper)',
              border: `1.5px solid ${isShared ? 'var(--orange)' : 'var(--rule)'}`,
              borderRadius: 100, cursor: 'pointer',
            }}
            aria-label={isShared ? `Unshare set ${s.title}` : `Share set ${s.title}`}
            aria-pressed={isShared}
          >
            <span aria-hidden="true">{isShared ? '🔗' : '🔒'}</span>
            {isShared ? 'Shared' : 'Share'}
          </button>
        );
      })()}

      <button
        type="button"
        onClick={() => onDelete(s.slug, s.title)}
        title="Delete this set"
        style={{
          position: 'absolute', top: 10, right: 10,
          width: 28, height: 28, padding: 0,
          display: 'grid', placeItems: 'center',
          fontSize: 13, lineHeight: 1,
          color: 'var(--rust)', background: 'var(--paper)',
          border: '1.5px solid var(--rust)', borderRadius: 100,
          cursor: 'pointer',
        }}
        aria-label={`Delete set ${s.title}`}
      >
        🗑
      </button>
    </div>
  );
}

export default function HomePage() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [scansPickerOpen, setScansPickerOpen] = useState(false);
  const router = useRouter();

  const goSingleCards = () => { setScansPickerOpen(false); router.push('/listings/scan-inbox'); };
  const goSetInventory = () => { setScansPickerOpen(false); router.push('/listings/scan-from-set'); };
  const goMultiCard = () => { setScansPickerOpen(false); router.push('/listings/scan-multi-card'); };

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserEmail(user.email || '');
      const { data } = await supabase
        .from('sets')
        .select('slug, title, year, brand, description, row_count, owned_count, owned_pct, total_cost, total_value, gain_loss, updated_at, purpose, share_token')
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

  async function handleDeleteSet(slug: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { error } = await supabase
      .from('sets')
      .delete()
      .eq('user_id', user.id)
      .eq('slug', slug);
    if (error) { alert('Failed to delete: ' + error.message); return; }
    setSets((prev) => prev.filter((s) => s.slug !== slug));
  }

  // Toggle share state from the My Shelf card. share_token: null = private,
  // any UUID = publicly viewable at /share/<token>. Mirrors the toggle on the
  // set detail page so seller can flip from either surface.
  async function handleToggleShare(slug: string, currentlyShared: boolean) {
    const prevSets = sets;
    const nextToken = currentlyShared ? null : (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setSets((prev) => prev.map((s) => (s.slug === slug ? { ...s, share_token: nextToken } : s)));
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { error } = await supabase
      .from('sets')
      .update({ share_token: nextToken })
      .eq('user_id', user.id)
      .eq('slug', slug);
    if (error) {
      alert('Failed to update share state: ' + error.message);
      setSets(prevSets);
    }
  }

  async function handlePurposeChange(slug: string, next: Exclude<PurposeFilter, 'all'>) {
    const prevSets = sets;
    setSets((prev) => prev.map((s) => (s.slug === slug ? { ...s, purpose: next } : s)));
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { error } = await supabase
      .from('sets')
      .update({ purpose: next, updated_at: Date.now() })
      .eq('user_id', user.id)
      .eq('slug', slug);
    if (error) {
      alert('Failed to update set category: ' + error.message);
      setSets(prevSets);
    }
  }

  const [search, setSearch] = useState('');
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilter>('all');
  const sorted = useMemo(() => {
    const arr = [...sets].sort((a, b) => (a.year || 0) - (b.year || 0) || (a.brand || '').localeCompare(b.brand || ''));
    const q = search.trim().toLowerCase();
    const purposed = purposeFilter === 'all'
      ? arr
      : arr.filter(s => (s.purpose || 'personal') === purposeFilter);
    if (!q) return purposed;
    return purposed.filter(s => {
      const hay = `${s.title} ${s.year || ''} ${s.brand || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sets, search, purposeFilter]);

  const purposeCounts = useMemo(() => {
    const c: Record<PurposeFilter, number> = { all: sets.length, personal: 0, inventory: 0, 'for-sale': 0 };
    for (const s of sets) c[(s.purpose || 'personal') as Exclude<PurposeFilter, 'all'>]++;
    return c;
  }, [sets]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <SCLogo size={80} />
          <p className="eyebrow" style={{ marginTop: 20, color: 'var(--ink-mute)' }}>Loading your shelf…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav userEmail={userEmail} onLogout={handleLogout} />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
          <div className="section-head" style={{ marginBottom: 0 }}>
            <span className="eyebrow" style={{ fontSize: 14 }}>★ My Shelf ★</span>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Filter by title / year / brand…"
            style={{
              flex: 1, minWidth: 220, maxWidth: 360,
              padding: '6px 14px', border: '1.5px solid var(--plum)', borderRadius: 100,
              background: 'var(--cream)', color: 'var(--plum)',
              fontFamily: 'var(--font-body)', fontSize: 12.5,
            }} />
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <Link href="/shared" className="btn btn-outline btn-sm">Community Sets</Link>
            <button onClick={() => setScansPickerOpen(true)} className="btn btn-ghost btn-sm">📷 Scans</button>
            <Link href="/set/new" className="btn btn-primary btn-sm">+ New Upload</Link>
          </div>
        </div>

        {sets.length > 0 && (
          <div style={{
            display: 'flex', gap: 6, flexWrap: 'wrap',
            padding: '8px 12px', marginBottom: 18,
            background: 'var(--paper)', borderRadius: 100, border: '1.5px solid var(--rule)',
            alignItems: 'center', alignSelf: 'flex-start', width: 'fit-content', maxWidth: '100%',
          }}>
            <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginRight: 6 }}>VIEW</span>
            {(['all', 'personal', 'inventory', 'for-sale'] as const).map(id => {
              const count = purposeCounts[id];
              if (id !== 'all' && count === 0) return null;
              const active = purposeFilter === id;
              const label = id === 'all' ? 'All' : PURPOSE_LABELS[id];
              return (
                <button key={id} type="button" onClick={() => setPurposeFilter(id)}
                  style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                    padding: '4px 11px', borderRadius: 100,
                    background: active ? 'var(--plum)' : 'transparent',
                    color: active ? 'var(--mustard)' : 'var(--plum)',
                    border: active ? '1.5px solid var(--plum)' : '1.5px solid transparent',
                    cursor: 'pointer',
                  }}>
                  {label} <span style={{ opacity: 0.7, marginLeft: 2 }}>({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
              <SCLogo size={64} />
            </div>
            <div className="display" style={{ fontSize: 26, color: 'var(--plum)', marginBottom: 10 }}>No sets yet</div>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: '0 auto 24px', maxWidth: 360 }}>
              Import a CSV to start tracking your collection.
            </p>
            <Link href="/set/new" className="btn btn-primary">+ New Upload</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 16 }}>
            {sorted.map((s, i) => (
              <SetCard key={s.slug} s={s} colorIndex={i} onDelete={handleDeleteSet} onPurposeChange={handlePurposeChange} onToggleShare={handleToggleShare} />
            ))}
          </div>
        )}
      </div>

      <footer style={{
        borderTop: '3px solid var(--plum)',
        padding: '24px 28px', maxWidth: 1280, margin: '0 auto',
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

      {scansPickerOpen && (
        <ScansPicker
          onClose={() => setScansPickerOpen(false)}
          onSingleCards={goSingleCards}
          onSetInventory={goSetInventory}
          onMultiCard={goMultiCard}
        />
      )}
    </div>
  );
}

function ScansPicker({ onClose, onSingleCards, onSetInventory, onMultiCard }: {
  onClose: () => void;
  onSingleCards: () => void;
  onSetInventory: () => void;
  onMultiCard: () => void;
}) {
  const choices = [
    {
      icon: '📷',
      label: 'Add Scans to Single Cards',
      hint: 'Match scans to individual listings — front and back per card.',
      onClick: onSingleCards,
    },
    {
      icon: '📚',
      label: 'Add Scans to Set Inventory',
      hint: 'Bulk attach scans to rows in one of your sets.',
      onClick: onSetInventory,
    },
    {
      icon: '🪟',
      label: 'Multi-Card Scan (2×3 grid)',
      hint: 'Upload one image of 6 fronts + one of 6 backs. Splits losslessly into 6 cards and assigns each to a row.',
      onClick: onMultiCard,
    },
  ];
  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(42,20,52,0.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '60px 20px', overflowY: 'auto',
      }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 540, padding: 28, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>Add Scans</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 20 }}>
          Pick where you want to attach card scans.
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          {choices.map(c => (
            <button key={c.label} type="button" onClick={c.onClick}
              className="panel-bordered"
              style={{
                padding: '18px 20px', textAlign: 'left', background: 'var(--paper)',
                cursor: 'pointer', border: '1.5px solid var(--rule)', borderRadius: 12,
              }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 4 }}>
                {c.icon} {c.label}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
