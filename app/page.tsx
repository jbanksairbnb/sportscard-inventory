'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { createClient } from '@/lib/supabase/client';

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

/* =====================  Share helpers  ===================== */
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function decodeSharePayload(code: string): any | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  } catch {
    return null;
  }
}
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

export default function HomePage() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Import shared set state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importPin, setImportPin] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const importCodeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserEmail(user.email || '');

      const { data } = await supabase
        .from('sets')
        .select('slug, title, year, brand, description, row_count, owned_count, owned_pct, total_cost, total_value, gain_loss, updated_at')
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

  async function handleImportSharedSet() {
    setImportError('');
    setImportSuccess('');
    const payload = decodeSharePayload(importCode);
    if (!payload || typeof payload !== 'object') {
      setImportError('Invalid share code. Please check and try again.');
      return;
    }
    if (payload.pinHash) {
      if (!importPin.trim()) {
        setImportError('This set is PIN-protected. Please enter the PIN.');
        return;
      }
      if (simpleHash(importPin.trim()) !== payload.pinHash) {
        setImportError('Incorrect PIN.');
        return;
      }
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Find a unique slug
    const base = slugify(payload.title || 'imported-set');
    const { data: existing } = await supabase
      .from('sets')
      .select('slug')
      .ilike('slug', `${base}%`);
    const existingSlugs = new Set((existing || []).map((r: any) => r.slug as string));
    let slug = base, i = 2;
    while (existingSlugs.has(slug)) slug = `${base}-${i++}`;

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const owned = rows.filter((r: any) => String(r?.['Owned'] || '') === 'Yes').length;
    const ownedPct = rows.length ? (owned / rows.length) * 100 : 0;

    const { error } = await supabase.from('sets').insert({
      user_id: user.id,
      slug,
      title: payload.title,
      year: Number(payload.year) || null,
      brand: payload.brand || '',
      description: payload.desc || '',
      rows,
      row_count: rows.length,
      owned_count: owned,
      owned_pct: ownedPct,
      total_cost: 0,
      total_value: 0,
      gain_loss: 0,
      updated_at: Date.now(),
    });

    if (error) {
      setImportError('Failed to import: ' + error.message);
      return;
    }

    setImportSuccess(`Imported "${payload.title}" successfully!`);
    setImportCode('');
    setImportPin('');

    // Refresh list
    const { data } = await supabase
      .from('sets')
      .select('slug, title, year, brand, description, row_count, owned_count, owned_pct, total_cost, total_value, gain_loss, updated_at')
      .order('updated_at', { ascending: false });
    if (data) setSets(data as SetRow[]);
  }

  const COLORS = ['#10b981', '#e5e7eb'];
  const fmtCurrency = (n: number) =>
    `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const sorted = useMemo(
    () => [...sets].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [sets]
  );

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
        {/* Header */}
        <header className="flex flex-col items-center gap-2">
          <div className="w-full flex items-center justify-between">
            <Image
              src="/sports-collective-logo.png"
              alt="Sports Collective logo"
              width={120}
              height={30}
              priority
            />
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span className="hidden sm:inline">{userEmail}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm shadow hover:bg-gray-50"
              >
                Sign out
              </button>
            </div>
          </div>
          <Image
            src="/Sets.png"
            alt="Your Sets secondary logo"
            width={300}
            height={100}
          />
        </header>

        {/* Action buttons */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setImportCode('');
              setImportPin('');
              setImportError('');
              setImportSuccess('');
              setShowImportModal(true);
            }}
            className="rounded-2xl border border-emerald-600 bg-white px-4 py-2 text-emerald-700 shadow hover:bg-emerald-50"
          >
            Import Shared Set
          </button>
          <Link
            href="/set/new"
            className="rounded-2xl bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700"
          >
            New Upload
          </Link>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-gray-600">
            No saved sets yet. Click <span className="font-medium">New Upload</span> to import a CSV and start editing.
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sorted.map((s) => {
              const owned = s.owned_count || 0;
              const pct = s.owned_pct || 0;
              const needPct = Math.max(0, 100 - pct);
              const data = [
                { name: 'Owned', value: Math.round(pct * 10) / 10 },
                { name: 'Needed', value: Math.round(needPct * 10) / 10 },
              ];
              const totalCost = s.total_cost || 0;
              const totalValue = s.total_value || 0;
              const gainLoss = s.gain_loss || 0;

              return (
                <div key={s.slug} className="relative group">
                <Link
                  href={`/set/${encodeURIComponent(s.slug)}`}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow hover:shadow-md block"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-lg font-semibold">{s.title}</div>
                      <div className="text-sm text-gray-600">{s.year} • {s.brand}</div>
                      <div className="text-sm text-gray-600 truncate">{s.description}</div>

                      <div className="mt-2 text-sm">
                        <div>
                          <span className="text-gray-600">Cards owned:</span>{' '}
                          <span className="font-medium">{owned}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">% owned:</span>{' '}
                          <span className="font-medium">{(Math.round(pct * 10) / 10).toFixed(1)}%</span>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:text-sm">
                        <div className="rounded-lg bg-gray-50 p-2">
                          <div className="text-gray-500">Total Cost</div>
                          <div className="font-semibold">{fmtCurrency(totalCost)}</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-2">
                          <div className="text-gray-500">Total Value</div>
                          <div className="font-semibold">{fmtCurrency(totalValue)}</div>
                        </div>
                        <div className={`rounded-lg p-2 ${gainLoss >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                          <div className="text-gray-500">Gain/Loss</div>
                          <div className={`font-semibold ${gainLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {fmtCurrency(gainLoss)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-gray-500">
                        Last updated {new Date(s.updated_at).toLocaleString()}
                      </div>
                    </div>

                    <div className="h-28 w-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip formatter={(v: any) => `${v}%`} />
                          <Pie data={data} dataKey="value" nameKey="name" innerRadius={36} outerRadius={54} stroke="none">
                            {data.map((_, idx) => (
                              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mt-1 text-center text-xs text-gray-600">Owned vs Needed</div>
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => handleDeleteSet(s.slug, s.title)}
                  title="Delete set"
                  className="absolute top-2 right-2 z-10 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-400 shadow opacity-0 group-hover:opacity-100 transition-opacity hover:border-red-300 hover:text-red-600"
                >
                  🗑
                </button>
                </div>
              );
            })}
          </section>
        )}
      </div>

      {/* Import shared set modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Import Shared Set</h2>
            <p className="mt-1 text-sm text-gray-600">
              Paste the share code you received. Enter the PIN if the set is protected.
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">Share Code</label>
              <textarea
                ref={importCodeRef}
                value={importCode}
                onChange={(e) => setImportCode(e.target.value)}
                rows={4}
                placeholder="Paste share code here…"
                className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-sm font-mono"
              />
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700">PIN (if required)</label>
              <input
                type="password"
                value={importPin}
                onChange={(e) => setImportPin(e.target.value)}
                placeholder="Leave blank if no PIN"
                className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-sm"
              />
            </div>
            {importError && <p className="mt-2 text-sm text-red-600">{importError}</p>}
            {importSuccess && <p className="mt-2 text-sm text-emerald-600">{importSuccess}</p>}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleImportSharedSet}
                disabled={!importCode.trim()}
                className="flex-1 rounded-2xl bg-emerald-600 px-4 py-2 text-sm text-white shadow hover:bg-emerald-700 disabled:opacity-40"
              >
                Import
              </button>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-2xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
