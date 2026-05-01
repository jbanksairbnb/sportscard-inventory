'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Template = {
  id: string;
  name: string;
  post_header: string;
  post_footer: string;
  lot_template: string;
  is_default: boolean;
  updated_at: string;
};

const DEFAULT_HEADER = `🌟🌟 Auction 🌟🌟
{auction_title}

Bidding rules:
- SB $1
- 24 Hour Rule (auction ends 24h after the last bid)
- Increments of $1`;

const DEFAULT_FOOTER = `Shipping: $1 PWE or $5 BMWT
PayPal F&F or Venmo
Thanks and good luck!`;

const DEFAULT_LOT = `{lot_number}. {year} {brand} #{card_number} {player}
{condition_note}
SB ${'${starting_bid}'}`;

const VARIABLES_HEADER_FOOTER = [
  { key: '{auction_title}', desc: 'The auction title you set when creating' },
  { key: '{lot_count}', desc: 'Total number of lots in this auction' },
  { key: '{ends_at}', desc: 'Scheduled end time' },
];

const VARIABLES_LOT = [
  { key: '{lot_number}', desc: 'Sequential number (1, 2, 3...)' },
  { key: '{year}', desc: 'Card year' },
  { key: '{brand}', desc: 'Brand (Topps, Bowman, etc.)' },
  { key: '{player}', desc: 'Player name' },
  { key: '{card_number}', desc: 'Card #' },
  { key: '{title}', desc: 'Full listing title' },
  { key: '{grade}', desc: 'Numeric grade (graded cards)' },
  { key: '{grading_company}', desc: 'PSA / SGC / BGS / etc.' },
  { key: '{raw_grade}', desc: 'Raw grade (NM, EX, etc.)' },
  { key: '{condition_note}', desc: 'Auto-formatted condition (graded or raw)' },
  { key: '{starting_bid}', desc: 'Asking price from listing' },
  { key: '{description}', desc: 'Listing description text' },
];

