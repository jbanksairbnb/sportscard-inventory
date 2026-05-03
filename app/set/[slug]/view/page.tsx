'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import SetHeaderBanner from '@/components/SetHeaderBanner';

type ImageItem = {
  url: string;
  cardNum: string;
  player: string;
  side: 'Front' | 'Back';
};

function ImageLightbox({ items, startIdx, onClose }: { items: ImageItem[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(Math.max(0, Math.min(startIdx, items.length - 1)));
  useEffect(() => { setIdx(Math.max(0, Math.min(startIdx, items.length - 1))); }, [startIdx, items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') { setIdx(i => (i - 1 + items.length) % items.length); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setIdx(i => (i + 1) % items.length); e.preventDefault(); }
      else if (e.key === 'Escape') { onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  if (items.length === 0) return null;
  const current = items[idx];
  const arrowBtn: React.CSSProperties = {
    background: 'rgba(42,20,52,0.7)', color: 'var(--cream)',
    border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 24,
    cursor: 'pointer', lineHeight: 1,
  };
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
        <img src={current.url} alt="Card" style={{ maxWidth: '90vw', maxHeight: '78vh', borderRadius: 12, display: 'block' }} />
        <div style={{
          marginTop: 12, padding: '8px 14px',
          background: 'rgba(248,236,208,0.96)', border: '2px solid var(--plum)',
          borderRadius: 8, color: 'var(--plum)', textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
            {current.cardNum ? `#${current.cardNum}` : ''}
          </span>
          <span className="display" style={{ fontSize: 14 }}>{current.player || '—'}</span>
          <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>{current.side}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 8 }}>
            {idx + 1} / {items.length}
          </span>
        </div>
        {items.length > 1 && (
          <div style={{ position: 'absolute', top: '40%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px', pointerEvents: 'none' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => (i - 1 + items.length) % items.length); }}
              style={{ ...arrowBtn, pointerEvents: 'auto' }} title="Previous (←)">‹</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => (i + 1) % items.length); }}
              style={{ ...arrowBtn, pointerEvents: 'auto' }} title="Next (→)">›</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm"
          style={{ position: 'absolute', top: 4, right: 4 }}>
          ✕ Close
        </button>
      </div>
    </div>
  );
}

function CardTile({ row, year, brand, onImageClick }: {
  row: Record<string, any>; year: string; brand: string;
  onImageClick: (cardIdx: number, side: 'Front' | 'Back') => void;
}) {
  const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
  const description = row['Player'] || row['Description'] || '';
  const gradingCo = row['Grading Company'] || '';
  const grade = row['Grade'] || '';
  const salePrice = row['Sale Price'] || '';
  const img1 = row['Image 1'] || '';
  const img2 = row['Image 2'] || '';
  const owned = String(row['Owned'] || '') === 'Yes';
  const details = [gradingCo, grade ? `Grade ${grade}` : '', salePrice].filter(Boolean).join('  ·  ');
  const cardIdx = row.__cardIdx as number;

  return (
    <div className="panel" style={{ padding: '14px 16px', position: 'relative' }}>
      {owned && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'var(--teal)', color: 'var(--cream)',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
          padding: '2px 7px', borderRadius: 100,
        }}>OWNED</div>
      )}
      <div className="eyebrow" style={{ fontSize: 10.5, color: 'var(--orange)', marginBottom: 4 }}>
        {[year, brand].filter(Boolean).join(' · ')}
      </div>
      <div style={{ marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-mute)' }}>{cardNum}</span>
        {cardNum && description && ' '}
        <span className="display" style={{ fontSize: 14, color: 'var(--plum)' }}>{description}</span>
      </div>
      {details && (
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>{details}</div>
      )}
      {(img1 || img2) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {img1 && (
            <img src={img1} alt="Front" onClick={() => onImageClick(cardIdx, 'Front')}
              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }} />
          )}
          {img2 && (
            <img src={img2} alt="Back" onClick={() => onImageClick(cardIdx, 'Back')}
              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }} />
          )}
        </div>
      )}
    </div>
  );
}

