'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';
import { insertHistoricalTransaction, findOrCreateGroup, type HistoricalChannel, type HistoricalEngagement } from '@/lib/historicalTransactions';
import { parseCsv } from '@/lib/csv';
import { buildTemplateWorkbook, downloadBlob } from '@/lib/xlsx';

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
  cost: number | null;
  channel: HistoricalChannel | null;
  engagement_type: HistoricalEngagement;
  group_id: string | null;
  notes: string | null;
};

type Group = { id: string; name: string };

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
  const [cost, setCost] = useState('');
  const [channel, setChannel] = useState<HistoricalChannel>('fb_auction');
  const [engagement, setEngagement] = useState<HistoricalEngagement>('won');
  const [notes, setNotes] = useState('');

  // Groups
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string>('');
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupUrl, setNewGroupUrl] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);

  // CSV import
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importReport, setImportReport] = useState<{ ok: number; failed: { row: number; reason: string }[] } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      const [{ data }, { data: groupRows }] = await Promise.all([
        supabase
          .from('historical_transactions')
          .select('id, occurred_at, bidder_name, bidder_fb_handle, year, brand, card_number, player, condition_note, amount, cost, channel, engagement_type, group_id, notes')
          .eq('user_id', user.id)
          .order('occurred_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }),
        supabase.from('fb_groups').select('id, name').eq('user_id', user.id).order('name'),
      ]);
      setRows((data || []) as Row[]);
      setGroups((groupRows || []) as Group[]);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleAddGroup() {
    if (!newGroupName.trim() || !userId) return;
    setAddingGroup(true);
    const supabase = createClient();
    const { data, error: gErr } = await supabase
      .from('fb_groups')
      .insert({ user_id: userId, name: newGroupName.trim(), url: newGroupUrl.trim() || null })
      .select('id, name')
      .single();
    setAddingGroup(false);
    if (gErr || !data) { alert(gErr?.message || 'Could not add group'); return; }
    const g = data as Group;
    setGroups(prev => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)));
    setGroupId(g.id);
    setNewGroupName('');
    setNewGroupUrl('');
    setShowAddGroup(false);
  }

  async function handleDownloadTemplate() {
    const blob = await buildTemplateWorkbook({
      sheetName: 'Transactions',
      columns: [
        { key: 'bidder_name', header: 'bidder_name', width: 22, help: 'Required. Buyer / bidder display name. Same name = same person.' },
        { key: 'bidder_fb_handle', header: 'bidder_fb_handle', width: 22, help: 'Optional. FB handle (no @).' },
        { key: 'occurred_at', header: 'occurred_at', width: 14, help: 'Date of the transaction in YYYY-MM-DD format.' },
        { key: 'engagement', header: 'engagement', width: 14, list: ['won', 'bid', 'tag_request'], help: 'won = paid winning bid. bid = lost bidder. tag_request = FB "w" comment.' },
        { key: 'channel', header: 'channel', width: 14, list: ['fb_auction', 'fb_claim', 'other'], help: 'Where the sale happened.' },
        { key: 'year', header: 'year', width: 8 },
        { key: 'brand', header: 'brand', width: 14 },
        { key: 'card_number', header: 'card_number', width: 12 },
        { key: 'player', header: 'player', width: 22 },
        { key: 'condition_note', header: 'condition_note', width: 18 },
        { key: 'amount', header: 'amount', width: 12, help: 'Sale price (won) or bid amount (bid). Leave blank for tag_request.' },
        { key: 'cost', header: 'cost', width: 12, help: 'My cost basis. Used for profit math on won rows. Blank counts as $0 profit.' },
        { key: 'group_name', header: 'group_name', width: 26, help: 'FB group name. New names auto-create a group.' },
        { key: 'notes', header: 'notes', width: 26 },
      ],
      examples: [
        {
          bidder_name: 'Henry Humm', bidder_fb_handle: 'henry.humm', occurred_at: '2025-08-14',
          engagement: 'won', channel: 'fb_auction',
          year: 1968, brand: 'Topps', card_number: '150', player: 'Roberto Clemente',
          condition_note: 'PSA 5 EX', amount: 125, cost: 50,
          group_name: 'Vintage Baseball Cards', notes: 'Won outright',
        },
        {
          bidder_name: 'Jeff Bennett', bidder_fb_handle: '', occurred_at: '2025-08-14',
          engagement: 'bid', channel: 'fb_auction',
          year: 1968, brand: 'Topps', card_number: '150', player: 'Roberto Clemente',
          condition_note: '', amount: 110, cost: '',
          group_name: 'Vintage Baseball Cards', notes: 'Lost bidder',
        },
        {
          bidder_name: 'Doran Braun', bidder_fb_handle: '', occurred_at: '2025-08-14',
          engagement: 'tag_request', channel: 'fb_auction',
          year: 1968, brand: 'Topps', card_number: '150', player: 'Roberto Clemente',
          condition_note: '', amount: '', cost: '',
          group_name: 'Vintage Baseball Cards', notes: 'Watched, never bid',
        },
      ],
      instructions: [
        'Sports Collective — Historical Transactions Template',
        '',
        '1. Fill in the Transactions sheet. Each row is one transaction.',
        '2. bidder_name is the only required column. Engagement and channel use dropdowns — pick one of the listed values.',
        '3. Dates go in YYYY-MM-DD format (Excel formats may differ; type the value as text if Excel reformats it).',
        '4. amount is the sale price for won rows or the bid amount for bid rows. Leave blank for tag_request.',
        '5. cost is your cost basis for the card. It only applies to won rows and is used for profit math; blank counts as $0 profit, not a loss.',
        '6. group_name is the Facebook group the sale happened in. New names auto-create a group on import.',
        '7. Delete the three example rows before saving.',
        '',
        '⚠ IMPORTANT: Save this file as CSV before uploading.',
        '   Excel: File → Save As → choose "CSV UTF-8 (Comma delimited) (*.csv)".',
        '   Google Sheets: File → Download → "Comma-separated values (.csv)".',
        '   Then return to the Historical Transactions page and click ⬆ Upload CSV.',
      ],
    });
    downloadBlob('historical-transactions-template.xlsx', blob);
  }

  async function handleUploadCsv(file: File) {
    if (!userId) return;
    setError('');
    setImportReport(null);
    const text = await file.text();
    const rows = parseCsv(text).filter(r => r.length > 0 && r.some(c => c.trim() !== ''));
    if (rows.length < 2) { setError('CSV is empty or has no data rows.'); return; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    const idx = (k: string) => header.indexOf(k);
    const need = ['bidder_name'];
    for (const k of need) {
      if (idx(k) === -1) { setError(`CSV missing required column "${k}". Use the template as a starting point.`); return; }
    }
    const dataRows = rows.slice(1);
    setImporting(true);
    setImportProgress({ done: 0, total: dataRows.length });
    const supabase = createClient();
    const groupCache = new Map<string, string | null>();
    let ok = 0;
    const failed: { row: number; reason: string }[] = [];
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const get = (k: string) => { const j = idx(k); return j === -1 ? '' : (r[j] || '').trim(); };
      const name = get('bidder_name');
      if (!name) { failed.push({ row: i + 2, reason: 'bidder_name is required' }); setImportProgress({ done: i + 1, total: dataRows.length }); continue; }
      const engagementRaw = (get('engagement') || 'won').toLowerCase();
      const engagement: HistoricalEngagement = engagementRaw === 'bid' || engagementRaw === 'tag_request' ? engagementRaw : 'won';
      const channelRaw = (get('channel') || '').toLowerCase();
      const channel: HistoricalChannel | null = channelRaw === 'fb_auction' || channelRaw === 'fb_claim' || channelRaw === 'other' ? channelRaw : null;
      const groupName = get('group_name');
      let groupIdResolved: string | null = null;
      if (groupName) {
        const key = groupName.toLowerCase();
        if (groupCache.has(key)) groupIdResolved = groupCache.get(key) || null;
        else {
          groupIdResolved = await findOrCreateGroup(supabase, userId, groupName);
          groupCache.set(key, groupIdResolved);
        }
      }
      const yearStr = get('year');
      const amountStr = get('amount');
      const costStr = get('cost');
      const result = await insertHistoricalTransaction(supabase, userId, {
        bidderName: name,
        bidderFbHandle: get('bidder_fb_handle') || null,
        occurredAt: get('occurred_at') || null,
        year: yearStr ? Number(yearStr) : null,
        brand: get('brand') || null,
        cardNumber: get('card_number') || null,
        player: get('player') || null,
        conditionNote: get('condition_note') || null,
        amount: amountStr ? Number(amountStr) : null,
        cost: costStr ? Number(costStr) : null,
        channel: channel,
        engagement,
        groupId: groupIdResolved,
        notes: get('notes') || null,
      });
      if (result.id) ok++;
      else failed.push({ row: i + 2, reason: result.error || 'unknown' });
      setImportProgress({ done: i + 1, total: dataRows.length });
    }
    setImporting(false);
    setImportProgress(null);
    setImportReport({ ok, failed });
    // Refresh rows + groups
    const [{ data }, { data: groupRows }] = await Promise.all([
      supabase
        .from('historical_transactions')
        .select('id, occurred_at, bidder_name, bidder_fb_handle, year, brand, card_number, player, condition_note, amount, cost, channel, engagement_type, group_id, notes')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('fb_groups').select('id, name').eq('user_id', userId).order('name'),
    ]);
    setRows((data || []) as Row[]);
    setGroups((groupRows || []) as Group[]);
  }

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
    setCost('');
    setNotes('');
    // keep channel + engagement + groupId as last-used so consecutive entries are quick
  }

  async function handleSubmit() {
    setError('');
    if (!userId) return;
    if (!bidderName.trim()) { setError('Buyer / bidder name is required.'); return; }
    setSaving(true);
    const supabase = createClient();
    const result = await insertHistoricalTransaction(supabase, userId, {
      bidderName: bidderName.trim(),
      bidderFbHandle: bidderHandle.trim() || null,
      occurredAt: occurredAt || null,
      year: year ? Number(year) : null,
      brand: brand || null,
      cardNumber: cardNumber || null,
      player: player || null,
      conditionNote: conditionNote || null,
      amount: amount ? Number(amount) : null,
      cost: cost ? Number(cost) : null,
      channel,
      engagement,
      groupId: groupId || null,
      notes: notes || null,
    });
    setSaving(false);
    if (!result.id) { setError(`Save failed: ${result.error || 'unknown error'}`); return; }
    // Refresh list (cheap reload of just this user's rows).
    const { data } = await supabase
      .from('historical_transactions')
      .select('id, occurred_at, bidder_name, bidder_fb_handle, year, brand, card_number, player, condition_note, amount, cost, channel, engagement_type, group_id, notes')
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
  const totalProfit = useMemo(
    () => rows.filter(r => r.engagement_type === 'won').reduce((s, r) => s + ((r.amount || 0) - (r.cost || 0)), 0),
    [rows],
  );
  const uniqueBidders = useMemo(() => new Set(rows.map(r => r.bidder_name.trim().toLowerCase())).size, [rows]);
  const wonCount = useMemo(() => rows.filter(r => r.engagement_type === 'won').length, [rows]);

  const groupNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) m.set(g.id, g.name);
    return m;
  }, [groups]);

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
            history pages light up immediately. Use the bulk uploader below for big batches; the form on the left handles one-offs.
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={handleDownloadTemplate} className="btn btn-ghost btn-sm">
              ⬇ Download Excel template
            </button>
            <label className="btn btn-primary btn-sm" style={{ cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.6 : 1 }}>
              ⬆ Upload CSV
              <input type="file" accept=".csv,text/csv" disabled={importing}
                onChange={async e => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) await handleUploadCsv(f);
                }}
                style={{ display: 'none' }} />
            </label>
            {importing && importProgress && (
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--plum)', fontWeight: 700 }}>
                Importing {importProgress.done}/{importProgress.total}…
              </span>
            )}
            {!importing && importReport && (
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: importReport.failed.length === 0 ? 'var(--teal)' : 'var(--rust)' }}>
                ✓ {importReport.ok} added{importReport.failed.length > 0 ? ` · ${importReport.failed.length} failed` : ''}
              </span>
            )}
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
              Excel template has dropdowns for engagement + channel. <strong>Save As CSV before uploading</strong> — see the Instructions sheet.
            </span>
          </div>
          {importReport && importReport.failed.length > 0 && (
            <div style={{ marginTop: 10, padding: 8, border: '1.5px solid var(--rust)', borderRadius: 6, background: 'rgba(197,74,44,0.08)', maxHeight: 180, overflowY: 'auto' }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--rust)', fontWeight: 700, marginBottom: 4 }}>Failed rows</div>
              <ul className="mono" style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: 'var(--rust)', lineHeight: 1.55 }}>
                {importReport.failed.map((f, i) => <li key={i}>Row {f.row}: {f.reason}</li>)}
              </ul>
            </div>
          )}
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
              {engagement === 'won' && (
                <Field label="My cost ($)">
                  <input type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} className="input-sc" style={{ width: '100%' }}
                    placeholder="50.00" />
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 4 }}>
                    Used for profit math. Leave blank if unknown — it counts as $0 profit, not a loss.
                  </div>
                </Field>
              )}
              <Field label="FB group">
                {showAddGroup ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: '1.5px dashed var(--plum)', borderRadius: 6 }}>
                    <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="input-sc" style={{ width: '100%' }}
                      placeholder="Group name" autoFocus />
                    <input value={newGroupUrl} onChange={e => setNewGroupUrl(e.target.value)} className="input-sc" style={{ width: '100%' }}
                      placeholder="Group URL (optional)" />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" onClick={handleAddGroup} disabled={!newGroupName.trim() || addingGroup}
                        className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                        {addingGroup ? 'Saving…' : 'Save group'}
                      </button>
                      <button type="button" onClick={() => { setShowAddGroup(false); setNewGroupName(''); setNewGroupUrl(''); }}
                        className="btn btn-ghost btn-sm">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={groupId} onChange={e => setGroupId(e.target.value)} className="input-sc" style={{ flex: 1 }}>
                      <option value="">— No group —</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setShowAddGroup(true)} className="btn btn-ghost btn-sm" title="Add a new group">
                      + New
                    </button>
                  </div>
                )}
              </Field>
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
                {uniqueBidders} unique buyer{uniqueBidders === 1 ? '' : 's'} · {wonCount} won · {fmtMoney(totalSpend)} sales · {fmtMoney(totalProfit)} profit
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
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Channel · Group</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>Cost</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>Profit</th>
                      <th style={{ padding: '6px 10px', textAlign: 'center', width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(r => {
                      const profit = r.engagement_type === 'won' && r.amount != null
                        ? r.amount - (r.cost || 0)
                        : null;
                      const groupName = r.group_id ? groupNameById.get(r.group_id) : null;
                      return (
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
                          <div>{r.channel ? CHANNEL_LABEL[r.channel] : '—'}</div>
                          {groupName && <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{groupName}</div>}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--orange)', fontWeight: 700 }}>
                          {r.engagement_type === 'tag_request' ? '—' : fmtMoney(r.amount)}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--ink-soft)' }}>
                          {r.engagement_type === 'won' ? fmtMoney(r.cost) : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: profit !== null && profit < 0 ? 'var(--rust)' : 'var(--teal)' }}>
                          {profit !== null ? fmtMoney(profit) : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <button type="button" onClick={() => handleDelete(r.id)} title="Delete"
                            style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--rust)', fontSize: 14 }}>×</button>
                        </td>
                      </tr>
                      );
                    })}
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
