'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Stage = 'loading' | 'form' | 'pending' | 'rejected';

const SIGNUP_INTENT_KEY = 'sc:signup-intent';

// Apply to Sell on Sports Collective.
//
// Buying access is granted immediately on signup. This page is the seller
// gate — it captures the application and flips wants_to_sell=true so the
// admin can review at /admin. The admin grants can_sell=true.
//
// Routing logic on mount:
//   - No auth                             → /login
//   - Profile already has can_sell=true   → /home (already a seller)
//   - Profile has wants_to_sell=true      → 'pending' view
//   - Profile.application_status=rejected → 'rejected' view
//   - Otherwise (buyer-only, never applied) → 'form' view
//
// First-time arrival from signup:
//   - If no profile exists yet (signup confirmation just clicked), create
//     one based on the intent stashed in localStorage. Buyer intent: write
//     approved profile, push to /home. Seller intent: write profile with
//     wants_to_sell=true and show the form.
export default function ApplyPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState<Stage>('loading');
  const [collectionDescription, setCollectionDescription] = useState('');
  const [ebayProfile, setEbayProfile] = useState('');
  const [fbGroups, setFbGroups] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      setEmail(user.email || '');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('application_status, can_sell, wants_to_sell')
        .eq('user_id', user.id)
        .maybeSingle();

      // Brand-new auth user with no profile yet — likely arriving from a
      // post-confirmation email click. Use the intent we stashed at signup.
      if (!profile) {
        let intent: 'buyer' | 'seller' = 'buyer';
        try {
          const v = localStorage.getItem(SIGNUP_INTENT_KEY);
          if (v === 'seller') intent = 'seller';
        } catch {}
        await supabase.from('user_profiles').upsert({
          user_id: user.id,
          email: user.email,
          application_status: 'approved',
          can_sell: false,
          wants_to_sell: intent === 'seller',
          applied_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        try { localStorage.removeItem(SIGNUP_INTENT_KEY); } catch {}
        if (intent === 'buyer') { router.push('/home'); return; }
        setStage('form');
        return;
      }

      if (profile.can_sell) { router.push('/home'); return; }
      if (profile.application_status === 'rejected') { setStage('rejected'); return; }
      if (profile.wants_to_sell) { setStage('pending'); return; }
      setStage('form');
    }
    check();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!collectionDescription.trim()) return;
    setSubmitting(true);
    const supabase = createClient();
    await supabase.from('user_profiles').upsert({
      user_id: userId,
      email,
      // Membership stays approved — buying access is unaffected by submitting
      // a seller application. We only flip wants_to_sell so /admin sees them.
      application_status: 'approved',
      collection_description: collectionDescription,
      ebay_profile: ebayProfile,
      fb_groups: fbGroups,
      wants_to_sell: true,
      applied_at: new Date().toISOString(),
    });
    await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicantEmail: email, collectionDescription, ebayProfile, fbGroups, wantsToSell: true }),
    });
    setStage('pending');
    setSubmitting(false);
  }

  if (stage === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    );
  }

  const fieldStyle: React.CSSProperties = {
    border: '2px solid var(--plum)', borderRadius: 8, padding: '10px 14px',
    fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--plum)',
    background: 'var(--cream)', width: '100%', boxSizing: 'border-box',
    outline: 'none',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        background: 'rgba(248,236,208,0.96)', borderBottom: '3px solid var(--plum)',
        padding: '12px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SCLogo size={40} />
          <div style={{ lineHeight: 0.95 }}>
            <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
          </div>
        </div>
        <button onClick={() => router.push('/home')} className="btn btn-ghost btn-sm">← Back to Home</button>
      </header>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px 80px' }}>
        <div style={{ width: '100%', maxWidth: 620 }}>

          {stage === 'pending' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>⏳</div>
              <div className="eyebrow" style={{ color: 'var(--orange)', marginBottom: 10 }}>★ Application Received ★</div>
              <h1 className="display" style={{ fontSize: 40, color: 'var(--plum)', margin: '0 0 24px' }}>
                Selling Application Submitted
              </h1>
              <div className="panel-bordered" style={{ padding: '28px 32px', textAlign: 'left' }}>
                <p style={{ margin: '0 0 14px', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  Thanks for applying to sell on <strong style={{ color: 'var(--plum)' }}>Sports Collective</strong>.
                  We&apos;ll review your application within <strong style={{ color: 'var(--plum)' }}>1–3 business days</strong>.
                </p>
                <p style={{ margin: '0 0 14px', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  In the meantime, your <strong style={{ color: 'var(--plum)' }}>buying access is fully active</strong> —
                  build your shelf, browse the marketplace, and pick up cards from other members.
                </p>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  We may reach out via your eBay profile or Facebook groups as part of verification.
                  Questions? <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--orange)', fontWeight: 600 }}>jbanks@sports-collective.com</a>.
                </p>
              </div>
              <div style={{ marginTop: 28 }}>
                <button onClick={() => router.push('/home')} className="btn btn-primary">Go to Home →</button>
              </div>
            </div>
          ) : stage === 'rejected' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>😔</div>
              <div className="eyebrow" style={{ color: 'var(--orange)', marginBottom: 10 }}>★ Application Update ★</div>
              <h1 className="display" style={{ fontSize: 40, color: 'var(--plum)', margin: '0 0 24px' }}>
                Selling Not Approved
              </h1>
              <div className="panel-bordered" style={{ padding: '28px 32px', textAlign: 'left' }}>
                <p style={{ margin: '0 0 14px', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  After reviewing your application, we weren&apos;t able to approve selling privileges
                  at this time. Your <strong style={{ color: 'var(--plum)' }}>buying access remains active</strong>.
                </p>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  If you&apos;d like to share additional context, reach out to{' '}
                  <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--orange)', fontWeight: 600 }}>jbanks@sports-collective.com</a>.
                </p>
              </div>
              <div style={{ marginTop: 28 }}>
                <button onClick={() => router.push('/home')} className="btn btn-primary">Go to Home →</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 36 }}>
                <div className="eyebrow" style={{ color: 'var(--orange)', marginBottom: 10 }}>★ Apply to Sell ★</div>
                <h1 className="display" style={{ fontSize: 44, color: 'var(--plum)', margin: '0 0 20px' }}>
                  Apply to Sell on the Collective
                </h1>
                <div className="panel-bordered" style={{ padding: '20px 24px', textAlign: 'left', borderColor: 'var(--mustard)' }}>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                    Selling on <strong style={{ color: 'var(--plum)' }}>Sports Collective</strong> is a privilege we
                    extend to verified collectors with a track record in the hobby. To keep buyers safe and
                    protect the trust we&apos;ve built, we personally review every seller application.
                  </p>
                  <p style={{ margin: '14px 0 0', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                    We may reach out via your eBay profile or ask for a reference from your Facebook collecting
                    groups to verify your selling history. <strong>You can keep buying while we review.</strong>
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="panel-bordered" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 22 }}>

                <div style={{ padding: '10px 16px', background: 'var(--paper)', border: '1.5px solid var(--plum)', borderRadius: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
                  Applying as <strong style={{ color: 'var(--plum)' }}>{email}</strong>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Tell Us About Your Selling History *</span>
                  </label>
                  <textarea
                    value={collectionDescription}
                    onChange={e => setCollectionDescription(e.target.value)}
                    rows={5}
                    required
                    placeholder="What kinds of cards do you sell? How long have you been selling, and where (eBay, Facebook groups, card shows)? Roughly how many transactions a year? Anything we should know about how you operate?"
                    style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>eBay Profile URL</span>
                  </label>
                  <input
                    type="url"
                    value={ebayProfile}
                    onChange={e => setEbayProfile(e.target.value)}
                    placeholder="https://www.ebay.com/usr/yourusername"
                    style={fieldStyle}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 5 }}>
                    Helps us verify your feedback score and trading history.
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Facebook Collecting Groups</span>
                  </label>
                  <textarea
                    value={fbGroups}
                    onChange={e => setFbGroups(e.target.value)}
                    rows={3}
                    placeholder="List the groups where you actively sell or trade — group names or links."
                    style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !collectionDescription.trim()}
                  className="btn btn-primary"
                  style={{ justifyContent: 'center', fontSize: 15, padding: '13px 24px' }}
                >
                  {submitting ? 'Submitting…' : 'Submit Seller Application →'}
                </button>

                <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', lineHeight: 1.5 }}>
                  We typically review applications within 1–3 business days. Buying access stays on the whole time.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
