'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

type SharedSet = {
  share_token: string;
  title: string;
  year: number | null;
  brand: string;
  owner_email: string;
  owned_pct: number;
  row_count: number;
  owned_count: number;
};

export default function CommunityPage() {
  const [sets, setSets] = useState<SharedSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [listView, setListView] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data } = await supabase
        .from('sets')
        .select('share_token, title, year, brand, owner_email, owned_pct, row_count, owned_count')
        .not('share_token', 'is', null)
        .order('title', { ascending: true });
      if (data) setSets(data as SharedSet[]);
      setLoading(false);
    }
    load();
  }, []);

  const displayed = sets.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (s.title || '').toLowerCase().includes(q) ||
      (s.owner_email || '').toLowerCase().includes(q) ||
      (s.brand || '').toLowerCase().includes(q)
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
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Image src="/sports-collective-logo.png" alt="Sports Collective" width={120} height={30} className="h-8 w-auto" priority />
            <Link href="/" className="rounded-xl bg-white px-3 py-1 text-sm shadow">← My Sets</Link>
            <h1 className="text-2xl font-semibold">Community Sets</h1>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sets…"
              className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm w-44"
            />
            <button
              type="button"
              onClick={() => setListView((v) => !v)}
              className={`rounded-xl px-3 py-1.5 text-sm shadow border ${listView ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
            >
              {listView ? 'Grid View' : 'List View'}
            </button>
            <span className="text-sm text-gray-500">{displayed.length} sets</span>
          </div>
        </header>

        {displayed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
            {sets.length === 0 ? 'No sets have been shared publicly yet.' : 'No sets match your search.'}
          </div>
        ) : listView ? (
          <section className="rounded-2xl bg-white shadow overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Set Title</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Cards</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">% Owned</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((s) => (
                  <tr key={s.share_token} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{s.owner_email || 'Unknown'}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {s.title}
                      {s.year || s.brand ? (
                        <span className="ml-2 text-xs text-gray-400">{[s.year, s.brand].filter(Boolean).join(' • ')}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.owned_count} / {s.row_count}</td>
                    <td className="px-4 py-3 text-gray-600">{(s.owned_pct || 0).toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      <Link href={`/share/${s.share_token}`} className="rounded-xl bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayed.map((s) => (
              <Link
                key={s.share_token}
                href={`/share/${s.share_token}`}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow hover:shadow-md block"
              >
                <div className="text-xs text-gray-400 font-medium tracking-wide uppercase mb-1">
                  {[s.year, s.brand].filter(Boolean).join(' • ')}
                </div>
                <div className="text-lg font-semibold text-gray-800">{s.title}</div>
                <div className="text-sm text-gray-500 mt-0.5">{s.owner_email || 'Unknown'}</div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">{s.owned_count} / {s.row_count} cards</span>
                  <span className="font-semibold text-emerald-600">{(s.owned_pct || 0).toFixed(1)}% owned</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, s.owned_pct || 0)}%` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