function CardTableRow({ row, year, brand, onImageClick }: {
  row: Record<string, any>; year: string; brand: string;
  onImageClick: (cardIdx: number, side: 'Front' | 'Back') => void;
}) {
  const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
  const img1 = row['Image 1'] || '';
  const img2 = row['Image 2'] || '';
  const cardIdx = row.__cardIdx as number;

  return (
    <tr style={{ borderTop: '1.5px solid var(--cream-warm)' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream-warm)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
      <td className="eyebrow" style={{ padding: '10px 14px', fontSize: 10.5, color: 'var(--orange)', whiteSpace: 'nowrap' }}>
        {[year, brand].filter(Boolean).join(' · ')}
      </td>
      <td className="mono" style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
        {cardNum}
      </td>
      <td className="display" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--plum)' }}>
        {row['Player'] || row['Description'] || ''}
      </td>
      <td className="eyebrow" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
        {row['Grading Company'] || ''}
      </td>
      <td className="mono" style={{ padding: '10px 14px', fontSize: 13, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
        {row['Grade'] ? `Grade ${row['Grade']}` : ''}
      </td>
      <td className="mono" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--teal)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {row['Sale Price'] || ''}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {img1 && (
            <img src={img1} alt="Front" onClick={() => onImageClick(cardIdx, 'Front')}
              style={{ width: 44, height: 44, borderRadius: 6, border: '1.5px solid var(--plum)', objectFit: 'cover', cursor: 'pointer' }} />
          )}
          {img2 && (
            <img src={img2} alt="Back" onClick={() => onImageClick(cardIdx, 'Back')}
              style={{ width: 44, height: 44, borderRadius: 6, border: '1.5px solid var(--plum)', objectFit: 'cover', cursor: 'pointer' }} />
          )}
        </div>
      </td>
    </tr>
  );
}

export default function InventoryViewPage() {
  const router = useRouter();
  const params = useParams();
  const slug = String(params?.slug || '');

  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [brand, setBrand] = useState('');
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [listView, setListView] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data } = await supabase
        .from('sets')
        .select('title, year, brand, rows')
        .eq('slug', slug)
        .single();
      if (data) {
        setTitle(data.title || '');
        setYear(data.year ? String(data.year) : '');
        setBrand(data.brand || '');
        setRows(data.rows || []);
      }
      setLoading(false);
    }
    load();
  }, [slug, router]);

  const displayed = useMemo(() => {
    const arr = showOwnedOnly
      ? rows.filter((r) => String(r['Owned'] || '') === 'Yes')
      : rows;
    return arr.map((r, i) => ({ ...r, __cardIdx: i }));
  }, [rows, showOwnedOnly]);

  // Build a flat list of every image across the displayed cards so the
  // lightbox can scroll through the whole set with the arrow keys.
  const lightboxItems: ImageItem[] = useMemo(() => {
    const items: ImageItem[] = [];
    for (const row of displayed) {
      const cardNum = row['Card #'] ? String(row['Card #']) : '';
      const player = String(row['Player'] || row['Description'] || '');
      if (row['Image 1']) items.push({ url: String(row['Image 1']), cardNum, player, side: 'Front' });
      if (row['Image 2']) items.push({ url: String(row['Image 2']), cardNum, player, side: 'Back' });
    }
    return items;
  }, [displayed]);

  function openLightbox(cardIdx: number, side: 'Front' | 'Back') {
    const target = displayed[cardIdx];
    if (!target) return;
    const targetUrl = String(target[side === 'Front' ? 'Image 1' : 'Image 2'] || '');
    if (!targetUrl) return;
    const idx = lightboxItems.findIndex(it => it.url === targetUrl);
    setLightboxIdx(idx >= 0 ? idx : 0);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <SCLogo size={80} />
          <p className="eyebrow" style={{ marginTop: 20, color: 'var(--ink-mute)' }}>Loading inventory…</p>
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
          maxWidth: 1400, margin: '0 auto', padding: '10px 28px',
          display: 'flex', alignItems: 'center', gap: 20,
        }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>

          <Link href={`/set/${encodeURIComponent(slug)}`} className="btn btn-outline btn-sm" style={{ flexShrink: 0 }}>
            ← Edit
          </Link>

          <div className="display" style={{ fontSize: 18, color: 'var(--plum)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button type="button" onClick={() => setListView((v) => !v)}
              className={`btn btn-sm ${listView ? 'btn-primary' : 'btn-ghost'}`}>
              {listView ? 'Grid' : 'List'}
            </button>
            <button type="button" onClick={() => setShowOwnedOnly((v) => !v)}
              className={`btn btn-sm ${showOwnedOnly ? 'btn-primary' : 'btn-ghost'}`}>
              {showOwnedOnly ? 'Owned Only' : 'All Cards'}
            </button>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 700 }}>
              {displayed.length} cards
            </span>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 28px 80px' }}>
        <div style={{ marginBottom: 20 }}>
          <SetHeaderBanner year={year} brand={brand} title={title} />
        </div>
        {displayed.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No cards to display</div>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: 0 }}>
              {showOwnedOnly ? 'No owned cards yet.' : 'This set has no cards.'}
            </p>
          </div>
        ) : listView ? (
          <div className="panel-bordered" style={{ overflow: 'hidden', padding: 0 }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--plum)' }}>
                 {['Year · Brand', 'Card #', 'Player', 'Grading Co.', 'Grade', 'Sale Price', 'Images'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left',
                      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      color: 'var(--mustard)', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ background: 'var(--cream)' }}>
                {displayed.map((row, i) => (
                  <CardTableRow key={i} row={row} year={year} brand={brand} onImageClick={openLightbox} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {displayed.map((row, i) => (
              <CardTile key={i} row={row} year={year} brand={brand} onImageClick={openLightbox} />
            ))}
          </div>
        )}
      </div>

      {lightboxIdx !== null && lightboxItems.length > 0 && (
        <ImageLightbox items={lightboxItems} startIdx={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}

      <footer style={{
        borderTop: '3px solid var(--plum)', padding: '24px 28px',
        maxWidth: 1400, margin: '0 auto',
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
