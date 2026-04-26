'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type ConditionType = 'raw' | 'graded';
type Status = 'draft' | 'active' | 'sold' | 'removed';

type Listing = {
  id: string;
  user_id: string;
  set_id: string | null;
  title: string;
  description: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: ConditionType;
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  cost: number | null;
  photos: string[];
  status: Status;
  sold_at: string | null;
  sold_price: number | null;
  created_at: string;
};

const RAW_GRADES = ['Gem Mint', 'Mint', 'NM-MT', 'NM', 'EXMT', 'EX', 'VG-EX', 'VG', 'G', 'P'];
const COMPANIES = ['PSA', 'SGC', 'BGS', 'CGC', 'TAG'];
const NUMERIC_GRADES = Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ''));

function emptyDraft(userId: string): Partial<Listing> {
  return {
    user_id: userId,
    title: '',
    description: '',
    year: null,
    brand: '',
    card_number: '',
    player: '',
    condition_type: 'raw',
    raw_grade: '',
    grading_company: '',
    grade: '',
    asking_price: null,
    cost: null,
    photos: [],
    status: 'draft',
  };
}

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function conditionLabel(l: Listing | Partial<Listing>) {
  if (l.condition_type === 'graded') {
    const c = l.grading_company || '?';
    const g = l.grade || '?';
    return `${c} ${g}`;
  }
  return l.raw_grade || 'Raw';
}

