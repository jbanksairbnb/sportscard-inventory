'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import MarketResearchModal, { CardDescriptor } from '@/components/MarketResearchModal';

type Listing = {
  id: string;
  title: string;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: 'raw' | 'graded';
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  photos: string[];
  status: string;
  source_set_slug: string | null;
  source_card_number: string | null;
};

type Group = { id: string; name: string; url: string | null };
type Template = { id: string; name: string; template_type: string | null; post_header: string; post_footer: string | null };

type LotDraft = {
  id: string;                       // local-only ID
  kind: 'single' | 'group';
  pricing: 'per_item' | 'group';
  listingIds: (string | null)[];    // length 1 for single, 1..6 for group
  itemPrices: (number | null)[];    // parallel to listingIds when pricing=per_item
  groupPrice: number | null;
  collageUrl: string;       // fronts collage
  backCollageUrl: string;   // backs collage
  commentBody: string;
  commentTouched: boolean;
};

function shortId() { return Math.random().toString(36).slice(2, 9); }

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function listingLabel(l: Listing | undefined | null): string {
  if (!l) return '— pick a listing —';
  const cond = l.condition_type === 'graded'
    ? `${l.grading_company || ''} ${l.grade || ''}`.trim()
    : (l.raw_grade || '');
  return [l.year, l.brand, l.card_number ? `#${l.card_number}` : '', l.player, cond].filter(Boolean).join(' ');
}

function buildCommentBody(
  lot: LotDraft,
  listings: Listing[],
  lotNumber: number,
): string {
  const get = (id: string | null) => listings.find(l => l.id === id) || null;
  if (lot.kind === 'single') {
    const l = get(lot.listingIds[0] || null);
    if (!l) return '';
    const price = lot.pricing === 'per_item' ? lot.itemPrices[0] : lot.groupPrice;
    const priceStr = price ? ` — ${fmtMoney(price)}` : '';
    return `${String(lotNumber).padStart(2, '0')} — ${listingLabel(l)}${priceStr}`;
  }
  // group
  const lines: string[] = [];
  for (let i = 0; i < lot.listingIds.length; i++) {
    const l = get(lot.listingIds[i]);
    if (!l) continue;
    const pos = i + 1;
    const price = lot.pricing === 'per_item' ? lot.itemPrices[i] : null;
    const priceStr = price ? ` — ${fmtMoney(price)}` : '';
    lines.push(`${pos}. ${listingLabel(l)}${priceStr}`);
  }
  if (lot.pricing === 'group' && lot.groupPrice) {
    lines.push('', `Group price: ${fmtMoney(lot.groupPrice)} each`);
  }
  return lines.join('\n');
}

function buildPostBody(title: string, lots: LotDraft[], paymentText: string, shippingText: string, footer: string): string {
  const lines = [
    `*** ${title || 'Claim Sale'} ***`,
    '',
    `${lots.length} lot${lots.length === 1 ? '' : 's'} below in the comments — claim by lot # and (for group lots) position.`,
    '',
  ];
  if (shippingText.trim()) lines.push(shippingText.trim(), '');
  if (paymentText.trim()) lines.push(paymentText.trim(), '');
  if (footer.trim()) lines.push(footer.trim());
  return lines.join('\n').trim();
}

