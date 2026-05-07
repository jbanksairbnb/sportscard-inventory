'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Member = {
  user_id: string;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  profile_shared: boolean;
  cards_owned: number;
  sets_tracked: number;
  want_list: number;
};

export default function MembersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'cards' | 'sets' | 'want'>('cards');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id, display_name, handle, avatar_url, bio, city, profile_shared')
        .eq('application_status', 'approved');

      const ids = (profiles || []).map(p => p.user_id);
      let setsByUser = new Map<string, { row_count: number; owned_count: number }[]>();
      if (ids.length > 0) {
        const { data: sets } = await supabase
          .from('sets')
          .select('user_id, row_count, owned_count')
          .in('user_id', ids);
        for (const s of (sets || [])) {
          const arr = setsByUser.get(s.user_id) || [];
          arr.push({ row_count: s.row_count || 0, owned_count: s.owned_count || 0 });
          setsByUser.set(s.user_id, arr);
        }
      }

      const list: Member[] = (profiles || []).map(p => {
        const arr = setsByUser.get(p.user_id) || [];
        const cards_owned = arr.reduce((n, s) => n + (s.owned_count || 0), 0);
        const sets_tracked = arr.length;
        const want_list = arr.reduce((n, s) => n + Math.max(0, (s.row_count || 0) - (s.owned_count || 0)), 0);
        return {
          ...p,
          profile_shared: (p as { profile_shared?: boolean | null }).profile_shared !== false,
          cards_owned, sets_tracked, want_list,
        } as Member;
      });

      setMembers(list);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let arr = q
      ? members.filter(m => {
          const hay = [m.display_name, m.handle, m.city, m.bio].filter(Boolean).join(' ').toLowerCase();
          return hay.includes(q);
        })
      : members;
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case 'name': return (a.display_name || a.handle || '').localeCompare(b.display_name || b.handle || '');
        case 'cards': return b.cards_owned - a.cards_owned;
        case 'sets': return b.sets_tracked - a.sets_tracked;
        case 'want': return b.want_list - a.want_list;
      }
    });
    return arr;
  }, [members, search, sort]);

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)', backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)', borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Members ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/" className="btn btn-ghost btn-sm">My Shelf</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ Connect with collectors ★</div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
            Browse the community. Click a member to visit their profile, see their shared sets, and find chases that match your want list.
          </p>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
            border: '2px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
            flex: 1, minWidth: 240, maxWidth: 420,
          }}>
            <span style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 700 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, handle, city…"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, flex: 1, color: 'var(--plum)' }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([['cards', 'Cards'], ['sets', 'Sets'], ['want', 'Want list'], ['name', 'Name']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setSort(v)}
                className={`btn btn-sm ${sort === v ? 'btn-primary' : 'btn-ghost'}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700, marginLeft: 'auto' }}>
            {filtered.length} member{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="eyebrow" style={{ textAlign: 'center', padding: 60, color: 'var(--ink-mute)' }}>Loading members…</div>
        ) : filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 6 }}>No members found</div>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Try a different search.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {filtered.map(m => <MemberCard key={m.user_id} m={m} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCard({ m }: { m: Member }) {
  const name = m.display_name || m.handle || 'Collector';
  const handle = m.handle ? `@${m.handle}` : '';
  const profileHref = `/profile/${m.user_id}`;
  const shared = m.profile_shared;

  const avatarBlock = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
        border: '2px solid var(--plum)',
        background: m.avatar_url
          ? `var(--cream) url(${m.avatar_url}) center/cover no-repeat`
          : 'var(--mustard)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, fontFamily: 'var(--font-display)', color: 'var(--plum)', fontWeight: 700,
      }}>
        {!m.avatar_url && name.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="display" style={{ fontSize: 16, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {name}
          </div>
          {!shared && (
            <span title="Profile is private — only their Want list is visible"
              style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100, background: 'var(--ink-mute)', color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Private
            </span>
          )}
        </div>
        {handle && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{handle}</div>
        )}
        {shared && m.city && (
          <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginTop: 4 }}>📍 {m.city}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="panel-bordered" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {shared ? (
        <Link href={profileHref} style={{ textDecoration: 'none', color: 'inherit' }}>{avatarBlock}</Link>
      ) : avatarBlock}
      <div style={{ display: 'flex', gap: 6, borderTop: '1.5px solid var(--rule)', paddingTop: 10 }}>
        <StatLink href={shared ? profileHref : null} label="Cards" value={m.cards_owned} />
        <StatLink href={shared ? profileHref : null} label="Sets" value={m.sets_tracked} />
        <StatLink href={profileHref} label="Want list" value={m.want_list} />
      </div>
    </div>
  );
}

function StatLink({ href, label, value }: { href: string | null; label: string; value: number }) {
  const inner = (
    <>
      <div className="mono" style={{ fontSize: 15, color: 'var(--plum)', fontWeight: 700 }}>
        {value.toLocaleString()}
      </div>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.16em' }}>
        {label}
      </div>
    </>
  );
  const baseStyle: React.CSSProperties = {
    flex: 1, textAlign: 'center', padding: '6px 4px', textDecoration: 'none',
    borderRadius: 6, border: '1.5px solid var(--rule)', background: 'var(--paper)',
    transition: 'background 120ms',
  };
  if (!href) {
    return <div style={{ ...baseStyle, opacity: 0.55 }}>{inner}</div>;
  }
  return (
    <Link href={href} style={baseStyle}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(184,146,58,0.18)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--paper)')}>
      {inner}
    </Link>
  );
}
