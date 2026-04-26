'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

export default function ApplyPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [collectionDescription, setCollectionDescription] = useState('');
  const [ebayProfile, setEbayProfile] = useState('');
  const [fbGroups, setFbGroups] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);
      setEmail(user.email || '');
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('application_status')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profile?.application_status === 'approved') { router.push('/home'); return; }
      if (profile?.application_status === 'pending') { router.push('/pending'); return; }
      setLoading(false);
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
      application_status: 'pending',
      collection_description: collectionDescription,
      ebay_profile: ebayProfile,
      fb_groups: fbGroups,
      applied_at: new Date().toISOString(),
    });
    await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicantEmail: email, collectionDescription, ebayProfile, fbGroups }),
    });
    router.push('/pending');
  }

  if (loading) {
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
        padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <SCLogo size={40} />
        <div style={{ lineHeight: 0.95 }}>
          <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
          <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px 80px' }}>
        <div style={{ width: '100%', maxWidth: 620 }}>

          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div className="eyebrow" style={{ color: 'var(--orange)', marginBottom: 10 }}>★ Join the Community ★</div>
            <h1 className="display" style={{ fontSize: 44, color: 'var(--plum)', margin: '0 0 20px' }}>
              Request Access
            </h1>
            <div className="panel-bordered" style={{ padding: '20px 24px', textAlign: 'left', borderColor: 'var(--mustard)' }}>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                Thank you for your interest in <strong style={{ color: 'var(--plum)' }}>Sports Collective</strong>! We're building
                a community of passionate card collectors who value authenticity, fair dealing, and a shared love of the hobby.
                To keep our community safe and trustworthy, we personally review every application.
              </p>
              <p style={{ margin: '14px 0 0', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                We may reach out via your eBay profile or ask for a reference from your Facebook collecting groups
                to verify your activity in the hobby. We appreciate your patience and look forward to welcoming
                you to the Collective!
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="panel-bordered" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 22 }}>

            <div style={{ padding: '10px 16px', background: 'var(--paper)', border: '1.5px solid var(--plum)', borderRadius: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
              Applying as <strong style={{ color: 'var(--plum)' }}>{email}</strong>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>
                <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>Tell Us About Your Collection *</span>
              </label>
              <textarea
                value={collectionDescription}
                onChange={e => setCollectionDescription(e.target.value)}
                rows={5}
                required
                placeholder="What do you collect? Vintage sets, rookies, specific players or teams? How long have you been in the hobby? What are you chasing right now?"
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
                e.g. https://www.ebay.com/usr/jbjr — helps us verify your trading history
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
                placeholder="List any Facebook baseball card, sports card, or collecting groups you're a member of…"
                style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !collectionDescription.trim()}
              className="btn btn-primary"
              style={{ justifyContent: 'center', fontSize: 15, padding: '13px 24px' }}
            >
              {submitting ? 'Submitting…' : 'Submit Application →'}
            </button>

            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', lineHeight: 1.5 }}>
              We typically review applications within 1–3 business days.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
