'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

const EXPECTED_HEADERS = [
  'Card #', 'Player', 'Owned', 'Raw Grade', 'Graded',
  'Grading Company', 'Grade', 'Cost', 'Value', 'Target Price',
  'Sale Price', 'Date Purchased', 'Purchased From', 'Upload Image(s)',
];

const YEARS = Array.from({ length: 2025 - 1953 + 1 }, (_, i) => String(1953 + i));
const BRANDS = ['Topps', 'Bowman', 'Play Ball'];
const RAW_GRADES = ['', 'Gem Mint', 'Mint', 'NM-MT', 'NM', 'EXMT', 'EX', 'VG-EX', 'VG', 'G', 'P'] as const;
const GRADES_NUMERIC = ['', ...Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ''))];
const SPORTS = [
  { value: 'baseball', label: 'Baseball' },
  { value: 'football', label: 'Football' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'hockey', label: 'Hockey' },
];

type TemplateOption = {
  id: string;
  year: number;
  brand: string;
  title: string;
  sport: string;
  card_count: number;
  is_official: boolean;
};

function stripCurrency(val: string) { return String(val ?? '').replace(/[^0-9.-]/g, ''); }
function toCurrency(val: string) {
  const n = Number(stripCurrency(val));
  return Number.isNaN(n) ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}
function normalizeNumericGrade(input: any) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const num = Number(s);
  if (!Number.isNaN(num)) {
    const clamped = Math.min(10, Math.max(1, Math.round(num * 2) / 2));
    const asStr = clamped.toFixed(1).replace(/\.0$/, '');
    return GRADES_NUMERIC.includes(asStr) ? asStr : '';
  }
  return GRADES_NUMERIC.includes(s) ? s : '';
}
function computeOwnedStats(rows: any[]) {
  const total = rows?.length || 0;
  const owned = rows?.filter((r) => String(r?.['Owned'] || '') === 'Yes').length || 0;
  return { ownedCount: owned, ownedPct: total ? (owned / total) * 100 : 0 };
}
function toNumber(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = Number(v.replace(/[$,]/g, '').trim()); return isFinite(n) ? n : 0; }
  return 0;
}
function computeFinancials(rows: any[]) {
  const totalCost = rows?.reduce((acc: number, r: any) => acc + toNumber(r?.['Cost']), 0) || 0;
  const totalValue = rows?.reduce((acc: number, r: any) => acc + toNumber(r?.['Value']), 0) || 0;
  return { totalCost, totalValue, gainLoss: totalValue - totalCost };
}

type Mode = 'library' | 'upload';
type UploadSource = 'standard' | 'psa' | null;

function stripPersonalData(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map(r => {
    const clean: Record<string, unknown> = {};
    EXPECTED_HEADERS.forEach(h => { clean[h] = ''; });
    clean['Card #'] = r['Card #'] || '';
    clean['Player'] = r['Player'] || '';
    return clean;
  });
}

