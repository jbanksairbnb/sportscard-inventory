'use client';

import React, { useState } from 'react';

export type BidderRow = { id: string; name: string; fb_handle: string | null };

export type LiveActivity = {
  bidder_id: string;
  source: 'auction' | 'claim';
  is_winner: boolean;
  is_paid: boolean;
  bid_amount: number | null;
  listing_year: number | null;
  listing_brand: string | null;
  listing_player: string | null;
};

export type SuggestionListing = {
  id: string;
  year: number | null;
  brand: string | null;
  player: string | null;
};

export type BidderSuggestion = {
  bidder: BidderRow;
  matchCount: number;
  wonCount: number;
  claimCount: number;
  totalSpend: number;
  matchedListingIds: string[];
};

const YEAR_TOLERANCE = 2;

// Compute past bidders/buyers most likely to be interested in this set of
// listings. Match each individual listing (not any post body): a bidder
// matches if they previously won/bid on the same player, OR any card within
// +/- 2 years of that listing's year (brand-independent — era interest).
export function computeBidderSuggestions(
  listings: SuggestionListing[],
  activity: LiveActivity[],
  bidders: BidderRow[],
  bidderTotals: Map<string, { auctionWins: number; claimCount: number }>,
  opts: { source: 'auction' | 'claim'; max?: number } = { source: 'auction' },
): BidderSuggestion[] {
  if (listings.length === 0 || activity.length === 0) return [];
  const byBidder = new Map<string, BidderSuggestion>();
  for (const l of listings) {
    for (const a of activity) {
      const playerMatch = !!l.player && !!a.listing_player
        && l.player.toLowerCase() === a.listing_player.toLowerCase();
      const yearWithin = l.year !== null && a.listing_year !== null
        && Math.abs(l.year - a.listing_year) <= YEAR_TOLERANCE;
      if (!playerMatch && !yearWithin) continue;
      const bidder = bidders.find(b => b.id === a.bidder_id);
      if (!bidder) continue;
      let entry = byBidder.get(bidder.id);
      if (!entry) {
        entry = { bidder, matchCount: 0, wonCount: 0, claimCount: 0, totalSpend: 0, matchedListingIds: [] };
        byBidder.set(bidder.id, entry);
      }
      entry.matchCount += 1;
      if (a.source === 'auction' && a.is_winner) entry.wonCount += 1;
      if (a.source === 'claim' && a.is_winner) entry.claimCount += 1;
      if (a.is_paid && a.bid_amount) entry.totalSpend += a.bid_amount;
      if (!entry.matchedListingIds.includes(l.id)) entry.matchedListingIds.push(l.id);
    }
  }
  // For auctions: filter out claim-only buyers (they don't typically bid).
  // For claim sales: filter out auction-only bidders (they don't typically claim).
  const CROSS_THRESHOLD = 3;
  const filtered = Array.from(byBidder.values()).filter(entry => {
    const totals = bidderTotals.get(entry.bidder.id);
    if (!totals) return true;
    if (opts.source === 'auction' && totals.auctionWins === 0 && totals.claimCount >= CROSS_THRESHOLD) return false;
    if (opts.source === 'claim' && totals.claimCount === 0 && totals.auctionWins >= CROSS_THRESHOLD) return false;
    return true;
  });
  filtered.sort((a, b) => {
    if (b.wonCount !== a.wonCount) return b.wonCount - a.wonCount;
    if (b.claimCount !== a.claimCount) return b.claimCount - a.claimCount;
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return b.totalSpend - a.totalSpend;
  });
  // Only cap when the caller explicitly asks for a max; otherwise return every
  // matching bidder so no relevant tag is dropped.
  return opts.max ? filtered.slice(0, opts.max) : filtered;
}

async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

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

export function BidderSuggestionsPanel({
  suggestions, headline = 'Suggested past bidders',
  hint = 'Based on past bids on the same player, or any card within ±2 years.',
}: {
  suggestions: BidderSuggestion[];
  headline?: string;
  hint?: string;
}) {
  if (suggestions.length === 0) return null;
  const tagAllText = suggestions
    .map(s => s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name)
    .join(' ');
  return (
    <section className="panel-bordered" style={{
      padding: '18px 22px',
      background: 'rgba(56,142,142,0.06)', border: '1.5px solid var(--teal)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>★ {headline} ★</div>
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{hint}</span>
        <div style={{ flex: 1 }} />
        <CopyButton text={tagAllText} label={`📋 Copy all ${suggestions.length} tag${suggestions.length === 1 ? '' : 's'}`} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {suggestions.map(s => {
          const tag = s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name;
          return (
            <div key={s.bidder.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', background: 'var(--paper)',
              border: '1.5px solid var(--teal)', borderRadius: 100,
              fontSize: 12, color: 'var(--plum)',
            }}>
              <span style={{ fontWeight: 700 }}>{s.bidder.name}</span>
              {s.bidder.fb_handle && <span className="mono" style={{ fontSize: 10.5, color: 'var(--teal)' }}>@{s.bidder.fb_handle}</span>}
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                {s.matchCount} match{s.matchCount === 1 ? '' : 'es'}
                {s.wonCount > 0 ? ` · ${s.wonCount} won` : ''}
                {s.claimCount > 0 ? ` · ${s.claimCount} claimed` : ''}
              </span>
              <CopyButton text={tag} label="📋" />
            </div>
          );
        })}
      </div>
    </section>
  );
}
