'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

type Stage = 'loading' | 'form' | 'pending' | 'rejected';

const SIGNUP_INTENT_KEY = 'sc:signup-intent';
const MIN_REFERENCES = 5;

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
  const [fullName, setFullName] = useState('');
  const [ebayProfile, setEbayProfile] = useState('');
  const [fbGroups, setFbGroups] = useState('');
  const [refs, setRefs] = useState<string[]>(() => Array.from({ length: MIN_REFERENCES }, () => ''));
  const [notes, setNotes] = useState('');
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
      // post-confirmation email click. Use the intent we stashed at signup
      // to decide where to send them, but DON'T set wants_to_sell here;
      // that only flips true when they submit the application form below.
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
          wants_to_sell: false,
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

  function setRefAt(i: number, value: string) {
    setRefs(prev => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }
  function addRef() {
    setRefs(prev => [...prev, '']);
  }
  function removeRef(i: number) {
    if (refs.length <= MIN_REFERENCES) return;
    setRefs(prev => prev.filter((_, idx) => idx !== i));
  }

  const cleanRefs = refs.map(r => r.trim()).filter(Boolean);
  const hasMinRefs = cleanRefs.length >= MIN_REFERENCES;
  const formValid =
    !!fullName.trim() &&
    !!ebayProfile.trim() &&
    !!fbGroups.trim() &&
    hasMinRefs;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setSubmitting(true);
    const supabase = createClient();
    await supabase.from('user_profiles').upsert({
      user_id: userId,
      email,
      // Membership stays approved — buying access is unaffected by submitting
      // a seller application. We only flip wants_to_sell so /admin sees them.
      application_status: 'approved',
      full_name: fullName.trim(),
      collection_description: notes.trim() || null,
      ebay_profile: ebayProfile.trim(),
      fb_groups: fbGroups.trim(),
      seller_references: cleanRefs,
      wants_to_sell: true,
      applied_at: new Date().toISOString(),
    });
    await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicantEmail: email,
        fullName: fullName.trim(),
        ebayProfile: ebayProfile.trim(),
        fbGroups: fbGroups.trim(),
        references: cleanRefs,
        notes: notes.trim(),
        wantsToSell: true,
      }),
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
        <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <SCLogo size={40} />
          <div style={{ lineHeight: 0.95 }}>
            <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
          </div>
        </Link>
        <button onClick={() => router.push('/home')} className="btn btn-ghost btn-sm">← Back to Home</button>
      </header>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px 80px' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>

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
                  We&apos;ll review your application within <strong style={{ color: 'var(--plum)' }}>24 hours</strong>.
                </p>
                <p style={{ margin: '0 0 14px', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  In the meantime, your <strong style={{ color: 'var(--plum)' }}>buying access is fully active</strong> —
                  build your shelf, browse the marketplace, and pick up cards from other members.
                </p>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  We may reach out via your eBay profile, your Facebook groups, or your references as part of verification.
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
                    <strong style={{ color: 'var(--plum)' }}>Sports Collective</strong> is built to be a safe
                    sportscard community where collectors trust the people they buy from. Selling here is a
                    privilege we extend to verified members — we personally review every application.
                  </p>
                  <p style={{ margin: '14px 0 0', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                    We aim to review every application <strong style={{ color: 'var(--plum)' }}>within 24 hours</strong>.
                    We may reach out via your eBay profile, your Facebook groups, or your references to verify
                    your selling history. <strong>You can keep buying while we review.</strong>
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="panel-bordered" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 22 }}>

                <div style={{ padding: '10px 16px', background: 'var(--paper)', border: '1.5px solid var(--plum)', borderRadius: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
                  Applying as <strong style={{ color: 'var(--plum)' }}>{email}</strong>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Full Name *</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    required
                    placeholder="First and last name"
                    style={fieldStyle}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 5 }}>
                    Used only for verification. Won&apos;t appear in your public profile.
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>eBay Profile URL *</span>
                  </label>
                  <input
                    type="url"
                    value={ebayProfile}
                    onChange={e => setEbayProfile(e.target.value)}
                    required
                    placeholder="https://www.ebay.com/usr/yourusername"
                    style={fieldStyle}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 5 }}>
                    We check feedback score and trading history.
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Facebook Groups You&apos;re a Member Of *</span>
                  </label>
                  <textarea
                    value={fbGroups}
                    onChange={e => setFbGroups(e.target.value)}
                    rows={3}
                    required
                    placeholder="List the FB collecting/trading groups you actively participate in — group names or links, one per line."
                    style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>References * <span style={{ color: 'var(--ink-mute)', fontWeight: 600 }}>(at least {MIN_REFERENCES})</span></span>
                  </label>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginBottom: 10 }}>
                    Five collectors who can vouch for you. For each: name + how to reach them
                    (FB profile link, email, or phone). We may contact them.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {refs.map((value, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className="mono" style={{
                          minWidth: 24, fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700, textAlign: 'right',
                        }}>
                          {i + 1}.
                        </span>
                        <input
                          type="text"
                          value={value}
                          onChange={e => setRefAt(i, e.target.value)}
                          required={i < MIN_REFERENCES}
                          placeholder={i === 0
                            ? 'e.g. Jane Doe — facebook.com/jane.doe — jane@example.com'
                            : 'Name — contact (FB / email / phone)'}
                          style={{ ...fieldStyle, flex: 1 }}
                        />
                        {refs.length > MIN_REFERENCES && (
                          <button type="button" onClick={() => removeRef(i)}
                            className="btn btn-ghost btn-sm" style={{ padding: '6px 10px' }}
                            title="Remove this reference">
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addRef} className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
                    + Add another reference
                  </button>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Anything else we should know? <span style={{ fontWeight: 600 }}>(optional)</span></span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Years selling, what you specialize in, card shows, anything else helpful."
                    style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !formValid}
                  className="btn btn-primary"
                  style={{ justifyContent: 'center', fontSize: 15, padding: '13px 24px' }}
                >
                  {submitting ? 'Submitting…' : 'Submit Seller Application →'}
                </button>

                <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', lineHeight: 1.5 }}>
                  We typically review applications within 24 hours. Buying access stays on the whole time.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
