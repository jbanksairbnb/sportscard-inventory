'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

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
}: {
  s: SetRow;
  colorIndex: number;
  onDelete: (slug: string, title: string) => void;
}) {
  const color = SET_COLORS[colorIndex % SET_COLORS.length];
  const pct = s.owned_pct || 0;
  const owned = s.owned_count || 0;
  const gainLoss = s.gain_loss || 0;
  const yearShort = s.year ? `'${String(s.year).slice(2)}` : '—';

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
          <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', marginBottom: 10 }}>
            {[s.year, s.brand].filter(Boolean).join(' · ')}
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

      <button
        type="button"
        onClick={() => onDelete(s.slug, s.title)}
        title="Delete set"
        style={{
          position: 'absolute', top: 10, right: 10,
          padding: '3px 8px', fontSize: 11,
          fontFamily: 'var(--font-body)', fontWeight: 700,
          color: 'var(--ink-mute)', background: 'var(--paper)',
          border: '1.5px solid var(--plum)', borderRadius: 100,
          cursor: 'pointer', opacity: 0, transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
        onFocus={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        onBlur={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
      >
        ✕
      </button>
    </div>
  );
}

export default function HomePage() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserEmail(user.email || '');
      const { data } = await supabase
        .from('sets')
        .select('slug, title, year, brand, description, row_count, owned_count, owned_pct, total_cost, total_value, gain_loss, updated_at')
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
    const { error } = await supabase.from('sets').delete().eq('slug', slug);
    if (error) { alert('Failed to delete: ' + error.message); return; }
    setSets((prev) => prev.filter((s) => s.slug !== slug));
  }

  const sorted = useMemo(
    () => [...sets].sort((a, b) => (a.year || 0) - (b.year || 0) || (a.brand || '').localeCompare(b.brand || '')),
    [sets]
  );

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 32 }}>
          <div className="section-head" style={{ flex: 1, marginBottom: 0 }}>
            <span className="eyebrow" style={{ fontSize: 14 }}>★ My Shelf ★</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <Link href="/shared" className="btn btn-outline btn-sm">Community Sets</Link>
            <Link href="/set/new" className="btn btn-primary btn-sm">+ New Upload</Link>
          </div>
        </div>

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
              <SetCard key={s.slug} s={s} colorIndex={i} onDelete={handleDeleteSet} />
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
    </div>
  );
}
