'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type CardRow = Record<string, string | number | null>;

type SetData = {
  title: string;
  year: number | null;
  brand: string;
  owner_email: string;
  row_count: number;
  owned_count: number;
  owned_pct: number;
  rows: CardRow[];
};

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(42, 20, 52, 0.88)',
      }}
      onClick={onClose}
    >
      <div style={{ position: 'relative', padding: 16 }} onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="Card" style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 12, display: 'block' }} />
        <button
          type="button"
          onClick={onClose}
          className="btn btn-sm"
          style={{ position: 'absolute', top: 4, right: 4 }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function CardTile({ row }: { row: CardRow }) {
  const [lightboxUrl, setLightboxUrl] = useState('');
  const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
  const description = String(row['Description'] || '');
  const gradingCo = String(row['Grading Company'] || '');
  const grade = row['Grade'] ? `Grade ${row['Grade']}` : '';
  const owned = String(row['Owned'] || '') === 'Yes';
  const img1 = String(row['Image 1'] || '');
  const img2 = String(row['Image 2'] || '');
  const details = [gradingCo, grade].filter(Boolean).join('  ·  ');

  return (
    <>
      <div className="panel" style={{ padding: '14px 16px', position: 'relative' }}>
        {owned && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            background: 'var(--teal)', color: 'var(--cream)',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            padding: '2px 7px', borderRadius: 100,
          }}>
            OWNED
          </div>
        )}
        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 700, marginBottom: 4 }}>
          {cardNum}
        </div>
        <div className="display" style={{ fontSize: 14, color: 'var(--plum)', marginBottom: 4, lineHeight: 1.2 }}>
          {description || '—'}
        </div>
        {details && (
          <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 6 }}>
            {details}
          </div>
        )}
        {(img1 || img2) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {img1 && (
              <img
                src={img1}
                alt="Front"
                onClick={() => setLightboxUrl(img1)}
                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }}
              />
            )}
            {img2 && (
              <img
                src={img2}
                alt="Back"
                onClick={() => setLightboxUrl(img2)}
                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }}
              />
            )}
          </div>
        )}
      </div>
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} />}
    </>
  );
}

export default function SharePage() {
  const params = useParams();
  const token = String(params?.token || '');

  const [setData, setSetData] = useState<SetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [listView, setListView] = useState(false);
  const [search, setSearch] = useState('');

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

  const { title, year, brand, owner_email, row_count, owned_count, owned_pct, rows } = setData;
  const pct = owned_pct || 0;

  const displayed = (rows || []).filter((row) => {
    if (showOwnedOnly && String(row['Owned'] || '') !== 'Yes') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        String(row['Card #'] || '').toLowerCase().includes(q) ||
        String(row['Description'] || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

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
          <Link href="/shared" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
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

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', border: '2px solid var(--plum)',
            borderRadius: 100, background: 'var(--cream)', flex: 1, minWidth: 180, maxWidth: 300,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--plum)', flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards…"
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)',
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowOwnedOnly((v) => !v)}
            className={`btn btn-sm ${showOwnedOnly ? 'btn-primary' : 'btn-ghost'}`}
          >
            {showOwnedOnly ? 'All Cards' : 'Owned Only'}
          </button>
          <button
            type="button"
            onClick={() => setListView((v) => !v)}
            className={`btn btn-sm ${listView ? 'btn-primary' : 'btn-ghost'}`}
          >
            {listView ? 'Grid' : 'List'}
          </button>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 700 }}>
            {displayed.length} {displayed.length === 1 ? 'card' : 'cards'}
          </span>
        </div>

        {displayed.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '40px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>No cards match</div>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: 0 }}>Try adjusting your search or filter.</p>
          </div>
        ) : listView ? (
          <div className="panel-bordered" style={{ overflow: 'hidden', padding: 0 }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--plum)' }}>
                  {['Card #', 'Description', 'Grading', 'Owned'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 16px', textAlign: 'left',
                      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--mustard)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((row, i) => {
                  const owned = String(row['Owned'] || '') === 'Yes';
                  const gradingCo = String(row['Grading Company'] || '');
                  const grade = row['Grade'] ? `Grade ${row['Grade']}` : '';
                  return (
                    <tr key={i} style={{
                      borderTop: '1.5px solid var(--cream-warm)',
                      background: i % 2 === 0 ? 'var(--cream)' : 'var(--paper)',
                    }}>
                      <td className="mono" style={{ padding: '10px 16px', fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                        {row['Card #'] ? `#${row['Card #']}` : '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className="display" style={{ fontSize: 13, color: 'var(--plum)' }}>
                          {String(row['Description'] || '—')}
                        </span>
                      </td>
                      <td className="eyebrow" style={{ padding: '10px 16px', fontSize: 9, color: 'var(--orange)' }}>
                        {[gradingCo, grade].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {owned && (
                          <span style={{
                            background: 'var(--teal)', color: 'var(--cream)',
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                            padding: '2px 8px', borderRadius: 100,
                          }}>
                            OWNED
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {displayed.map((row, i) => <CardTile key={i} row={row} />)}
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
        <Link href="/shared" style={{ color: 'inherit', textDecoration: 'none' }}>← Community Sets</Link>
      </footer>
    </div>
  );
}