'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Listing = {
  id: string;
  title: string;
  description: string | null;
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
};

type Template = {
  id: string;
  name: string;
  post_header: string;
  post_footer: string;
  lot_template: string;
  is_default: boolean;
};

type Group = { id: string; name: string; url: string | null };

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function conditionNote(l: Listing): string {
  if (l.condition_type === 'graded' && l.grading_company && l.grade) {
    return `${l.grading_company} ${l.grade}`;
  }
  if (l.condition_type === 'raw' && l.raw_grade) {
    return l.raw_grade;
  }
  return '';
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

async function buildSideBySide(frontUrl: string, backUrl: string | null): Promise<Blob | null> {
  try {
    const front = await loadImage(frontUrl);
    const back = backUrl ? await loadImage(backUrl).catch(() => null) : null;
    const gap = back ? 20 : 0;
    const w = front.naturalWidth + (back ? back.naturalWidth + gap : 0);
    const h = Math.max(front.naturalHeight, back?.naturalHeight || 0);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(front, 0, (h - front.naturalHeight) / 2);
    if (back) ctx.drawImage(back, front.naturalWidth + gap, (h - back.naturalHeight) / 2);
    return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.95));
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function NewFbAuctionPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  const [title, setTitle] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupUrl, setGroupUrl] = useState('');
  const [showAddGroup, setShowAddGroup] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generated, setGenerated] = useState<{ auctionId: string; lots: Array<{ id: string; lot_number: number; listing: Listing; text: string; }> } | null>(null);
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyImage, setBusyImage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const [listingsRes, templatesRes, groupsRes] = await Promise.all([
        supabase.from('listings').select('id, title, description, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, asking_price, photos, status').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false }),
        supabase.from('fb_auction_templates').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
        supabase.from('fb_groups').select('id, name, url').eq('user_id', user.id).order('name'),
      ]);
      setListings((listingsRes.data || []) as Listing[]);
      setTemplates((templatesRes.data || []) as Template[]);
      setGroups((groupsRes.data || []) as Group[]);
      const def = (templatesRes.data || []).find((t: Template) => t.is_default);
      if (def) setTemplateId(def.id);
      else if (templatesRes.data && templatesRes.data.length > 0) setTemplateId(templatesRes.data[0].id);
      setLoading(false);
    }
    load();
  }, [router]);

  const filteredListings = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return listings;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return listings.filter(l => {
      const hay = [l.title, l.player, l.brand, l.card_number, l.year ? String(l.year) : '', l.description, l.raw_grade, l.grading_company, l.grade].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [listings, searchQuery]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function addGroup() {
    if (!groupName.trim() || !userId) return;
    const supabase = createClient();
    const { data, error } = await supabase.from('fb_groups').insert({
      user_id: userId, name: groupName.trim(), url: groupUrl.trim() || null,
    }).select().single();
    if (error) { alert(error.message); return; }
    setGroups(prev => [...prev, data as Group].sort((a, b) => a.name.localeCompare(b.name)));
    setGroupId(data.id);
    setGroupName('');
    setGroupUrl('');
    setShowAddGroup(false);
  }

  const selectedListings: Listing[] = useMemo(
    () => selectedIds.map(id => listings.find(l => l.id === id)).filter(Boolean) as Listing[],
    [selectedIds, listings]
  );

  const canGenerate = title.trim() && templateId && selectedListings.length > 0;

  async function handleGenerate() {
    if (!canGenerate || !userId) return;
    const t = templates.find(x => x.id === templateId);
    if (!t) return;
    setSaving(true);

    const headerVars = {
      auction_title: title.trim(),
      lot_count: String(selectedListings.length),
      ends_at: endsAt ? new Date(endsAt).toLocaleString() : '',
    };
    const header = substitute(t.post_header, headerVars);
    const footer = substitute(t.post_footer, headerVars);

    const supabase = createClient();
    const { data: auc, error: aucErr } = await supabase.from('fb_auctions').insert({
      user_id: userId,
      title: title.trim(),
      group_id: groupId || null,
      template_id: t.id,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      status: 'draft',
    }).select().single();
    if (aucErr || !auc) { alert(aucErr?.message || 'Failed to create auction'); setSaving(false); return; }

    const lotRows = selectedListings.map((l, idx) => ({
      auction_id: auc.id,
      user_id: userId,
      listing_id: l.id,
      lot_number: idx + 1,
      starting_bid: l.asking_price,
      status: 'open',
    }));
    const { data: insertedLots, error: lotsErr } = await supabase.from('fb_auction_lots').insert(lotRows).select();
    if (lotsErr) { alert(lotsErr.message); setSaving(false); return; }

    const lots = selectedListings.map((l, idx) => {
      const inserted = (insertedLots || []).find((x: { lot_number: number }) => x.lot_number === idx + 1);
      const lotVars: Record<string, string> = {
        lot_number: String(idx + 1),
        year: l.year ? String(l.year) : '',
        brand: l.brand || '',
        player: l.player || '',
        card_number: l.card_number || '',
        title: l.title || '',
        grade: l.grade || '',
        grading_company: l.grading_company || '',
        raw_grade: l.raw_grade || '',
        condition_note: conditionNote(l),
        starting_bid: l.asking_price !== null && l.asking_price !== undefined ? String(l.asking_price) : '',
        description: l.description || '',
      };
      return {
        id: (inserted?.id as string) || '',
        lot_number: idx + 1,
        listing: l,
        text: substitute(t.lot_template, lotVars),
      };
    });

    setHeaderText(header);
    setFooterText(footer);
    setGenerated({ auctionId: auc.id, lots });
    setSaving(false);
  }

  async function handleDownloadImage(lot: { lot_number: number; listing: Listing }) {
    const photos = lot.listing.photos || [];
    const front = photos[0];
    const back = photos[1] || null;
    if (!front) { alert('No photo on this listing.'); return; }
    setBusyImage(lot.listing.id);
    const blob = back ? await buildSideBySide(front, back) : await fetch(front).then(r => r.blob()).catch(() => null);
    setBusyImage(null);
    if (!blob) { alert('Image generation failed (likely a CORS issue with the photo source).'); return; }
    const safe = `${lot.listing.year || 'card'}-${(lot.listing.player || 'player').replace(/[^a-z0-9]+/gi, '-')}-lot${lot.lot_number}.jpg`.toLowerCase();
    downloadBlob(blob, safe);
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  if (templates.length === 0) {
    return (
      <div style={{ minHeight: '100vh' }}>
        <Header />
        <div style={{ maxWidth: 720, margin: '60px auto', padding: '0 28px' }}>
          <div className="panel-bordered" style={{ padding: '40px 28px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No templates yet</div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 14, marginBottom: 18 }}>
              You need at least one auction template before you can create an auction.
            </p>
            <Link href="/fb-auctions/templates" className="btn btn-primary">Create your first template →</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <Header />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>

        {!generated && (
          <>
            <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
              <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
              <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
                <li>Set the auction title and pick the template + Facebook group you&apos;re posting in.</li>
                <li>Select the listings you want to auction. Order = selection order (lot 1 is the first you tick).</li>
                <li>Click <strong>Generate Auction</strong>. You&apos;ll get a copy-ready post header, copy-ready per-lot text blocks, and a downloadable side-by-side image (front + back) for each lot.</li>
                <li>Paste the post into your FB group, then paste each lot as a comment with the matching image attached.</li>
                <li>Once posted, drop the FB post URL into the manage page so you can track bids and settle winners.</li>
              </ol>
            </section>

            <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 14 }}>1. Setup</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <div>
                  <label className="input-label">Auction Title *</label>
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. 1971 Topps Mixed HOFers" className="input-sc" style={{ width: '100%' }} />
                </div>
                <div>
                  <label className="input-label">Template *</label>
                  <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="input-sc" style={{ width: '100%' }}>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' ★' : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="input-label">Facebook Group</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={groupId} onChange={e => setGroupId(e.target.value)} className="input-sc" style={{ flex: 1 }}>
                      <option value="">— none —</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <button onClick={() => setShowAddGroup(s => !s)} className="btn btn-ghost btn-sm" type="button">+</button>
                  </div>
                  {showAddGroup && (
                    <div style={{ marginTop: 8, padding: 10, background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" className="input-sc" />
                      <input value={groupUrl} onChange={e => setGroupUrl(e.target.value)} placeholder="Group URL (optional)" className="input-sc" />
                      <button onClick={addGroup} className="btn btn-primary btn-sm" disabled={!groupName.trim()}>Add Group</button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="input-label">Ends At (optional)</label>
                  <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="input-sc" style={{ width: '100%' }} />
                </div>
              </div>
            </section>

            <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
                <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>2. Pick Listings ({selectedIds.length} selected)</div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                  border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
                  flex: 1, minWidth: 240, maxWidth: 420,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--plum)', fontWeight: 700 }}>🔍</span>
                  <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search active listings — multi-term"
                    style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: 12.5, flex: 1, color: 'var(--plum)' }} />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', border: 'none', color: 'var(--plum)', cursor: 'pointer', fontSize: 14 }}>×</button>
                  )}
                </div>
              </div>

              {filteredListings.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                  {listings.length === 0 ? 'You have no active listings. Create one first.' : 'No listings match your search.'}
                </div>
              ) : (
                <div style={{ maxHeight: 480, overflowY: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--plum)', color: 'var(--mustard)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      <tr>
                        <th style={{ padding: '8px 12px', textAlign: 'left', width: 36 }}></th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', width: 64 }}>Lot</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', width: 64 }}>Photo</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>Listing</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', width: 100 }}>Asking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredListings.map(l => {
                        const lotIdx = selectedIds.indexOf(l.id);
                        const isSel = lotIdx !== -1;
                        return (
                          <tr key={l.id} onClick={() => toggleSelect(l.id)}
                            style={{ borderTop: '1px solid var(--rule)', cursor: 'pointer', background: isSel ? 'rgba(184,146,58,0.18)' : 'transparent' }}>
                            <td style={{ padding: '8px 12px' }}>
                              <input type="checkbox" checked={isSel} onChange={() => toggleSelect(l.id)} style={{ accentColor: 'var(--plum)' }} />
                            </td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--plum)', fontWeight: 700 }}>
                              {isSel ? `#${lotIdx + 1}` : ''}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              {l.photos && l.photos[0] ? (
                                <img src={l.photos[0]} alt="" style={{ width: 40, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--plum)' }} />
                              ) : <span style={{ fontSize: 9, color: 'var(--ink-mute)' }}>—</span>}
                            </td>
                            <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--plum)' }}>
                              <div style={{ fontWeight: 600 }}>{l.title}</div>
                              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
                                {l.year} {l.brand} #{l.card_number} {conditionNote(l) ? '· ' + conditionNote(l) : ''}
                              </div>
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13, color: 'var(--orange)', fontWeight: 700 }}>
                              {l.asking_price !== null && l.asking_price !== undefined ? `$${l.asking_price}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={handleGenerate} disabled={!canGenerate || saving} className="btn btn-primary">
                {saving ? 'Generating…' : `Generate Auction (${selectedIds.length} lot${selectedIds.length === 1 ? '' : 's'})`}
              </button>
            </div>
          </>
        )}

        {generated && (
          <>
            <div style={{ padding: '14px 18px', marginBottom: 24, background: 'rgba(56,142,142,0.12)', border: '1.5px solid var(--teal)', borderRadius: 10, fontSize: 13, color: 'var(--teal)', fontWeight: 700 }}>
              ✓ Auction created with {generated.lots.length} lot{generated.lots.length === 1 ? '' : 's'}. Copy each block below into Facebook and attach the matching image.
            </div>

            <CopyBlock label="📋 Post Body (paste this as the Facebook post)" text={headerText} />

            <div style={{ marginTop: 24, marginBottom: 12 }}>
              <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>Lots — paste each as a comment with the image attached</div>
            </div>

            {generated.lots.map(lot => (
              <div key={lot.lot_number} className="panel-bordered" style={{ padding: 18, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{
                    width: 64, height: 64, flexShrink: 0,
                    background: 'var(--plum)', color: 'var(--mustard)',
                    display: 'grid', placeItems: 'center', borderRadius: 8,
                    fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
                  }}>
                    #{lot.lot_number}
                  </div>
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div className="display" style={{ fontSize: 15, color: 'var(--plum)', marginBottom: 4 }}>{lot.listing.title}</div>
                    <pre style={{
                      background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
                      padding: '10px 12px', fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--plum)',
                      whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: '0 0 8px',
                    }}>{lot.text}</pre>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <CopyButton text={lot.text} label="📋 Copy lot text" />
                      <button onClick={() => handleDownloadImage(lot)} disabled={busyImage === lot.listing.id || !lot.listing.photos?.[0]}
                        className="btn btn-outline btn-sm">
                        {busyImage === lot.listing.id ? 'Building…' : '🖼 Download image'}
                      </button>
                      {lot.listing.photos?.length === 0 && (
                        <span style={{ fontSize: 11, color: 'var(--rust)', fontWeight: 700, alignSelf: 'center' }}>No photos on this listing</span>
                      )}
                      {lot.listing.photos?.length === 1 && (
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)', alignSelf: 'center' }}>(only 1 photo — front-only download)</span>
                      )}
                    </div>
                  </div>
                  {lot.listing.photos?.[0] && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <img src={lot.listing.photos[0]} alt="Front" style={{ width: 72, height: 100, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--plum)' }} />
                      {lot.listing.photos[1] && (
                        <img src={lot.listing.photos[1]} alt="Back" style={{ width: 72, height: 100, objectFit: 'cover', borderRadius: 6, border: '1.5px solid var(--plum)' }} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            <CopyBlock label="📋 Post Footer (paste at the end of your post, or as a final pinned comment)" text={footerText} />

            <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setGenerated(null); setSelectedIds([]); setTitle(''); setEndsAt(''); }} className="btn btn-outline">
                ← New auction
              </button>
              <Link href="/fb-auctions" className="btn btn-primary">View all auctions →</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
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
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ New FB Auction ★</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/fb-auctions/templates" className="btn btn-ghost btn-sm">Templates</Link>
          <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
          <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
        </div>
      </div>
    </header>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="panel-bordered" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 8 }}>{label}</div>
      <pre style={{
        background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 6,
        padding: '12px 14px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--plum)',
        whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: '0 0 8px',
      }}>{text}</pre>
      <CopyButton text={text} label="📋 Copy" />
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => {
      const ok = await copyText(text);
      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
      else alert('Copy failed — please select and copy manually.');
    }} className="btn btn-primary btn-sm">
      {copied ? '✓ Copied' : label}
    </button>
  );
}