export default function FbTemplatesPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data } = await supabase
        .from('fb_auction_templates')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      setTemplates((data || []) as Template[]);
      setLoading(false);
    }
    load();
  }, [router]);

  function openNew() {
    setEditing({
      name: 'My Auction Template',
      post_header: DEFAULT_HEADER,
      post_footer: DEFAULT_FOOTER,
      lot_template: DEFAULT_LOT,
      is_default: templates.length === 0,
    });
  }

  function openEdit(t: Template) {
    setEditing({ ...t });
  }

  async function save() {
    if (!editing || !userId) return;
    if (!editing.name?.trim()) { alert('Name is required.'); return; }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      user_id: userId,
      name: editing.name.trim(),
      post_header: editing.post_header || '',
      post_footer: editing.post_footer || '',
      lot_template: editing.lot_template || '',
      is_default: !!editing.is_default,
      updated_at: new Date().toISOString(),
    };
    if (editing.is_default) {
      await supabase.from('fb_auction_templates').update({ is_default: false }).eq('user_id', userId);
    }
    if (editing.id) {
      await supabase.from('fb_auction_templates').update(payload).eq('id', editing.id);
    } else {
      await supabase.from('fb_auction_templates').insert(payload);
    }
    const { data } = await supabase
      .from('fb_auction_templates')
      .select('*').eq('user_id', userId).order('updated_at', { ascending: false });
    setTemplates((data || []) as Template[]);
    setEditing(null);
    setSaving(false);
  }

  async function remove(id: string) {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    const supabase = createClient();
    await supabase.from('fb_auction_templates').delete().eq('id', id);
    setTemplates(prev => prev.filter(t => t.id !== id));
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
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ FB Auction Templates ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li>Templates are reusable post text for your Facebook auctions. Save the boilerplate once — auction rules, shipping, payment info — and reuse for every auction.</li>
            <li>The <strong>Post header</strong> is the main auction announcement (top of the post). The <strong>Post footer</strong> goes after the lots (shipping/payment/signature). The <strong>Lot template</strong> is the per-card line for each comment.</li>
            <li>Use <span className="mono">{'{variables}'}</span> shown on the right — they get filled in automatically when you generate a post from your listings.</li>
            <li>Mark one template as <strong>★ Default</strong> and it&apos;ll auto-load when you start a new auction.</li>
          </ol>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)' }}>Your Templates</div>
          <button onClick={openNew} className="btn btn-primary btn-sm">+ New Template</button>
        </div>

        {templates.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)', marginBottom: 8 }}>No templates yet</div>
            <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Click <strong>+ New Template</strong> to create your first one.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {templates.map(t => (
              <div key={t.id} className="panel-bordered" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>
                    {t.name} {t.is_default && <span className="chip" style={{ fontSize: 9, background: 'var(--plum)', color: 'var(--mustard)', marginLeft: 6 }}>★ DEFAULT</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                    Updated {new Date(t.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => openEdit(t)} className="btn btn-ghost btn-sm">✎ Edit</button>
                <button onClick={() => remove(t.id)} className="btn btn-sm" style={{ background: 'transparent', color: 'var(--rust)', border: '1.5px solid var(--rust)' }}>🗑 Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div onClick={() => setEditing(null)} style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(42,20,52,0.82)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '40px 20px', overflowY: 'auto',
        }}>
          <div onClick={e => e.stopPropagation()} className="panel-bordered"
            style={{ width: '100%', maxWidth: 980, padding: 26, background: 'var(--cream)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>
                {editing.id ? 'Edit Template' : 'New Template'}
              </div>
              <button onClick={() => setEditing(null)} className="btn btn-outline btn-sm">✕ Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="input-label">Template Name *</label>
                  <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    placeholder="e.g. Vintage Baseball Cards Auction" className="input-sc" style={{ width: '100%' }} />
                </div>
                <div>
                  <label className="input-label">Post Header (top of FB post)</label>
                  <textarea value={editing.post_header || ''} onChange={e => setEditing({ ...editing, post_header: e.target.value })}
                    rows={6}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px',
                      fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--plum)',
                      background: 'var(--paper)', resize: 'vertical',
                    }} />
                </div>
                <div>
                  <label className="input-label">Lot Template (per-card comment)</label>
                  <textarea value={editing.lot_template || ''} onChange={e => setEditing({ ...editing, lot_template: e.target.value })}
                    rows={5}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px',
                      fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--plum)',
                      background: 'var(--paper)', resize: 'vertical',
                    }} />
                </div>
                <div>
                  <label className="input-label">Post Footer (after the lots)</label>
                  <textarea value={editing.post_footer || ''} onChange={e => setEditing({ ...editing, post_footer: e.target.value })}
                    rows={5}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px',
                      fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--plum)',
                      background: 'var(--paper)', resize: 'vertical',
                    }} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--plum)', fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!editing.is_default} onChange={e => setEditing({ ...editing, is_default: e.target.checked })} />
                  Use this as my default template
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button onClick={save} disabled={saving} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                    {saving ? 'Saving…' : editing.id ? 'Save Changes' : 'Create Template'}
                  </button>
                  <button onClick={() => setEditing(null)} className="btn btn-outline">Cancel</button>
                </div>
              </div>

              <div style={{ background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, padding: 16 }}>
                <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 10 }}>★ Variables ★</div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--plum)', marginBottom: 6 }}>Header & Footer</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {VARIABLES_HEADER_FOOTER.map(v => (
                      <div key={v.key} style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                        <span className="mono" style={{ background: 'var(--cream)', padding: '1px 5px', borderRadius: 4, color: 'var(--plum)', fontWeight: 700 }}>{v.key}</span>
                        <span style={{ marginLeft: 6 }}>{v.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--plum)', marginBottom: 6 }}>Lot Template</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {VARIABLES_LOT.map(v => (
                      <div key={v.key} style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                        <span className="mono" style={{ background: 'var(--cream)', padding: '1px 5px', borderRadius: 4, color: 'var(--plum)', fontWeight: 700 }}>{v.key}</span>
                        <span style={{ marginLeft: 6 }}>{v.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 16, padding: 10, background: 'var(--cream)', border: '1px dashed var(--rule)', borderRadius: 6, fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
                  💡 <strong>Tip:</strong> Press Enter for line breaks. The <span className="mono">$</span> character is literal — type it directly.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
