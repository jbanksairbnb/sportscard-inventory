'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import SetCardsView, { SetCardRow } from '@/components/SetCardsView';

type SetData = {
  title: string;
  year: number | null;
  brand: string;
  owner_email: string;
  row_count: number;
  owned_count: number;
  owned_pct: number;
  rows: SetCardRow[];
};

export default function SharePage() {
  // useSearchParams (read inside SharePageContent) must sit under a Suspense
  // boundary or Next.js fails the build during prerender.
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>}>
      <SharePageContent />
    </Suspense>
  );
}

function SharePageContent() {
  const params = useParams();
  const token = String(params?.token || '');
  const searchParams = useSearchParams();
  // When a visitor arrives from a collector's member page we pass ?from=<userId>
  // so we can offer a one-click return to that exact page.
  const fromUserId = searchParams?.get('from') || '';
  const backHref = fromUserId ? `/profile/${fromUserId}` : '';

  const [setData, setSetData] = useState<SetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) return;
    const supabase = createClient();
    async function load() {
      const { data } = await supabase
        .from('sets')
        .select('title, year, brand, owner_email, row_count, owned_count, owned_pct, rows')
        .eq('share_token', token)
        .single();
      if (!data) { setNotFound(true); }
      else { setSetData(data as SetData); }
      setLoading(false);
    }
    load();
  }, [token]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <SCLogo size={80} />
          <p className="eyebrow" style={{ marginTop: 20, color: 'var(--ink-mute)' }}>Loading set…</p>
        </div>
      </div>
    );
  }

  if (notFound || !setData) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="panel-bordered" style={{ padding: '48px 40px', textAlign: 'center', maxWidth: 420 }}>
          <SCLogo size={64} />
          <div className="display" style={{ fontSize: 24, color: 'var(--plum)', margin: '16px 0 8px' }}>
            Set not found
          </div>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: '0 0 24px' }}>
            This shared set may have been removed or the link is invalid.
          </p>
          <Link href="/shared" className="btn btn-primary">← Community Sets</Link>
        </div>
      </div>
    );
  }

  const { title, year, brand, owner_email, row_count, owned_count, owned_pct } = setData;
  const pct = owned_pct || 0;

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
          display: 'flex', alignItems: 'center', gap: 20,
        }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)' }}>
              {[year, brand].filter(Boolean).join(' · ')}{owner_email ? `  ·  ${owner_email}` : ''}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {backHref && <Link href={backHref} className="btn btn-primary btn-sm">← Back to Collection</Link>}
            <Link href="/shared" className="btn btn-outline btn-sm">← Community</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 28px 80px' }}>
        <div className="panel-bordered" style={{ padding: '16px 24px', marginBottom: 28, display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)', marginBottom: 4 }}>Cards Owned</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--plum)' }}>
              {owned_count} <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>/ {row_count}</span>
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)', marginBottom: 4 }}>Completion</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)' }}>{pct.toFixed(1)}%</div>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="progress">
              <span style={{ width: `${Math.min(100, pct)}%`, background: 'var(--teal)' }} />
            </div>
          </div>
        </div>

        <SetCardsView rows={setData.rows || []} />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {backHref && <Link href={backHref} style={{ color: 'inherit', textDecoration: 'none' }}>← Back to Collection</Link>}
          <Link href="/shared" style={{ color: 'inherit', textDecoration: 'none' }}>← Community Sets</Link>
        </div>
      </footer>
    </div>
  );
}