export default function NewSetPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('library');
  const [year, setYear] = useState('');
  const [brand, setBrand] = useState('');
  const [desc, setDesc] = useState('');
  const [sport, setSport] = useState('baseball');
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [addToLibrary, setAddToLibrary] = useState(false);
  const [uploadSource, setUploadSource] = useState<UploadSource>(null);

  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateFilterSport, setTemplateFilterSport] = useState('baseball');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.push('/login');
      else setUserId(user.id);
    });
  }, [router]);

  useEffect(() => {
    async function loadTemplates() {
      setTemplatesLoading(true);
      const res = await fetch(`/api/set-templates?sport=${encodeURIComponent(templateFilterSport)}`);
      const data = await res.json();
      setTemplates(data.templates || []);
      setTemplatesLoading(false);
    }
    loadTemplates();
  }, [templateFilterSport]);

  async function handlePickTemplate(id: string) {
    setSelectedTemplateId(id);
    if (!id) {
      setRows([]); setYear(''); setBrand(''); setDesc('');
      return;
    }
    setTemplateLoading(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/set-templates/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load template');
      setRows(data.rows || []);
      setYear(String(data.year || ''));
      setBrand(data.brand || '');
      setSport(data.sport || 'baseball');
      const titleMatch = String(data.title || '').match(/—\s*(.*)$/);
      setDesc(titleMatch ? titleMatch[1].trim() : data.title || '');
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Failed to load template']);
    } finally {
      setTemplateLoading(false);
    }
  }

  const canSave = year.trim() && brand.trim() && desc.trim() && rows.length > 0 && sport;
  const titlePreview = useMemo(
    () => (year && brand && desc ? `${year.trim()} ${brand.trim()} — ${desc.trim()}` : ''),
    [year, brand, desc]
  );

  function handleFileChosen(file: File) {
    setErrors([]);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (result) => {
        const missing = EXPECTED_HEADERS.filter((h) => !(result.meta.fields || []).includes(h));
        if (missing.length > 0) { setErrors([`CSV is missing required columns: ${missing.join(', ')}.`]); setRows([]); return; }
        const cleaned = (result.data as any[]).map((r) => {
          const norm: Record<string, any> = {};
          EXPECTED_HEADERS.forEach((h) => { norm[h] = r[h] ?? ''; });
          ['Owned', 'Graded'].forEach((f) => {
            const val = String(norm[f]).trim().toLowerCase();
            norm[f] = val === 'yes' || val === 'y' || val === 'true' || val === '1' ? 'Yes'
              : val === 'no' || val === 'n' || val === 'false' || val === '0' ? 'No' : '';
          });
          const rg = String(norm['Raw Grade']).trim();
          norm['Raw Grade'] = RAW_GRADES.includes(rg as any) ? rg : '';
          norm['Grade'] = normalizeNumericGrade(norm['Grade']);
          ['Cost', 'Value', 'Target Price', 'Sale Price'].forEach((f) => {
            const raw = norm[f];
            if (String(raw).trim()) { const s = stripCurrency(String(raw)); if (!Number.isNaN(Number(s))) norm[f] = toCurrency(s); }
          });
          const d = String(norm['Date Purchased']).trim();
          if (d) { const digits = d.replace(/[^0-9]/g, ''); if (digits.length === 8) norm['Date Purchased'] = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`; }
          const cardNum = Number(String(norm['Card #']).trim());
          if (Number.isNaN(cardNum)) norm['Card #'] = '';
          return norm;
        });
        setRows(cleaned);
        setUploadSource('standard');
      },
      error: (err) => setErrors([`Parse error: ${err.message}`]),
    });
  }

  function handlePSAFileChosen(file: File) {
    setErrors([]);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const fields = result.meta.fields || [];
        const missing = ['Card #', 'Item', 'Grade'].filter((f) => !fields.includes(f));
        if (missing.length > 0) { setErrors([`Not a PSA export. Missing: ${missing.join(', ')}.`]); return; }
        const cleaned = (result.data as any[])
          .filter((r: any) => String(r['Card #'] ?? '').trim() !== '')
          .map((r: any) => {
            const norm: Record<string, any> = {};
            EXPECTED_HEADERS.forEach((h) => { norm[h] = ''; });
            const isOwned = String(r['Cert #'] ?? '').trim() !== '';
            norm['Card #'] = String(r['Card #'] ?? '').trim();
            norm['Player'] = String(r['Item'] ?? '').trim();
            norm['Owned'] = isOwned ? 'Yes' : 'No';
            if (isOwned) {
              norm['Grade'] = normalizeNumericGrade(r['Grade']);
              norm['Grading Company'] = 'PSA';
              norm['Graded'] = 'Yes';
              const cost = String(r['My Cost'] ?? '').trim();
              if (cost && Number(cost) > 0) norm['Cost'] = toCurrency(stripCurrency(cost));
              const dp = String(r['Purchase Date'] ?? '').trim();
              if (dp) { const digits = dp.replace(/[^0-9]/g, ''); norm['Date Purchased'] = digits.length === 8 ? `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}` : dp; }
              norm['Purchased From'] = String(r['Source'] ?? '').trim();
            }
            return norm;
          });
        setRows(cleaned);
        setUploadSource('psa');
      },
      error: (err) => setErrors([`Parse error: ${err.message}`]),
    });
  }

  async function handleSave() {
    if (!canSave || !userId) return;
    setSaving(true);
    const newTitle = `${year.trim()} ${brand.trim()} — ${desc.trim()}`;
    const base = slugify(newTitle);
    const supabase = createClient();
    const { data: existing } = await supabase.from('sets').select('slug').ilike('slug', `${base}%`);
    const taken = new Set((existing || []).map((r: any) => r.slug as string));
    let newSlug = base; let i = 2;
    while (taken.has(newSlug)) newSlug = `${base}-${i++}`;
    const { ownedCount, ownedPct } = computeOwnedStats(rows);
    const { totalCost, totalValue, gainLoss } = computeFinancials(rows);
    await supabase.from('sets').upsert({
      user_id: userId, slug: newSlug, title: newTitle,
      year: Number(year) || null, brand: brand.trim(), description: desc, sport,
      rows, row_count: rows.length, owned_count: ownedCount, owned_pct: ownedPct,
      total_cost: totalCost, total_value: totalValue, gain_loss: gainLoss,
      updated_at: Date.now(),
    }, { onConflict: 'user_id,slug' });

    const shouldShareToLibrary = mode === 'upload' && (addToLibrary || uploadSource === 'psa');
    if (shouldShareToLibrary) {
      try {
        const sharedRows = uploadSource === 'psa' ? stripPersonalData(rows) : rows;
        await fetch('/api/set-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: Number(year), brand: brand.trim(), title: newTitle, sport, rows: sharedRows,
          }),
        });
      } catch {}
    }

    router.push(`/set/${newSlug}`);
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <Link href="/" className="btn btn-outline btn-sm" style={{ flexShrink: 0 }}>← My Shelf</Link>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', flex: 1 }}>New Set</div>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 28px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li><strong>From Library</strong> — pick a pre-loaded checklist from our library, filtered by sport. Fastest way to start a new set.</li>
            <li><strong>Upload CSV</strong> — upload your own checklist using our standard template. Required columns: <span className="mono" style={{ fontSize: 12 }}>{EXPECTED_HEADERS.join(', ')}</span>. Tick the box at the bottom of the upload section to share your checklist with the community.</li>
            <li><strong>PSA Export</strong> — download your collection from your PSA account and upload the CSV directly. Owned cards auto-fill with grades, costs, and dates. The checklist (Card # and Player only — no personal data) is automatically added to our public library if it isn&apos;t there yet.</li>
            <li>Don&apos;t see a set you want?  Email <a href="mailto:info@sports-collective.com" style={{ color: 'var(--plum)', fontWeight: 700 }}>info@sports-collective.com</a> and we&apos;ll add it to the library.</li>
          </ul>
        </section>

        <section className="panel-bordered" style={{ padding: '24px 28px' }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 12 }}>1. Choose a Source</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button onClick={() => { setMode('library'); setRows([]); setErrors([]); setUploadSource(null); }}
              className={mode === 'library' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
              From Library
            </button>
            <button onClick={() => { setMode('upload'); setRows([]); setErrors([]); setSelectedTemplateId(''); setUploadSource(null); }}
              className={mode === 'upload' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
              Upload CSV
            </button>
          </div>

          {mode === 'library' && (
            <div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
                <div>
                  <label className="input-label">Sport</label>
                  <select value={templateFilterSport} onChange={e => { setTemplateFilterSport(e.target.value); setSelectedTemplateId(''); setRows([]); }} className="input-sc" style={{ minWidth: 140 }}>
                    {SPORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <label className="input-label">Pick a Set</label>
                  <select value={selectedTemplateId} onChange={e => handlePickTemplate(e.target.value)}
                    disabled={templatesLoading || templateLoading}
                    className="input-sc" style={{ width: '100%' }}>
                    <option value="">{templatesLoading ? 'Loading…' : templates.length === 0 ? 'No templates available' : 'Select a set…'}</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.card_count} cards){t.is_official ? ' ★ Official' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {templateLoading && <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Loading checklist…</div>}
              {rows.length > 0 && !templateLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 700 }}>✓</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>{rows.length} cards loaded from library</span>
                </div>
              )}
            </div>
          )}

          {mode === 'upload' && (
            <div>
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="display" style={{ fontSize: 15, color: 'var(--plum)', marginBottom: 4 }}>Standard CSV</div>
                  <div className="eyebrow" style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 10 }}>
                    Required columns: {EXPECTED_HEADERS.join(', ')}
                  </div>
                  <input type="file" accept=".csv,text/csv"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); }}
                    style={{ display: 'block', padding: '8px 12px', border: '2px solid var(--plum)', borderRadius: 10, background: 'var(--cream)', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', cursor: 'pointer' }} />
                </div>
                <div style={{ flex: 1, minWidth: 240, borderLeft: '2px solid var(--cream-warm)', paddingLeft: 32 }}>
                  <div className="display" style={{ fontSize: 15, color: 'var(--plum)', marginBottom: 4 }}>PSA Export</div>
                  <div className="eyebrow" style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 10 }}>
                    Upload a CSV exported from your PSA account. Grading Company auto-sets to PSA.
                  </div>
                  <input type="file" accept=".csv,text/csv"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePSAFileChosen(f); }}
                    style={{ display: 'block', padding: '8px 12px', border: '2px solid var(--teal)', borderRadius: 10, background: 'var(--cream)', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', cursor: 'pointer' }} />
                </div>
              </div>
              {rows.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 700 }}>✓</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>{rows.length} cards loaded</span>
                </div>
              )}
              {uploadSource === 'psa' ? (
                <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(56,142,142,0.08)', border: '1.5px solid var(--teal)', borderRadius: 8, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                  ✓ The clean checklist (Card # &amp; Player only — no personal data) will be added to the public library if it doesn&apos;t already exist.
                </div>
              ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, color: 'var(--plum)', fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={addToLibrary} onChange={e => setAddToLibrary(e.target.checked)} />
                  Add this checklist to the public library so others can use it
                </label>
              )}
            </div>
          )}

          {errors.length > 0 && (
            <div style={{ marginTop: 14, background: 'rgba(197,74,44,0.08)', border: '1.5px solid var(--rust)', borderRadius: 10, padding: '10px 16px' }}>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {errors.map((er, i) => <li key={i} style={{ fontSize: 13, color: 'var(--rust)', fontWeight: 600 }}>{er}</li>)}
              </ul>
            </div>
          )}
        </section>

        <section className="panel-bordered" style={{ padding: '24px 28px' }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 16 }}>2. Name This Set</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 16 }}>
            <div>
              <label className="input-label" htmlFor="year-input">Year</label>
              <input id="year-input" type="text" list="year-options" value={year}
                onChange={(e) => setYear(e.target.value)} placeholder="e.g., 1954" className="input-sc" />
              <datalist id="year-options">{YEARS.map((y) => <option key={y} value={y} />)}</datalist>
            </div>
            <div>
              <label className="input-label" htmlFor="brand-input">Brand</label>
              <input id="brand-input" type="text" list="brand-options" value={brand}
                onChange={(e) => setBrand(e.target.value)} placeholder="e.g., Topps" className="input-sc" />
              <datalist id="brand-options">{BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div>
              <label className="input-label" htmlFor="sport-input">Sport</label>
              <select id="sport-input" value={sport} onChange={e => setSport(e.target.value)} className="input-sc">
                {SPORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label" htmlFor="desc-input">Description (≤ 60 chars)</label>
              <input id="desc-input" type="text" value={desc} maxLength={60}
                onChange={(e) => setDesc(e.target.value)} placeholder="e.g., Base set checklist" className="input-sc" />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              {titlePreview
                ? <><span style={{ color: 'var(--ink-mute)', fontWeight: 600 }}>Title: </span><span className="display" style={{ color: 'var(--plum)' }}>{titlePreview}</span></>
                : 'Fill in year, brand, and description.'}
            </div>
            <button type="button" onClick={handleSave} disabled={!canSave || saving}
              className="btn btn-primary" style={{ minWidth: 140 }}>
              {saving ? 'Saving…' : 'Save & Edit Set →'}
            </button>
          </div>
        </section>
      </div>

      <footer style={{
        borderTop: '3px solid var(--plum)', padding: '24px 28px',
        maxWidth: 900, margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: 'var(--plum)', fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SCLogo size={32} />
          <div style={{ lineHeight: 0.9 }}>
            <div className="wordmark" style={{ fontSize: 16, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 10, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
          </div>
        </div>
        <span>Keep on collectin&apos;</span>
      </footer>
    </div>
  );
}
