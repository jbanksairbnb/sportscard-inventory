'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
      onClick={onClose}
    >
      <div className="relative max-w-4xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="Card" className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain" />
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 rounded-full bg-gray-900/80 px-3 py-1 text-white text-sm hover:bg-gray-900"
        >
          ✕ Close
        </button>
      </div>
    </div>
  );
}

function CardTile({ row, year, brand }: { row: Record<string, any>; year: string; brand: string }) {
  const [lightboxUrl, setLightboxUrl] = useState('');

  const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
  const description = row['Description'] || '';
  const gradingCo = row['Grading Company'] || '';
  const grade = row['Grade'] || '';
  const salePrice = row['Sale Price'] || '';
  const img1 = row['Image 1'] || '';
  const img2 = row['Image 2'] || '';

  const details = [gradingCo, grade ? `Grade ${grade}` : '', salePrice].filter(Boolean).join('  •  ');

  return (
    <>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow flex flex-col gap-2">
        <div className="text-xs text-gray-400 font-medium tracking-wide uppercase">
          {[year, brand].filter(Boolean).join(' • ')}
        </div>
        <div>
          <span className="text-lg font-bold text-gray-800">{cardNum}</span>
          {cardNum && description && ' '}
          <span className="text-lg font-semibold text-gray-700">{description}</span>
        </div>
        {details && (
          <div className="text-sm text-gray-500">{details}</div>
        )}
        {(img1 || img2) && (
          <div className="flex gap-2 mt-1">
            {img1 && (
              <img
                src={img1}
                alt="Front"
                onClick={() => setLightboxUrl(img1)}
                className="h-20 w-20 rounded border border-gray-200 object-cover cursor-pointer hover:opacity-80"
                title="Click to enlarge"
              />
            )}
            {img2 && (
              <img
                src={img2}
                alt="Back"
                onClick={() => setLightboxUrl(img2)}
                className="h-20 w-20 rounded border border-gray-200 object-cover cursor-pointer hover:opacity-80"
                title="Click to enlarge"
              />
            )}
          </div>
        )}
      </div>

      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} />
      )}
    </>
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

  const displayed = showOwnedOnly
    ? rows.filter((r) => String(r['Owned'] || '') === 'Yes')
    : rows;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/sports-collective-logo.png" alt="Sports Collective" width={120} height={30} className="h-8 w-auto" priority />
            <Link href={`/set/${encodeURIComponent(slug)}`} className="rounded-xl bg-white px-3 py-1 text-sm shadow">
              ← Edit
            </Link>
            <h1 className="text-2xl font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowOwnedOnly((v) => !v)}
              className={`rounded-xl px-3 py-1.5 text-sm shadow border ${showOwnedOnly ? 'bg-amber-500 text-white border-amber-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
            >
              {showOwnedOnly ? 'Showing: Owned' : 'Show Owned Only'}
            </button>
            <span className="text-sm text-gray-500">{displayed.length} cards</span>
          </div>
        </header>

        {displayed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
            No cards to display.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayed.map((row, i) => (
              <CardTile key={i} row={row} year={year} brand={brand} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
