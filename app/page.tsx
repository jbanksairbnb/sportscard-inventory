import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import SCLogo from '@/components/SCLogo';

export const metadata: Metadata = {
  title: 'Sports Collective — Built by a collector, for the collection',
  description:
    "Most platforms are built for sellers. Sports Collective is built for vintage card collectors — automated set-tracking that prevents duplicate purchases, a curated community that bypasses Facebook noise, and tools that match the real vintage workflow.",
  alternates: { canonical: 'https://sports-collective.com/' },
  openGraph: {
    title: 'Sports Collective — Built by a collector, for the collection',
    description:
      'Inventory intelligence, curated community, and Facebook sales tools designed for the vintage workflow.',
    url: 'https://sports-collective.com/',
    siteName: 'Sports Collective',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sports Collective — Built by a collector, for the collection',
    description:
      'Inventory intelligence, curated community, and Facebook sales tools designed for the vintage workflow.',
  },
};

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/home');

  const websiteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sports Collective',
    url: 'https://sports-collective.com',
    description:
      'A community-curated platform for vintage sports card collectors — built for the collection, not the flip.',
  };
  const orgLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Sports Collective',
    url: 'https://sports-collective.com',
    logo: 'https://sports-collective.com/icon.png',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'jbanks@sports-collective.com',
      contactType: 'Customer Support',
    },
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }} />

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto', padding: '12px 28px',
          display: 'flex', alignItems: 'center', gap: 20,
        }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={44} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 22, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 13, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <Link href="/login" className="btn btn-outline btn-sm">Sign In</Link>
            <Link href="/login?mode=register" className="btn btn-primary btn-sm">Apply</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section style={{
        position: 'relative', overflow: 'hidden',
        padding: '80px 28px 70px',
        background: 'linear-gradient(180deg, var(--cream) 0%, var(--paper) 100%)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <div className="eyebrow" style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 700, marginBottom: 18, letterSpacing: '0.22em' }}>
            ★ For vintage sports card collectors ★
          </div>
          <h1 className="wordmark" style={{
            fontSize: 88, color: 'var(--orange)', lineHeight: 0.95,
            textShadow: '4px 4px 0 var(--mustard), 7px 7px 0 var(--plum)',
            margin: '0 0 8px',
          }}>
            Sports
          </h1>
          <div className="display" style={{
            fontSize: 56, color: 'var(--plum)', letterSpacing: '0.04em', marginBottom: 30,
          }}>
            COLLECTIVE
          </div>
          <h2 className="display" style={{
            fontSize: 30, color: 'var(--plum)', lineHeight: 1.25,
            maxWidth: 720, margin: '0 auto 22px',
          }}>
            Built by a collector, for the collection.
          </h2>
          <p style={{
            margin: '0 auto 36px', maxWidth: 720, fontSize: 16.5, lineHeight: 1.65,
            color: 'var(--ink-soft)', fontWeight: 500,
          }}>
            Most platforms are built for sellers. This one is built for <strong>you</strong>. We&apos;ve eliminated
            the friction of vintage collecting — from automated set-tracking that prevents duplicate
            purchases to a streamlined forum that bypasses the noise of social media. The digital
            infrastructure your physical collection deserves.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 30 }}>
            <Link href="/login?mode=register" className="btn btn-primary"
              style={{ fontSize: 15, padding: '12px 26px' }}>
              Apply for Membership →
            </Link>
            <Link href="/login" className="btn btn-outline"
              style={{ fontSize: 15, padding: '12px 26px' }}>
              Sign In
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="chip chip-rust">Collect</span>
            <span className="chip chip-gold">Trade</span>
            <span className="chip chip-forest">Connect</span>
          </div>
        </div>
      </section>

      {/* The Pitch — Chaos → Elegance */}
      <section style={{ padding: '70px 28px', background: 'var(--cream)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div className="section-head" style={{ marginBottom: 14, textAlign: 'center', justifyContent: 'center' }}>
            <span className="eyebrow" style={{ fontSize: 13, color: 'var(--orange)' }}>★ Chaos, replaced with elegance ★</span>
          </div>
          <p style={{
            margin: '0 auto 40px', maxWidth: 700, fontSize: 15.5, lineHeight: 1.6,
            color: 'var(--ink-soft)', textAlign: 'center', fontWeight: 500,
          }}>
            Tools designed for the vintage workflow — not retrofitted from a generic marketplace.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            <Pillar
              accent="var(--orange)"
              eyebrow="◆ Inventory Intelligence"
              title="Say goodbye to duplicate buys"
              body="Manage your sets with tools designed specifically for the vintage workflow — track every checklist position, target conditions, target prices, and what's already in your binder."
            />
            <Pillar
              accent="var(--rust)"
              eyebrow="◆ Curation Over Algorithms"
              title="Stop hoping the algorithm shows you the post"
              body="No more refreshing Facebook hoping a 'For Sale' post lands in your feed. We connect you directly to the inventory you actually need — your want list, matched against live listings and FB auctions."
            />
            <Pillar
              accent="var(--teal)"
              eyebrow="◆ Speed Up Your Posts"
              title="Streamline your Facebook business"
              body="Auctions, claim sales, bid tracking, per-buyer invoices, and one-click image assembly. Built for the way collectors actually sell on Facebook."
            />
            <Pillar
              accent="var(--plum)"
              eyebrow="◆ Community First"
              title="The hobby outranks the hustle"
              body="A dedicated, curated space where the love of the hobby comes before the flip. Members are vetted. Profiles, shared sets, and connections that actually help your collection grow."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '70px 28px', background: 'var(--paper)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="section-head" style={{ marginBottom: 36, textAlign: 'center', justifyContent: 'center' }}>
            <span className="eyebrow" style={{ fontSize: 13, color: 'var(--orange)' }}>★ How it works ★</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            <Step n={1} title="Apply" body="Tell us about your collection and where you trade today. Membership is curated to keep the community healthy." />
            <Step n={2} title="Build your shelf" body="Spin up sets from templates or your own CSV. Drop in card photos, target conditions, and target prices — and a sale price you'd happily take for your extras." />
            <Step n={3} title="Sell & connect" body="Generate Facebook posts and auctions, run claim sales, settle invoices. See who's chasing what you've got — and vice versa." />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ padding: '80px 28px', background: 'var(--plum)', color: 'var(--cream)', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div className="display" style={{ fontSize: 36, color: 'var(--mustard)', marginBottom: 14 }}>
            Ready to organize the chase?
          </div>
          <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 28, color: 'rgba(248,236,208,0.85)' }}>
            Apply for membership and we&apos;ll get you set up. Existing members can sign in below.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/login?mode=register" className="btn btn-primary"
              style={{ fontSize: 15, padding: '12px 26px' }}>
              Apply for Membership →
            </Link>
            <Link href="/login" className="btn btn-outline"
              style={{ fontSize: 15, padding: '12px 26px',
                background: 'transparent', color: 'var(--cream)',
                border: '2px solid var(--cream)' }}>
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '28px',
        borderTop: '3px solid var(--plum)', background: 'var(--cream)',
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          color: 'var(--plum)', fontSize: 12, fontWeight: 600,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SCLogo size={32} />
            <div className="display" style={{ fontSize: 12, letterSpacing: '0.04em' }}>Sports COLLECTIVE</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 18 }}>
            <Link href="/privacy" style={{ color: 'var(--plum)', textDecoration: 'none' }}>Privacy</Link>
            <Link href="/terms" style={{ color: 'var(--plum)', textDecoration: 'none' }}>Terms</Link>
            <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--plum)', textDecoration: 'none' }}>Contact</a>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', width: '100%', borderTop: '1.5px solid var(--rule)', paddingTop: 10, marginTop: 6, textAlign: 'center' }}>
            © {new Date().getFullYear()} Sports Collective · Est. 2023 · Keep on collectin&apos;
          </div>
        </div>
      </footer>
    </div>
  );
}

function Pillar({ accent, eyebrow, title, body }: {
  accent: string; eyebrow: string; title: string; body: string;
}) {
  return (
    <div className="panel-bordered" style={{
      padding: 26, background: 'var(--paper)', borderTop: `4px solid ${accent}`,
    }}>
      <div className="eyebrow" style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: '0.16em', marginBottom: 8 }}>
        {eyebrow}
      </div>
      <div className="display" style={{ fontSize: 19, color: 'var(--plum)', marginBottom: 12, lineHeight: 1.25 }}>{title}</div>
      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)', margin: 0 }}>{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="panel-bordered" style={{ padding: 28, background: 'var(--cream)' }}>
      <div style={{
        width: 48, height: 48,
        background: 'var(--orange)', color: 'var(--cream)',
        display: 'grid', placeItems: 'center', borderRadius: '50%',
        fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
        border: '2px solid var(--plum)', boxShadow: '0 3px 0 var(--plum)',
        marginBottom: 16,
      }}>{n}</div>
      <div className="display" style={{ fontSize: 18, color: 'var(--plum)', marginBottom: 8 }}>{title}</div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)' }}>{body}</p>
    </div>
  );
}
