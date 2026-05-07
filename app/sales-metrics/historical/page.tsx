'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import { insertHistoricalTransaction, type HistoricalChannel, type HistoricalEngagement } from '@/lib/historicalTransactions';

type Row = {
  id: string;
  occurred_at: string | null;
  bidder_name: string;
  bidder_fb_handle: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_note: string | null;
  amount: number | null;
  channel: HistoricalChannel | null;
  engagement_type: HistoricalEngagement;
  notes: string | null;
};

const ENGAGEMENT_LABEL: Record<HistoricalEngagement, string> = {
  won: '🏆 Won',
  bid: '👋 Bid',
  tag_request: '👀 Tag req',
};

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

const CHANNEL_LABEL: Record<HistoricalChannel, string> = {
  fb_auction: 'FB Auction',
  fb_claim: 'FB Claim Sale',
  other: 'Other',
};

export default function HistoricalTransactionsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [bidderName, setBidderName] = useState('');
  const [bidderHandle, setBidderHandle] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [year, setYear] = useState('');
  const [brand, setBrand] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [player, setPlayer] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<HistoricalChannel>('fb_auction');
  const [engagement, setEngagement] = useState<HistoricalEngagement>('won');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const { data } = await supabase
        .from('historical_transactions')
        .select('id, occurred_at, bidder_name, bidder_fb_handle, year, brand, card_number, player, condition_note, amount, channel, engagement_type, notes')
        .eq('user_id', user.id)
        .order('occurred_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      setRows((data || []) as Row[]);
      setLoading(false);
    }
    load();
  }, [router]);

  function resetForm() {
    setBidderName('');
    setBidderHandle('');
    setOccurredAt('');
    setYear('');
    setBrand('');
    setCardNumber('');
    setPlayer('');
    setConditionNote('');
    setAmount('');
    setNotes('');
    // keep channel + engagement as last-used so consecutive entries are quick
  }

  async function handleSubmit() {
    setError('');
    if (!userId) return;
    if (!bidderName.trim()) { setError('Buyer / bidder name is required.'); return; }
    setSaving(true);
    const supabase = createClient();
    const id = await insertHistoricalTransaction(supabase, userId, {
      bidderName: bidderName.trim(),
      bidderFbHandle: bidderHandle.trim() || null,
      occurredAt: occurredAt || null,
      year: year ? Number(year) : null,
      brand: brand || null,
      cardNumber: cardNumber || null,
      player: player || null,
      conditionNote: conditionNote || null,
      amount: amount ? Number(amount) : null,
      channel,
      engagement,
      notes: notes || null,
    });
    setSaving(false);
    if (!id) { setError('Save failed.'); return; }
    // Refresh list (cheap reload of just this user's rows).
    const { data } = await supabase
      .from('historical_transactions')
      .select('id, occurred_at, bidder_name, bidder_fb_handle, year, brand, card_number, player, condition_note, amount, channel, engagement_type, notes')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    setRows((data || []) as Row[]);
    resetForm();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this transaction?')) return;
    const supabase = createClient();
    const { error: delErr } = await supabase.from('historical_transactions').delete().eq('id', id);
    if (delErr) { alert('Delete failed: ' + delErr.message); return; }
    setRows(prev => prev.filter(r => r.id !== id));
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const terms = q.split(/\s+/).filter(Boolean);
    return rows.filter(r => {
      const hay = [r.bidder_name, r.bidder_fb_handle, r.player, r.brand, r.card_number, r.year ? String(r.year) : '', r.notes]
        .filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [rows, search]);

  const totalSpend = useMemo(
    () => rows.filter(r => r.engagement_type === 'won').reduce((s, r) => s + (r.amount || 0), 0),
    [rows],
  );
  const uniqueBidders = useMemo(() => new Set(rows.map(r => r.bidder_name.trim().toLowerCase())).size, [rows]);
  const wonCount = useMemo(() => rows.filter(r => r.engagement_type === 'won').length, [rows]);

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;

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
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Historical Transactions ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/sales-metrics" className="btn btn-ghost btn-sm">← Metrics</Link>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">Bidders</Link>
            <Link href="/home" className="btn btn-outline btn-sm">Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 18 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ How it works ★</div>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Bring your past Facebook auction and claim sale activity into Sports Collective. Each entry is matched to a bidder by name —
            same name twice means same buyer. New names auto-create a bidder profile so future tag suggestions, metrics, and bidder
            history pages light up immediately. CSV import is coming next; this form covers single entries.
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 20 }}>
          <section className="panel-bordered" style={{ padding: '18px 22px', alignSelf: 'start', position: 'sticky', top: 96 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', flex: 1 }}>Add a transaction</div>
              {savedFlash && <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>✓ Saved</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Buyer / Bidder name *">
                <input value={bidderName} onChange={e => setBidderName(e.target.value)} className="input-sc" style={{ width: '100%' }}
                  placeholder="Henry Humm" />
              </Field>
              <Field label="FB handle (optional)">
                <input value={bidderHandle} onChange={e => setBidderHandle(e.target.value)} className="input-sc" style={{ width: '100%' }}
                  placeholder="henry.humm" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Date">
                  <input type="date" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} className="input-sc" style={{ width: '100%' }} />
                </Field>
                <Field label="Channel">
                  <select value={channel} onChange={e => setChannel(e.target.value as HistoricalChannel)} className="input-sc" style={{ width: '100%' }}>
                    <option value="fb_auction">FB Auction</option>
                    <option value="fb_claim">FB Claim Sale</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>
              <Field label="Engagement type">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['won', 'bid', 'tag_request'] as HistoricalEngagement[]).map(e => (
                    <button key={e} type="button" onClick={() => setEngagement(e)}
                      className={`btn btn-sm ${engagement === e ? 'btn-primary' : 'btn-ghost'}`}>
                      {ENGAGEMENT_LABEL[e]}
                    </button>
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 4 }}>
                  Won = paid winning bid · Bid = lost bidder · Tag req = FB &ldquo;w&rdquo; comment / watcher
                </div>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px', gap: 10 }}>
                <Field label="Year">
                  <input type="number" value={year} onChange={e => setYear(e.target.value)} className="input-sc" style={{ width: '100%' }}
                    placeholder="1968" />
                </Field>
                <Field label="Brand">
                  <input value={brand} onChange={e => setBrand(e.target.value)} className="input-sc" style={{ width: '100%' }}
                    placeholder="Topps" />
                </Field>
                <Field label="Card #">
                  <input value={cardNumber} onChange={e => setCardNumber(e.target.value)} className="input-sc" style={{ width: '100%' }}
                    placeholder="150" />
                </Field>
              </div>
              <Field label="Player">
                <input value={player} onChange={e => setPlayer(e.target.value)} className="input-sc" style={{ width: '100%' }}
                  placeholder="Roberto Clemente" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Condition / Grade">
                  <input value={conditionNote} onChange={e => setConditionNote(e.target.value)} className="input-sc" style={{ width: '100%' }}
                    placeholder="PSA 5 EX" />
                </Field>
                {engagement !== 'tag_request' && (
                  <Field label={engagement === 'won' ? 'Sale price ($)' : 'Bid amount ($)'}>
                    <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="input-sc" style={{ width: '100%' }}
                      placeholder="125.00" />
                  </Field>
                )}
              </div>
              <Field label="Notes">
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input-sc" rows={2}
                  style={{ width: '100%', resize: 'vertical' }} placeholder="Optional context" />
              </Field>
              {error && (
                <div style={{ padding: 8, background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)', borderRadius: 6, color: 'var(--rust)', fontSize: 12 }}>
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button type="button" onClick={handleSubmit} disabled={saving || !bidderName.trim()} className="btn btn-primary" style={{ flex: 1 }}>
                  {saving ? 'Saving…' : '+ Add transaction'}
                </button>
                <button type="button" onClick={resetForm} disabled={saving} className="btn btn-ghost btn-sm">Clear</button>
              </div>
            </div>
          </section>

          <section className="panel-bordered" style={{ padding: '18px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>
                Imported transactions ({rows.length})
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                {uniqueBidders} unique buyer{uniqueBidders === 1 ? '' : 's'} · {wonCount} won · {fmtMoney(totalSpend)} sales
              </span>
              <div style={{
                marginLeft: 'auto',
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)',
                minWidth: 220, maxWidth: 320,
              }}>
                <span style={{ fontSize: 12, color: 'var(--plum)' }}>🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, player, year…"
                  style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, flex: 1, color: 'var(--plum)' }} />
                {search && <button onClick={() => setSearch('')} style={{ background: 'transparent', border: 'none', color: 'var(--plum)', cursor: 'pointer', fontSize: 13 }}>×</button>}
              </div>
            </div>
            {filteredRows.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
                {rows.length === 0 ? 'No historical transactions yet — start adding them on the left.' : 'No matches.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    <tr>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Buyer</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Card</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Type</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Channel</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '6px 10px', textAlign: 'center', width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(r => (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--rule)', fontSize: 12.5, color: 'var(--plum)' }}>
                        <td style={{ padding: '6px 10px' }} className="mono">
                          {r.occurred_at || '—'}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <div style={{ fontWeight: 600 }}>{r.bidder_name}</div>
                          {r.bidder_fb_handle && <div className="mono" style={{ fontSize: 10, color: 'var(--teal)' }}>@{r.bidder_fb_handle}</div>}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <div>
                            {[r.year, r.brand, r.card_number ? `#${r.card_number}` : '', r.player].filter(Boolean).join(' ') || '—'}
                          </div>
                          {r.condition_note && <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{r.condition_note}</div>}
                        </td>
                        <td style={{ padding: '6px 10px' }} className="mono">
                          {ENGAGEMENT_LABEL[r.engagement_type]}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {r.channel ? CHANNEL_LABEL[r.channel] : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--orange)', fontWeight: 700 }}>
                          {r.engagement_type === 'tag_request' ? '—' : fmtMoney(r.amount)}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <button type="button" onClick={() => handleDelete(r.id)} title="Delete"
                            style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--rust)', fontSize: 14 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="input-label" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
