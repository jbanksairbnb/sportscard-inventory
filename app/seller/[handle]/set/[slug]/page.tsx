import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import SCLogo from '@/components/SCLogo';

// Public, read-only view of a seller's set when they have an active
// listing_type='set' listing pointing at it. Buyers reach this page
// from the "↗ View set contents" link on a marketplace set listing.
// Access is gated on the listing's existence — sets without an active
// set-listing return 404 here.

type SetRow = Record<string, unknown>;

export const dynamic = 'force-dynamic';

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function cardLabel(r: SetRow): string {
  const parts = [
    r['Card #'] ? `#${r['Card #']}` : '',
    String(r['Player'] || r['Description'] || ''),
  ].filter(Boolean);
  return parts.join(' ').trim() || '(card)';
}

function conditionLabel(r: SetRow): string {
  const gco = String(r['Grading Company'] || '').trim();
  const grade = String(r['Grade'] || '').trim();
  if (gco && grade) return `${gco} ${grade}`;
  const raw = String(r['Raw Grade'] || '').trim();
  return raw || '—';
}

export default async function PublicSellerSetPage(props: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await props.params;

  // Public read using service-role so we can join across users without
  // worrying about RLS on the buyer side. Only emits data when an active
  // set-type listing exists; otherwise the page 404's.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: seller } = await admin
    .from('user_profiles')
    .select('user_id, handle, display_name')
    .eq('handle', handle)
    .maybeSingle();
  if (!seller) notFound();

  const { data: listing } = await admin
    .from('listings')
    .select('id, title, description, asking_price, photos, shipping_options, status')
    .eq('user_id', seller.user_id)
    .eq('listing_type', 'set')
    .eq('set_slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (!listing) notFound();

  const { data: set } = await admin
    .from('sets')
    .select('title, year, brand, rows, owned_count, row_count')
    .eq('user_id', seller.user_id)
    .eq('slug', slug)
    .maybeSingle();
  if (!set) notFound();

  const rows = (Array.isArray(set.rows) ? set.rows : []) as SetRow[];
  const ownedRows = rows.filter(r => String(r['Owned'] || '') === 'Yes');
  const totalCount = set.row_count ?? rows.length;
  const ownedCount = set.owned_count ?? ownedRows.length;

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/marketplace" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div style={{ flex: 1 }} />
          <Link href="/marketplace" className="btn btn-ghost btn-sm">← Marketplace</Link>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '20px 24px', marginBottom: 18 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 100, background: 'var(--teal)', color: 'var(--cream)' }}>📚 COMPLETE SET</span>
          <h1 className="display" style={{ fontSize: 30, color: 'var(--plum)', margin: '10px 0 6px' }}>
            {listing.title}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
            Sold by <strong>{seller.display_name || seller.handle}</strong> · <strong>{ownedCount} of {totalCount}</strong> cards{ownedCount < totalCount ? ' (partial set)' : ' (complete)'}
          </div>
          {listing.description && (
            <p style={{ margin: '6px 0 12px', fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {listing.description}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
            <div className="display" style={{ fontSize: 28, color: 'var(--plum)', fontWeight: 700 }}>
              {fmtMoney(listing.asking_price as number | null)}
            </div>
            <Link href={`/marketplace?focus=${listing.id}`} className="btn btn-primary">
              Buy this complete set →
            </Link>
          </div>
        </section>

        <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 12 }}>
          Set contents ({ownedCount} cards)
        </div>

        {ownedRows.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '40px 32px', textAlign: 'center', color: 'var(--ink-mute)' }}>
            The seller hasn&apos;t marked any cards as Owned in this set yet.
          </div>
        ) : (
          <div className="panel-bordered" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--plum)', color: 'var(--mustard)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '10px 14px', textAlign: 'left', width: 90 }}>Image</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Card</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Condition</th>
                </tr>
              </thead>
              <tbody>
                {ownedRows.map((r, i) => {
                  const img = String(r['Image 1'] || '') || String(r['Image 1 Archived'] || '');
                  return (
                    <tr key={i} style={{ borderTop: '1px solid var(--rule)' }}>
                      <td style={{ padding: '8px 14px' }}>
                        <div style={{ width: 64, height: 90, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                          {img ? (
                            <img loading="lazy" decoding="async" src={img} alt={cardLabel(r)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span className="eyebrow" style={{ fontSize: 8, color: 'var(--ink-mute)' }}>—</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 13, color: 'var(--plum)', fontWeight: 600 }}>{cardLabel(r)}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12.5, color: 'var(--ink-soft)' }}>{conditionLabel(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
