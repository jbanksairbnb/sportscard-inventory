'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import SCLogo from '@/components/SCLogo';

const EXPECTED_HEADERS = [
  'Card #', 'Player', 'Owned', 'Raw Grade', 'Graded',
  'Grading Company', 'Grade', 'Cost', 'Value', 'Target Price',
  'Sale Price', 'Date Purchased', 'Purchased From', 'Upload Image(s)',
];

const SPORTS = ['baseball', 'football', 'basketball', 'hockey'] as const;

type ParsedItem = {
  filename: string;
  year: string;
  brand: string;
  title: string;
  sport: string;
  rows: Record<string, unknown>[];
  error?: string;
};

function inferFromFilename(filename: string): { year: string; brand: string; title: string; sport: string } {
  const base = filename.replace(/\.csv$/i, '').replace(/[_]+/g, ' ').replace(/[-]+/g, ' ').trim();
  const yearMatch = base.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : '';
  const lower = base.toLowerCase();
  let brand = '';
  if (/\btopps\b/.test(lower)) brand = 'Topps';
  else if (/\bbowman\b/.test(lower)) brand = 'Bowman';
  else if (/\bplay\s*ball\b/.test(lower)) brand = 'Play Ball';
  else if (/\bdonruss\b/.test(lower)) brand = 'Donruss';
  else if (/\bfleer\b/.test(lower)) brand = 'Fleer';
  else if (/\bupper\s*deck\b/.test(lower)) brand = 'Upper Deck';
  let sport = 'baseball';
  if (/\bfootball\b|\bnfl\b/.test(lower)) sport = 'football';
  else if (/\bbasketball\b|\bnba\b/.test(lower)) sport = 'basketball';
  else if (/\bhockey\b|\bnhl\b/.test(lower)) sport = 'hockey';
  let title = base;
  if (year) title = title.replace(year, '').trim();
  if (brand) title = title.replace(new RegExp(brand, 'i'), '').trim();
  title = title.replace(/\b(baseball|football|basketball|hockey|nfl|nba|nhl|mlb)\b/gi, '').trim();
  title = title.replace(/\s+/g, ' ');
  if (year && brand) title = `${year} ${brand} — ${title || 'Base Set'}`;
  else if (year) title = `${year} ${title || 'Set'}`;
  return { year, brand, title, sport };
}

export default function AdminTemplatesPage() {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string>('');

  function handleFiles(files: FileList | null) {
    if (!files) return;
    setResult('');
    const arr = Array.from(files);
    const next: ParsedItem[] = [];
    let pending = arr.length;
    arr.forEach(file => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const fields = res.meta.fields || [];
          const missing = EXPECTED_HEADERS.filter(h => !fields.includes(h));
          const meta = inferFromFilename(file.name);
          if (missing.length > 0) {
            next.push({ filename: file.name, ...meta, rows: [], error: `Missing columns: ${missing.join(', ')}` });
          } else {
            const cleaned = (res.data as Record<string, unknown>[]).map(r => {
              const row: Record<string, unknown> = {};
              EXPECTED_HEADERS.forEach(h => { row[h] = r[h] ?? ''; });
              return row;
            }).filter(r => String(r['Card #'] || '').trim() !== '');
            next.push({ filename: file.name, ...meta, rows: cleaned });
          }
          pending -= 1;
          if (pending === 0) setItems(prev => [...prev, ...next]);
        },
        error: (err) => {
          next.push({ filename: file.name, ...inferFromFilename(file.name), rows: [], error: `Parse error: ${err.message}` });
          pending -= 1;
          if (pending === 0) setItems(prev => [...prev, ...next]);
        },
      });
    });
  }

  function updateItem(idx: number, patch: Partial<ParsedItem>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }
  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  const valid = items.filter(it => !it.error && it.year && it.brand && it.title && it.sport && it.rows.length > 0);

  async function handleUpload() {
    if (valid.length === 0) return;
    setUploading(true);
    setResult('');
    try {
      const res = await fetch('/api/admin/set-templates/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: valid.map(it => ({
            year: Number(it.year),
            brand: it.brand,
            title: it.title,
            sport: it.sport,
            rows: it.rows,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(`✓ Uploaded ${data.inserted} template(s).`);
      setItems([]);
    } catch (e) {
      setResult(`✗ ${e instanceof Error ? e.message : 'Upload failed'}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <Link href="/admin" className="btn btn-outline btn-sm">← Admin</Link>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', flex: 1 }}>Bulk Upload Templates</div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '24px 28px', marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 6 }}>1. Drop CSVs</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Drop one or more CSV files in standard format. Filenames are parsed for year/brand/sport.
            You can edit the metadata for each file before uploading.
          </p>
          <input type="file" accept=".csv,text/csv" multiple
            onChange={(e) => handleFiles(e.target.files)}
            style={{ display: 'block', padding: '8px 12px', border: '2px solid var(--plum)', borderRadius: 10, background: 'var(--cream)', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', cursor: 'pointer' }} />
        </section>

        {items.length > 0 && (
          <section className="panel-bordered" style={{ padding: '24px 28px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>2. Review & Upload ({items.length})</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                {valid.length} of {items.length} ready
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((it, i) => (
                <div key={i} style={{
                  border: it.error ? '1.5px solid var(--rust)' : '1.5px solid var(--rule)',
                  borderRadius: 8, padding: 12,
                  display: 'grid', gridTemplateColumns: '1fr 80px 130px 2fr 110px 80px 32px', gap: 10, alignItems: 'center',
                }}>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={it.filename}>{it.filename}</div>
                  <input type="text" value={it.year} onChange={e => updateItem(i, { year: e.target.value })} placeholder="Year" className="input-sc" style={{ fontSize: 12, padding: '6px 8px' }} />
                  <input type="text" value={it.brand} onChange={e => updateItem(i, { brand: e.target.value })} placeholder="Brand" className="input-sc" style={{ fontSize: 12, padding: '6px 8px' }} />
                  <input type="text" value={it.title} onChange={e => updateItem(i, { title: e.target.value })} placeholder="Title" className="input-sc" style={{ fontSize: 12, padding: '6px 8px' }} />
                  <select value={it.sport} onChange={e => updateItem(i, { sport: e.target.value })} className="input-sc" style={{ fontSize: 12, padding: '6px 8px' }}>
                    {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="mono" style={{ fontSize: 11, color: it.error ? 'var(--rust)' : 'var(--teal)', textAlign: 'right' }}>
                    {it.error ? 'error' : `${it.rows.length} cards`}
                  </div>
                  <button onClick={() => removeItem(i)} title="Remove" style={{ background: 'transparent', border: 'none', color: 'var(--rust)', fontSize: 18, cursor: 'pointer' }}>×</button>
                  {it.error && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--rust)', fontWeight: 600 }}>{it.error}</div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={handleUpload} disabled={uploading || valid.length === 0} className="btn btn-primary">
                {uploading ? 'Uploading…' : `Upload ${valid.length} template${valid.length === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => setItems([])} className="btn btn-ghost btn-sm">Clear</button>
              {result && <span className="mono" style={{ fontSize: 12, color: result.startsWith('✓') ? 'var(--teal)' : 'var(--rust)', fontWeight: 600 }}>{result}</span>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