export default function NewClaimSalePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [listings, setListings] = useState<Listing[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [research, setResearch] = useState<{ descriptor: CardDescriptor; apply: (value: number) => void } | null>(null);

  // Sale-level
  const [title, setTitle] = useState('');
  const [groupId, setGroupId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [paymentText, setPaymentText] = useState('PayPal F&F: your-paypal@email.com\nVenmo: @your-venmo');
  const [shippingText, setShippingText] = useState('U.S. shipping $5. Combined shipping on multiple lots.');
  const [defaultShipping, setDefaultShipping] = useState<number>(5);
  const [endsAt, setEndsAt] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postBodyTouched, setPostBodyTouched] = useState(false);

  const [lots, setLots] = useState<LotDraft[]>([]);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const [listRes, grpRes, tmplRes] = await Promise.all([
        supabase.from('listings')
          .select('id, title, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, asking_price, photos, status, source_set_slug, source_card_number')
          .eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false }),
        supabase.from('fb_groups').select('id, name, url').eq('user_id', user.id).order('name'),
        supabase.from('fb_auction_templates').select('id, name, template_type, post_header, post_footer').eq('user_id', user.id),
      ]);
      setListings((listRes.data || []) as Listing[]);
      setGroups((grpRes.data || []) as Group[]);
      setTemplates((tmplRes.data || []) as Template[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const claimTemplates = useMemo(() => templates.filter(t => (t.template_type || 'multi') === 'claim'), [templates]);
  const fallbackTemplate = useMemo(() => templates.find(t => (t.template_type || 'multi') === 'multi'), [templates]);
  const activeTemplate = templates.find(t => t.id === templateId) || (claimTemplates[0] || fallbackTemplate);

  // Auto-fill post body when inputs change unless the user has touched it.
  useEffect(() => {
    if (postBodyTouched) return;
    setPostBody(buildPostBody(title, lots, paymentText, shippingText, activeTemplate?.post_footer || ''));
  }, [title, lots, paymentText, shippingText, activeTemplate, postBodyTouched]);

  function addLot(kind: 'single' | 'group') {
    setLots(prev => [...prev, {
      id: shortId(),
      kind,
      pricing: 'per_item',
      listingIds: kind === 'single' ? [null] : Array(6).fill(null),
      itemPrices: kind === 'single' ? [null] : Array(6).fill(null),
      groupPrice: null,
      collageUrl: '',
      backCollageUrl: '',
      commentBody: '',
      commentTouched: false,
    }]);
  }

  function patchLot(id: string, patch: Partial<LotDraft>) {
    setLots(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }
  function removeLot(id: string) {
    setLots(prev => prev.filter(l => l.id !== id));
  }
  function moveLot(id: string, dir: -1 | 1) {
    setLots(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  // Re-derive each lot's commentBody whenever inputs change unless user touched it
  useEffect(() => {
    setLots(prev => prev.map((l, i) => l.commentTouched ? l : ({ ...l, commentBody: buildCommentBody(l, listings, i + 1) })));
  }, [listings, lots.map(l => `${l.id}:${l.kind}:${l.pricing}:${l.listingIds.join(',')}:${l.itemPrices.join(',')}:${l.groupPrice}`).join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate() {
    setError('');
    if (!title.trim()) { setError('Title is required.'); return; }
    if (lots.length === 0) { setError('Add at least one lot.'); return; }
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      const filled = lot.listingIds.filter(Boolean);
      if (filled.length === 0) { setError(`Lot ${i + 1}: pick at least one listing.`); return; }
      if (lot.kind === 'single' && filled.length !== 1) { setError(`Lot ${i + 1}: single lots have exactly one card.`); return; }
      if (lot.pricing === 'per_item') {
        for (let j = 0; j < lot.listingIds.length; j++) {
          if (lot.listingIds[j] && (lot.itemPrices[j] == null || isNaN(lot.itemPrices[j] as number))) {
            setError(`Lot ${i + 1}: per-item pricing — set a price for position ${j + 1}.`); return;
          }
        }
      } else {
        if (lot.groupPrice == null || isNaN(lot.groupPrice)) {
          setError(`Lot ${i + 1}: group pricing — set a single group price.`); return;
        }
      }
    }
    setSaving(true);
    const supabase = createClient();
    // Insert sale
    const { data: saleData, error: sErr } = await supabase
      .from('fb_claim_sales')
      .insert({
        user_id: userId,
        title: title.trim(),
        status: 'draft',
        post_body: postBody,
        group_id: groupId || null,
        template_id: templateId || null,
        payment_text: paymentText,
        shipping_text: shippingText,
        default_shipping_cost: defaultShipping,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      })
      .select()
      .single();
    if (sErr || !saleData) { setError(sErr?.message || 'Failed to create sale'); setSaving(false); return; }
    const saleId = saleData.id;

    // Insert lots + items
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      const { data: lotData, error: lErr } = await supabase
        .from('fb_claim_sale_lots')
        .insert({
          sale_id: saleId, user_id: userId,
          lot_number: i + 1,
          kind: lot.kind,
          comment_body: lot.commentBody,
          collage_url: lot.collageUrl.trim() || null,
          back_collage_url: lot.backCollageUrl.trim() || null,
          group_price: lot.pricing === 'group' ? lot.groupPrice : null,
        })
        .select().single();
      if (lErr || !lotData) { setError(lErr?.message || 'Lot insert failed'); setSaving(false); return; }
      const itemRows = lot.listingIds
        .map((listingId, pos) => ({ listingId, pos: pos + 1, price: lot.pricing === 'per_item' ? lot.itemPrices[pos] : null }))
        .filter(r => !!r.listingId)
        .map(r => ({
          lot_id: lotData.id, user_id: userId,
          position: r.pos, listing_id: r.listingId,
          price: r.price ?? (lot.pricing === 'group' ? lot.groupPrice : null),
          claim_status: 'open',
        }));
      if (itemRows.length > 0) {
        const { error: iErr } = await supabase.from('fb_claim_sale_items').insert(itemRows);
        if (iErr) { setError(iErr.message); setSaving(false); return; }
      }
    }

    setSaving(false);
    router.push(`/fb-claim-sales/${saleId}`);
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ New Claim Sale ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-claim-sales" className="btn btn-ghost btn-sm">All Claim Sales</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/sales-metrics" className="btn btn-ghost btn-sm">📊 Metrics</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', marginBottom: 14 }}>Sale info</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="Sale title">
              <input value={title} onChange={e => setTitle(e.target.value)} className="input-sc" style={{ width: '100%' }} placeholder="Wacky Wednesday Claim Sale" />
            </Field>
            <Field label="FB Group (optional)">
              <select value={groupId} onChange={e => setGroupId(e.target.value)} className="input-sc" style={{ width: '100%' }}>
                <option value="">— none —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Template (optional)">
              <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="input-sc" style={{ width: '100%' }}>
                <option value="">— default —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.template_type ? ` · ${t.template_type}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Default shipping">
              <input type="number" step="0.01" value={defaultShipping} onChange={e => setDefaultShipping(Number(e.target.value) || 0)} className="input-sc" style={{ width: '100%' }} />
            </Field>
            <Field label="Ends at (optional)">
              <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="input-sc" style={{ width: '100%' }} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Field label="Shipping note (in post)">
              <textarea value={shippingText} onChange={e => setShippingText(e.target.value)} rows={2} className="input-sc" style={{ width: '100%', resize: 'vertical' }} />
            </Field>
            <Field label="Payment note (in post)">
              <textarea value={paymentText} onChange={e => setPaymentText(e.target.value)} rows={2} className="input-sc" style={{ width: '100%', resize: 'vertical' }} />
            </Field>
          </div>
        </section>

        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="display" style={{ fontSize: 17, color: 'var(--plum)' }}>Lots ({lots.length})</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => addLot('single')} className="btn btn-ghost btn-sm">+ Single card</button>
              <button onClick={() => addLot('group')} className="btn btn-primary btn-sm">+ Group lot (up to 6)</button>
            </div>
          </div>
          {lots.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
              Add a lot to start. Each lot becomes one comment under your FB post.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {lots.map((lot, i) => {
                const usedInOtherLots = new Set<string>();
                for (const ol of lots) {
                  if (ol.id === lot.id) continue;
                  for (const id of ol.listingIds) if (id) usedInOtherLots.add(id);
                }
                return (
                  <LotEditor key={lot.id} onResearch={(descriptor, apply) => setResearch({ descriptor, apply })}
                    lot={lot}
                    index={i}
                    isLast={i === lots.length - 1}
                    listings={listings}
                    usedInOtherLots={usedInOtherLots}
                    onPatch={patch => patchLot(lot.id, patch)}
                    onRemove={() => removeLot(lot.id)}
                    onMove={dir => moveLot(lot.id, dir)} />
                );
              })}
            </div>
          )}
          {lots.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1.5px dashed var(--rule)' }}>
              <button onClick={() => addLot('single')} className="btn btn-ghost btn-sm">+ Single card</button>
              <button onClick={() => addLot('group')} className="btn btn-primary btn-sm">+ Group lot (up to 6)</button>
            </div>
          )}
        </section>

        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', marginBottom: 10 }}>Parent post</div>
          <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 }}>Auto-generated. Edits stick.</div>
          <textarea value={postBody}
            onChange={e => { setPostBody(e.target.value); setPostBodyTouched(true); }}
            rows={10} className="input-sc"
            style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12.5 }} />
          {postBodyTouched && (
            <button onClick={() => { setPostBodyTouched(false); }} className="btn btn-ghost btn-sm" style={{ marginTop: 6 }}>↺ Reset to auto</button>
          )}
        </section>

        {error && (
          <div style={{ padding: '10px 12px', background: 'rgba(192,57,43,0.12)', border: '1.5px solid var(--rust)', borderRadius: 8, color: 'var(--rust)', fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Link href="/fb-claim-sales" className="btn btn-ghost">Cancel</Link>
          <button onClick={handleGenerate} disabled={saving} className="btn btn-primary">
            {saving ? 'Generating…' : 'Generate & Manage →'}
          </button>
        </div>
      </div>
      <MarketResearchModal
        open={!!research}
        onClose={() => setResearch(null)}
        card={research?.descriptor || { year: null, brand: null, card_number: null, player: null, grade: null, grading_company: null, raw_grade: null }}
        onApply={(value) => { research?.apply(value); }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

function LotEditor({ lot, index, isLast, listings, usedInOtherLots, onPatch, onRemove, onMove, onResearch }: {
  lot: LotDraft;
  index: number;
  isLast: boolean;
  listings: Listing[];
  usedInOtherLots: Set<string>;
  onPatch: (patch: Partial<LotDraft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onResearch: (descriptor: CardDescriptor, apply: (v: number) => void) => void;
}) {
  // Sorted by year desc → card # natural asc → player asc.
  const sortedListings = React.useMemo(() => {
    return [...listings].sort((a, b) => {
      const yA = a.year || 0, yB = b.year || 0;
      if (yA !== yB) return yB - yA;
      const cmp = (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
      if (cmp !== 0) return cmp;
      return (a.player || '').localeCompare(b.player || '');
    });
  }, [listings]);
  function optionsForSlot(slotPos: number): Listing[] {
    const currentId = lot.listingIds[slotPos] || null;
    return sortedListings.filter(l => {
      if (currentId === l.id) return true;
      if (usedInOtherLots.has(l.id)) return false;
      // Skip listings already used in another slot of THIS lot.
      if (lot.listingIds.some((id, i) => id === l.id && i !== slotPos)) return false;
      return true;
    });
  }
  function descriptorFromListing(id: string | null): CardDescriptor {
    const l = id ? listings.find(x => x.id === id) : null;
    return {
      year: l?.year ?? null,
      brand: l?.brand ?? null,
      card_number: l?.card_number ?? null,
      player: l?.player ?? null,
      grade: l?.grade ?? null,
      grading_company: l?.grading_company ?? null,
      raw_grade: l?.raw_grade ?? null,
      listing_id: l?.id ?? null,
    };
  }
  function setListingAt(pos: number, id: string) {
    const next = [...lot.listingIds];
    next[pos] = id || null;
    onPatch({ listingIds: next });
  }
  function setPriceAt(pos: number, val: string) {
    const next = [...lot.itemPrices];
    next[pos] = val === '' ? null : Number(val.replace(/[^0-9.]/g, '')) || null;
    onPatch({ itemPrices: next });
  }
  function setGroupSize(n: number) {
    const next = [...lot.listingIds];
    const prices = [...lot.itemPrices];
    while (next.length < n) { next.push(null); prices.push(null); }
    while (next.length > n) { next.pop(); prices.pop(); }
    onPatch({ listingIds: next, itemPrices: prices });
  }
  return (
    <div className="panel" style={{ padding: 16, border: '1.5px solid var(--rule)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, background: 'var(--plum)', color: 'var(--mustard)',
          display: 'grid', placeItems: 'center', borderRadius: 8,
          fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
        }}>#{index + 1}</div>
        <div className="display" style={{ fontSize: 14, color: 'var(--plum)', flex: 1 }}>
          {lot.kind === 'single' ? 'Single card lot' : `Group lot (${lot.listingIds.filter(Boolean).length}/${lot.listingIds.length})`}
        </div>
        <button onClick={() => onMove(-1)} disabled={index === 0} className="btn btn-ghost btn-sm" title="Move up">↑</button>
        <button onClick={() => onMove(1)} disabled={isLast} className="btn btn-ghost btn-sm" title="Move down">↓</button>
        <button onClick={onRemove} className="btn btn-ghost btn-sm" style={{ color: 'var(--rust)' }}>🗑 Remove</button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700 }}>Pricing</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
          <input type="radio" checked={lot.pricing === 'per_item'} onChange={() => onPatch({ pricing: 'per_item' })} />
          Per-item
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
          <input type="radio" checked={lot.pricing === 'group'} onChange={() => onPatch({ pricing: 'group' })} />
          Group price
        </label>
        {lot.pricing === 'group' && (
          <>
            <input type="number" step="0.01" placeholder="$"
              value={lot.groupPrice ?? ''}
              onChange={e => onPatch({ groupPrice: e.target.value === '' ? null : Number(e.target.value) || 0 })}
              className="input-sc" style={{ width: 100 }} />
            <button type="button" onClick={() => onResearch(descriptorFromListing(lot.listingIds[0] || null), v => onPatch({ groupPrice: Math.round(v * 100) / 100 }))}
              style={{ background: 'transparent', border: 0, color: 'var(--teal)', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
              📈 Research
            </button>
          </>
        )}
        {lot.kind === 'group' && (
          <>
            <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700, marginLeft: 12 }}>Slots</span>
            <select value={lot.listingIds.length} onChange={e => setGroupSize(Number(e.target.value))} className="input-sc" style={{ width: 80 }}>
              {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lot.listingIds.map((id, pos) => (
          <div key={pos} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {lot.kind === 'group' && (
              <div style={{
                width: 28, height: 28, background: 'var(--paper)', color: 'var(--plum)',
                border: '1.5px solid var(--plum)', borderRadius: 4,
                display: 'grid', placeItems: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
              }}>{pos + 1}</div>
            )}
            <select value={id || ''} onChange={e => setListingAt(pos, e.target.value)} className="input-sc" style={{ flex: 1 }}>
              <option value="">— pick a listing —</option>
              {optionsForSlot(pos).map(l => (
                <option key={l.id} value={l.id}>{listingLabel(l)}</option>
              ))}
            </select>
            {lot.pricing === 'per_item' && (
              <>
                <input type="number" step="0.01" placeholder="$"
                  value={lot.itemPrices[pos] ?? ''}
                  onChange={e => setPriceAt(pos, e.target.value)}
                  className="input-sc" style={{ width: 90 }} />
                <button type="button"
                  onClick={() => onResearch(descriptorFromListing(id),
                    v => setPriceAt(pos, (Math.round(v * 100) / 100).toString()))}
                  title="Research market price" aria-label="Research market price"
                  style={{ background: 'transparent', border: 0, color: 'var(--teal)', cursor: 'pointer', fontSize: 14, padding: 2 }}>📈</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>
          Comment text (auto-generated, editable)
        </div>
        <textarea value={lot.commentBody}
          onChange={e => onPatch({ commentBody: e.target.value, commentTouched: true })}
          rows={Math.max(3, lot.commentBody.split('\n').length + 1)}
          className="input-sc" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        {lot.commentTouched && (
          <button onClick={() => onPatch({ commentTouched: false })} className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}>↺ Reset to auto</button>
        )}
      </div>

    </div>
  );
}
