'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

type IndexEntry = {
  slug: string;
  title: string;
  year: number;
  brand: string;
  desc: string;
  updatedAt: number;
  rowCount: number;
  ownedCount?: number;
  ownedPct?: number;

  // NEW optional fields for financial stats
  totalCost?: number;
  totalValue?: number;
  gainLoss?: number;
};

function loadIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem('sc_sets_index');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function loadSet(slug: string) {
  try {
    const raw = localStorage.getItem(`sc_set_${slug}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function computeOwnedStats(rows: any[]) {
  const total = rows?.length || 0;
  const owned = rows?.filter((r) => String(r?.['Owned'] || '') === 'Yes').length || 0;
  const pct = total ? (owned / total) * 100 : 0;
  return { ownedCount: owned, ownedPct: pct, total };
}

// Safe numeric parser for "$1,234.56", "1,234.56", 1234.56, etc.
function toNumber(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,]/g, '').trim();
    const n = Number(cleaned);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

function computeFinancials(rows: any[]) {
  const totalCost = rows?.reduce((acc: number, r: any) => acc + toNumber(r?.['Cost']), 0) || 0;
  const totalValue = rows?.reduce((acc: number, r: any) => acc + toNumber(r?.['Value']), 0) || 0;
  const gainLoss = totalValue - totalCost;
  return { totalCost, totalValue, gainLoss };
}

export default function HomePage() {
  const [sets, setSets] = useState<IndexEntry[]>([]);

  useEffect(() => {
    const idx = loadIndex();
    const withStats = idx.map((e) => {
      // If stats already cached in the index, keep them. Otherwise compute.
      if (
        typeof e.ownedCount === 'number' &&
        typeof e.ownedPct === 'number' &&
        typeof e.totalCost === 'number' &&
        typeof e.totalValue === 'number' &&
        typeof e.gainLoss === 'number'
      ) {
        return e;
      }

      const saved = loadSet(e.slug);
      const rows = saved?.rows || [];

      const { ownedCount, ownedPct } = computeOwnedStats(rows);
      const { totalCost, totalValue, gainLoss } = computeFinancials(rows);

      return { ...e, ownedCount, ownedPct, totalCost, totalValue, gainLoss };
    });
    setSets(withStats);
  }, []);

  const sorted = useMemo(
    () => [...sets].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [sets]
  );

  const COLORS = ['#10b981', '#e5e7eb']; // teal + gray

  // Currency formatter
  const fmtCurrency = (n: number) =>
    `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* 🔥 Header: logo upper-left + Sets.png underneath */}
        <header className="flex flex-col items-center gap-2">
          <div className="self-start">
            <Image
              src="/sports-collective-logo.png"
              alt="Sports Collective logo"
              width={120}  // reduced 50%
              height={30}
              priority
            />
          </div>
          <Image
            src="/Sets.png"
            alt="Your Sets secondary logo"
            width={300}
            height={100}
          />
        </header>

        {/* New Upload button */}
        <div className="flex justify-end">
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
              const owned = typeof s.ownedCount === 'number' ? s.ownedCount : 0;
              const pct = typeof s.ownedPct === 'number' ? s.ownedPct : 0;
              const needPct = Math.max(0, 100 - pct);

              const data = [
                { name: 'Owned', value: Math.round(pct * 10) / 10 },
                { name: 'Needed', value: Math.round(needPct * 10) / 10 },
              ];

              const totalCost = typeof s.totalCost === 'number' ? s.totalCost : 0;
              const totalValue = typeof s.totalValue === 'number' ? s.totalValue : 0;
              const gainLoss = typeof s.gainLoss === 'number' ? s.gainLoss : totalValue - totalCost;

              return (
                <Link
                  key={s.slug}
                  href={`/set/${encodeURIComponent(s.slug)}`}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-lg font-semibold">{s.title}</div>
                      <div className="text-sm text-gray-600">
                        {s.year} • {s.brand}
                      </div>
                      <div className="text-sm text-gray-600 truncate">{s.desc}</div>

                      {/* Existing stats */}
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

                      {/* NEW: Financial stats */}
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
                        Last updated {new Date(s.updatedAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="h-28 w-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip formatter={(v: any) => `${v}%`} />
                          <Pie
                            data={data}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={36}
                            outerRadius={54}
                            stroke="none"
                          >
                            {data.map((entry, idx) => (
                              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mt-1 text-center text-xs text-gray-600">Owned vs Needed</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
