import Link from 'next/link';
import type { Metadata } from 'next';
import SCLogo from '@/components/SCLogo';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The rules of the road for using Sports Collective.',
  alternates: { canonical: 'https://sports-collective.com/terms' },
};

const LAST_UPDATED = 'January 14, 2026';

export default function TermsPage() {
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
          ★ Terms of Use ★
        </div>
        <h1 className="display" style={{ fontSize: 36, color: 'var(--plum)', margin: '0 0 8px' }}>
          Terms of Use
        </h1>
        <p className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 36 }}>
          Last updated: {LAST_UPDATED}
        </p>

        <Section title="Membership">
          Sports Collective is a curated community. Membership is by application and may be
          revoked at our discretion if a member violates these terms. We may also pause or
          decline applications without explanation.
        </Section>

        <Section title="What you can do">
          <ul>
            <li>Track your own card collection privately.</li>
            <li>Share sets with the community via the sharing tools we provide.</li>
            <li>List cards for sale on our marketplace and in your own Facebook auctions / claim sales.</li>
            <li>Browse other approved members&apos; public profiles and shared sets.</li>
          </ul>
        </Section>

        <Section title="What you can't do">
          <ul>
            <li>Misrepresent cards (condition, authenticity, grading) in listings or auctions.</li>
            <li>Harass, dox, or otherwise target other members.</li>
            <li>Scrape, resell, or otherwise redistribute member or listing data.</li>
            <li>Use the platform to evade taxes or sales-tax obligations that apply to you.</li>
            <li>Try to break, probe, or overload the platform.</li>
          </ul>
        </Section>

        <Section title="Transactions between members">
          Sports Collective provides tools to organize sales — listings, auctions, claim sales,
          invoices, and shipping options. <strong>Transactions happen between you and the other
          member.</strong> We don&apos;t escrow funds or guarantee any sale, payment, condition,
          authenticity, or shipment. You are responsible for resolving any disputes directly with
          the counterparty. We may help mediate but are under no obligation to do so.
        </Section>

        <Section title="Your content">
          You keep ownership of the photos, descriptions, and other content you upload. By
          uploading, you grant Sports Collective a non-exclusive license to display that content
          inside the platform for the purpose of operating the service (showing your sets to
          other members you&apos;ve shared with, displaying your listings on the marketplace,
          etc.). You can request deletion at any time per the Privacy Policy.
        </Section>

        <Section title="No warranty">
          The service is provided &ldquo;as-is&rdquo; without warranty of any kind. We do our
          best to keep things running and accurate, but we&apos;re not liable for lost data, lost
          sales, or other consequential damages. Where the law allows, our total liability is
          limited to the fees you&apos;ve paid us in the prior 12 months (currently zero).
        </Section>

        <Section title="Pricing">
          Membership is currently free during the pilot. We may introduce paid tiers in the
          future; if so, we&apos;ll give existing members notice and a chance to opt out before
          any charge.
        </Section>

        <Section title="Termination">
          You can close your account at any time. We may suspend or terminate access for
          violations of these terms. We&apos;ll do our best to give you a heads-up first when
          practical.
        </Section>

        <Section title="Changes">
          We may update these terms; on material changes we&apos;ll prompt you to re-accept on
          next sign-in.
        </Section>

        <Section title="Contact">
          Questions? Write to{' '}
          <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--orange)', fontWeight: 600 }}>jbanks@sports-collective.com</a>.
        </Section>

        <p style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic', marginTop: 40, paddingTop: 18, borderTop: '1.5px solid var(--rule)' }}>
          This is a plain-language summary. It is not a substitute for legal advice. We&apos;ll
          replace this stub with a full reviewed agreement before broad public launch.
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
