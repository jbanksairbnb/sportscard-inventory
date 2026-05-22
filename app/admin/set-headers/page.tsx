'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SCLogo from '@/components/SCLogo';

type Header = {
  id: string;
  year: number;
  brand: string;
  title: string;
  image_url: string | null;
  description: string | null;
  updated_at?: string;
};

type Template = {
  id: string;
  year: number;
  brand: string;
  title: string;
  sport: string;
};

export default function AdminSetHeadersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [headers, setHeaders] = useState<Header[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Header> & { _custom?: boolean } | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadAll() {
    setLoading(true);
    const [hRes, tRes] = await Promise.all([
      fetch('/api/admin/set-headers'),
      fetch('/api/set-templates'),
    ]);
    if (hRes.status === 401) { setAuthError(true); setLoading(false); return; }
    const hData = await hRes.json();
    const tData = await tRes.json();
    setHeaders(hData?.headers || []);
    setTemplates(tData?.templates || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  function startNew() {
    setEditing({ year: undefined, brand: '', title: '', description: '', image_url: '' });
    setImageFile(null);
    setImagePreview('');
    setError('');
  }
  function startEdit(h: Header) {
    setEditing({ ...h });
    setImageFile(null);
    setImagePreview(h.image_url || '');
    setError('');
  }
  function close() {
    setEditing(null);
    setImageFile(null);
    setImagePreview('');
    setError('');
  }

  function pickTemplate(t: Template | null) {
    if (!t) {
      setEditing(prev => prev ? { ...prev, year: undefined, brand: '', title: '', _custom: true } : prev);
      return;
    }
    setEditing(prev => prev ? { ...prev, year: t.year, brand: t.brand, title: t.title, _custom: false } : prev);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(String(reader.result || ''));
    reader.readAsDataURL(f);
  }

  async function save() {
    if (!editing) return;
    setError('');
    if (!editing.year || !editing.brand?.trim() || !editing.title?.trim()) {
      setError('Year, brand, and title are required.');
      return;
    }
    setSaving(true);
    const fd = new FormData();
    fd.set('year', String(editing.year));
    fd.set('brand', editing.brand.trim());
    fd.set('title', editing.title.trim());
    fd.set('description', (editing.description || '').trim());
    if (editing.image_url && !imageFile) fd.set('existing_image_url', editing.image_url);
    if (imageFile) fd.set('image', imageFile);
    const res = await fetch('/api/admin/set-headers', { method: 'POST', body: fd });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j?.error || `Save failed (${res.status})`);
      return;
    }
    const { header } = await res.json();
    setHeaders(prev => {
      const idx = prev.findIndex(h => h.id === header.id);
      if (idx >= 0) {
        const next = [...prev]; next[idx] = header; return next;
      }
      return [header, ...prev];
    });
    close();
  }

  async function remove(id: string) {
    if (!confirm('Delete this header?')) return;
    const res = await fetch('/api/admin/set-headers', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) { alert('Delete failed'); return; }
    setHeaders(prev => prev.filter(h => h.id !== id));
  }

  const filteredHeaders = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return headers;
    return headers.filter(h => {
      const hay = [h.title, h.brand, String(h.year)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [headers, search]);

  if (authError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="panel-bordered" style={{ padding: 32, textAlign: 'center', maxWidth: 420 }}>
          <div className="display" style={{ fontSize: 24, color: 'var(--plum)', marginBottom: 8 }}>Access Denied</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 16 }}>You need admin privileges to view this page.</p>
          <button onClick={() => router.push('/home')} className="btn btn-primary btn-sm">← Home</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Admin · Set Headers ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={startNew} className="btn btn-primary btn-sm">+ New Header</button>
            <button onClick={() => router.push('/admin')} className="btn btn-ghost btn-sm">← Admin</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Create a header (image + description) for a canonical set. The header is keyed on <strong>year + brand + title</strong> and shows up at the top of every user&apos;s set page that matches.
            Pick a set from the template list, or use <em>Custom</em> to type the year/brand/title manually.
          </p>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
            flex: 1, maxWidth: 420,
          }}>
            <span style={{ fontSize: 13, color: 'var(--plum)' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search headers by year, brand, title…"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, flex: 1, color: 'var(--plum)' }} />
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700 }}>
            {filteredHeaders.length} header{filteredHeaders.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="eyebrow" style={{ textAlign: 'center', padding: 40, color: 'var(--ink-mute)' }}>Loading…</div>
        ) : filteredHeaders.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 6 }}>No headers yet</div>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Click <strong>+ New Header</strong> to create one.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {filteredHeaders.map(h => (
              <div key={h.id} className="panel-bordered" style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
                {h.image_url ? (
                  <img loading="lazy" decoding="async" src={h.image_url} alt="" style={{ width: 110, height: 70, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--rule)', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 110, height: 70, borderRadius: 6, border: '1.5px dashed var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--ink-mute)', flexShrink: 0 }}>
                    no image
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="display" style={{ fontSize: 15, color: 'var(--plum)' }}>{h.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                    {h.year} · {h.brand}
                  </div>
                  {h.description && (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6, maxHeight: 36, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.description}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => startEdit(h)} className="btn btn-ghost btn-sm">✎ Edit</button>
                  <button onClick={() => remove(h.id)} className="btn btn-ghost btn-sm">🗑 Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div onClick={close}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(42,20,52,0.82)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '40px 20px', overflowY: 'auto',
          }}>
          <div onClick={e => e.stopPropagation()} className="panel-bordered"
            style={{ width: '100%', maxWidth: 720, padding: 24, background: 'var(--cream)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>
                {editing.id ? 'Edit Set Header' : 'New Set Header'}
              </div>
              <button type="button" onClick={close} className="btn btn-outline btn-sm">✕ Close</button>
            </div>

            {!editing.id && (
              <div style={{ marginBottom: 14 }}>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700, marginBottom: 6 }}>★ Pick a canonical set ★</div>
                <select
                  value={editing._custom ? '__custom__' : (editing.year && editing.brand && editing.title ? `${editing.year}|${editing.brand}|${editing.title}` : '')}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__custom__') { pickTemplate(null); return; }
                    if (!v) { setEditing(prev => prev ? { ...prev, year: undefined, brand: '', title: '', _custom: false } : prev); return; }
                    const t = templates.find(t => `${t.year}|${t.brand}|${t.title}` === v);
                    if (t) pickTemplate(t);
                  }}
                  style={{
                    width: '100%', padding: '8px 10px', border: '1.5px solid var(--plum)',
                    borderRadius: 6, fontSize: 13, color: 'var(--plum)', background: 'var(--cream)',
                  }}
                >
                  <option value="">— Pick from templates —</option>
                  <option value="__custom__">+ Type custom (no template)</option>
                  {templates.map(t => (
                    <option key={t.id} value={`${t.year}|${t.brand}|${t.title}`}>
                      {t.year} · {t.brand} · {t.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 2fr', gap: 10, marginBottom: 14 }}>
              <Field label="Year">
                <input type="number" value={editing.year ?? ''} disabled={!editing._custom && !editing.id ? !!(editing.year) : false}
                  onChange={e => setEditing(prev => prev ? { ...prev, year: e.target.value ? Number(e.target.value) : undefined } : prev)}
                  style={inputStyle} />
              </Field>
              <Field label="Brand">
                <input type="text" value={editing.brand ?? ''}
                  onChange={e => setEditing(prev => prev ? { ...prev, brand: e.target.value } : prev)}
                  style={inputStyle} />
              </Field>
              <Field label="Title">
                <input type="text" value={editing.title ?? ''}
                  onChange={e => setEditing(prev => prev ? { ...prev, title: e.target.value } : prev)}
                  style={inputStyle} />
              </Field>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700, marginBottom: 6 }}>Image</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 200, height: 130, borderRadius: 8, border: '1.5px dashed var(--plum)',
                  background: imagePreview ? `var(--cream) url(${imagePreview}) center/cover no-repeat` : 'var(--cream)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0,
                }}>
                  {!imagePreview && 'No image'}
                </div>
                <div style={{ flex: 1 }}>
                  <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: 'none' }} />
                  <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-outline btn-sm">
                    {imagePreview ? 'Replace image' : 'Upload image'}
                  </button>
                  {imagePreview && (
                    <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); setEditing(prev => prev ? { ...prev, image_url: '' } : prev); }}
                      className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}>
                      Remove
                    </button>
                  )}
                  <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 6 }}>
                    Wide landscape (e.g. 1200×600) works best.
                  </p>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', fontWeight: 700, marginBottom: 6 }}>Description</div>
              <textarea
                value={editing.description ?? ''}
                onChange={e => setEditing(prev => prev ? { ...prev, description: e.target.value } : prev)}
                rows={5}
                placeholder="A short overview of the set — history, key cards, design notes…"
                style={{
                  width: '100%', padding: '10px 12px', border: '1.5px solid var(--plum)',
                  borderRadius: 6, fontSize: 13, color: 'var(--plum)', background: 'var(--cream)',
                  fontFamily: 'var(--font-body)', resize: 'vertical',
                }}
              />
            </div>

            {error && (
              <div style={{ padding: '10px 12px', background: 'rgba(192,57,43,0.12)', border: '1.5px solid var(--rust)', borderRadius: 8, color: 'var(--rust)', fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={close} className="btn btn-ghost btn-sm">Cancel</button>
              <button type="button" onClick={save} disabled={saving} className="btn btn-primary btn-sm">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1.5px solid var(--plum)',
  borderRadius: 6, fontSize: 13, color: 'var(--plum)', background: 'var(--cream)',
  fontFamily: 'var(--font-body)',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}