export default function ListingsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState<'draft' | 'active' | 'sold' | 'all'>('active');
  const [editing, setEditing] = useState<Partial<Listing> | null>(null);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data } = await supabase
        .from('listings')
        .select('*')
        .eq('user_id', user.id)
        .neq('status', 'removed')
        .order('created_at', { ascending: false });
      setListings((data || []) as Listing[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const counts = {
    draft: listings.filter(l => l.status === 'draft').length,
    active: listings.filter(l => l.status === 'active').length,
    sold: listings.filter(l => l.status === 'sold').length,
  };
  const filtered = useMemo(
    () => filter === 'all' ? listings : listings.filter(l => l.status === filter),
    [listings, filter]
  );

  function openNew() {
    setFormError('');
    setEditing(emptyDraft(userId));
  }
  function openEdit(l: Listing) {
    setFormError('');
    setEditing({ ...l });
  }
  function closeEdit() {
    setEditing(null);
    setFormError('');
  }

  async function saveListing() {
    if (!editing) return;
    setFormError('');
    if (!editing.title?.trim()) { setFormError('Title is required.'); return; }
    if (editing.condition_type === 'graded' && (!editing.grading_company || !editing.grade)) {
      setFormError('Graded cards need a grading company and grade.');
      return;
    }
    if (editing.condition_type === 'raw' && !editing.raw_grade) {
      setFormError('Raw cards need a raw grade.');
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      ...editing,
      year: editing.year ? Number(editing.year) : null,
      asking_price: editing.asking_price !== null && editing.asking_price !== undefined && String(editing.asking_price) !== '' ? Number(editing.asking_price) : null,
      cost: editing.cost !== null && editing.cost !== undefined && String(editing.cost) !== '' ? Number(editing.cost) : null,
      updated_at: new Date().toISOString(),
    };
    if (editing.id) {
      const { data, error } = await supabase.from('listings').update(payload).eq('id', editing.id).select().single();
      if (error) { setFormError(error.message); setSaving(false); return; }
      setListings(prev => prev.map(l => l.id === editing.id ? (data as Listing) : l));
    } else {
      const { data, error } = await supabase.from('listings').insert(payload).select().single();
      if (error) { setFormError(error.message); setSaving(false); return; }
      setListings(prev => [data as Listing, ...prev]);
    }
    setSaving(false);
    setEditing(null);
  }

  async function setStatus(id: string, status: Status, sold_price?: number) {
    setWorking(id);
    const supabase = createClient();
    const update: Partial<Listing> = { status };
    if (status === 'sold') {
      update.sold_at = new Date().toISOString();
      if (sold_price !== undefined) update.sold_price = sold_price;
    }
    const { data, error } = await supabase.from('listings').update(update).eq('id', id).select().single();
    setWorking(null);
    if (error) { alert('Update failed: ' + error.message); return; }
    if (status === 'removed') {
      setListings(prev => prev.filter(l => l.id !== id));
    } else {
      setListings(prev => prev.map(l => l.id === id ? (data as Listing) : l));
    }
  }

  async function markSold(l: Listing) {
    const input = prompt('Final sale price:', l.asking_price ? String(l.asking_price) : '');
    if (input === null) return;
    const trimmed = input.trim();
    const price = trimmed === '' ? undefined : Number(trimmed.replace(/[^0-9.]/g, ''));
    if (price !== undefined && (Number.isNaN(price) || price < 0)) { alert('Invalid price.'); return; }
    await setStatus(l.id, 'sold', price);
  }

  async function deleteListing(l: Listing) {
    if (!confirm(`Delete listing "${l.title}"? This cannot be undone.`)) return;
    setWorking(l.id);
    const supabase = createClient();
    const { error } = await supabase.from('listings').delete().eq('id', l.id);
    setWorking(null);
    if (error) { alert('Delete failed: ' + error.message); return; }
    setListings(prev => prev.filter(x => x.id !== l.id));
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </div>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ My Listings ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={openNew} className="btn btn-primary btn-sm">+ New Listing</button>
            <button onClick={() => router.push('/home')} className="btn btn-outline btn-sm">← Home</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {(['active', 'draft', 'sold', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span style={{ marginLeft: 6, opacity: 0.8 }}>
                ({f === 'all' ? listings.length : counts[f]})
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No {filter === 'all' ? '' : filter} listings</div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Click <strong>+ New Listing</strong> to create one.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filtered.map(l => {
              const profit = l.status === 'sold' && l.sold_price !== null && l.cost !== null ? l.sold_price - l.cost : null;
              const statusBg = l.status === 'active' ? 'var(--teal)' : l.status === 'sold' ? 'var(--plum)' : 'var(--mustard)';
              const statusFg = l.status === 'draft' ? 'var(--plum)' : 'var(--cream)';
              return (
                <div key={l.id} className="panel-bordered" style={{ padding: '18px 22px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 280 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>{l.title}</div>
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                          background: statusBg, color: statusFg,
                        }}>
                          {l.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 10 }}>
                        {[l.year, l.brand, l.card_number ? `#${l.card_number}` : null].filter(Boolean).join(' · ')}
                        {' · '}{conditionLabel(l)}
                      </div>
                      {l.description && (
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{l.description}</p>
                      )}
                      <div style={{ display: 'flex', gap: 22, fontSize: 13, marginTop: 6, flexWrap: 'wrap' }}>
                        <span><span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginRight: 6 }}>Asking</span><strong>{fmtMoney(l.asking_price)}</strong></span>
                        <span><span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginRight: 6 }}>Cost</span>{fmtMoney(l.cost)}</span>
                        {l.status === 'sold' && (
                          <>
                            <span><span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginRight: 6 }}>Sold For</span><strong>{fmtMoney(l.sold_price)}</strong></span>
                            {profit !== null && (
                              <span style={{ color: profit >= 0 ? 'var(--teal)' : 'var(--rust)', fontWeight: 700 }}>
                                <span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginRight: 6 }}>Profit</span>
                                {profit >= 0 ? '+' : ''}{fmtMoney(profit)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, minWidth: 130 }}>
                      <button onClick={() => openEdit(l)} className="btn btn-ghost btn-sm" style={{ justifyContent: 'center' }}>Edit</button>
                      {l.status === 'draft' && (
                        <button onClick={() => setStatus(l.id, 'active')} disabled={working === l.id} className="btn btn-primary btn-sm" style={{ justifyContent: 'center' }}>
                          {working === l.id ? '…' : '✓ Activate'}
                        </button>
                      )}
                      {l.status === 'active' && (
                        <>
                          <button onClick={() => markSold(l)} disabled={working === l.id} className="btn btn-sm" style={{ justifyContent: 'center', background: 'var(--plum)', color: 'var(--mustard)', border: '2px solid var(--plum)' }}>
                            {working === l.id ? '…' : '$ Mark Sold'}
                          </button>
                          <button onClick={() => setStatus(l.id, 'draft')} disabled={working === l.id} className="btn btn-ghost btn-sm" style={{ justifyContent: 'center' }}>
                            Pause (→ Draft)
                          </button>
                        </>
                      )}
                      {l.status === 'sold' && (
                        <button onClick={() => setStatus(l.id, 'active')} disabled={working === l.id} className="btn btn-ghost btn-sm" style={{ justifyContent: 'center' }}>
                          Reactivate
                        </button>
                      )}
                      <button onClick={() => deleteListing(l)} disabled={working === l.id} className="btn btn-sm" style={{ justifyContent: 'center', background: 'transparent', color: 'var(--ink-mute)', border: '1.5px solid var(--rule)' }}>
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <ListingEditor
          draft={editing}
          onChange={setEditing}
          onCancel={closeEdit}
          onSave={saveListing}
          saving={saving}
          error={formError}
        />
      )}
    </div>
  );
}

