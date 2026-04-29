'use client';

import React, { useEffect, useState } from 'react';

type EbayHit = {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  image?: { imageUrl: string };
  thumbnailImages?: { imageUrl: string }[];
  condition?: string;
  itemWebUrl: string;
  seller?: { username: string; feedbackPercentage?: string; feedbackScore?: number };
  buyingOptions?: string[];
  itemEndDate?: string;
  itemLocation?: { country?: string };
  matched_set_title: string;
  matched_card: string;
  detected_grade?: { type: 'raw' | 'graded'; rank?: number; grade?: number; company?: string };
};

function fmtMoney(value: string | undefined, currency = 'USD'): string {
  if (!value) return '—';
  const n = parseFloat(value);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
}

function fmtTimeLeft(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function EbayHitsFeed() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hits, setHits] = useState<EbayHit[]>([]);
  const [error, setError] = useState('');
  const [wantCount, setWantCount] = useState(0);

  async function load(forceRefresh = false) {
    setError('');
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch('/api/feed/ebay-hits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load eBay hits');
      setHits(data.hits || []);
      setWantCount(data.wantCount || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load eBay hits');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
  }, []);

  if (loading) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
        Searching eBay for matches…
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--rust)', fontWeight: 600, marginBottom: 8 }}>{error}</div>
        <button onClick={() => load(false)} className="btn btn-outline btn-sm">Try again</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>
          {hits.length === 0
            ? `Scanned ${wantCount} cards from your want list — no eBay matches right now.`
            : `${hits.length} eBay match${hits.length === 1 ? '' : 'es'} from ${wantCount} cards on your want list.`}
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="btn btn-ghost btn-sm">
          {refreshing ? 'Refreshing…' : '↻ Refresh from eBay'}
        </button>
      </div>

      {hits.length === 0 ? (
        <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Nothing matching your conditions on eBay right now. Click <strong>Refresh from eBay</strong> to bypass the cache, or check back later — we re-scan every 6 hours.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {hits.map(h => <HitItem key={h.itemId} hit={h} />)}
        </div>
      )}
    </div>
  );
}

function HitItem({ hit }: { hit: EbayHit }) {
  const photo = hit.image?.imageUrl || hit.thumbnailImages?.[0]?.imageUrl;
  const isAuction = hit.buyingOptions?.includes('AUCTION');
  const timeLeft = fmtTimeLeft(hit.itemEndDate);
  const conditionBadge = hit.detected_grade
    ? hit.detected_grade.type === 'graded'
      ? `${hit.detected_grade.company || ''} ${hit.detected_grade.grade || ''}`.trim()
      : (hit.condition || 'Raw')
    : (hit.condition || 'Unknown');

  return (
    <article className="panel" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'stretch' }}>
      <div style={{
        width: 115, height: 161, flexShrink: 0,
        background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 8,
        overflow: 'hidden', display: 'grid', placeItems: 'center',
      }}>
        {photo ? (
          <img src={photo} alt={hit.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>No photo</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="chip" style={{ fontSize: 10, background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--plum)', fontWeight: 700 }}>
            ◆ eBay match
          </span>
          {isAuction && timeLeft && (
            <span className="chip chip-navy" style={{ fontSize: 10 }}>Auction · ends {timeLeft}</span>
          )}
          <span className="chip" style={{ fontSize: 10, background: 'var(--paper)', color: 'var(--plum)', border: '1.5px solid var(--rule)' }}>
            from your {hit.matched_set_title} list
          </span>
        </div>

        <h3 className="display" style={{ fontSize: 18, margin: '4px 0 4px', color: 'var(--plum)', lineHeight: 1.25 }}>
          {hit.title}
        </h3>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8, fontWeight: 500 }}>
          Match: <strong style={{ color: 'var(--plum)' }}>{hit.matched_card}</strong>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 8 }}>
          <strong>{conditionBadge}</strong>
          {hit.seller?.username && (
            <> · <span className="mono">{hit.seller.username}</span>
              {hit.seller.feedbackPercentage && <> · {hit.seller.feedbackPercentage}% positive</>}
            </>
          )}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="stat-num" style={{ fontSize: 26, color: 'var(--orange)' }}>
            {fmtMoney(hit.price?.value, hit.price?.currency)}
          </div>
          <a href={hit.itemWebUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
            View on eBay →
          </a>
        </div>
      </div>
    </article>
  );
}
