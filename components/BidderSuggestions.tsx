'use client';

import React, { useMemo, useState } from 'react';
import { playersMatch } from '@/lib/playerName';

export type BidderRow = { id: string; name: string; fb_handle: string | null };

// One recorded engagement. A `bid` row is a single bid that was entered — five
// bids on one lot are five rows, because bid volume is the signal we rank on.
// An `acquisition` row is a won lot, a claimed item, or an imported sale with
// no bid event behind it, so the bidder is still credited for the item.
export type LiveActivity = {
  bidder_id: string;
  source: 'auction' | 'claim';
  kind: 'bid' | 'acquisition';
  // Identifies the underlying lot/item, so wins and spend count once even when
  // several bid rows point at the same lot.
  item_key: string;
  is_winner: boolean;
  is_paid: boolean;
  bid_amount: number | null;
  occurred_at: string | null;
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

// Which band a bidder falls in. Membership is about the bidder's own
// engagement with the auctions, independent of what is in this sale; the
// ordering *within* a band is about relevance to this sale.
export type Tranche = 'priority' | 'active' | 'proven' | 'tail';

export type BidderSuggestion = {
  bidder: BidderRow;
  tranche: Tranche;
  // Scoped to the listings in this sale.
  bidCount: number;
  wonCount: number;
  claimCount: number;
  totalSpend: number;
  matchedListingIds: string[];
  // All-time, across every auction — what tranche membership is decided on.
  totalBids: number;
  totalWins: number;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  // A heavy bidder who rarely wins: they drive prices up, so they are worth
  // tagging even when the win test drops them out of the priority band.
  isBidBumper: boolean;
};

const YEAR_TOLERANCE = 2;
const RECENT_DAYS = 60;
const MIN_PRIORITY_BIDS = 5;
const BUMPER_MIN_BIDS = 8;

export const TRANCHE_ORDER: Tranche[] = ['priority', 'active', 'proven', 'tail'];

export const TRANCHE_LABEL: Record<Tranche, string> = {
  priority: 'Priority — bidding now, and they buy',
  active: 'Active — bid in the last 60 days',
  proven: 'Proven, but quiet lately',
  tail: 'Everyone else who matches',
};

export const TRANCHE_HINT: Record<Tranche, string> = {
  priority: `${MIN_PRIORITY_BIDS}+ bids, at least one win, and bid within ${RECENT_DAYS} days`,
  active: `bid within ${RECENT_DAYS} days`,
  proven: 'real history, but nothing recent',
  tail: 'matched on player or era',
};

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

// A listing matches past activity when it names the same player by surname, or
// is any card within +/- 2 years (era interest, brand-independent).
function activityMatches(listing: SuggestionListing, a: LiveActivity): boolean {
  if (playersMatch(listing.player, a.listing_player)) return true;
  return listing.year !== null && a.listing_year !== null
    && Math.abs(listing.year - a.listing_year) <= YEAR_TOLERANCE;
}

type Engagement = {
  totalBids: number;
  wonItems: Set<string>;
  lastActivityAt: string | null;
};

// Rank past bidders/buyers for a set of listings.
//
// Ranking is two-layered, because "who is worth tagging" and "who is worth
// tagging FIRST" are different questions. Tranche membership measures the
// bidder's engagement with the auctions overall — do they bid a lot, do they
// ever buy, are they still around. Ordering inside a tranche measures how
// closely their history matches the cards actually in this sale.
//
// The algorithm is format-independent: auctions and claim sales run identical
// logic, on the assumption that interest follows the items, not the channel.
export function computeBidderSuggestions(
  listings: SuggestionListing[],
  activity: LiveActivity[],
  bidders: BidderRow[],
  opts: {
    max?: number;
    now?: number;
    recentDays?: number;
    minPriorityBids?: number;
  } = {},
): BidderSuggestion[] {
  if (listings.length === 0 || activity.length === 0) return [];
  const now = opts.now ?? Date.now();
  const recentDays = opts.recentDays ?? RECENT_DAYS;
  const minPriorityBids = opts.minPriorityBids ?? MIN_PRIORITY_BIDS;

  const byId = new Map(bidders.map(b => [b.id, b]));

  // Pass 1 — all-time engagement, over every activity row whether or not it
  // matches this sale. This is what the tranches are decided on.
  const engagement = new Map<string, Engagement>();
  for (const a of activity) {
    let e = engagement.get(a.bidder_id);
    if (!e) {
      e = { totalBids: 0, wonItems: new Set(), lastActivityAt: null };
      engagement.set(a.bidder_id, e);
    }
    if (a.kind === 'bid') e.totalBids += 1;
    if (a.is_winner) e.wonItems.add(a.item_key);
    e.lastActivityAt = laterOf(e.lastActivityAt, a.occurred_at);
  }

  // Pass 2 — the part of that history which matches the cards in this sale.
  type Acc = {
    bidder: BidderRow;
    bidCount: number;
    wonItems: Set<string>;
    claimItems: Set<string>;
    paidItems: Map<string, number>;
    matchedListingIds: Set<string>;
  };
  const matched = new Map<string, Acc>();
  for (const a of activity) {
    const bidder = byId.get(a.bidder_id);
    if (!bidder) continue;
    let acc: Acc | undefined;
    for (const l of listings) {
      if (!activityMatches(l, a)) continue;
      if (!acc) {
        acc = matched.get(a.bidder_id);
        if (!acc) {
          acc = {
            bidder, bidCount: 0, wonItems: new Set(), claimItems: new Set(),
            paidItems: new Map(), matchedListingIds: new Set(),
          };
          matched.set(a.bidder_id, acc);
        }
      }
      acc.matchedListingIds.add(l.id);
    }
    if (!acc) continue;
    // Counted once per activity row, not once per listing it matched, so a
    // 60-card sale does not inflate every bidder 60-fold.
    if (a.kind === 'bid') acc.bidCount += 1;
    if (a.is_winner) {
      if (a.source === 'claim') acc.claimItems.add(a.item_key);
      else acc.wonItems.add(a.item_key);
    }
    if (a.is_paid && a.bid_amount) acc.paidItems.set(a.item_key, a.bid_amount);
  }
  if (matched.size === 0) return [];

  // "High relative bid count" adapts to the pool: in a sale that only matches
  // heavy hitters the bar rises, so the priority band stays meaningful instead
  // of swallowing everyone. The floor keeps it honest in a thin match.
  const matchedTotals = Array.from(matched.keys())
    .map(id => engagement.get(id)?.totalBids ?? 0)
    .sort((x, y) => x - y);
  const p60 = matchedTotals[Math.floor(matchedTotals.length * 0.6)] ?? 0;
  const priorityBidBar = Math.max(minPriorityBids, p60);

  const results: BidderSuggestion[] = [];
  for (const [id, acc] of matched) {
    const e = engagement.get(id) ?? { totalBids: 0, wonItems: new Set<string>(), lastActivityAt: null };
    const totalWins = e.wonItems.size;
    const days = daysSince(e.lastActivityAt, now);
    const isRecent = days !== null && days <= recentDays;
    let tranche: Tranche;
    if (e.totalBids >= priorityBidBar && totalWins >= 1 && isRecent) tranche = 'priority';
    else if (isRecent) tranche = 'active';
    else if (e.totalBids >= priorityBidBar || totalWins >= 1) tranche = 'proven';
    else tranche = 'tail';
    let totalSpend = 0;
    for (const v of acc.paidItems.values()) totalSpend += v;
    results.push({
      bidder: acc.bidder,
      tranche,
      bidCount: acc.bidCount,
      wonCount: acc.wonItems.size,
      claimCount: acc.claimItems.size,
      totalSpend,
      matchedListingIds: Array.from(acc.matchedListingIds),
      totalBids: e.totalBids,
      totalWins,
      lastActivityAt: e.lastActivityAt,
      daysSinceActivity: days,
      isBidBumper: e.totalBids >= BUMPER_MIN_BIDS && totalWins === 0,
    });
  }

  const rank = (t: Tranche) => TRANCHE_ORDER.indexOf(t);
  results.sort((a, b) => {
    if (a.tranche !== b.tranche) return rank(a.tranche) - rank(b.tranche);
    // Bids first, as asked: someone who keeps pushing the price up is worth
    // tagging even when they rarely take the card home.
    if (b.bidCount !== a.bidCount) return b.bidCount - a.bidCount;
    if (b.totalBids !== a.totalBids) return b.totalBids - a.totalBids;
    const aWon = a.wonCount + a.claimCount;
    const bWon = b.wonCount + b.claimCount;
    if (bWon !== aWon) return bWon - aWon;
    const ad = a.daysSinceActivity ?? Number.MAX_SAFE_INTEGER;
    const bd = b.daysSinceActivity ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return b.totalSpend - a.totalSpend;
  });
  return opts.max ? results.slice(0, opts.max) : results;
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
  hint = 'Banded by engagement, then sorted by bids on matching cards. Matched on the player’s last name, or any card within ±2 years.',
}: {
  suggestions: BidderSuggestion[];
  headline?: string;
  hint?: string;
}) {
  // Which bands to tag. Defaults to everyone, because the long tail still
  // matches; narrow it when you only want people who are actively bidding.
  const [depth, setDepth] = useState<'priority' | 'active' | 'all'>('all');

  const visible = useMemo(() => {
    if (depth === 'priority') return suggestions.filter(s => s.tranche === 'priority');
    if (depth === 'active') return suggestions.filter(s => s.tranche === 'priority' || s.tranche === 'active');
    return suggestions;
  }, [suggestions, depth]);

  const counts = useMemo(() => {
    const c: Record<Tranche, number> = { priority: 0, active: 0, proven: 0, tail: 0 };
    for (const s of suggestions) c[s.tranche] += 1;
    return c;
  }, [suggestions]);

  if (suggestions.length === 0) return null;

  const postTags = visible.slice(0, POST_TAG_LIMIT);
  const commentTags = visible.slice(POST_TAG_LIMIT);
  const postTagText = postTags
    .map(s => s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name)
    .join(' ');
  // Comment mentions must be typed with a leading @ to trigger Facebook's
  // tagger, so force the @ prefix even when we only have a display name.
  const commentTagText = commentTags
    .map(s => `@${s.bidder.fb_handle || s.bidder.name}`)
    .join(' ');

  const depthOptions: { key: 'priority' | 'active' | 'all'; label: string; n: number }[] = [
    { key: 'priority', label: 'Priority only', n: counts.priority },
    { key: 'active', label: '+ Active', n: counts.priority + counts.active },
    { key: 'all', label: 'Everyone', n: suggestions.length },
  ];

  return (
    <section className="panel-bordered" style={{
      padding: '18px 22px',
      background: 'rgba(56,142,142,0.06)', border: '1.5px solid var(--teal)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>★ {headline} ★</div>
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{hint}</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', border: '1.5px solid var(--teal)', borderRadius: 100, overflow: 'hidden' }}>
          {depthOptions.map(o => (
            <button key={o.key} type="button" onClick={() => setDepth(o.key)}
              title={`Tag ${o.n} bidder${o.n === 1 ? '' : 's'}`}
              style={{
                border: 0, cursor: 'pointer', padding: '4px 12px', fontSize: 11, fontWeight: 700,
                fontFamily: 'inherit',
                background: depth === o.key ? 'var(--teal)' : 'transparent',
                color: depth === o.key ? 'var(--cream)' : 'var(--teal)',
              }}>
              {o.label} ({o.n})
            </button>
          ))}
        </div>
        <CopyButton
          text={postTagText}
          label={commentTags.length > 0
            ? `📋 Copy first ${postTags.length} (post)`
            : `📋 Copy all ${postTags.length} tag${postTags.length === 1 ? '' : 's'}`}
        />
      </div>
      {visible.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic', padding: '6px 0' }}>
          No bidders in this band for these cards — widen the selection above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {visible.map((s, i) => {
            const tag = s.bidder.fb_handle ? `@${s.bidder.fb_handle}` : s.bidder.name;
            const isComment = i >= POST_TAG_LIMIT;
            const commentTag = `@${s.bidder.fb_handle || s.bidder.name}`;
            const startsBand = i === 0 || visible[i - 1].tranche !== s.tranche;
            return (
              <React.Fragment key={s.bidder.id}>
                {startsBand && (
                  <div style={{
                    flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    margin: i === 0 ? '2px 0' : '10px 0 2px', fontSize: 11, fontWeight: 700,
                    color: s.tranche === 'priority' ? 'var(--teal)' : 'var(--ink-mute)',
                  }}>
                    <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {TRANCHE_LABEL[s.tranche]}
                    </span>
                    <span style={{ fontWeight: 400, fontStyle: 'italic' }}>{TRANCHE_HINT[s.tranche]}</span>
                    <span style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.25 }} />
                  </div>
                )}
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
                  border: `1.5px solid ${isComment ? 'var(--orange)' : s.tranche === 'priority' ? 'var(--teal)' : 'var(--rule)'}`,
                  borderRadius: 100, fontSize: 12, color: 'var(--plum)',
                  opacity: isComment ? 0.9 : 1,
                }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{i + 1}</span>
                  <span style={{ fontWeight: 700 }}>{s.bidder.name}</span>
                  {s.bidder.fb_handle && <span className="mono" style={{ fontSize: 10.5, color: 'var(--teal)' }}>@{s.bidder.fb_handle}</span>}
                  {s.isBidBumper && (
                    <span title="Bids a lot, rarely wins — drives your prices up"
                      style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '1px 6px',
                        borderRadius: 100, background: 'var(--mustard)', color: 'var(--plum)',
                      }}>
                      ↑ BUMPER
                    </span>
                  )}
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                    {s.bidCount} bid{s.bidCount === 1 ? '' : 's'}
                    {s.wonCount > 0 ? ` · ${s.wonCount} won` : ''}
                    {s.claimCount > 0 ? ` · ${s.claimCount} claimed` : ''}
                    {s.daysSinceActivity !== null ? ` · ${s.daysSinceActivity}d ago` : ''}
                  </span>
                  <CopyButton text={isComment ? commentTag : tag} label="📋" />
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
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
