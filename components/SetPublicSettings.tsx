'use client';

// Owner-only panel on the set view: turns the set's public showcase page on or
// off and edits what buyers see there — description, price, offers and
// minimum offer, key cards, condition notes, shipping & payment terms.

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadCardImageWithThumb } from '@/lib/upload-card-image';
import Thumb from '@/components/Thumb';
import { fmtMoney, type KeyCardNote, type ShowcaseSettings } from '@/lib/setShowcase';

function toNum(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export default function SetPublicSettings({ userId, slug, handle, settings, cardOptions, onSaved }: {
  userId: string;
  slug: string;
  handle: string | null;
  settings: ShowcaseSettings;
  cardOptions: Array<{ cardNumber: string; label: string; imageFront?: string | null }>;
  onSaved: (s: ShowcaseSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [price, setPrice] = useState(settings.asking_price != null ? String(settings.asking_price) : '');
  const [minOffer, setMinOffer] = useState(settings.min_offer != null ? String(settings.min_offer) : '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Upload a photo for the small title image. Stored next to the set's other
  // images; only saved to the set when the owner hits Save.
  async function uploadTitleImage(file: File) {
    setUploading(true);
    setMsg(null);
    const supabase = createClient();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${userId}/set-showcase/${slug}/title-${Date.now()}.${ext}`;
    const { error } = await uploadCardImageWithThumb(supabase, path, file, { contentType: file.type || undefined });
    setUploading(false);
    if (error) { setMsg(`Upload failed: ${error.message}`); return; }
    const { data } = supabase.storage.from('card-images').getPublicUrl(path);
    setDraft(d => ({ ...d, title_image: data.publicUrl }));
  }

  useEffect(() => {
    setDraft(settings);
    setPrice(settings.asking_price != null ? String(settings.asking_price) : '');
    setMinOffer(settings.min_offer != null ? String(settings.min_offer) : '');
  }, [settings]);

  const publicPath = handle ? `/seller/${encodeURIComponent(handle)}/set/${encodeURIComponent(slug)}` : null;
  const publicUrl = publicPath && typeof window !== 'undefined' ? `${window.location.origin}${publicPath}` : publicPath;

  async function save(next: ShowcaseSettings) {
    setSaving(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.from('sets').update({
      public_enabled: next.public_enabled,
      description: next.description?.trim() || null,
      asking_price: next.asking_price,
      accept_offers: next.accept_offers,
      min_offer: next.min_offer,
      show_card_values: next.show_card_values,
      key_cards: next.key_cards.filter(k => k.card.trim()),
      condition_notes: next.condition_notes?.trim() || null,
      sale_terms: next.sale_terms?.trim() || null,
      title_image: next.title_image || null,
    }).eq('user_id', userId).eq('slug', slug);
    setSaving(false);
    if (error) {
      setMsg(`Couldn't save: ${error.message}`);
      return false;
    }
    onSaved(next);
    setMsg('Saved');
    setTimeout(() => setMsg(null), 2500);
    return true;
  }

  function saveAll() {
    const p = toNum(price);
    const m = toNum(minOffer);
    if (m !== null && p !== null && m > p) {
      setMsg('The minimum offer is higher than the price.');
      return;
    }
    save({ ...draft, asking_price: p, min_offer: m });
  }

  async function togglePublic() {
    // Saves any edits in the form along with the switch, so nothing typed is
    // lost when the saved settings flow back in.
    const next = { ...draft, asking_price: toNum(price), min_offer: toNum(minOffer), public_enabled: !draft.public_enabled };
    setDraft(next);
    await save(next);
  }

  async function copyLink() {
    if (!publicUrl) return;
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  }

  const setKey = (i: number, patch: Partial<KeyCardNote>) =>
    setDraft(d => ({ ...d, key_cards: d.key_cards.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));

  const label: React.CSSProperties = { display: 'block', marginTop: 12 };

  return (
    <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 20, background: 'var(--paper)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="display" style={{ fontSize: 15, color: 'var(--plum)' }}>🌐 Public Page &amp; Sale Settings</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: handle ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, color: draft.public_enabled ? 'var(--teal)' : 'var(--ink-mute)' }}>
          <input type="checkbox" checked={draft.public_enabled} disabled={!handle || saving} onChange={togglePublic} />
          {draft.public_enabled ? 'Public: anyone with the link can view' : 'Private'}
        </label>
        {draft.public_enabled && publicPath && (
          <>
            <a href={publicPath} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">View public page ↗</a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>{copied ? 'Copied!' : 'Copy link'}</button>
          </>
        )}
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide settings ▲' : 'Edit description & price ▼'}
        </button>
      </div>
      {!handle && (
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--rust)', marginTop: 8 }}>
          Your profile needs a handle before this set can have a public link.
        </div>
      )}
      {draft.public_enabled && publicUrl && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 6, wordBreak: 'break-all' }}>{publicUrl}</div>
      )}

      {open && (
        <div style={{ marginTop: 10 }}>
          <label className="input-label" style={label}>Title image (shown beside the set&apos;s name)</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            {draft.title_image ? (
              <Thumb url={draft.title_image} width={240} alt="Title image"
                style={{ width: 64, height: 88, objectFit: 'cover', borderRadius: 6, border: '2px solid var(--plum)' }} />
            ) : (
              <div style={{ width: 64, height: 88, borderRadius: 6, border: '2px dashed var(--rule)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--ink-mute)' }}>None</div>
            )}
            <label className="btn btn-outline btn-sm" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
              {uploading ? 'Uploading…' : 'Upload image'}
              <input type="file" accept="image/*" hidden disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadTitleImage(f); }} />
            </label>
            <select className="input-sc" value="" onChange={e => { const v = e.target.value; if (v) setDraft(d => ({ ...d, title_image: v })); }}
              style={{ flex: '0 1 260px' }}>
              <option value="">…or use a card&apos;s photo</option>
              {cardOptions.filter(o => o.imageFront).map(o => <option key={o.cardNumber} value={o.imageFront!}>{o.label}</option>)}
            </select>
            {draft.title_image && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(d => ({ ...d, title_image: null }))}>Remove</button>
            )}
          </div>

          <label className="input-label" style={label}>Set description</label>
          <textarea className="input-sc" rows={5} value={draft.description || ''} placeholder="Tell buyers about the set: its history, the key cards, how you put it together, centering, eye appeal…"
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label className="input-label" style={label}>Price (USD)</label>
              <input className="input-sc" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="Leave blank to show no price" />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label className="input-label" style={label}>
                <input type="checkbox" checked={draft.accept_offers} onChange={e => setDraft(d => ({ ...d, accept_offers: e.target.checked }))} style={{ marginRight: 6 }} />
                Accept offers
              </label>
              <input className="input-sc" inputMode="decimal" value={minOffer} onChange={e => setMinOffer(e.target.value)} disabled={!draft.accept_offers}
                placeholder="Secret minimum offer (optional)" />
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 4 }}>
                Private: buyers never see it. Offers below it are declined automatically.
              </div>
            </div>
          </div>

          <label style={{ ...label, fontSize: 13, color: 'var(--ink-soft)' }}>
            <input type="checkbox" checked={draft.show_card_values} onChange={e => setDraft(d => ({ ...d, show_card_values: e.target.checked }))} style={{ marginRight: 6 }} />
            Show each card&apos;s value in the full checklist and key cards (the set total, movers and top 16 always show values)
          </label>

          <label className="input-label" style={label}>Key cards</label>
          {draft.key_cards.map((k, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <select className="input-sc" value={k.card} onChange={e => setKey(i, { card: e.target.value })} style={{ flex: '0 1 260px' }}>
                <option value="">Pick a card…</option>
                {cardOptions.map(o => <option key={o.cardNumber} value={o.cardNumber}>{o.label}</option>)}
              </select>
              <input className="input-sc" value={k.note} onChange={e => setKey(i, { note: e.target.value })} maxLength={300}
                placeholder="Why it matters, e.g. rookie card, short print, great centering" style={{ flex: '1 1 240px' }} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(d => ({ ...d, key_cards: d.key_cards.filter((_, j) => j !== i) }))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }}
            onClick={() => setDraft(d => ({ ...d, key_cards: [...d.key_cards, { card: '', note: '' }] }))}>＋ Add key card</button>

          <label className="input-label" style={label}>Condition notes</label>
          <textarea className="input-sc" rows={3} value={draft.condition_notes || ''} placeholder="e.g. Most cards VG-EX with typical Bowman edge chipping; #184 has a light crease"
            onChange={e => setDraft(d => ({ ...d, condition_notes: e.target.value }))} />

          <label className="input-label" style={label}>Shipping &amp; payment terms</label>
          <textarea className="input-sc" rows={3} value={draft.sale_terms || ''} placeholder="e.g. Ships insured in a binder within 2 business days. PayPal G&S or Venmo."
            onChange={e => setDraft(d => ({ ...d, sale_terms: e.target.value }))} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            {toNum(price) !== null && <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>Price {fmtMoney(toNum(price)!)}</span>}
            {msg && <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: msg === 'Saved' ? 'var(--teal)' : 'var(--rust)' }}>{msg}</span>}
          </div>
        </div>
      )}
      {!open && msg && <div className="mono" style={{ fontSize: 12, fontWeight: 700, marginTop: 6, color: msg === 'Saved' ? 'var(--teal)' : 'var(--rust)' }}>{msg}</div>}
    </section>
  );
}
