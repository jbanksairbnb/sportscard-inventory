'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
  matched_set_slug: string;
  matched_set_title: string;
  matched_card: string;
  matched_card_number: string;
  matched_player: string;
  detected_grade?: { type: 'raw' | 'graded'; rank?: number; grade?: number; company?: string };
};

type SetOption = { slug: string; title: string; unownedCount: number };

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
  const [setOptions, setSetOptions] = useState<SetOption[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [hits, setHits] = useState<EbayHit[]>([]);
  const [error, setError] = useState('');
  const [wantCount, setWantCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    async function loadSets() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSetsLoading(false); return; }
      const { data } = await supabase
        .from('sets')
        .select('slug, title, year, brand, rows')
        .eq('user_id', user.id);
      const opts: SetOption[] = [];
      for (const s of (data || [])) {
        const rows = (s.rows || []) as Record<string, unknown>[];
        const unowned = rows.filter(r => String(r['Owned'] || '') !== 'Yes' && (r['Player'] || r['Description']) && r['Card #']).length;
        if (unowned === 0) continue;
        opts.push({
          slug: s.slug,
          title: s.title || `${s.year} ${s.brand}`,
          unownedCount: unowned,
        });
      }
      opts.sort((a, b) => a.title.localeCompare(b.title));
      setSetOptions(opts);
      setSetsLoading(false);
    }
    loadSets();
  }, []);

  async function runSearch(forceRefresh = false) {
    if (!selectedSlug) return;
    setError('');
    setSearching(true);
    try {
      const res = await fetch('/api/feed/ebay-hits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setSlug: selectedSlug, forceRefresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load eBay hits');
      setHits(data.hits || []);
      setWantCount(data.wantCount || 0);
      setHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load eBay hits');
    } finally {
      setSearching(false);
    }
  }

  function handleHide(itemId: string) {
    setHits(prev => prev.filter(h => h.itemId !== itemId));
    fetch('/api/feed/ebay-hits/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    }).catch(() => {});
  }

  function handleMarkBought(hit: EbayHit) {
    setHits(prev => prev.filter(h =>
      !(h.matched_set_slug === hit.matched_set_slug
        && h.matched_card_number === hit.matched_card_number
        && h.matched_player === hit.matched_player)
    ));
    fetch('/api/feed/ebay-hits/mark-bought', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: hit.itemId,
        setSlug: hit.matched_set_slug,
        cardNumber: hit.matched_card_number,
        player: hit.matched_player,
      }),
    }).catch(() => {});
  }

  const selectedSet = setOptions.find(s => s.slug === selectedSlug);

  return (
    <div>
      <div className="panel" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="eyebrow" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700 }}>
          Search a set
        </label>
        <select
          value={selectedSlug}
          onChange={e => { setSelectedSlug(e.target.value); setHits([]); setHasSearched(false); setError(''); }}
          disabled={setsLoading || searching}
          style={{
            flex: 1, minWidth: 220, padding: '8px 10px', fontSize: 13,
            border: '1.5px solid var(--rule)', borderRadius: 6, background: 'var(--paper)',
            color: 'var(--plum)', fontWeight: 500,
          }}
        >
          <option value="">{setsLoading ? 'Loading sets…' : setOptions.length === 0 ? 'No sets with unowned cards' : 'Select a set…'}</option>
          {setOptions.map(s => (
            <option key={s.slug} value={s.slug}>{s.title} ({s.unownedCount} unowned)</option>
          ))}
        </select>
        <button
          onClick={() => runSearch(false)}
          disabled={!selectedSlug || searching}
          className="btn btn-primary btn-sm"
        >
          {searching ? 'Searching…' : 'Search eBay'}
        </button>
        {hasSearched && selectedSlug && (
          <button
            onClick={() => runSearch(true)}
            disabled={searching}
            className="btn btn-ghost btn-sm"
            title="Bypass cache and re-query eBay"
          >
            ↻ Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="panel" style={{ padding: 24, textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--rust)', fontWeight: 600, marginBottom: 8 }}>{error}</div>
          <button onClick={() => runSearch(false)} className="btn btn-outline btn-sm">Try again</button>
        </div>
      )}

      {!hasSearched && !error && (
        <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Pick a set above and click <strong>Search eBay</strong> to find current listings that match your unowned cards and target conditions.
          </p>
        </div>
      )}

      {hasSearched && !error && hits.length === 0 && (
        <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            Scanned {wantCount} unowned card{wantCount === 1 ? '' : 's'} from {selectedSet?.title || 'this set'} — no eBay matches right now.
            Click <strong>Refresh</strong> to bypass the cache.
          </p>
        </div>
      )}

      {hasSearched && hits.length > 0 && (
        <>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 14 }}>
            {hits.length} eBay match{hits.length === 1 ? '' : 'es'} from {wantCount} unowned card{wantCount === 1 ? '' : 's'} in {selectedSet?.title || 'this set'}.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {hits.map(h => (
              <HitItem
                key={h.itemId}
                hit={h}
                onHide={() => handleHide(h.itemId)}
                onMarkBought={() => handleMarkBought(h)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HitItem({ hit, onHide, onMarkBought }: { hit: EbayHit; onHide: () => void; onMarkBought: () => void }) {
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

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="stat-num" style={{ fontSize: 26, color: 'var(--orange)' }}>
            {fmtMoney(hit.price?.value, hit.price?.currency)}
          </div>
          <a href={hit.itemWebUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
            View on eBay →
          </a>
          <button onClick={onMarkBought} className="btn btn-outline btn-sm" title="Mark this card as owned and hide this listing">
            ✓ Mark as Bought
          </button>
          <button onClick={onHide} className="btn btn-ghost btn-sm" title="Never show this listing again">
            🚫 Hide
          </button>
        </div>
      </div>
    </article>
  );
}
