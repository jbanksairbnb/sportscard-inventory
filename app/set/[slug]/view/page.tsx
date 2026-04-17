'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

function ImageLightbox({ urls, startIndex, onClose }: { urls: string[]; startIndex: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIndex);
  const canPrev = idx > 0;
  const canNext = idx < urls.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85" onClick={onClose}>
      <div className="relative max-w-4xl max-h-[90vh] p-4 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!canPrev}
          className="rounded-full bg-gray-900/80 px-4 py-3 text-white text-xl hover:bg-gray-900 disabled:opacity-20"
        >
          ‹
        </button>
        <div className="flex flex-col items-center gap-2">
          <img src={urls[idx]} alt="Card" className="max-w-full max-h-[75vh] rounded-lg shadow-2xl object-contain" />
          {urls.length > 1 && (
            <span className="text-white text-sm opacity-70">{idx + 1} / {urls.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!canNext}
          className="rounded-full bg-gray-900/80 px-4 py-3 text-white text-xl hover:bg-gray-900 disabled:opacity-20"
        >
          ›
        </button>
        <button type="button" onClick={onClose} className="absolute top-2 right-2 rounded-full bg-gray-900/80 px-3 py-1 text-white text-sm hover:bg-gray-900">
          ✕
        </button>
      </div>
    </div>
  );
}

function CardTile({ row, year, brand }: { row: Record<string, any>; year: string; brand: string }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const cardNum = row['Card #'] ? `#${row['Card #']}` : '';
  const description = row['Description'] || '';
  const gradingCo = row['Grading Company'] || '';
  const grade = row['Grade'] || '';
  const salePrice = row['Sale Price'] || '';
  const imgs = [row['Image 1'] || '', row['Image 2'] || ''].filter(Boolean);
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
        {details && <div className="text-sm text-gray-500">{details}</div>}
        {imgs.length > 0 && (
          <div className="flex gap-2 mt-1">
            {imgs.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={i === 0 ? 'Front' : 'Back'}
                onClick={() => setLightboxIndex(i)}
                className="h-20 w-20 rounded border border-gray-200 object-cover cursor-pointer hover:opacity-80"
                title="Click to enlarge"
              />
            ))}
          </div>
        )}
      </div>
      {lightboxIndex !== null && (
        <ImageLightbox urls={imgs} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  );
}

function CardTableRow({ row, year, brand }: { row: Record<string, any>; year: string; brand: string }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imgs = [row['Image 1'] || '', row['Image 2'] || ''].filter(Boolean);

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-gray-50">
        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{[year, brand].filter(Boolean).join(' • ')}</td>
        <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-800">{row['Card #'] ? `#${row['Card #']}` : ''}</td>
        <td className="px-3 py-2 text-sm text-gray-700">{row['Description'] || ''}</td>
        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{row['Grading Company'] || ''}</td>
        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{row['Grade'] ? `Grade ${row['Grade']}` : ''}</td>
        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{row['Sale Price'] || ''}</td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            {imgs.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={i === 0 ? 'Front' : 'Back'}
                onClick={() => setLightboxIndex(i)}
                className="h-12 w-12 rounded border border-gray-200 object-cover cursor-pointer hover:opacity-80"
                title="Click to enlarge"
              />
            ))}
          </div>
        </td>
      </tr>
      {lightboxIndex !== null && (
        <ImageLightbox urls={imgs} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
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
  const [listView, setListView] = useState(false);
  const [search, setSearch] = useState('');

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

  const displayed = rows
    .filter((r) => !showOwnedOnly || String(r['Owned'] || '') === 'Yes')
    .filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        String(r['Card #'] || '').toLowerCase().includes(q) ||
        String(r['Description'] || '').toLowerCase().includes(q)
      );
    });

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
            <Link href="/">
              <Image src="/sports-collective-logo.png" alt="Sports Collective" width={120} height={30} className="h-8 w-auto" priority />
            </Link>
            <Link href={`/set/${encodeURIComponent(slug)}`} className="rounded-xl bg-white px-3 py-1 text-sm shadow">
              ← Edit
            </Link>
            <h1 className="text-2xl font-semibold">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards…"
              className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm w-44"
            />
            <button
              type="button"
              onClick={() => setListView((v) => !v)}
              className={`rounded-xl px-3 py-1.5 text-sm shadow border ${listView ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
            >
              {listView ? 'Grid View' : 'List View'}
            </button>
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
        ) : listView ? (
          <section className="overflow-x-auto rounded-2xl bg-white shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Year • Brand</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Card #</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Grading Co.</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Grade</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Sale Price</th>
                  <th className="px-3 py-2 font-medium">Images</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((row, i) => (
                  <CardTableRow key={i} row={row} year={year} brand={brand} />
                ))}
              </tbody>
            </table>
          </section>
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
