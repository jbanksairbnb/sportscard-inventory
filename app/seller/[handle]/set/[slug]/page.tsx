import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { loadShowcase } from './loadShowcase';
import PublicSetShowcase from './PublicSetShowcase';
import { buildShowcaseCards, completionOf, fmtMoney } from '@/lib/setShowcase';

// Public, read-only showcase of a seller's set — the link a seller drops in a
// Facebook post. No sign-in needed (/seller is a public path in proxy.ts).
// Visible when the owner turns on "Public page" for the set (or while the set
// has an active complete-set marketplace listing); otherwise 404.
//
// Shows price / offers, the set's value movement, completion, condition mix,
// key cards, value over time, the top 16 cards by value, and then the whole
// checklist in card-number order. Data is trimmed to buyer-safe fields in
// loadShowcase.

export const dynamic = 'force-dynamic';

type Params = { handle: string; slug: string };

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { handle, slug } = await props.params;
  const data = await loadShowcase(handle, slug);
  if (!data) return { title: 'Set not found · Sports Collective' };

  const cards = buildShowcaseCards(data.rows, data.set.year, data.set.brand, data.marksByKey);
  const completion = completionOf(cards);
  const seen = new Set<string>();
  let value = 0;
  for (const c of cards) {
    if (c.owned && c.value !== null && !seen.has(c.key)) { seen.add(c.key); value += c.value; }
  }
  const price = data.settings.asking_price ?? data.listing?.askingPrice ?? null;
  const facts = [
    completion.missing.length === 0 ? `Complete set · ${completion.total} cards` : `${completion.owned} of ${completion.total} cards`,
    value > 0 ? `Market value ${fmtMoney(value)}` : '',
    price !== null ? `Price ${fmtMoney(price)}` : '',
  ].filter(Boolean).join(' · ');
  const desc = data.settings.description
    ? `${facts}. ${data.settings.description.replace(/\s+/g, ' ').slice(0, 220)}`
    : `${facts}. See the top cards, condition and value history.`;
  const title = `${data.set.title} · ${data.seller.displayName}`;

  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';

  return {
    metadataBase: host ? new URL(`${proto}://${host}`) : undefined,
    title,
    description: desc,
    alternates: { canonical: `/seller/${handle}/set/${slug}` },
    openGraph: {
      type: 'website',
      siteName: 'Sports Collective',
      title,
      description: desc,
      url: `/seller/${handle}/set/${slug}`,
    },
    twitter: { card: 'summary_large_image', title, description: desc },
  };
}

export default async function PublicSellerSetPage(props: { params: Promise<Params> }) {
  const { handle, slug } = await props.params;
  const data = await loadShowcase(handle, slug);
  if (!data) notFound();
  return <PublicSetShowcase data={data} />;
}
