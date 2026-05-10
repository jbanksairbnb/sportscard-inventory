'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

// Seller Terms & Conditions acceptance gate.
//
// Reachable after the admin grants can_sell — the approval email links
// straight here. The user must check the agreement box and click the
// button; on success we record seller_terms_accepted_at = NOW() and route
// them to /home with selling tools unlocked.
//
// Routing:
//   - No auth → /login
//   - can_sell=false (and not admin) → /apply (selling not approved yet)
//   - seller_terms_accepted_at IS NOT NULL → /home (already accepted)
//   - Otherwise → render the agreement form.
export default function SellerTermsPage() {
  const router = useRouter();
  const [stage, setStage] = useState<'loading' | 'form' | 'submitting' | 'done'>('loading');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = createClient();
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('can_sell, is_admin, seller_terms_accepted_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile?.can_sell && !profile?.is_admin) {
        router.replace('/apply');
        return;
      }
      if (profile.seller_terms_accepted_at) {
        router.replace('/home');
        return;
      }
      setStage('form');
    }
    check();
  }, [router]);

  async function handleAgree() {
    if (!agreed) return;
    setError('');
    setStage('submitting');
    const res = await fetch('/api/seller-terms', { method: 'POST' });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: 'Unknown error' }));
      setError(err || 'Could not record acceptance.');
      setStage('form');
      return;
    }
    setStage('done');
    setTimeout(() => router.push('/home'), 1200);
  }

  if (stage === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        background: 'rgba(248,236,208,0.96)', borderBottom: '3px solid var(--plum)',
        padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <SCLogo size={40} />
        <div style={{ lineHeight: 0.95 }}>
          <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
          <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px 80px' }}>
        <div style={{ width: '100%', maxWidth: 720 }}>

          {stage === 'done' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
              <div className="eyebrow" style={{ color: 'var(--orange)', marginBottom: 10 }}>★ Welcome to the Collective ★</div>
              <h1 className="display" style={{ fontSize: 40, color: 'var(--plum)', margin: '0 0 24px' }}>
                Selling Activated
              </h1>
              <p style={{ fontSize: 14.5, color: 'var(--ink-soft)' }}>Redirecting you home…</p>
            </div>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div className="eyebrow" style={{ color: 'var(--orange)', marginBottom: 10 }}>★ One Last Step ★</div>
                <h1 className="display" style={{ fontSize: 40, color: 'var(--plum)', margin: '0 0 12px' }}>
                  Seller Terms &amp; Conditions
                </h1>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
                  Your selling application was approved — welcome aboard. Please read and agree to the
                  terms below to activate your seller account.
                </p>
              </div>

              <div className="panel-bordered" style={{ padding: '28px 32px', maxHeight: 480, overflowY: 'auto', lineHeight: 1.7, fontSize: 14, color: 'var(--ink-soft)' }}>
                <p style={{ margin: '0 0 16px' }}>
                  Selling on <strong style={{ color: 'var(--plum)' }}>Sports Collective</strong> is a
                  privilege we extend to verified collectors. By activating your seller account, you
                  agree to the following:
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>1. Vintage cards only.</h3>
                <p style={{ margin: 0 }}>
                  For now, &ldquo;vintage&rdquo; means anything <strong>dated 1992 or earlier</strong>. Listings
                  for cards from 1993 or later may be removed without notice.
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>2. Honest pricing — no advertising posts.</h3>
                <p style={{ margin: 0 }}>
                  Don&apos;t post listings that are wildly above market. We use eBay recent solds and
                  current Sports Collective inventory as the benchmark. The marketplace works because
                  buyers trust the price. Egregious overpricing — i.e. listings that are clearly priced
                  as &ldquo;advertising&rdquo; rather than to sell — will be removed and may put your selling
                  privileges at risk.
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>3. Honest grading.</h3>
                <p style={{ margin: 0 }}>
                  When describing condition (raw or graded), describe what a major grading company would
                  realistically assign. We don&apos;t expect perfection — just your best, experienced read.
                  If there&apos;s any flaw worth knowing (centering, surface, edges, corners), call it out
                  in the description. Buyers should never be surprised by what arrives.
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>4. Professional, courteous communication.</h3>
                <p style={{ margin: 0 }}>
                  Every interaction with buyers — pre-sale, during the transaction, after — must be
                  respectful and professional. <strong>Zero tolerance</strong> for abusive, threatening,
                  harassing, or discriminatory messages. A single confirmed incident is grounds for
                  immediate revocation of selling privileges.
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>5. Fulfillment &amp; shipping.</h3>
                <p style={{ margin: 0 }}>
                  When you mark a sale paid, ship promptly (within 5 business days). Use the shipping
                  option the buyer paid for. Communicate any delays as early as possible.
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>6. Buyer-protected payments.</h3>
                <p style={{ margin: 0 }}>
                  Sellers must accept payment methods that include buyer protection (e.g.,
                  <strong> PayPal Goods &amp; Services</strong>) without surcharging the buyer for fees.
                  Price your cards to absorb processing costs. Demanding Friends &amp; Family, Zelle, or
                  other unprotected methods as the only option is not allowed — buyers always need a
                  recourse path.
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>7. Liability &amp; responsibility.</h3>
                <p style={{ margin: 0 }}>
                  You are solely responsible for the accuracy of your listings, the condition of cards
                  you sell, and the fulfillment of your sales. Sports Collective is a marketplace — we
                  are not party to any transaction and do not hold funds. Any disputes are between buyer
                  and seller, though serious complaints may affect your selling privileges.{' '}
                  <strong>
                    Sports Collective makes no warranties, express or implied, about items listed by
                    sellers and disclaims all liability for loss, damage, or any direct, indirect,
                    incidental, or consequential damages arising from transactions on the platform.
                    By selling here, you indemnify Sports Collective and its operators against claims
                    arising from your listings or conduct.
                  </strong>
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>8. Account integrity.</h3>
                <p style={{ margin: 0 }}>
                  One seller account per person. Don&apos;t share credentials. Don&apos;t attempt to
                  manipulate listings, ratings, or the marketplace.
                </p>

                <h3 style={{ color: 'var(--plum)', marginTop: 18, marginBottom: 6, fontSize: 16 }}>9. Changes to these terms.</h3>
                <p style={{ margin: 0 }}>
                  We may update these terms as the community grows. Continued selling activity after
                  updates are published constitutes acceptance.
                </p>
              </div>

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                marginTop: 22, padding: '14px 18px',
                border: agreed ? '2px solid var(--plum)' : '1.5px solid var(--rule)',
                borderRadius: 10,
                background: agreed ? 'var(--cream)' : 'transparent',
              }}>
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18 }} />
                <span style={{ fontSize: 14, color: 'var(--plum)', lineHeight: 1.5 }}>
                  I have read and agree to the Sports Collective Seller Terms &amp; Conditions above.
                  I understand my selling privileges may be revoked for any violation.
                </span>
              </label>

              {error && (
                <div style={{
                  marginTop: 14, background: 'rgba(197,74,44,0.1)',
                  border: '1.5px solid var(--rust)', borderRadius: 8,
                  padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600,
                }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => router.push('/home')} className="btn btn-ghost btn-sm">
                  ← Back to Home
                </button>
                <button
                  onClick={handleAgree}
                  disabled={!agreed || stage === 'submitting'}
                  className="btn btn-primary"
                  style={{ fontSize: 15, padding: '13px 28px' }}
                >
                  {stage === 'submitting' ? 'Activating…' : 'I Agree, Activate Selling →'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
