'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import PurchaseDetailModal, { PurchaseDetail } from '@/components/PurchaseDetailModal';
import MarketResearchModal from '@/components/MarketResearchModal';

type ConditionType = 'raw' | 'graded';
type Status = 'draft' | 'active' | 'sold' | 'removed';

type ShippingOption = { label: string; cost: number };

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
  shipping_options: ShippingOption[];
  status: Status;
  sold_at: string | null;
  sold_price: number | null;
  source_set_slug: string | null;
  source_card_number: string | null;
  created_at: string;
};

const RAW_GRADES = ['Gem Mint', 'Mint', 'NM-MT', 'NM', 'EXMT', 'EX', 'VG-EX', 'VG', 'G', 'P'];
const COMPANIES = ['PSA', 'SGC', 'BGS', 'CGC', 'TAG'];
const NUMERIC_GRADES = Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ''));
const GRADE_LABELS: Record<string, string> = {
  '10': 'GEM MT', '9.5': 'GEM MT', '9': 'MINT',
  '8.5': 'NM-MT+', '8': 'NM-MT', '7.5': 'NM+', '7': 'NM',
  '6.5': 'EX-MT+', '6': 'EX-MT', '5.5': 'EX+', '5': 'EX',
  '4.5': 'VG-EX+', '4': 'VG-EX', '3.5': 'VG+', '3': 'VG',
  '2.5': 'GOOD+', '2': 'GOOD', '1.5': 'FAIR', '1': 'POOR',
};
const DEFAULT_SHIPPING_OPTIONS: ShippingOption[] = [
  { label: 'PWE (Plain White Envelope)', cost: 1.00 },
  { label: 'Bubble Mailer with Tracking', cost: 5.00 },
];
function emptyDraft(userId: string, defaults?: ShippingOption[]): Partial<Listing> {
  const ship = (defaults && defaults.length > 0) ? [...defaults] : [...DEFAULT_SHIPPING_OPTIONS];
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
    shipping_options: ship,
    status: 'draft',
  };
}
function buildTitle(d: Partial<Listing>): string {
  let condition = '';
  if (d.condition_type === 'graded' && d.grading_company && d.grade) {
    const label = GRADE_LABELS[String(d.grade)] || '';
    condition = label ? `${d.grading_company} ${d.grade} ${label}` : `${d.grading_company} ${d.grade}`;
  } else if (d.condition_type === 'raw' && d.raw_grade) {
    condition = d.raw_grade;
  }
  const parts = [
    d.year ? String(d.year) : '',
    d.brand || '',
    d.card_number ? `#${d.card_number}` : '',
    d.player || '',
    condition,
  ].filter(Boolean);
  return parts.join(' ').trim();
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

const MAX_PHOTOS = 5;

function ShippingOptionsEditor({
  options, onChange,
}: { options: ShippingOption[]; onChange: (next: ShippingOption[]) => void }) {
  function update(idx: number, patch: Partial<ShippingOption>) {
    onChange(options.map((o, i) => i === idx ? { ...o, ...patch } : o));
  }
  function remove(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...options, { label: '', cost: 0 }]);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.length === 0 && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
          No shipping options. Click + Add to require one.
        </div>
      )}
      {options.map((opt, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={opt.label} onChange={e => update(idx, { label: e.target.value })}
            placeholder="Label (e.g. PWE)"
            style={{
              flex: 1, border: '1.5px solid var(--plum)', borderRadius: 6,
              padding: '6px 10px', fontFamily: 'var(--font-body)', fontSize: 13,
              color: 'var(--plum)', background: 'var(--cream)',
            }} />
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>$</span>
          <input type="number" step="0.01" value={opt.cost ?? ''} onChange={e => update(idx, { cost: e.target.value ? Number(e.target.value) : 0 })}
            placeholder="0.00"
            style={{
              width: 80, border: '1.5px solid var(--plum)', borderRadius: 6,
              padding: '6px 10px', fontFamily: 'var(--font-body)', fontSize: 13,
              color: 'var(--plum)', background: 'var(--cream)',
            }} />
          <button type="button" onClick={() => remove(idx)}
            className="btn btn-sm" style={{
              background: 'transparent', color: 'var(--ink-mute)',
              border: '1.5px solid var(--rule)', padding: '4px 8px',
            }}>
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
        + Add option
      </button>
    </div>
  );
}

function ListingPhotoStrip({ photos }: { photos: string[] }) {
  const [lbStart, setLbStart] = useState<number | null>(null);
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {photos.slice(0, 3).map((p, i) => (
          <img key={p + i} src={p} alt={`Photo ${i + 1}`} onClick={() => setLbStart(i)}
            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }} />
        ))}
        {photos.length > 3 && (
          <div onClick={() => setLbStart(3)}
            style={{
              width: 72, height: 72, borderRadius: 8, border: '2px solid var(--plum)',
              background: 'var(--plum)', color: 'var(--mustard)',
              display: 'grid', placeItems: 'center', cursor: 'pointer',
              fontSize: 14, fontWeight: 700,
            }}>
            +{photos.length - 3}
          </div>
        )}
      </div>
      {lbStart !== null && <PhotoLightbox urls={photos} startIdx={lbStart} onClose={() => setLbStart(null)} />}
    </>
  );
}

function PhotoLightbox({ urls, startIdx, onClose }: { urls: string[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIdx);
  const arrowBtn: React.CSSProperties = {
    background: 'rgba(42,20,52,0.7)', color: 'var(--cream)',
    border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 24,
    cursor: 'pointer', lineHeight: 1,
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 250,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(42, 20, 52, 0.92)',
    }} onClick={onClose}>
      <div style={{ position: 'relative', padding: 16 }} onClick={(e) => e.stopPropagation()}>
        <img src={urls[idx]} alt="Listing" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, display: 'block' }} />
        {urls.length > 1 && (
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)); }}
              style={{ ...arrowBtn, opacity: idx === 0 ? 0.25 : 1 }} disabled={idx === 0}>‹</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => Math.min(urls.length - 1, i + 1)); }}
              style={{ ...arrowBtn, opacity: idx === urls.length - 1 ? 0.25 : 1 }} disabled={idx === urls.length - 1}>›</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn btn-sm" style={{ position: 'absolute', top: 4, right: 4 }}>✕ Close</button>
      </div>
    </div>
  );
}

export default function ListingsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    }>
      <ListingsPageContent />
    </Suspense>
  );
}

function ListingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState<'draft' | 'active' | 'sold' | 'all'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState<Partial<Listing> | null>(null);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const [formError, setFormError] = useState('');
   const [importOpen, setImportOpen] = useState(false);
  const [newPickerOpen, setNewPickerOpen] = useState(false);
  const [scansPickerOpen, setScansPickerOpen] = useState(false);
  const [fbSalesPickerOpen, setFbSalesPickerOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
    const [defaultShipping, setDefaultShipping] = useState<ShippingOption[]>([]);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [purchasesByListing, setPurchasesByListing] = useState<Record<string, PurchaseDetail & { buyer_name: string; buyer_email: string }>>({});
  const [openPurchaseId, setOpenPurchaseId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('default_shipping_options')
        .eq('user_id', user.id)
        .maybeSingle();
      const defaults = (profile?.default_shipping_options as ShippingOption[] | null) || [];
      setDefaultShipping(defaults);
        const { data } = await supabase
        .from('listings')
        .select('*')
        .eq('user_id', user.id)
        .neq('status', 'removed')
        .order('created_at', { ascending: false });
      setListings((data || []) as Listing[]);

      const { data: purchaseRows } = await supabase
        .from('purchases')
        .select('*, listing:listings(title, photos)')
        .eq('seller_id', user.id);
      const buyerIds = Array.from(new Set((purchaseRows || []).map(p => p.buyer_id)));
      const { data: buyerProfiles } = buyerIds.length > 0
        ? await supabase.from('user_profiles').select('user_id, display_name, handle, email').in('user_id', buyerIds)
        : { data: [] as { user_id: string; display_name: string | null; handle: string | null; email: string | null }[] };
      const buyerMap = new Map((buyerProfiles || []).map(p => [p.user_id, p]));
      const map: Record<string, PurchaseDetail & { buyer_name: string; buyer_email: string }> = {};
      for (const p of (purchaseRows || [])) {
        const profile = buyerMap.get(p.buyer_id);
        const email = profile?.email || '';
        map[p.listing_id] = {
          ...(p as PurchaseDetail),
          buyer_name: profile?.display_name || profile?.handle || (email ? email.split('@')[0] : '—'),
          buyer_email: email,
        };
      }
      setPurchasesByListing(map);

      setLoading(false);
    }
    load();
  }, [router]);

  useEffect(() => {
    if (!userId) return;
    if (searchParams?.get('prefill') !== '1') return;
    const draft = emptyDraft(userId, defaultShipping);
    const yearParam = searchParams.get('year');
    if (yearParam) draft.year = Number(yearParam) || null;
    draft.brand = searchParams.get('brand') || '';
    draft.card_number = searchParams.get('card') || '';
    draft.player = searchParams.get('player') || '';
    const ct = searchParams.get('condition_type');
    if (ct === 'graded') {
      draft.condition_type = 'graded';
      draft.grading_company = searchParams.get('grading_company') || '';
      draft.grade = searchParams.get('grade') || '';
    } else if (ct === 'raw') {
      draft.condition_type = 'raw';
      draft.raw_grade = searchParams.get('raw_grade') || '';
    }
    const costParam = searchParams.get('cost');
    if (costParam) {
      const c = Number(costParam);
      if (!Number.isNaN(c)) draft.cost = c;
    }
    const photos = searchParams.getAll('photo').filter(Boolean).slice(0, MAX_PHOTOS);
    if (photos.length > 0) draft.photos = photos;
    setEditing(draft);
    router.replace('/listings');
  }, [userId, searchParams, router, defaultShipping]);

  const counts = {
    draft: listings.filter(l => l.status === 'draft').length,
    active: listings.filter(l => l.status === 'active').length,
    sold: listings.filter(l => l.status === 'sold').length,
  };
  const metrics = useMemo(() => {
    let activeTotal = 0;
    let soldTotal = 0;
    for (const l of listings) {
      if (l.status === 'active' && l.asking_price) activeTotal += l.asking_price;
      if (l.status === 'sold' && l.sold_price) soldTotal += l.sold_price;
    }
    return { activeTotal, soldTotal };
  }, [listings]);
  const filtered = useMemo(() => {
    let arr = filter === 'all' ? listings : listings.filter(l => l.status === filter);
    const q = searchQuery.trim();
    if (q) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      arr = arr.filter(l => {
        const hay = [
          l.title, l.player, l.brand, l.card_number, l.year ? String(l.year) : '',
          l.description, l.raw_grade, l.grading_company, l.grade,
        ].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    return arr;
  }, [listings, filter, searchQuery]);

  function openNew() {
    setFormError('');
    setNewPickerOpen(true);
  }
  function openBlankNew() {
    setFormError('');
    setNewPickerOpen(false);
    setEditing(emptyDraft(userId, defaultShipping));
  }
  function openInventoryNew() {
    setFormError('');
    setNewPickerOpen(false);
    setInventoryOpen(true);
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
        if (!editing.year) { setFormError('Year is required.'); return; }
    if (!editing.brand?.trim()) { setFormError('Brand is required.'); return; }
    if (!editing.card_number?.trim()) { setFormError('Card # is required.'); return; }
    if (!editing.player?.trim()) { setFormError('Player is required.'); return; }
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
      title: buildTitle(editing),
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

  async function uploadPhoto(file: File) {
    if (!editing?.id || !userId) { alert('Save the listing before adding photos.'); return; }
    if ((editing.photos?.length || 0) >= MAX_PHOTOS) { alert(`Max ${MAX_PHOTOS} photos.`); return; }
    const supabase = createClient();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${userId}/listings/${editing.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('card-images').upload(path, file);
    if (upErr) { alert('Upload failed: ' + upErr.message); return; }
    const { data } = supabase.storage.from('card-images').getPublicUrl(path);
    const url = data.publicUrl;
    const newPhotos = [...(editing.photos || []), url];
    const { error: updErr } = await supabase.from('listings').update({ photos: newPhotos }).eq('id', editing.id);
    if (updErr) { alert(updErr.message); return; }
    setEditing(prev => prev ? { ...prev, photos: newPhotos } : prev);
    setListings(prev => prev.map(l => l.id === editing.id ? { ...l, photos: newPhotos } : l));
  }

  async function deletePhoto(idx: number) {
    if (!editing?.id || !editing.photos) return;
    const url = editing.photos[idx];
    if (!url) return;
    const supabase = createClient();
    const m = url.match(/\/card-images\/(.+?)(?:\?|$)/);
    if (m?.[1]) await supabase.storage.from('card-images').remove([decodeURIComponent(m[1])]);
    const newPhotos = editing.photos.filter((_, i) => i !== idx);
    const { error } = await supabase.from('listings').update({ photos: newPhotos }).eq('id', editing.id);
    if (error) { alert(error.message); return; }
    setEditing(prev => prev ? { ...prev, photos: newPhotos } : prev);
    setListings(prev => prev.map(l => l.id === editing.id ? { ...l, photos: newPhotos } : l));
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
    const { data: linked } = await supabase.from('purchases').select('id').eq('listing_id', l.id).limit(1);
    const hasPurchases = (linked || []).length > 0;
    if (hasPurchases) {
      const { error } = await supabase.from('listings').update({ status: 'removed' }).eq('id', l.id);
      setWorking(null);
      if (error) { alert('Delete failed: ' + error.message); return; }
    } else {
      for (const url of l.photos || []) {
        const m = url.match(/\/card-images\/(.+?)(?:\?|$)/);
        if (m?.[1]) await supabase.storage.from('card-images').remove([decodeURIComponent(m[1])]);
      }
      const { error } = await supabase.from('listings').delete().eq('id', l.id);
      setWorking(null);
      if (error) { alert('Delete failed: ' + error.message); return; }
    }
    setListings(prev => prev.filter(x => x.id !== l.id));
  }
  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelectedIds(new Set(filtered.map(l => l.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  async function bulkSetStatus(status: 'active' | 'draft') {
    if (selectedIds.size === 0) return;
    setBulkWorking(true);
    const supabase = createClient();
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from('listings').update({ status }).in('id', ids);
    setBulkWorking(false);
    if (error) { alert('Bulk update failed: ' + error.message); return; }
    setListings(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, status } : l));
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    if (!confirm(`Delete ${n} listing${n === 1 ? '' : 's'}? Listings with purchase history will be hidden (kept for records); the rest will be permanently deleted.`)) return;
    setBulkWorking(true);
    const supabase = createClient();
    const ids = Array.from(selectedIds);

    const { data: linked } = await supabase.from('purchases').select('listing_id').in('listing_id', ids);
    const blockedIds = new Set((linked || []).map(p => p.listing_id));
    const softIds = ids.filter(id => blockedIds.has(id));
    const hardIds = ids.filter(id => !blockedIds.has(id));

    const paths: string[] = [];
    for (const l of listings.filter(x => hardIds.includes(x.id))) {
      for (const url of l.photos || []) {
        const m = url.match(/\/card-images\/(.+?)(?:\?|$)/);
        if (m?.[1]) paths.push(decodeURIComponent(m[1]));
      }
    }
    if (paths.length > 0) await supabase.storage.from('card-images').remove(paths);

    if (softIds.length > 0) {
      const { error } = await supabase.from('listings').update({ status: 'removed' }).in('id', softIds);
      if (error) { setBulkWorking(false); alert('Bulk delete failed (hide): ' + error.message); return; }
    }
    if (hardIds.length > 0) {
      const { error } = await supabase.from('listings').delete().in('id', hardIds);
      if (error) { setBulkWorking(false); alert('Bulk delete failed (remove): ' + error.message); return; }
    }

    setBulkWorking(false);
    setListings(prev => prev.filter(l => !selectedIds.has(l.id)));
    setSelectedIds(new Set());
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
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ My Listings ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={openNew} className="btn btn-primary btn-sm">+ New Listing</button>
            <button onClick={() => setScansPickerOpen(true)} className="btn btn-ghost btn-sm">📷 Scans</button>
            <button onClick={() => setFbSalesPickerOpen(true)} className="btn btn-ghost btn-sm">📣 FB Sales</button>
            <button onClick={() => setDefaultsOpen(true)} className="btn btn-ghost btn-sm">⚙ Default Shipping</button>
            <Link href="/sales-metrics" className="btn btn-ghost btn-sm">📊 Metrics</Link>
            <button onClick={() => router.push('/home')} className="btn btn-outline btn-sm">← Home</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Click <strong>+ New Listing</strong> to add one card at a time, pick from your inventory, or bulk-import from a CSV.</li>
            <li>Hit <strong>⚙ Default Shipping</strong> to set the shipping options you offer — these get applied automatically to every new listing you create.</li>
            <li>Listings start out as <strong>Draft</strong> while you finish details and add photos. When you&apos;re ready to sell, switch them to <strong>Active</strong> so they appear in the Marketplace.</li>
            <li>Use the tabs below to filter by status. Tick the checkboxes on multiple listings and you can <strong>Activate</strong>, <strong>Pause</strong> (move back to Draft), or <strong>Delete</strong> them in bulk.</li>
            <li>When a card sells, it moves to the <strong>Sold</strong> tab automatically and the buyer&apos;s order shows up in their Purchases.</li>
          </ol>
        </section>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18,
        }}>
          <ListingsMetricCard label="Active total" value={fmtMoney(metrics.activeTotal)} />
          <ListingsMetricCard label="Sold total" value={fmtMoney(metrics.soldTotal)} accent />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
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
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
            flex: 1, minWidth: 240, marginLeft: 'auto', maxWidth: 420,
          }}>
            <span style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 700 }}>🔍</span>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search — multi-term (e.g. 1971 Topps Munson)"
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)',
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} title="Clear search"
                style={{ background: 'transparent', border: 'none', color: 'var(--plum)', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
            )}
          </div>
          {searchQuery && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
              {filtered.length} match{filtered.length === 1 ? '' : 'es'}
            </span>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div style={{
            position: 'sticky', top: 64, zIndex: 40,
            background: 'var(--plum)', color: 'var(--mustard)',
            padding: '10px 18px', marginBottom: 14,
            borderRadius: 12, border: '2px solid var(--plum)',
            boxShadow: '0 4px 0 var(--plum-deep, rgba(0,0,0,0.2))',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span className="eyebrow" style={{ color: 'var(--mustard)', fontSize: 11 }}>
              {selectedIds.size} selected
            </span>
            <button type="button" onClick={selectAllVisible}
              className="btn btn-sm" style={{ background: 'transparent', color: 'var(--mustard)', border: '1.5px solid var(--mustard)' }}>
              Select all visible ({filtered.length})
            </button>
            <button type="button" onClick={() => bulkSetStatus('active')} disabled={bulkWorking}
              className="btn btn-sm" style={{ background: 'var(--teal)', color: 'var(--cream)', border: '1.5px solid var(--teal)' }}>
              ✓ Activate
            </button>
            <button type="button" onClick={() => bulkSetStatus('draft')} disabled={bulkWorking}
              className="btn btn-sm" style={{ background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--mustard)' }}>
              ⏸ Pause
            </button>
            <button type="button" onClick={bulkDelete} disabled={bulkWorking}
              className="btn btn-sm" style={{ background: 'var(--rust)', color: 'var(--cream)', border: '1.5px solid var(--rust)' }}>
              🗑 Delete
            </button>
            <button type="button" onClick={clearSelection}
              className="btn btn-sm" style={{ background: 'transparent', color: 'var(--mustard)', border: '1.5px solid var(--mustard)', marginLeft: 'auto' }}>
              Clear
            </button>
          </div>
        )}

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
              const purchase = purchasesByListing[l.id];
              return (
                <div key={l.id} className="panel-bordered" style={{ padding: '18px 22px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(l.id)}
                      onChange={() => toggleSelected(l.id)}
                      style={{ width: 18, height: 18, marginTop: 4, accentColor: 'var(--plum)', cursor: 'pointer', flexShrink: 0 }}
                      aria-label="Select listing"
                    />
                    {l.photos && l.photos.length > 0 && (
                      <ListingPhotoStrip photos={l.photos} />
                    )}
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
                      {l.description && (
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{l.description}</p>
                      )}
                      <div style={{ display: 'flex', gap: 22, fontSize: 13, marginTop: 10, flexWrap: 'wrap' }}>
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
                      {l.status === 'sold' && purchase && (
                        <div style={{
                          marginTop: 10, padding: '8px 12px',
                          background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8,
                          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                        }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                            background: purchase.status === 'paid' ? 'var(--mustard)' : purchase.status === 'shipped' ? 'var(--orange)' : purchase.status === 'completed' ? 'var(--teal)' : purchase.status === 'cancelled' ? 'var(--ink-mute)' : 'var(--rust)',
                            color: purchase.status === 'paid' ? 'var(--plum)' : 'var(--cream)',
                          }}>
                            {purchase.status.toUpperCase()}
                          </span>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
                            Buyer:{' '}
                            {purchase.buyer_email ? (
                              <a href={`mailto:${purchase.buyer_email}?subject=${encodeURIComponent(`Sports Collective: ${l.title}`)}`}
                                style={{ color: 'var(--orange)' }}>
                                {purchase.buyer_name}
                              </a>
                            ) : (
                              purchase.buyer_name
                            )}
                          </span>
                          <button type="button" onClick={() => setOpenPurchaseId(purchase.id)}
                            className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
                            View Details →
                          </button>
                        </div>
                      )}
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
          onUploadPhoto={uploadPhoto}
          onDeletePhoto={deletePhoto}
          onResearchPrice={() => setResearchOpen(true)}
        />
      )}
      <MarketResearchModal
        open={researchOpen && !!editing}
        onClose={() => setResearchOpen(false)}
        card={{
          year: editing?.year ?? null,
          brand: editing?.brand ?? null,
          card_number: editing?.card_number ?? null,
          player: editing?.player ?? null,
          grade: editing?.grade ?? null,
          grading_company: editing?.grading_company ?? null,
          raw_grade: editing?.raw_grade ?? null,
          listing_id: editing?.id ?? null,
        }}
        onApply={(v) => setEditing(prev => prev ? { ...prev, asking_price: Math.round(v * 100) / 100 } : prev)}
      />
      {importOpen && (
        <ImportListingsModal
          userId={userId}
          onClose={() => setImportOpen(false)}
          onComplete={(newListings) => {
            setListings(prev => [...newListings, ...prev]);
            setImportOpen(false);
          }}
        />
      )}

      {newPickerOpen && (
        <NewListingPicker
          onClose={() => setNewPickerOpen(false)}
          onChooseBlank={openBlankNew}
          onChooseInventory={openInventoryNew}
          onChooseBulk={() => { setNewPickerOpen(false); setImportOpen(true); }}
        />
      )}

      {scansPickerOpen && (
        <ChoicePicker
          title="Add Scans"
          subtitle="Pick where you want to attach card scans."
          choices={[
            {
              icon: '📷',
              label: 'Add Scans to Single Cards',
              hint: 'Match scans to individual listings — front and back per card.',
              onClick: () => { setScansPickerOpen(false); router.push('/listings/scan-inbox'); },
            },
            {
              icon: '📚',
              label: 'Add Scans to Set Inventory',
              hint: 'Bulk attach scans to rows in one of your sets.',
              onClick: () => { setScansPickerOpen(false); router.push('/listings/scan-from-set'); },
            },
            {
              icon: '🪟',
              label: 'Multi-Card Scan (2×3 grid)',
              hint: 'Upload one image of 6 fronts + one of 6 backs. Splits losslessly into 6 cards and assigns each to a row.',
              onClick: () => { setScansPickerOpen(false); router.push('/listings/scan-multi-card'); },
            },
          ]}
          onClose={() => setScansPickerOpen(false)}
        />
      )}

      {fbSalesPickerOpen && (
        <ChoicePicker
          title="FB Sales"
          subtitle="Which kind of Facebook sale do you want to manage?"
          choices={[
            {
              icon: '🔨',
              label: 'Auctions',
              hint: 'Bidding-style sales with current high bid per lot.',
              onClick: () => { setFbSalesPickerOpen(false); router.push('/fb-auctions'); },
            },
            {
              icon: '🏷',
              label: 'Claim Sales',
              hint: 'Fixed-price multi-lot posts where buyers claim in the comments.',
              onClick: () => { setFbSalesPickerOpen(false); router.push('/fb-claim-sales'); },
            },
          ]}
          onClose={() => setFbSalesPickerOpen(false)}
        />
      )}

      {inventoryOpen && (
        <InventoryListingWizard
          userId={userId}
          defaultShipping={defaultShipping}
          onClose={() => setInventoryOpen(false)}
          onComplete={(newListings) => {
            setListings(prev => [...newListings, ...prev]);
            setInventoryOpen(false);
          }}
        />
      )}

      {defaultsOpen && (
        <DefaultShippingModal
          userId={userId}
          initial={defaultShipping}
          onClose={() => setDefaultsOpen(false)}
          onSaved={(opts) => { setDefaultShipping(opts); setDefaultsOpen(false); }}
        />
      )}

      {openPurchaseId && (() => {
        const purchase = Object.values(purchasesByListing).find(p => p.id === openPurchaseId);
        if (!purchase) return null;
        return (
          <PurchaseDetailModal
            purchase={purchase}
            mode="seller"
            counterparty={{ name: purchase.buyer_name, email: purchase.buyer_email }}
            onClose={() => setOpenPurchaseId(null)}
            onUpdated={(updated) => {
              setPurchasesByListing(prev => ({
                ...prev,
                [updated.listing_id]: { ...prev[updated.listing_id], ...updated },
              }));
              if (updated.status === 'cancelled') {
                setListings(prev => prev.map(x => x.id === updated.listing_id ? { ...x, status: 'active' } : x));
              }
            }}
          />
        );
      })()}
    </div>
  );
}

