import React from 'react';
import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import SCLogo from '@/components/SCLogo';
import SetCardsView, { SetCardRow } from '@/components/SetCardsView';
import CopyLinkButton from '@/components/CopyLinkButton';
import ListingGallery from '@/components/ListingGallery';

// Public, no-login page for a single listing — a card, a complete set, or a
// multi-card lot. Sellers paste /l/<listing-id> into Facebook posts. Buyers
// see the photos, description, price and shipping; set listings also show the
// full set contents. Only active (or recently sold) listings resolve; drafts
// and removed listings 404. Private fields (cost, tag, source ids) are never
// selected.

export const dynamic = 'force-dynamic';

const COLUMNS =
  'id, user_id, title, description, asking_price, photos, shipping_options, status, sold_state, ' +
  'listing_type, set_slug, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade';

type Listing = {
  id: string; user_id: string; title: string | null; description: string | null;
  asking_price: number | null; photos: string[] | null;
  shipping_options: Array<{ label: string; cost: number }> | null;
  status: string; sold_state: string | null; listing_type: string | null; set_slug: string | null;
  year: number | null; brand: string | null; card_number: string | null; player: string | null;
  condition_type: string | null; raw_grade: string | null; grading_company: string | null; grade: string | null;
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadListing(id: string): Promise<Listing | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await admin().from('listings').select(COLUMNS).eq('id', id).in('status', ['active', 'sold']).maybeSingle();
  return (data as unknown as Listing) ?? null;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const l = await loadListing(id);
  if (!l) return { title: 'Listing not found — Sports Collective' };
  const title = l.title || 'Sports Collective listing';
  const price = fmtMoney(l.asking_price);
  const desc = [price, (l.description || '').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · ').slice(0, 200)
    || 'View photos and details on Sports Collective.';
  const image = l.photos?.[0];
  return {
    title: `${title} — Sports Collective`,
    description: desc,
    openGraph: { title, description: desc, type: 'website', ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description: desc, ...(image ? { images: [image] } : {}) },
  };
}

export default async function PublicListingPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const listing = await loadListing(id);
  if (!listing) notFound();

  const db = admin();
  const { data: seller } = await db.from('user_profiles').select('handle, display_name').eq('user_id', listing.user_id).maybeSingle();

  const isSet = listing.listing_type === 'set' && !!listing.set_slug;
  let rows: SetCardRow[] = [];
  let ownedCount = 0;
  let totalCount = 0;
  if (isSet) {
    const { data: set } = await db.from('sets').select('rows, owned_count, row_count')
      .eq('user_id', listing.user_id).eq('slug', listing.set_slug!).maybeSingle();
    if (set) {
      rows = (Array.isArray(set.rows) ? set.rows : []) as SetCardRow[];
      totalCount = set.row_count ?? rows.length;
      ownedCount = set.owned_count ?? rows.filter(r => String(r['Owned'] || '') === 'Yes').length;
    }
  }

  const sold = listing.status === 'sold' || listing.sold_state === 'sold';
  const claimed = !sold && listing.sold_state === 'claimed';
  const photos = (listing.photos ?? []).filter(Boolean);
  const title = listing.title || 'Untitled listing';
  const badge = isSet ? '📚 COMPLETE SET' : listing.listing_type === 'lot' ? '📦 LOT' : null;
  const sellerName = seller?.display_name || seller?.handle || null;

  const specs: Array<[string, string]> = [];
  if (listing.player) specs.push(['Player', listing.player]);
  if (listing.year) specs.push(['Year', String(listing.year)]);
  if (listing.brand) specs.push(['Brand', listing.brand]);
  if (listing.card_number) specs.push(['Card #', listing.card_number]);
  if (listing.condition_type === 'graded' && listing.grading_company) specs.push(['Grade', `${listing.grading_company} ${listing.grade ?? ''}`.trim()]);
  else if (listing.raw_grade) specs.push(['Condition', listing.raw_grade]);

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)', borderBottom: '3px solid var(--plum)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={36} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 18, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 11, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div style={{ flex: 1 }} />
          <CopyLinkButton label="Share" />
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start' }}>
          <ListingGallery photos={photos} alt={title} />

          <section className="panel-bordered" style={{ padding: '20px 24px' }}>
            {badge && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 100, background: 'var(--teal)', color: 'var(--cream)' }}>{badge}</span>}
            {(sold || claimed) && (
              <span style={{ marginLeft: badge ? 8 : 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 100, background: 'var(--orange)', color: 'var(--cream)' }}>
                {sold ? 'SOLD' : 'CLAIMED'}
              </span>
            )}
            <h1 className="display" style={{ fontSize: 28, color: 'var(--plum)', margin: '10px 0 6px', lineHeight: 1.15 }}>{title}</h1>
            {sellerName && (
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
                Sold by {seller?.handle
                  ? <Link href={`/seller/${seller.handle}`} style={{ fontWeight: 700, color: 'var(--plum)' }}>{sellerName}</Link>
                  : <strong>{sellerName}</strong>}
                {isSet && totalCount > 0 && <> · <strong>{ownedCount} of {totalCount}</strong> cards</>}
              </div>
            )}
            {listing.asking_price != null && (
              <div className="display" style={{ fontSize: 32, color: 'var(--plum)', fontWeight: 700, margin: '4px 0 12px', textDecoration: sold ? 'line-through' : 'none' }}>
                {fmtMoney(listing.asking_price)}
              </div>
            )}
            {specs.length > 0 && (
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', margin: '0 0 14px', fontSize: 13 }}>
                {specs.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt style={{ color: 'var(--ink-soft)' }}>{k}</dt>
                    <dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
            {listing.description && (
              <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {listing.description}
              </p>
            )}
            {(listing.shipping_options ?? []).length > 0 && (
              <div style={{ fontSize: 13, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Shipping</div>
                {listing.shipping_options!.map((s, i) => (
                  <div key={i} style={{ color: 'var(--ink-soft)' }}>{s.label} — {s.cost > 0 ? fmtMoney(s.cost) : 'Free'}</div>
                ))}
              </div>
            )}
            {!sold && (
              <Link href={`/marketplace?focus=${listing.id}`} className="btn btn-primary">
                Buy on Sports Collective →
              </Link>
            )}
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>
              Interested? Comment or message the seller on Facebook, or sign in to buy here.
            </div>
          </section>
        </div>

        {isSet && rows.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>Set contents</div>
            <SetCardsView rows={rows} initialFilter="owned" />
          </div>
        )}
      </main>
    </div>
  );
}
