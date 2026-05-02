'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type TemplateType = 'single' | 'multi';

type Template = {
  id: string;
  name: string;
  template_type: TemplateType;
  post_header: string;
  post_footer: string;
  lot_template: string;
  is_default: boolean;
  updated_at: string;
};

const SINGLE_DEFAULT_BODY = `🌟🌟 Auction 🌟🌟
{title}
{description}
SB ${'${starting_bid}'}`;

const MULTI_DEFAULT_LOT = `{lot_number}. {year} {brand} #{card_number} {player}
{condition_note}
SB ${'${starting_bid}'}`;

const DEFAULT_AUCTION_INFO = `24 Hour Rule (auction ends 24h after the last bid)
Bid increments of $1
Shipping: $1 PWE or $5 BMWT
PayPal F&F or Venmo
Thanks and good luck!`;

const VARIABLES_SINGLE = [
  { key: '{title}', desc: 'Listing title' },
  { key: '{description}', desc: 'Listing description (condition notes, etc.)' },
  { key: '{year}', desc: 'Card year' },
  { key: '{brand}', desc: 'Topps / Bowman / etc.' },
  { key: '{player}', desc: 'Player name' },
  { key: '{card_number}', desc: 'Card #' },
  { key: '{grade}', desc: 'Numeric grade (graded cards)' },
  { key: '{grading_company}', desc: 'PSA / SGC / etc.' },
  { key: '{raw_grade}', desc: 'Raw grade (NM, EX, etc.)' },
  { key: '{condition_note}', desc: 'Auto-formatted condition' },
  { key: '{starting_bid}', desc: 'Asking price' },
];
const VARIABLES_MULTI_LOT = [
  { key: '{lot_number}', desc: 'Sequential lot number (1, 2, 3...)' },
  ...VARIABLES_SINGLE,
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

  function openNewSingle() {
    setEditing({
      name: 'Single Card Auction',
      template_type: 'single',
      post_header: SINGLE_DEFAULT_BODY,
      post_footer: DEFAULT_AUCTION_INFO,
      lot_template: '',
      is_default: !templates.some(t => t.template_type === 'single'),
    });
  }
  function openNewMulti() {
    setEditing({
      name: 'Multi-Card Auction',
      template_type: 'multi',
      post_header: '',
      post_footer: DEFAULT_AUCTION_INFO,
      lot_template: MULTI_DEFAULT_LOT,
      is_default: !templates.some(t => t.template_type === 'multi'),
    });
  }
  function openEdit(t: Template) { setEditing({ ...t }); }

  async function save() {
    if (!editing || !userId) return;
    if (!editing.name?.trim()) { alert('Name is required.'); return; }
    if (!editing.template_type) { alert('Template type is required.'); return; }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      user_id: userId,
      name: editing.name.trim(),
      template_type: editing.template_type,
      post_header: editing.post_header || '',
      post_footer: editing.post_footer || '',
      lot_template: editing.lot_template || '',
      is_default: !!editing.is_default,
      updated_at: new Date().toISOString(),
    };
    if (editing.is_default) {
      await supabase.from('fb_auction_templates')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('template_type', editing.template_type);
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
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  const singles = templates.filter(t => t.template_type === 'single');
  const multis = templates.filter(t => t.template_type === 'multi' || !t.template_type);

  return (
    <div style={{ minHeight: '100vh' }}>
      <Header />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            <li><strong>Single Card</strong> templates: for posts that auction one card. The body auto-fills from the listing&apos;s title + description; you can tweak before posting. The auction info (rules / shipping / payment) gets appended from the template.</li>
            <li><strong>Multi-Card</strong> templates: for posts that auction many cards. You type the parent post title + description for each auction; the template provides the auction info footer + the per-card comment format.</li>
            <li>Mark one of each type as <strong>★ Default</strong> — that one auto-loads when you start a new auction of that type.</li>
            <li>Use <span className="mono">{'{variables}'}</span> shown in the editor to insert listing data automatically.</li>
          </ol>
        </section>

        <TemplateSection
          title="Single Card Templates"
          subtitle="One card per Facebook post. Body auto-fills from the listing."
          templates={singles}
          onNew={openNewSingle}
          onEdit={openEdit}
          onRemove={remove}
        />
        <div style={{ height: 28 }} />
        <TemplateSection
          title="Multi-Card Templates"
          subtitle="Many cards per post — each card pasted as a comment with its image."
          templates={multis}
          onNew={openNewMulti}
          onEdit={openEdit}
          onRemove={remove}
        />
      </div>

      {editing && (
        <TemplateEditor
          editing={editing}
          setEditing={setEditing}
          saving={saving}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
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
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ FB Auction Templates ★</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/fb-auctions" className="btn btn-ghost btn-sm">Auctions</Link>
          <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">Bidders</Link>
          <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
          <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
        </div>
      </div>
    </header>
  );
}

function TemplateSection({ title, subtitle, templates, onNew, onEdit, onRemove }: {
  title: string; subtitle: string;
  templates: Template[];
  onNew: () => void;
  onEdit: (t: Template) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{subtitle}</div>
        </div>
        <button onClick={onNew} className="btn btn-primary btn-sm">+ New</button>
      </div>
      {templates.length === 0 ? (
        <div className="panel-bordered" style={{ padding: '28px 24px', textAlign: 'center', borderStyle: 'dashed' }}>
          <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>None yet — click <strong>+ New</strong> to create one.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.map(t => (
            <div key={t.id} className="panel-bordered" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>
                  {t.name} {t.is_default && <span className="chip" style={{ fontSize: 9, background: 'var(--plum)', color: 'var(--mustard)', marginLeft: 6 }}>★ DEFAULT</span>}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                  Updated {new Date(t.updated_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => onEdit(t)} className="btn btn-ghost btn-sm">✎ Edit</button>
              <button onClick={() => onRemove(t.id)} className="btn btn-sm" style={{ background: 'transparent', color: 'var(--rust)', border: '1.5px solid var(--rust)' }}>🗑 Delete</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TemplateEditor({ editing, setEditing, saving, onSave, onClose }: {
  editing: Partial<Template>;
  setEditing: (e: Partial<Template>) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const isSingle = editing.template_type === 'single';
  const variables = isSingle ? VARIABLES_SINGLE : VARIABLES_MULTI_LOT;

  const textareaStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px',
    fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--plum)',
    background: 'var(--paper)', resize: 'vertical',
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 980, padding: 26, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>
            {editing.id ? 'Edit Template' : 'New Template'} — <span style={{ color: 'var(--orange)' }}>{isSingle ? 'Single Card' : 'Multi-Card'}</span>
          </div>
          <button onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="input-label">Template Name *</label>
              <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Vintage Baseball Cards 24h Auction" className="input-sc" style={{ width: '100%' }} />
            </div>

            {isSingle ? (
              <div>
                <label className="input-label">Card Body Template (the FB post body) *</label>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>
                  Auto-fills from the listing&apos;s data. The user can edit before posting (e.g. to add condition notes).
                </div>
                <textarea value={editing.post_header || ''} onChange={e => setEditing({ ...editing, post_header: e.target.value })}
                  rows={8} style={textareaStyle} />
              </div>
            ) : (
              <div>
                <label className="input-label">Lot Template — per-card comment *</label>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>
                  This is the format used for each card&apos;s comment under the parent post.
                </div>
                <textarea value={editing.lot_template || ''} onChange={e => setEditing({ ...editing, lot_template: e.target.value })}
                  rows={6} style={textareaStyle} />
              </div>
            )}

            <div>
              <label className="input-label">Auction Info (rules / shipping / payment) *</label>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>
                {isSingle
                  ? 'Appended below the card body in every auction post.'
                  : 'Appended below the user-typed title and description on the parent post.'}
              </div>
              <textarea value={editing.post_footer || ''} onChange={e => setEditing({ ...editing, post_footer: e.target.value })}
                rows={6} style={textareaStyle} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--plum)', fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!editing.is_default} onChange={e => setEditing({ ...editing, is_default: e.target.checked })} />
              Use as my default {isSingle ? 'single-card' : 'multi-card'} template
            </label>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button onClick={onSave} disabled={saving} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                {saving ? 'Saving…' : editing.id ? 'Save Changes' : 'Create Template'}
              </button>
              <button onClick={onClose} className="btn btn-outline">Cancel</button>
            </div>
          </div>

          <div style={{ background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, padding: 16 }}>
            <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 10 }}>★ Variables ★</div>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 10, lineHeight: 1.5 }}>
              {isSingle
                ? 'Use these in the Card Body Template. They auto-fill from the chosen listing.'
                : 'Use these in the Lot Template. They auto-fill per card. The Auction Info typically has no variables.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {variables.map(v => (
                <div key={v.key} style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                  <span className="mono" style={{ background: 'var(--cream)', padding: '1px 5px', borderRadius: 4, color: 'var(--plum)', fontWeight: 700 }}>{v.key}</span>
                  <span style={{ marginLeft: 6 }}>{v.desc}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 10, background: 'var(--cream)', border: '1px dashed var(--rule)', borderRadius: 6, fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              💡 <strong>Tip:</strong> Press Enter for line breaks. <span className="mono">$</span> is literal — type directly.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