function ListingEditor({
  draft, onChange, onCancel, onSave, saving, error, onUploadPhoto, onDeletePhoto, onResearchPrice,
}: {
  draft: Partial<Listing>;
  onChange: (next: Partial<Listing>) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string;
  onUploadPhoto: (file: File) => Promise<void>;
  onDeletePhoto: (idx: number) => Promise<void>;
  onResearchPrice: () => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lbStart, setLbStart] = useState<number | null>(null);
  const photos = draft.photos || [];
  const canUpload = !!draft.id && photos.length < MAX_PHOTOS;
   async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await onUploadPhoto(file);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }  const fieldStyle: React.CSSProperties = {
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
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 130px', gap: 12 }}>
            <div>
              <div className="eyebrow" style={labelStyle}>Year *</div>
              <input type="number" value={draft.year ?? ''} onChange={e => set('year', e.target.value ? Number(e.target.value) : null)}
                placeholder="1953" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Brand *</div>
              <input value={draft.brand || ''} onChange={e => set('brand', e.target.value)}
                placeholder="Topps" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Card # *</div>
              <input value={draft.card_number || ''} onChange={e => set('card_number', e.target.value)}
                placeholder="82" style={fieldStyle} />
            </div>
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Player *</div>
            <input value={draft.player || ''} onChange={e => set('player', e.target.value)}
              placeholder="Mickey Mantle" style={fieldStyle} />
            <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', fontWeight: 600, marginTop: 4 }}>
              Title preview: <span style={{ color: 'var(--plum)' }}>{buildTitle(draft) || '—'}</span>
            </div>
          </div>

          <div>            <div className="eyebrow" style={labelStyle}>Condition Type *</div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div className="eyebrow" style={{ ...labelStyle, marginBottom: 0 }}>Asking Price ($)</div>
                <button type="button" onClick={onResearchPrice}
                  style={{ background: 'transparent', border: 0, color: 'var(--teal)', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                  📈 Research Prices
                </button>
              </div>
              <input type="number" step="0.01" value={draft.asking_price ?? ''} onChange={e => set('asking_price', e.target.value ? Number(e.target.value) : null)}
                placeholder="0.00" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Cost ($) — private</div>
              <input type="number" step="0.01" value={draft.cost ?? ''} onChange={e => set('cost', e.target.value ? Number(e.target.value) : null)}
                placeholder="0.00" style={fieldStyle} />
                                   </div>
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Description (optional)</div>
            <textarea value={draft.description || ''} onChange={e => set('description', e.target.value)}
              rows={3} placeholder="Additional details — centering, surface, any flaws, sale terms…"
              style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>
          <div>
            <div className="eyebrow" style={labelStyle}>Shipping Options</div>
            <ShippingOptionsEditor
              options={draft.shipping_options || []}
              onChange={(opts) => set('shipping_options', opts as Listing['shipping_options'])}
            />
          </div>
                    <div>
            <div className="eyebrow" style={labelStyle}>Photos ({photos.length} / {MAX_PHOTOS})</div>
            {!draft.id ? (
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600, fontStyle: 'italic' }}>
                Save the listing first, then re-open to add photos.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {photos.map((url, i) => (
                  <div key={url + i} style={{ position: 'relative' }}>
                    <img src={url} alt={`Photo ${i + 1}`} onClick={() => setLbStart(i)}
                      style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'pointer' }} />
                    <button type="button" onClick={() => onDeletePhoto(i)}
                      style={{
                        position: 'absolute', top: -6, right: -6,
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'var(--rust)', color: 'var(--cream)',
                        border: '2px solid var(--cream)', cursor: 'pointer',
                        fontSize: 11, fontWeight: 700, lineHeight: 1, padding: 0,
                      }}>×</button>
                  </div>
                ))}
                {canUpload && (
                  <>
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      style={{
                        width: 80, height: 80, borderRadius: 8,
                        border: '2px dashed var(--plum)', background: 'var(--paper)',
                        color: 'var(--plum)', cursor: 'pointer', fontSize: 24, fontWeight: 700,
                      }}>
                      {uploading ? '…' : '+'}
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
                  </>
                )}
              </div>
            )}
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
      {lbStart !== null && photos.length > 0 && (
                <PhotoLightbox urls={photos} startIdx={lbStart} onClose={() => setLbStart(null)} />
      )}
    </div>
  );
}

