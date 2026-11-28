'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import SCLogo from '@/components/SCLogo';
import CopyLinkButton from '@/components/CopyLinkButton';
import SetHeaderBanner from '@/components/SetHeaderBanner';
import SetValueStats, { type CardValueStat } from '@/components/SetValueStats';
import { SetDescription, SetFacts, KeyCards, SetValueChart, TopCards, SetCardGrid, CardLightbox } from '@/components/SetShowcase';
import Thumb from '@/components/Thumb';
import {
  buildShowcaseCards, topCardsByValue, completionOf, conditionSummaryOf, valueTimeline, valuesProvenance, fmtMoney,
  type ShowcaseCard,
} from '@/lib/setShowcase';
import type { PublicShowcaseData } from './loadShowcase';

export function statsFromCards(cards: ShowcaseCard[]): CardValueStat[] {
  const seen = new Set<string>();
  const out: CardValueStat[] = [];
  for (const c of cards) {
    if (!c.owned || c.value === null || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push({
      key: c.key,
      name: [c.cardNumber ? `#${c.cardNumber}` : '', c.player].filter(Boolean).join(' ') || 'Card',
      conditionLabel: c.condition || 'Raw',
      latest: c.value,
      trend: c.trend,
      latestMarkAt: c.lastMarkAt,
    });
  }
  return out;
}

export default function PublicSetShowcase({ data }: { data: PublicShowcaseData }) {
  const { set, settings, seller, listing } = data;
  const cards = useMemo(() => buildShowcaseCards(data.rows, set.year, set.brand, data.marksByKey), [data.rows, set.year, set.brand, data.marksByKey]);
  const stats = useMemo(() => statsFromCards(cards), [cards]);
  const setValue = useMemo(() => stats.reduce((s, c) => s + (c.latest || 0), 0), [stats]);
  const top = useMemo(() => topCardsByValue(cards, 16), [cards]);
  const completion = useMemo(() => completionOf(cards), [cards]);
  const condition = useMemo(() => conditionSummaryOf(cards), [cards]);
  const timeline = useMemo(() => valueTimeline(cards, data.marksByKey, setValue), [cards, data.marksByKey, setValue]);
  const prov = useMemo(() => valuesProvenance(data.marksByKey), [data.marksByKey]);
  const [offerOpen, setOfferOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [titleImageOpen, setTitleImageOpen] = useState(false);

  const askingPrice = settings.asking_price ?? listing?.askingPrice ?? null;

  async function downloadChecklist() {
    setPdfBusy(true);
    try {
      const { generateSetChecklistPdf } = await import('@/lib/pdf/setChecklistPdf');
      const blob = generateSetChecklistPdf({
        setTitle: set.title,
        subtitle: `${completion.owned} of ${completion.total} cards${setValue > 0 ? ` · Market value ${fmtMoney(setValue)}` : ''}${askingPrice ? ` · Price ${fmtMoney(askingPrice)}` : ''}`,
        pageUrl: `${window.location.origin}${window.location.pathname}`,
        showValues: settings.show_card_values,
        rows: cards.map(c => ({ cardNumber: c.cardNumber, player: c.player, condition: c.condition, owned: c.owned, value: c.value })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${set.slug}-checklist.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)', borderBottom: '3px solid var(--plum)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={36} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 18, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 11, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={downloadChecklist} disabled={pdfBusy}>
            {pdfBusy ? 'Preparing…' : '⬇ Checklist'}
          </button>
          <CopyLinkButton />
        </div>
      </header>

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px 80px' }}>
        {/* Hero: what it is, what it's worth, what it costs */}
        <section className="panel-bordered" style={{ padding: '20px 22px', marginBottom: 20, background: 'var(--paper)', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Left: the seller's chosen image, then what it is */}
          <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', gap: 16, alignItems: 'center' }}>
            {settings.title_image && (
              <button type="button" onClick={() => setTitleImageOpen(true)} title="View larger"
                style={{ flexShrink: 0, padding: 0, border: 0, background: 'none', cursor: 'zoom-in' }}>
                <Thumb url={settings.title_image} width={320} alt={set.title}
                  style={{ display: 'block', width: 'clamp(64px, 12vw, 110px)', aspectRatio: '5 / 7', objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', boxShadow: '3px 3px 0 var(--plum)' }} />
              </button>
            )}
            <div style={{ minWidth: 0, flex: '0 1 auto' }}>
              <div className="eyebrow" style={{ fontSize: 10.5, color: 'var(--orange)' }}>{[set.year, set.brand].filter(Boolean).join(' · ')}{completion.missing.length === 0 ? ' · Complete set' : ''}</div>
              <h1 className="display" style={{ fontSize: 'clamp(24px, 4vw, 34px)', color: 'var(--plum)', margin: '6px 0 4px', lineHeight: 1.1 }}>{set.title}</h1>
              <div style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>
                Offered by <strong>{seller.displayName}</strong> · <strong>{completion.owned} of {completion.total}</strong> cards
                {completion.missing.length === 0 ? ' (complete)' : ` (${completion.pct.toFixed(1)}% complete)`}
              </div>
              {setValue > 0 && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 10 }}>
                  <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Market value</span>
                  <span className="display" style={{ fontSize: 20, color: 'var(--orange)', lineHeight: 1 }}>{fmtMoney(setValue)}</span>
                  {askingPrice !== null && askingPrice < setValue && (
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>
                      Priced {Math.round((1 - askingPrice / setValue) * 100)}% below market value
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: price, with Make an offer underneath */}
          {(askingPrice !== null || settings.accept_offers || listing) && (
            <div style={{ flex: '0 0 auto', marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, textAlign: 'right' }}>
              {askingPrice !== null && (
                <div>
                  <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Price</div>
                  <div className="display" style={{ fontSize: 'clamp(28px, 4.5vw, 38px)', color: 'var(--plum)', lineHeight: 1 }}>{fmtMoney(askingPrice)}</div>
                </div>
              )}
              {settings.accept_offers && (
                <button type="button" className="btn btn-primary" onClick={() => setOfferOpen(true)} style={{ minWidth: 170 }}>Make an offer</button>
              )}
              {listing && (
                <Link href={`/marketplace?focus=${listing.id}`} className="btn btn-outline btn-sm">Buy on marketplace →</Link>
              )}
            </div>
          )}
        </section>

        <div style={{ marginBottom: 20 }}>
          <SetHeaderBanner year={set.year} brand={set.brand} title={set.title} />
        </div>

        <SetDescription description={settings.description} conditionNotes={settings.condition_notes} />
        <SetValueStats stats={stats} />
        <SetFacts completion={completion} condition={condition} asOf={prov.asOf} fromComps={prov.fromComps} />
        <TopCards cards={top} />
        <KeyCards notes={settings.key_cards} cards={cards} showValues={settings.show_card_values} />
        <SetValueChart points={timeline} />
        <SetCardGrid cards={cards} showValues={settings.show_card_values} />

        {settings.sale_terms && (
          <section className="panel-bordered" style={{ padding: '16px 20px', marginTop: 28, background: 'var(--paper)' }}>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>Shipping &amp; payment</div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>{settings.sale_terms}</p>
          </section>
        )}
      </main>

      {titleImageOpen && settings.title_image && (
        <CardLightbox items={[{ url: settings.title_image, label: set.title }]} startIdx={0} onClose={() => setTitleImageOpen(false)} />
      )}

      {offerOpen && (
        <OfferModal handle={seller.handle} slug={set.slug} setTitle={set.title} askingPrice={askingPrice} onClose={() => setOfferOpen(false)} />
      )}
    </div>
  );
}

function OfferModal({ handle, slug, setTitle, askingPrice, onClose }: {
  handle: string; slug: string; setTitle: string; askingPrice: number | null; onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const amt = Number(amount.replace(/[$,\s]/g, ''));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Please enter an offer amount.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/set-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, slug, amount: amt, name, contact, message, website }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not send your offer.'); return; }
      setSent(true);
    } catch {
      setError('Could not send your offer. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(42,20,52,0.75)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} className="panel-bordered" style={{ width: '100%', maxWidth: 440, background: 'var(--paper)', padding: '20px 22px' }}>
        {sent ? (
          <>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>Offer sent 🎉</div>
            <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              Your offer of <strong>{fmtMoney(amt)}</strong> for {setTitle} went to the seller. They&apos;ll reach out using the contact details you gave.
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>Make an offer</div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '4px 0 14px' }}>
              {setTitle}
              {askingPrice !== null && <> · Price {fmtMoney(askingPrice)}</>}
            </div>
            <label className="input-label">Your offer (USD)</label>
            <input className="input-sc" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required />
            <label className="input-label" style={{ marginTop: 10, display: 'block' }}>Your name</label>
            <input className="input-sc" value={name} onChange={e => setName(e.target.value)} maxLength={120} required />
            <label className="input-label" style={{ marginTop: 10, display: 'block' }}>How can the seller reach you?</label>
            <input className="input-sc" value={contact} onChange={e => setContact(e.target.value)} maxLength={200} placeholder="Email, phone, or Facebook name" required />
            <label className="input-label" style={{ marginTop: 10, display: 'block' }}>Message (optional)</label>
            <textarea className="input-sc" value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={3} />
            {/* Honeypot: hidden from people, filled in by bots. */}
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)}
              style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} aria-hidden="true" />
            {error && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--rust)', fontWeight: 600 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send offer'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
