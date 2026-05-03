import Link from 'next/link';
import type { Metadata } from 'next';
import SCLogo from '@/components/SCLogo';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Sports Collective collects, uses, and protects member information.',
  alternates: { canonical: 'https://sports-collective.com/privacy' },
};

const LAST_UPDATED = 'January 14, 2026';

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <Link href="/" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>← Home</Link>
        </div>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '50px 28px 80px' }}>
        <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>
          ★ Privacy Policy ★
        </div>
        <h1 className="display" style={{ fontSize: 36, color: 'var(--plum)', margin: '0 0 8px' }}>
          Privacy Policy
        </h1>
        <p className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 36 }}>
          Last updated: {LAST_UPDATED}
        </p>

        <Section title="Who we are">
          Sports Collective (&ldquo;we,&rdquo; &ldquo;us&rdquo;) is a community-curated platform for
          vintage sports card collectors. This policy explains what information we collect, why
          we collect it, and how we protect it.
        </Section>

        <Section title="What we collect">
          <ul>
            <li><strong>Account info:</strong> email, password (hashed), display name, handle.</li>
            <li><strong>Application info:</strong> a short description of your collection and where you trade today, used during the membership review.</li>
            <li><strong>Profile info you choose to add:</strong> avatar, bio, city, favorite team, favorite players.</li>
            <li><strong>Collection data:</strong> sets, cards, prices, photos, want lists, and listings — only visible to you and to other members through the explicit sharing features you enable.</li>
            <li><strong>Operational logs:</strong> standard request logs and error reporting (no analytics tracking pixels).</li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul>
            <li>To provide the inventory, want-list, and selling tools you use day-to-day.</li>
            <li>To match buyers and sellers — for example, surfacing a listing or auction that matches your want list.</li>
            <li>To send transactional email (purchase confirmations, ship notifications, application status).</li>
            <li>To improve the product. We do <strong>not</strong> sell your data and do <strong>not</strong> use it for third-party advertising.</li>
          </ul>
        </Section>

        <Section title="What other members see">
          Approved members can see your public profile (display name, handle, avatar, bio, city,
          favorite players/teams, favorite cards), and any sets you have explicitly shared.
          They cannot see your costs, your private set rows, or your account email unless you
          choose to email them. Listings show your handle and a contact link if you have an
          active marketplace listing.
        </Section>

        <Section title="Where data lives">
          Account, profile, and collection data are stored with Supabase (US-region Postgres + Storage).
          The site is hosted on Vercel. Transactional email is sent via Resend.
        </Section>

        <Section title="Data deletion">
          You can request account and data deletion at any time by emailing{' '}
          <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--orange)', fontWeight: 600 }}>jbanks@sports-collective.com</a>.
          We&apos;ll remove your profile, sets, listings, and personally identifying information
          within 7 days. Aggregate / non-identifying data (e.g. completed transaction counts) may
          be retained.
        </Section>

        <Section title="Cookies">
          We use essential cookies for sign-in (set by Supabase) and may add Vercel Analytics for
          aggregate page-view counts. We do not run advertising or third-party tracking pixels.
        </Section>

        <Section title="Changes">
          When we update this policy we&apos;ll bump the &ldquo;Last updated&rdquo; date and, for
          material changes, prompt you to re-accept on next sign-in.
        </Section>

        <Section title="Contact">
          Questions? Write to{' '}
          <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--orange)', fontWeight: 600 }}>jbanks@sports-collective.com</a>.
        </Section>

        <p style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic', marginTop: 40, paddingTop: 18, borderTop: '1.5px solid var(--rule)' }}>
          This is a plain-language summary. It is not a substitute for legal advice. We&apos;ll
          replace this stub with a full reviewed policy before broad public launch.
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 className="display" style={{ fontSize: 20, color: 'var(--plum)', margin: '0 0 10px' }}>{title}</h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>{children}</div>
    </section>
  );
}