const REQUIRED_HEADERS = ['Year', 'Brand', 'Card #', 'Player', 'Condition Type', 'Asking Price'];
const ALL_HEADERS = [...REQUIRED_HEADERS, 'Raw Grade', 'Grading Company', 'Grade', 'Cost'];

type ParsedRow = {
  rowIndex: number;
  data?: Partial<Listing>;
  error?: string;
};

function normalizeNumeric(s: string): string {
  const n = Number(s.trim());
  if (Number.isNaN(n)) return '';
  return NUMERIC_GRADES.includes(n.toString()) ? n.toString() : '';
}

function ImportListingsModal({
  userId, onClose, onComplete,
}: {
  userId: string;
  onClose: () => void;
  onComplete: (newListings: Listing[]) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [headerError, setHeaderError] = useState('');
  const [importing, setImporting] = useState(false);
  function downloadTemplate() {
    const lines = [
      'Enter cards in this format - delete this row before submitting',
      'Year,Brand,Card #,Player,Condition Type,Asking Price,Raw Grade,Grading Company,Grade,Cost',
      '1954,Topps,1,TED WILLIAMS,Graded,850,,PSA,5,600',
      '1955,Topps,3,MONTE IRVIN,Graded,100,,SGC,5,50',
      '1956,Topps,10,JACKIE ROBINSON,Graded,750,,PSA,4.5,600',
      '1970,Topps,128,HANK AARON,Raw,2500,VG,,,2000',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sports-collective-listings-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setHeaderError('');
    setParsed(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
      complete: (result) => {
        setParsing(false);
        const fields = result.meta.fields || [];
        const missing = REQUIRED_HEADERS.filter(h => !fields.includes(h));
        if (missing.length > 0) {
          setHeaderError(`CSV is missing required columns: ${missing.join(', ')}`);
          return;
        }
        const rows: ParsedRow[] = (result.data as Record<string, string>[]).map((r, i) => {
          const rowIndex = i + 2;
          const yearStr = String(r['Year'] || '').trim();
          const brand = String(r['Brand'] || '').trim();
          const cardNum = String(r['Card #'] || '').trim();
          const player = String(r['Player'] || '').trim();
          const condTypeRaw = String(r['Condition Type'] || '').trim().toLowerCase();
          const askingStr = String(r['Asking Price'] || '').replace(/[^0-9.]/g, '');
          const costStr = String(r['Cost'] || '').replace(/[^0-9.]/g, '');
          const rawGrade = String(r['Raw Grade'] || '').trim();
          const gradingCo = String(r['Grading Company'] || '').trim().toUpperCase();
          const numGrade = String(r['Grade'] || '').trim();

          if (!yearStr || !brand || !cardNum || !player) return { rowIndex, error: 'Missing required field (Year, Brand, Card #, or Player).' };
          const year = Number(yearStr);
          if (Number.isNaN(year)) return { rowIndex, error: `Year is not a number: "${yearStr}".` };

          let condition_type: ConditionType;
          if (condTypeRaw === 'raw') condition_type = 'raw';
          else if (condTypeRaw === 'graded') condition_type = 'graded';
          else return { rowIndex, error: `Condition Type must be "Raw" or "Graded" (got "${r['Condition Type']}").` };

          if (!askingStr) return { rowIndex, error: 'Asking Price is required.' };
          const asking = Number(askingStr);
          if (Number.isNaN(asking) || asking < 0) return { rowIndex, error: `Asking Price invalid: "${r['Asking Price']}".` };

          let cost: number | null = null;
          if (costStr) { const c = Number(costStr); if (!Number.isNaN(c) && c >= 0) cost = c; }

          let chosenRaw = '';
          let chosenCo = '';
          let chosenGrade = '';
          if (condition_type === 'raw') {
            chosenRaw = RAW_GRADES.includes(rawGrade) ? rawGrade : '';
            if (!chosenRaw) return { rowIndex, error: `Raw Grade required for Raw cards. Allowed: ${RAW_GRADES.join(', ')}.` };
          } else {
            chosenCo = COMPANIES.includes(gradingCo) ? gradingCo : '';
            chosenGrade = normalizeNumeric(numGrade);
            if (!chosenCo) return { rowIndex, error: `Grading Company required for Graded cards. Allowed: ${COMPANIES.join(', ')}.` };
            if (!chosenGrade) return { rowIndex, error: `Grade required (1–10, half-points OK) for Graded cards.` };
          }

          const data: Partial<Listing> = {
            user_id: userId,
            year,
            brand,
            card_number: cardNum,
            player,
            condition_type,
            raw_grade: chosenRaw || null,
            grading_company: chosenCo || null,
            grade: chosenGrade || null,
            asking_price: asking,
            cost,
            photos: [],
            status: 'draft',
            description: null,
          };
          data.title = buildTitle(data);
          return { rowIndex, data };
        });
        setParsed(rows);
      },
      error: () => {
        setParsing(false);
        setHeaderError('Could not parse CSV file.');
      },
    });
  }

  async function handleImport() {
    if (!parsed) return;
    const valid = parsed.filter(r => r.data).map(r => r.data!);
    if (valid.length === 0) return;
    setImporting(true);
    const supabase = createClient();
    const { data, error } = await supabase.from('listings').insert(valid).select();
    setImporting(false);
    if (error) { alert('Import failed: ' + error.message); return; }
    onComplete((data || []) as Listing[]);
  }

  const validCount = parsed?.filter(r => r.data).length || 0;
  const invalidCount = parsed?.filter(r => r.error).length || 0;

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(42,20,52,0.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 20px', overflowY: 'auto',
      }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 760, padding: 28, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div className="display" style={{ fontSize: 24, color: 'var(--plum)', flex: 1 }}>Bulk Upload Listings</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ marginBottom: 18, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          Upload a CSV with these columns: <strong>{ALL_HEADERS.join(', ')}</strong>.<br/>
          Required: <strong>{REQUIRED_HEADERS.join(', ')}</strong> (and Raw Grade if Raw, Grading Company + Grade if Graded).
          All imported rows land as <strong>drafts</strong> for review.
        </div>

                <div style={{ marginBottom: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={parsing}
            className="btn btn-primary btn-sm">
            {parsing ? 'Parsing…' : 'Choose CSV file…'}
          </button>
          <button type="button" onClick={downloadTemplate} className="btn btn-ghost btn-sm">
            ⬇ Download Template
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
        </div>

        {headerError && (
          <div style={{
            background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
            borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600, marginBottom: 16,
          }}>
            {headerError}
          </div>
        )}

        {parsed && (
          <>
            <div style={{ display: 'flex', gap: 14, marginBottom: 14, fontSize: 13 }}>
              <span style={{ color: 'var(--teal)', fontWeight: 700 }}>✓ {validCount} valid</span>
              {invalidCount > 0 && <span style={{ color: 'var(--rust)', fontWeight: 700 }}>✕ {invalidCount} invalid</span>}
            </div>

            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1.5px solid var(--plum)', borderRadius: 8, marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--plum)', color: 'var(--mustard)' }}>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Row</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Title / Error</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Asking</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--cream-warm)', background: r.error ? 'rgba(197,74,44,0.08)' : (i % 2 ? 'var(--paper)' : 'var(--cream)') }}>
                      <td className="mono" style={{ padding: '6px 10px', color: 'var(--ink-mute)' }}>{r.rowIndex}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {r.data ? (
                          <span style={{ color: 'var(--plum)' }}>{r.data.title}</span>
                        ) : (
                          <span style={{ color: 'var(--rust)' }}>{r.error}</span>
                        )}
                      </td>
                      <td className="mono" style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--ink-soft)' }}>
                        {r.data ? fmtMoney(r.data.asking_price ?? null) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={handleImport} disabled={importing || validCount === 0}
                className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                {importing ? 'Importing…' : `Import ${validCount} ${validCount === 1 ? 'Listing' : 'Listings'} as Drafts`}
              </button>
              <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DefaultShippingModal({
  userId, initial, onClose, onSaved,
}: {
  userId: string;
  initial: ShippingOption[];
  onClose: () => void;
  onSaved: (opts: ShippingOption[]) => void;
}) {
  const [opts, setOpts] = useState<ShippingOption[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    setSaving(true);
    const supabase = createClient();
    const cleaned = opts.filter(o => o.label.trim() && (o.cost === 0 || o.cost > 0));
    const { error: err } = await supabase
      .from('user_profiles')
      .update({ default_shipping_options: cleaned })
      .eq('user_id', userId);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved(cleaned);
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 540, padding: 28, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>Default Shipping Options</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          These will be pre-filled on every <strong>new</strong> listing you create. You can still customize per-listing in the editor. Existing listings are not affected.
        </p>

        <ShippingOptionsEditor options={opts} onChange={setOpts} />

        {error && (
          <div style={{
            background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
            borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600, marginTop: 14,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={save} disabled={saving}
            className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            {saving ? 'Saving…' : 'Save Defaults'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function NewListingPicker({
  onClose, onChooseBlank, onChooseInventory, onChooseBulk,
}: {
  onClose: () => void;
  onChooseBlank: () => void;
  onChooseInventory: () => void;
  onChooseBulk: () => void;
}) {
  return (
    <ChoicePicker
      title="New Listing"
      subtitle="How would you like to start?"
      onClose={onClose}
      choices={[
        {
          icon: '✏️',
          label: 'Blank listing',
          hint: 'Type in a single card from scratch.',
          onClick: onChooseBlank,
        },
        {
          icon: '📚',
          label: 'From my inventory',
          hint: 'Pick one or many cards from a set you already track.',
          onClick: onChooseInventory,
        },
        {
          icon: '📁',
          label: 'Bulk Load (CSV)',
          hint: 'Import a bunch of listings at once from a CSV file.',
          onClick: onChooseBulk,
        },
      ]}
    />
  );
}

type Choice = { icon: string; label: string; hint: string; onClick: () => void };

function ChoicePicker({
  title, subtitle, choices, onClose,
}: {
  title: string;
  subtitle?: string;
  choices: Choice[];
  onClose: () => void;
}) {
  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(42,20,52,0.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '60px 20px', overflowY: 'auto',
      }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 540, padding: 28, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>{title}</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 20 }}>{subtitle}</p>}
        <div style={{ display: 'grid', gap: 12 }}>
          {choices.map(c => (
            <button key={c.label} type="button" onClick={c.onClick}
              className="panel-bordered"
              style={{
                padding: '18px 20px', textAlign: 'left', background: 'var(--paper)',
                cursor: 'pointer', border: '1.5px solid var(--rule)', borderRadius: 12,
              }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 4 }}>
                {c.icon} {c.label}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type InventorySet = {
  id?: string | null;
  slug: string;
  year: number | null;
  brand: string | null;
  title: string | null;
  rows: Record<string, any>[];
};

function stripMoney(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n) || n === 0) return null;
  return n;
}

function InventoryListingWizard({
  userId, defaultShipping, onClose, onComplete,
}: {
  userId: string;
  defaultShipping: ShippingOption[];
  onClose: () => void;
  onComplete: (newListings: Listing[]) => void;
}) {
  const [researchIdx, setResearchIdx] = useState<number | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sets, setSets] = useState<InventorySet[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [setSearch, setSetSearch] = useState('');
  const [chosenSlug, setChosenSlug] = useState<string | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Partial<Listing>[]>([]);
  const initialShip = (defaultShipping && defaultShipping.length > 0) ? defaultShipping : DEFAULT_SHIPPING_OPTIONS;
  const [sharedShipping, setSharedShipping] = useState<ShippingOption[]>([...initialShip]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data } = await supabase
        .from('sets')
        .select('id, slug, year, brand, title, rows')
        .eq('user_id', userId)
        .order('year', { ascending: false });
      setSets((data || []) as InventorySet[]);
      setSetsLoading(false);
    }
    load();
  }, [userId]);

  const chosenSet = sets.find(s => s.slug === chosenSlug) || null;

  const filteredSets = useMemo(() => {
    const q = setSearch.toLowerCase().trim();
    if (!q) return sets;
    return sets.filter(s => {
      const hay = [s.title, s.brand, s.year ? String(s.year) : ''].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [sets, setSearch]);

  const candidateRows = useMemo(() => {
    if (!chosenSet) return [] as { row: Record<string, any>; origIndex: number }[];
    const rows = (chosenSet.rows || []).map((row, origIndex) => ({ row, origIndex }));
    const q = cardSearch.toLowerCase().trim();
    return rows.filter(({ row }) => {
      if (ownedOnly && String(row['Owned'] || '') !== 'Yes') return false;
      if (!q) return true;
      const hay = [row['Card #'], row['Player'], row['Description']].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [chosenSet, ownedOnly, cardSearch]);

  function togglePick(origIndex: number) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(origIndex)) next.delete(origIndex); else next.add(origIndex);
      return next;
    });
  }

  function selectAllVisible() {
    setPicked(prev => {
      const next = new Set(prev);
      candidateRows.forEach(c => next.add(c.origIndex));
      return next;
    });
  }
  function clearPicked() { setPicked(new Set()); }

  function buildDraftFromRow(row: Record<string, any>): Partial<Listing> {
    const isGraded = String(row['Graded'] || '').toLowerCase() === 'yes';
    const company = String(row['Grading Company'] || '').toUpperCase();
    const grade = String(row['Grade'] || '');
    const rawGrade = String(row['Raw Grade'] || '');
    const photos: string[] = [];
    if (row['Image 1']) photos.push(String(row['Image 1']));
    if (row['Image 2']) photos.push(String(row['Image 2']));
    const cost = stripMoney(row['Cost']);
    const value = stripMoney(row['Value']);
    const sale = stripMoney(row['Sale Price']);
    const target = stripMoney(row['Target Price']);
    const askingPrice = sale ?? value ?? target ?? null;
    const draft: Partial<Listing> = {
      user_id: userId,
      set_id: chosenSet?.id || null,
      source_set_slug: chosenSet?.slug || null,
      source_card_number: String(row['Card #'] || '') || null,
      title: '',
      description: '',
      year: chosenSet?.year || null,
      brand: chosenSet?.brand || '',
      card_number: String(row['Card #'] || ''),
      player: String(row['Player'] || row['Description'] || ''),
      condition_type: isGraded ? 'graded' : 'raw',
      raw_grade: !isGraded && RAW_GRADES.includes(rawGrade) ? rawGrade : null,
      grading_company: isGraded && COMPANIES.includes(company) ? company : null,
      grade: isGraded ? grade : null,
      asking_price: askingPrice,
      cost: cost,
      photos,
      shipping_options: [...sharedShipping],
      status: 'draft',
    };
    draft.title = buildTitle(draft);
    return draft;
  }

  function goToReview() {
    if (!chosenSet) return;
    const ds = Array.from(picked).map(i => buildDraftFromRow(chosenSet.rows[i]));
    setDrafts(ds);
    setStep(3);
  }

  function updateDraft(i: number, patch: Partial<Listing>) {
    setDrafts(prev => prev.map((d, idx) => {
      if (idx !== i) return d;
      const next = { ...d, ...patch };
      next.title = buildTitle(next);
      return next;
    }));
  }
  function removeDraft(i: number) {
    setDrafts(prev => prev.filter((_, idx) => idx !== i));
  }
  function applySharedShippingToAll() {
    setDrafts(prev => prev.map(d => ({ ...d, shipping_options: [...sharedShipping] })));
  }
  function updateSharedShip(i: number, patch: Partial<ShippingOption>) {
    setSharedShipping(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }
  function addSharedShip() {
    setSharedShipping(prev => [...prev, { label: '', cost: 0 }]);
  }
  function removeSharedShip(i: number) {
    setSharedShipping(prev => prev.filter((_, idx) => idx !== i));
  }

  async function saveAll() {
    setError('');
    if (drafts.length === 0) { setError('No cards selected.'); return; }
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      if (!d.year) { setError(`Row ${i + 1}: Year is required.`); return; }
      if (!d.brand?.trim()) { setError(`Row ${i + 1}: Brand is required.`); return; }
      if (!d.card_number?.toString().trim()) { setError(`Row ${i + 1}: Card # is required.`); return; }
      if (!d.player?.trim()) { setError(`Row ${i + 1}: Player is required.`); return; }
      if (d.condition_type === 'graded' && (!d.grading_company || !d.grade)) {
        setError(`Row ${i + 1}: Graded cards need a grading company and grade.`); return;
      }
      if (d.condition_type === 'raw' && !d.raw_grade) {
        setError(`Row ${i + 1}: Raw cards need a raw grade.`); return;
      }
    }
    setSaving(true);
    const supabase = createClient();
    const payload = drafts.map(d => ({
      ...d,
      title: buildTitle(d),
      year: d.year ? Number(d.year) : null,
      asking_price: d.asking_price !== null && d.asking_price !== undefined && String(d.asking_price) !== '' ? Number(d.asking_price) : null,
      cost: d.cost !== null && d.cost !== undefined && String(d.cost) !== '' ? Number(d.cost) : null,
    }));
    const { data, error: err } = await supabase.from('listings').insert(payload).select();
    setSaving(false);
    if (err) { setError(err.message); return; }
    onComplete((data || []) as Listing[]);
  }

  const SECTION_LABEL: React.CSSProperties = {
    fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: 'var(--orange)', fontWeight: 700, marginBottom: 8,
  };

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(42,20,52,0.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 20px', overflowY: 'auto',
      }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 980, padding: 24, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>
            New Listing — From Inventory
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700 }}>
            Step {step} of 3
          </span>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {[1, 2, 3].map(n => (
            <div key={n} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: step >= n ? 'var(--orange)' : 'var(--rule)',
            }} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={SECTION_LABEL}>★ Choose a set ★</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', border: '1.5px solid var(--plum)',
              borderRadius: 100, background: 'var(--cream)', marginBottom: 12,
            }}>
              <span style={{ fontSize: 13, color: 'var(--plum)' }}>🔍</span>
              <input
                value={setSearch}
                onChange={(e) => setSetSearch(e.target.value)}
                placeholder="Search sets by year, brand, title…"
                autoFocus
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontFamily: 'var(--font-body)', fontSize: 13, flex: 1, color: 'var(--plum)',
                }}
              />
            </div>
            {setsLoading ? (
              <div className="eyebrow" style={{ textAlign: 'center', padding: 30, color: 'var(--ink-mute)' }}>Loading sets…</div>
            ) : filteredSets.length === 0 ? (
              <div className="eyebrow" style={{ textAlign: 'center', padding: 30, color: 'var(--ink-mute)' }}>No sets found.</div>
            ) : (
              <div style={{ maxHeight: 420, overflowY: 'auto', display: 'grid', gap: 6 }}>
                {filteredSets.map(s => {
                  const ownedCount = (s.rows || []).filter(r => String(r['Owned'] || '') === 'Yes').length;
                  const isChosen = s.slug === chosenSlug;
                  return (
                    <button key={s.slug} type="button" onClick={() => setChosenSlug(s.slug)}
                      style={{
                        textAlign: 'left', padding: '12px 14px',
                        border: isChosen ? '2px solid var(--orange)' : '1.5px solid var(--rule)',
                        borderRadius: 10, background: isChosen ? 'rgba(184, 146, 58, 0.18)' : 'var(--paper)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                      }}>
                      <div style={{ flex: 1 }}>
                        <div className="display" style={{ fontSize: 15, color: 'var(--plum)' }}>
                          {s.title || `${s.year || ''} ${s.brand || ''}`.trim() || s.slug}
                        </div>
                        <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                          {s.year || '—'} · {s.brand || '—'} · {(s.rows || []).length} rows · {ownedCount} owned
                        </div>
                      </div>
                      {isChosen && <span style={{ color: 'var(--orange)', fontSize: 18 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" onClick={onClose} className="btn btn-outline btn-sm">Cancel</button>
              <button type="button" disabled={!chosenSlug} onClick={() => setStep(2)} className="btn btn-primary btn-sm">
                Next: Pick cards →
              </button>
            </div>
          </div>
        )}

        {step === 2 && chosenSet && (
          <div>
            <div style={SECTION_LABEL}>★ Pick cards from {chosenSet.title || chosenSet.slug} ★</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', border: '1.5px solid var(--plum)',
                borderRadius: 100, background: 'var(--cream)', flex: 1, minWidth: 220,
              }}>
                <span style={{ fontSize: 13, color: 'var(--plum)' }}>🔍</span>
                <input
                  value={cardSearch}
                  onChange={(e) => setCardSearch(e.target.value)}
                  placeholder="Search by card #, player…"
                  style={{
                    border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: 'var(--font-body)', fontSize: 13, flex: 1, color: 'var(--plum)',
                  }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--plum)', fontWeight: 600 }}>
                <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
                Owned only
              </label>
              <button type="button" onClick={selectAllVisible} className="btn btn-ghost btn-sm">Select all visible</button>
              <button type="button" onClick={clearPicked} className="btn btn-ghost btn-sm">Clear</button>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', fontWeight: 700 }}>
                {picked.size} selected · {candidateRows.length} shown
              </span>
            </div>

            <div style={{ maxHeight: 420, overflowY: 'auto', border: '1.5px solid var(--rule)', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--plum)', color: 'var(--mustard)' }}>
                  <tr>
                    {['', 'Card #', 'Player', 'Condition', 'Cost', 'Value'].map(h => (
                      <th key={h} className="eyebrow" style={{
                        padding: '8px 12px', textAlign: 'left', fontSize: 10,
                        letterSpacing: '0.16em', fontWeight: 700,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidateRows.length === 0 ? (
                    <tr><td colSpan={6} className="eyebrow" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)' }}>No matching cards.</td></tr>
                  ) : candidateRows.map(({ row, origIndex }, i) => {
                    const isGraded = String(row['Graded'] || '').toLowerCase() === 'yes';
                    const cond = isGraded
                      ? `${row['Grading Company'] || '?'} ${row['Grade'] || '?'}`
                      : (row['Raw Grade'] ? String(row['Raw Grade']) : '—');
                    const isPicked = picked.has(origIndex);
                    return (
                      <tr key={origIndex} onClick={() => togglePick(origIndex)} style={{
                        cursor: 'pointer',
                        borderTop: '1px solid var(--rule)',
                        background: isPicked ? 'rgba(184, 146, 58, 0.18)' : (i % 2 === 0 ? 'var(--cream)' : 'var(--paper)'),
                      }}>
                        <td style={{ padding: '8px 12px' }}>
                          <input type="checkbox" checked={isPicked} onChange={() => togglePick(origIndex)} onClick={(e) => e.stopPropagation()} />
                        </td>
                        <td className="mono" style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--plum)' }}>
                          {row['Card #'] ? `#${row['Card #']}` : '—'}
                        </td>
                        <td className="display" style={{ padding: '8px 12px', color: 'var(--plum)' }}>
                          {row['Player'] || row['Description'] || '—'}
                        </td>
                        <td className="eyebrow" style={{ padding: '8px 12px', color: 'var(--orange)', fontSize: 10.5 }}>
                          {cond}
                        </td>
                        <td className="mono" style={{ padding: '8px 12px', color: 'var(--ink-soft)' }}>
                          {row['Cost'] ? String(row['Cost']) : '—'}
                        </td>
                        <td className="mono" style={{ padding: '8px 12px', color: 'var(--ink-soft)' }}>
                          {row['Value'] ? String(row['Value']) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 18 }}>
              <button type="button" onClick={() => setStep(1)} className="btn btn-outline btn-sm">← Back</button>
              <button type="button" disabled={picked.size === 0} onClick={goToReview} className="btn btn-primary btn-sm">
                Next: Review {picked.size} card{picked.size === 1 ? '' : 's'} →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={SECTION_LABEL}>★ Review & finalize ★</div>

            <div className="panel-bordered" style={{ padding: 14, background: 'var(--paper)', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700, flex: 1 }}>
                  Shared shipping (applied to all)
                </div>
                <button type="button" onClick={addSharedShip} className="btn btn-ghost btn-sm">+ Add option</button>
                <button type="button" onClick={applySharedShippingToAll} className="btn btn-outline btn-sm">Apply to all rows</button>
              </div>
              {sharedShipping.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No shipping options. Click + Add option.</div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {sharedShipping.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        value={s.label}
                        onChange={(e) => updateSharedShip(i, { label: e.target.value })}
                        placeholder="Label (e.g. Bubble Mailer with Tracking)"
                        style={{
                          flex: 1, padding: '6px 10px', border: '1.5px solid var(--plum)',
                          borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: 'var(--plum)',
                          background: 'var(--cream)',
                        }}
                      />
                      <input
                        type="number" step="0.01" min="0"
                        value={s.cost}
                        onChange={(e) => updateSharedShip(i, { cost: Number(e.target.value) || 0 })}
                        placeholder="0.00"
                        style={{
                          width: 90, padding: '6px 10px', border: '1.5px solid var(--plum)',
                          borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--plum)',
                          background: 'var(--cream)',
                        }}
                      />
                      <button type="button" onClick={() => removeSharedShip(i)} className="btn btn-ghost btn-sm">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {drafts.length === 0 ? (
              <div className="eyebrow" style={{ textAlign: 'center', padding: 30, color: 'var(--ink-mute)' }}>No cards left. Go back to pick some.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10, maxHeight: 460, overflowY: 'auto' }}>
                {drafts.map((d, i) => (
                  <div key={i} className="panel-bordered" style={{ padding: 14, background: 'var(--paper)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div className="display" style={{ flex: 1, fontSize: 14, color: 'var(--plum)' }}>{d.title || '—'}</div>
                      <button type="button" onClick={() => removeDraft(i)} className="btn btn-ghost btn-sm">🗑 Remove</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                      <LabeledInput label="Year" type="number" value={d.year ?? ''}
                        onChange={(v) => updateDraft(i, { year: v === '' ? null : Number(v) })} />
                      <LabeledInput label="Brand" value={d.brand ?? ''}
                        onChange={(v) => updateDraft(i, { brand: String(v) })} />
                      <LabeledInput label="Card #" value={d.card_number ?? ''}
                        onChange={(v) => updateDraft(i, { card_number: String(v) })} />
                      <LabeledInput label="Player" value={d.player ?? ''}
                        onChange={(v) => updateDraft(i, { player: String(v) })} />
                      <LabeledSelect label="Condition" value={d.condition_type || 'raw'}
                        options={[{ v: 'raw', l: 'Raw' }, { v: 'graded', l: 'Graded' }]}
                        onChange={(v) => updateDraft(i, { condition_type: v as ConditionType })} />
                      {d.condition_type === 'raw' ? (
                        <LabeledSelect label="Raw Grade" value={d.raw_grade ?? ''}
                          options={[{ v: '', l: '—' }, ...RAW_GRADES.map(g => ({ v: g, l: g }))]}
                          onChange={(v) => updateDraft(i, { raw_grade: v || null })} />
                      ) : (
                        <>
                          <LabeledSelect label="Company" value={d.grading_company ?? ''}
                            options={[{ v: '', l: '—' }, ...COMPANIES.map(c => ({ v: c, l: c }))]}
                            onChange={(v) => updateDraft(i, { grading_company: v || null })} />
                          <LabeledSelect label="Grade" value={d.grade ?? ''}
                            options={[{ v: '', l: '—' }, ...NUMERIC_GRADES.map(g => ({ v: g, l: g }))]}
                            onChange={(v) => updateDraft(i, { grade: v || null })} />
                        </>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700 }}>Asking Price</span>
                          <button type="button" onClick={() => setResearchIdx(i)}
                            style={{ background: 'transparent', border: 0, color: 'var(--teal)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                            📈 Research
                          </button>
                        </div>
                        <input type="number" value={d.asking_price ?? ''}
                          onChange={(e) => updateDraft(i, { asking_price: e.target.value === '' ? null : Number(e.target.value) })}
                          style={{ padding: '6px 8px', border: '1.5px solid var(--plum)', borderRadius: 4, background: 'var(--paper)', color: 'var(--plum)', fontFamily: 'var(--font-body)', fontSize: 13 }} />
                      </div>
                      <LabeledInput label="Cost" type="number" value={d.cost ?? ''}
                        onChange={(v) => updateDraft(i, { cost: v === '' ? null : Number(v) })} />
                    </div>
                    {(d.photos && d.photos.length > 0) && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        {d.photos.map((p, pi) => (
                          <img key={pi} src={p} alt=""
                            style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--rule)' }} />
                        ))}
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', alignSelf: 'center', marginLeft: 4 }}>
                          {d.photos.length} photo{d.photos.length === 1 ? '' : 's'} from set
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div style={{
                marginTop: 12, padding: '10px 12px', background: 'rgba(192,57,43,0.12)',
                border: '1.5px solid var(--rust)', borderRadius: 8, color: 'var(--rust)', fontSize: 12.5, fontWeight: 600,
              }}>{error}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 18 }}>
              <button type="button" onClick={() => setStep(2)} className="btn btn-outline btn-sm">← Back</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
                <button type="button" disabled={saving || drafts.length === 0} onClick={saveAll} className="btn btn-primary btn-sm">
                  {saving ? 'Creating…' : `Create ${drafts.length} draft${drafts.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <MarketResearchModal
        open={researchIdx !== null && researchIdx < drafts.length}
        onClose={() => setResearchIdx(null)}
        card={researchIdx !== null && drafts[researchIdx] ? {
          year: drafts[researchIdx].year ?? null,
          brand: drafts[researchIdx].brand ?? null,
          card_number: drafts[researchIdx].card_number ?? null,
          player: drafts[researchIdx].player ?? null,
          grade: drafts[researchIdx].grade ?? null,
          grading_company: drafts[researchIdx].grading_company ?? null,
          raw_grade: drafts[researchIdx].raw_grade ?? null,
        } : { year: null, brand: null, card_number: null, player: null, grade: null, grading_company: null, raw_grade: null }}
        onApply={(value) => {
          if (researchIdx !== null) updateDraft(researchIdx, { asking_price: Math.round(value * 100) / 100 });
        }}
      />
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = 'text' }: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700 }}>{label}</span>
      <input
        type={type}
        value={value as any}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px', border: '1.5px solid var(--plum)',
          borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: 'var(--plum)',
          background: 'var(--cream)',
        }}
      />
    </label>
  );
}

function LabeledSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px', border: '1.5px solid var(--plum)',
          borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: 'var(--plum)',
          background: 'var(--cream)', cursor: 'pointer',
        }}
      >
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function ListingsMetricCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel-bordered" style={{ padding: '12px 16px' }}>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, color: accent ? 'var(--orange)' : 'var(--plum)', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
