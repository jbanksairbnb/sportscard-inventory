'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import SCLogo from '@/components/SCLogo';

type ExistingTemplate = {
  id: string;
  year: number | null;
  brand: string | null;
  title: string | null;
  sport: string | null;
  card_count: number | null;
  is_official: boolean | null;
  updated_at: string | null;
  created_at: string | null;
};

// Roster template schema. 'Notes' and 'Tag #' are seller-bookkeeping
// fields — both optional so old set-roster CSVs produced before either
// column existed still import. 'Graded' was retired (graded-ness is
// now derived from the Grading Company field).
const EXPECTED_HEADERS = [
  'Card #', 'Player', 'Notes', 'Tag #', 'Owned', 'Raw Grade',
  'Grading Company', 'Grade', 'Cost', 'Value', 'Target Price',
  'Sale Price', 'Date Purchased', 'Purchased From', 'Upload Image(s)',
];
const OPTIONAL_HEADERS = new Set(['Notes', 'Tag #']);
const REQUIRED_HEADERS = EXPECTED_HEADERS.filter(h => !OPTIONAL_HEADERS.has(h));

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

  // Known brands first — preserves canonical capitalization / punctuation.
  // Order matters: longer/multi-word patterns before shorter ones.
  const KNOWN_BRANDS: Array<{ re: RegExp; brand: string }> = [
    { re: /\bo[\s.-]?pee[\s.-]?chee\b/, brand: 'O-Pee-Chee' },
    { re: /\bupper\s*deck\b/, brand: 'Upper Deck' },
    { re: /\bplay\s*ball\b/, brand: 'Play Ball' },
    { re: /\bstadium\s*club\b/, brand: 'Stadium Club' },
    { re: /\btopps\b/, brand: 'Topps' },
    { re: /\bbowman\b/, brand: 'Bowman' },
    { re: /\bdonruss\b/, brand: 'Donruss' },
    { re: /\bfleer\b/, brand: 'Fleer' },
    { re: /\bgoudey\b/, brand: 'Goudey' },
    { re: /\bleaf\b/, brand: 'Leaf' },
    { re: /\bpanini\b/, brand: 'Panini' },
    { re: /\bscore\b/, brand: 'Score' },
    { re: /\bpinnacle\b/, brand: 'Pinnacle' },
    { re: /\bsportflics\b/, brand: 'Sportflics' },
  ];
  let brand = '';
  for (const { re, brand: b } of KNOWN_BRANDS) {
    if (re.test(lower)) { brand = b; break; }
  }

  let sport = 'baseball';
  if (/\bfootball\b|\bnfl\b/.test(lower)) sport = 'football';
  else if (/\bbasketball\b|\bnba\b/.test(lower)) sport = 'basketball';
  else if (/\bhockey\b|\bnhl\b/.test(lower)) sport = 'hockey';

  // Fallback when no known brand matched: pull whatever sits between the
  // year and the first sport/set-type keyword as the brand. Lets new
  // brands (O-Pee-Chee Premier, Tristar, etc.) flow through without code
  // changes — admin can still tweak in the review row.
  if (!brand && year) {
    const after = base.slice(base.indexOf(year) + year.length);
    const stopRe = /\b(baseball|football|basketball|hockey|nfl|nba|nhl|mlb|base|complete|set|update|series|high\s*number|hi[\s-]?num|checklist|insert|subset|all[\s-]?star|rookie|hof|hall)\b/i;
    const m = after.match(stopRe);
    const raw = (m ? after.slice(0, m.index) : after).trim();
    if (raw) {
      brand = raw
        .split(/\s+/)
        .map(w => w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
        .join(' ');
    }
  }

  let title = base;
  if (year) title = title.replace(year, '').trim();
  if (brand) title = title.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim();
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
  const [existing, setExisting] = useState<ExistingTemplate[]>([]);
  const [existingLoading, setExistingLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<ExistingTemplate>>({});
  const [search, setSearch] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  async function loadExisting() {
    setExistingLoading(true);
    try {
      const res = await fetch('/api/admin/set-templates');
      const data = await res.json();
      if (res.ok) setExisting(data.templates || []);
    } catch {} finally {
      setExistingLoading(false);
    }
  }
  useEffect(() => { loadExisting(); }, []);

  async function deleteTemplate(t: ExistingTemplate) {
    if (!confirm(`Delete template "${t.title}" (${t.year} ${t.brand})? Users who have already started a set from this template are unaffected.`)) return;
    setWorking(t.id);
    const res = await fetch('/api/admin/set-templates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id }),
    });
    setWorking(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'Delete failed'); return; }
    setExisting(prev => prev.filter(x => x.id !== t.id));
  }
  async function saveEdit() {
    if (!editId) return;
    setWorking(editId);
    const res = await fetch('/api/admin/set-templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, ...editDraft }),
    });
    setWorking(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'Save failed'); return; }
    const j = await res.json();
    setExisting(prev => prev.map(x => x.id === editId ? { ...x, ...(j.template || {}) } : x));
    setEditId(null);
    setEditDraft({});
  }

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
          const missing = REQUIRED_HEADERS.filter(h => !fields.includes(h));
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
      loadExisting();
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
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
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

        <section className="panel-bordered" style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)', flex: 1 }}>
              Existing Templates ({existing.length})
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Filter by year / brand / title…"
              style={{
                padding: '6px 12px', minWidth: 220, maxWidth: 320,
                border: '1.5px solid var(--plum)', borderRadius: 100,
                background: 'var(--cream)', color: 'var(--plum)',
                fontFamily: 'var(--font-body)', fontSize: 12.5,
              }} />
            <button onClick={loadExisting} className="btn btn-ghost btn-sm">↻ Refresh</button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 12px' }}>
            Re-uploading a CSV with the same year + brand + title automatically overrides the existing template (rows are replaced).
          </p>
          {existingLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>Loading…</div>
          ) : existing.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>No templates yet. Drop a CSV above.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Year</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Brand</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Title</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Sport</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Cards</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Updated</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {existing
                  .filter(t => {
                    const q = search.trim().toLowerCase();
                    if (!q) return true;
                    return `${t.year || ''} ${t.brand || ''} ${t.title || ''}`.toLowerCase().includes(q);
                  })
                  .map(t => {
                    const isEditing = editId === t.id;
                    return (
                      <tr key={t.id} style={{ borderTop: '1px solid var(--rule)' }}>
                        <td style={{ padding: '8px 10px' }}>
                          {isEditing ? (
                            <input value={String(editDraft.year ?? t.year ?? '')} onChange={e => setEditDraft(d => ({ ...d, year: Number(e.target.value) || null }))}
                              className="input-sc" style={{ width: 70, fontSize: 12, padding: '4px 8px' }} />
                          ) : <span className="mono">{t.year}</span>}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {isEditing ? (
                            <input value={String(editDraft.brand ?? t.brand ?? '')} onChange={e => setEditDraft(d => ({ ...d, brand: e.target.value }))}
                              className="input-sc" style={{ width: 120, fontSize: 12, padding: '4px 8px' }} />
                          ) : t.brand}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {isEditing ? (
                            <input value={String(editDraft.title ?? t.title ?? '')} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                              className="input-sc" style={{ width: '100%', fontSize: 12, padding: '4px 8px' }} />
                          ) : t.title}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {isEditing ? (
                            <select value={String(editDraft.sport ?? t.sport ?? 'baseball')} onChange={e => setEditDraft(d => ({ ...d, sport: e.target.value }))}
                              className="input-sc" style={{ width: 110, fontSize: 12, padding: '4px 8px' }}>
                              {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : t.sport}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }} className="mono">{t.card_count ?? 0}</td>
                        <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--ink-soft)' }}>
                          {t.updated_at ? new Date(t.updated_at).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {isEditing ? (
                            <>
                              <button onClick={saveEdit} disabled={working === t.id} className="btn btn-primary btn-sm" style={{ marginRight: 6 }}>
                                {working === t.id ? 'Saving…' : 'Save'}
                              </button>
                              <button onClick={() => { setEditId(null); setEditDraft({}); }} className="btn btn-ghost btn-sm">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditId(t.id); setEditDraft({ year: t.year, brand: t.brand, title: t.title, sport: t.sport }); }}
                                className="btn btn-ghost btn-sm" style={{ marginRight: 6 }}>Edit</button>
                              <button onClick={() => deleteTemplate(t)} disabled={working === t.id}
                                className="btn btn-ghost btn-sm" style={{ color: 'var(--rust)', border: '1.5px solid var(--rust)' }}>
                                🗑 Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