function ListingEditor({
  draft, onChange, onCancel, onSave, saving, error,
}: {
  draft: Partial<Listing>;
  onChange: (next: Partial<Listing>) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string;
}) {
  const fieldStyle: React.CSSProperties = {
    border: '2px solid var(--plum)', borderRadius: 8, padding: '8px 12px',
    fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--plum)',
    background: 'var(--cream)', width: '100%', boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle: React.CSSProperties = { fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 };

  function set<K extends keyof Listing>(key: K, value: Listing[K] | null) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(42,20,52,0.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 20px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-bordered"
        style={{ width: '100%', maxWidth: 640, padding: 28, background: 'var(--cream)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 24, color: 'var(--plum)', flex: 1 }}>
            {draft.id ? 'Edit Listing' : 'New Listing'}
          </div>
          <button type="button" onClick={onCancel} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <div>
            <div className="eyebrow" style={labelStyle}>Title *</div>
            <input value={draft.title || ''} onChange={e => set('title', e.target.value)}
              placeholder="e.g. 1953 Topps #82 Mickey Mantle" style={fieldStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 130px', gap: 12 }}>
            <div>
              <div className="eyebrow" style={labelStyle}>Year</div>
              <input type="number" value={draft.year ?? ''} onChange={e => set('year', e.target.value ? Number(e.target.value) : null)}
                placeholder="1953" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Brand</div>
              <input value={draft.brand || ''} onChange={e => set('brand', e.target.value)}
                placeholder="Topps" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Card #</div>
              <input value={draft.card_number || ''} onChange={e => set('card_number', e.target.value)}
                style={fieldStyle} />
            </div>
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Player (optional)</div>
            <input value={draft.player || ''} onChange={e => set('player', e.target.value)}
              placeholder="Mickey Mantle" style={fieldStyle} />
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Description (optional)</div>
            <textarea value={draft.description || ''} onChange={e => set('description', e.target.value)}
              rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Condition Type *</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['raw', 'graded'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('condition_type', t)}
                  className={`btn btn-sm ${draft.condition_type === t ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  {t === 'raw' ? 'Raw' : 'Graded'}
                </button>
              ))}
            </div>
          </div>

          {draft.condition_type === 'raw' ? (
            <div>
              <div className="eyebrow" style={labelStyle}>Raw Grade *</div>
              <select value={draft.raw_grade || ''} onChange={e => set('raw_grade', e.target.value)} style={fieldStyle}>
                <option value="">— Select —</option>
                {RAW_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="eyebrow" style={labelStyle}>Grading Company *</div>
                <select value={draft.grading_company || ''} onChange={e => set('grading_company', e.target.value)} style={fieldStyle}>
                  <option value="">— Select —</option>
                  {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div className="eyebrow" style={labelStyle}>Grade *</div>
                <select value={draft.grade || ''} onChange={e => set('grade', e.target.value)} style={fieldStyle}>
                  <option value="">— Select —</option>
                  {NUMERIC_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="eyebrow" style={labelStyle}>Asking Price ($)</div>
              <input type="number" step="0.01" value={draft.asking_price ?? ''} onChange={e => set('asking_price', e.target.value ? Number(e.target.value) : null)}
                placeholder="0.00" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Cost ($) — private</div>
              <input type="number" step="0.01" value={draft.cost ?? ''} onChange={e => set('cost', e.target.value ? Number(e.target.value) : null)}
                placeholder="0.00" style={fieldStyle} />
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onSave} disabled={saving} className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}>
              {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Create Listing'}
            </button>
            <button type="button" onClick={onCancel} className="btn btn-outline">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
