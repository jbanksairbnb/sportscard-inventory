'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

export default function PendingPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setEmail(user.email || '');
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('application_status')
        .eq('user_id', user.id)
        .maybeSingle();
      const s = profile?.application_status;
      setStatus(s ?? null);
      if (s === 'approved') { router.push('/home'); return; }
      if (!s) { router.push('/apply'); return; }
      setLoading(false);
    }
    check();
  }, [router]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    );
  }

  const rejected = status === 'rejected';

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
        <button onClick={handleSignOut} className="btn btn-ghost btn-sm">Sign out</button>
      </header>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px' }}>
        <div style={{ width: '100%', maxWidth: 540, textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>{rejected ? '😔' : '⏳'}</div>
          <div className="eyebrow" style={{ color: 'var(--orange)', marginBottom: 10 }}>
            {rejected ? '★ Application Update ★' : '★ Application Received ★'}
          </div>
          <h1 className="display" style={{ fontSize: 40, color: 'var(--plum)', margin: '0 0 24px' }}>
            {rejected ? 'Not a Fit Right Now' : 'You\'re on Deck'}
          </h1>

          <div className="panel-bordered" style={{ padding: '28px 32px', textAlign: 'left' }}>
            {rejected ? (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  Thank you for applying to Sports Collective. After reviewing your application,
                  we weren't able to approve your membership at this time.
                </p>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  If you believe this is a mistake or have additional information to share,
                  please reach out to us at{' '}
                  <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--orange)', fontWeight: 600 }}>
                    jbanks@sports-collective.com
                  </a>.
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  Your application is in our hands — we'll review it and get back to you
                  within <strong style={{ color: 'var(--plum)' }}>1–3 business days</strong>.
                </p>
                <p style={{ margin: '0 0 14px', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  We may reach out via your eBay profile or Facebook groups as part of our verification.
                  Keep an eye on the inbox for <strong style={{ color: 'var(--plum)' }}>{email}</strong>.
                </p>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                  Questions? Email us at{' '}
                  <a href="mailto:jbanks@sports-collective.com" style={{ color: 'var(--orange)', fontWeight: 600 }}>
                    jbanks@sports-collective.com
                  </a>.
                </p>
              </>
            )}
          </div>

          {!rejected && (
            <div style={{ marginTop: 28, display: 'flex', justifyContent: 'center', gap: 20, opacity: 0.5 }}>
              {['⚾', '🏈', '🏀', '🏒', '⚽'].map((e, i) => (
                <span key={i} style={{ fontSize: 28 }}>{e}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
