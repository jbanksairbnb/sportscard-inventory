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

// Facebook allows up to 50 tags in a post body; anything beyond that has to be
// dropped into a comment (each mention typed with a leading @). Suggestions are
// pre-sorted by best match, split at this line.
const POST_TAG_LIMIT = 50;

export function BidderSuggestionsPanel({
  suggestions, headline = 'Suggested past bidders',
  hint = 'Sorted by best match — wins first, then bids. Based on past bids on the same player, or any card within ±2 years.',
}: {
  suggestions: BidderSuggestion[];
  headline?: string;
  hint?: string;
}) {
  if (suggestions.length === 0) return null;
  const postTags = suggestions.slice(0, POST_TAG_LIMIT);
  const commentTags = suggestions.slice(POST_TAG_LIMIT);
  const postTagText = postTags
    .map(s => s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name)
    .join(' ');
  // Comment mentions must be typed with a leading @ to trigger Facebook's
  // tagger, so force the @ prefix even when we only have a display name.
  const commentTagText = commentTags
    .map(s => `@${s.bidder.fb_handle || s.bidder.name}`)
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
        <CopyButton
          text={postTagText}
          label={commentTags.length > 0
            ? `📋 Copy first ${postTags.length} (post)`
            : `📋 Copy all ${postTags.length} tag${postTags.length === 1 ? '' : 's'}`}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {suggestions.map((s, i) => {
          const tag = s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name;
          const isComment = i >= POST_TAG_LIMIT;
          const commentTag = `@${s.bidder.fb_handle || s.bidder.name}`;
          return (
            <React.Fragment key={s.bidder.id}>
              {i === POST_TAG_LIMIT && (
                <div style={{
                  flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  margin: '6px 0 2px', fontSize: 11, fontWeight: 700, color: 'var(--orange)',
                }}>
                  <span style={{ flex: 1, height: 1, background: 'var(--orange)', opacity: 0.5 }} />
                  ⚠️ 50-tag post limit — tag the {commentTags.length} below in a comment
                  <span style={{ flex: 1, height: 1, background: 'var(--orange)', opacity: 0.5 }} />
                </div>
              )}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', background: 'var(--paper)',
                border: `1.5px solid ${isComment ? 'var(--orange)' : 'var(--teal)'}`,
                borderRadius: 100, fontSize: 12, color: 'var(--plum)',
                opacity: isComment ? 0.9 : 1,
              }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{i + 1}</span>
                <span style={{ fontWeight: 700 }}>{s.bidder.name}</span>
                {s.bidder.fb_handle && <span className="mono" style={{ fontSize: 10.5, color: 'var(--teal)' }}>@{s.bidder.fb_handle}</span>}
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                  {s.matchCount} match{s.matchCount === 1 ? '' : 'es'}
                  {s.wonCount > 0 ? ` · ${s.wonCount} won` : ''}
                  {s.claimCount > 0 ? ` · ${s.claimCount} claimed` : ''}
                </span>
                <CopyButton text={isComment ? commentTag : tag} label="📋" />
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {commentTags.length > 0 && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(232,116,44,0.10)', border: '1.5px solid var(--orange)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--plum)', flex: 1, minWidth: 220 }}>
            <strong>Facebook caps a post at {POST_TAG_LIMIT} tags.</strong> Publish the post first, then paste
            these {commentTags.length} as a comment — each is prefixed with <span className="mono">@</span> so
            Facebook&apos;s tagger picks them up.
          </span>
          <CopyButton text={commentTagText} label={`📋 Copy ${commentTags.length} comment tag${commentTags.length === 1 ? '' : 's'}`} />
        </div>
      )}
    </section>
  );
}
