import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import SCLogo from '@/components/SCLogo';
import { fetchAll } from '@/lib/supabase/fetchAll';
import StorefrontListings, { StorefrontItem } from './StorefrontListings';

// Public, read-only storefront for a single seller. Reachable with no login
// (see PUBLIC_PATHS in proxy.ts). Shows the seller's active listings so the
// owner can hand out a shareable URL — /seller/<handle> — to people who
// aren't members. There is NO purchase functionality here: every "buy" path
// routes a visitor to /login. Data is read with the service-role key so this
// page never depends on (or loosens) the authenticated-only RLS policies that
// power the real marketplace. Seller email is deliberately never selected or
// rendered — only display name / handle.

export const dynamic = 'force-dynamic';

type ListingRow = {
  id: string;
  title: string;
  description: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  condition_type: 'raw' | 'graded' | null;
  raw_grade: string | null;
  grading_company: string | null;
  grade: string | null;
  asking_price: number | null;
  photos: string[] | null;
  listing_type: 'card' | 'set' | null;
  set_slug: string | null;
};

function conditionLabel(l: ListingRow): string {
  if (l.condition_type === 'graded') {
    return [l.grading_company, l.grade].filter(Boolean).join(' ') || 'Graded';
  }
  return l.raw_grade || 'Raw';
}

export default async function SellerStorefrontPage(props: { params: Promise<{ handle: string }> }) {
  const { handle } = await props.params;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Note: email is intentionally excluded from this select.
  const { data: seller } = await admin
    .from('user_profiles')
    .select('user_id, handle, display_name, bio, city, team, avatar_url')
    .eq('handle', handle)
    .maybeSingle();
  if (!seller) notFound();

  // PostgREST caps any single query at 1000 rows, so a seller with more than
  // 1000 active listings would silently lose the rest (and the storefront's
  // client-side search would never see them). fetchAll walks the result set in
  // 1000-row windows so the full inventory reaches the page.
  const rows = await fetchAll<ListingRow>((from, to) =>
    admin
      .from('listings')
      .select('id, title, description, year, brand, card_number, player, condition_type, raw_grade, grading_company, grade, asking_price, photos, listing_type, set_slug')
      .eq('user_id', seller.user_id)
      .eq('status', 'active')
      .gt('asking_price', 0)
      .order('year', { ascending: true })
      .order('brand', { ascending: true })
      .range(from, to)
  );

  const listings = rows as ListingRow[];
  // year → brand → card # (numeric) so set-completion browsers see cards in order.
  listings.sort((a, b) => {
    const yd = (a.year || 0) - (b.year || 0);
    if (yd !== 0) return yd;
    const bd = (a.brand || '').localeCompare(b.brand || '');
    if (bd !== 0) return bd;
    return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
  });

  const items: StorefrontItem[] = listings.map(l => ({
    id: l.id,
    title: l.title,
    description: l.description,
    conditionLabel: conditionLabel(l),
    askingPrice: l.asking_price,
    photos: Array.isArray(l.photos) ? l.photos : [],
    isSet: l.listing_type === 'set',
    setHref: l.listing_type === 'set' && l.set_slug
      ? `/seller/${encodeURIComponent(seller.handle as string)}/set/${encodeURIComponent(l.set_slug)}`
      : null,
    searchText: [
      l.title, l.description, l.player, l.brand, l.card_number,
      l.year, conditionLabel(l),
    ].filter(Boolean).join(' ').toLowerCase(),
  }));

  const sellerName = (seller.display_name as string) || (seller.handle as string);

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div style={{ flex: 1 }} />
          <Link href="/login" className="btn btn-primary btn-sm">Log in</Link>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '22px 26px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          {seller.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={seller.avatar_url as string} alt={sellerName}
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--plum)' }} />
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: '50%', border: '2px solid var(--plum)',
              background: 'var(--teal)', color: 'var(--cream)', display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-display)', fontSize: 26,
            }}>{sellerName.slice(0, 1).toUpperCase()}</div>
          )}
          <div style={{ flex: 1, minWidth: 200 }}>
            <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>★ Storefront ★</span>
            <h1 className="display" style={{ fontSize: 28, color: 'var(--plum)', margin: '4px 0 2px' }}>{sellerName}</h1>
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600 }}>
              {[seller.city, seller.team].filter(Boolean).join(' · ') || `@${seller.handle}`}
            </div>
            {seller.bio && (
              <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{seller.bio as string}</p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="display" style={{ fontSize: 24, color: 'var(--plum)', fontWeight: 700 }}>{items.length}</div>
            <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>
              {items.length === 1 ? 'listing' : 'listings'} for sale
            </div>
          </div>
        </section>

        <div className="panel" style={{
          padding: '12px 18px', marginBottom: 22, background: 'var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            Browsing as a guest — <strong>log in to buy</strong> or make an offer.
          </span>
          <Link href="/login" className="btn btn-outline btn-sm">Log in / Sign up</Link>
        </div>

        <StorefrontListings items={items} />
      </div>
    </div>
  );
}
