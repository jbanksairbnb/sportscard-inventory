'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SCLogo from '@/components/SCLogo';

const ADMIN_EMAIL = 'jbanks@sportscollective.com';

type Applicant = {
  user_id: string;
  application_status: string;
  collection_description: string | null;
  ebay_profile: string | null;
  fb_groups: string | null;
  applied_at: string | null;
  display_name: string | null;
  handle: string | null;
  email?: string;
};

export default function AdminPage() {
  const router = useRouter();
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.email !== ADMIN_EMAIL) { setUnauthorized(true); setLoading(false); return; }
      const { data } = await supabase
        .from('user_profiles')
        .select('user_id, application_status, collection_description, ebay_profile, fb_groups, applied_at, display_name, handle')
        .not('application_status', 'is', null)
        .order('applied_at', { ascending: false });
      setApplicants((data || []) as Applicant[]);
      setLoading(false);
    }
    load();
  }, []);

  async function updateStatus(userId: string, status: 'approved' | 'rejected') {
    setWorking(userId);
    const supabase = createClient();
    await supabase.from('user_profiles').update({ application_status: status }).eq('user_id', userId);
    setApplicants(prev => prev.map(a => a.user_id === userId ? { ...a, application_status: status } : a));
    setWorking(null);
  }

  const filtered = applicants.filter(a => filter === 'all' || a.application_status === filter);

  const counts = {
    pending: applicants.filter(a => a.application_status === 'pending').length,
    approved: applicants.filter(a => a.application_status === 'approved').length,
    rejected: applicants.filter(a => a.application_status === 'rejected').length,
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <SCLogo size={80} />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <SCLogo size={64} />
          <div className="display" style={{ fontSize: 28, color: 'var(--plum)', margin: '16px 0 8px' }}>Access Denied</div>
          <p style={{ color: 'var(--ink-mute)', fontSize: 14 }}>This page is for admins only.</p>
          <button onClick={() => router.push('/home')} className="btn btn-outline" style={{ marginTop: 16 }}>← Go Home</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </div>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Admin ★</div>
          <button onClick={() => router.push('/home')} className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>← Home</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ marginBottom: 28 }}>
          <div className="section-head" style={{ marginBottom: 16 }}>
            <span className="eyebrow" style={{ fontSize: 14 }}>★ Membership Applications ★</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f !== 'all' && <span style={{ marginLeft: 6, opacity: 0.8 }}>({counts[f]})</span>}
                {f === 'all' && <span style={{ marginLeft: 6, opacity: 0.8 }}>({applicants.length})</span>}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 22, color: 'var(--plum)' }}>No {filter} applications</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filtered.map(a => (
              <div key={a.user_id} className="panel-bordered" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>
                        {a.display_name || a.handle || 'New Applicant'}
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                        background: a.application_status === 'approved' ? 'var(--teal)' : a.application_status === 'rejected' ? 'var(--rust)' : 'var(--mustard)',
                        color: a.application_status === 'pending' ? 'var(--plum)' : 'var(--cream)',
                      }}>
                        {a.application_status.toUpperCase()}
                      </span>
                    </div>
                    {a.applied_at && (
                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 12 }}>
                        Applied {new Date(a.applied_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    )}

                    {a.collection_description && (
                      <div style={{ marginBottom: 10 }}>
                        <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 4 }}>About Their Collection</div>
                        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)', fontStyle: 'italic', borderLeft: '3px solid var(--mustard)', paddingLeft: 12 }}>
                          "{a.collection_description}"
                        </p>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13, marginTop: 10 }}>
                      {a.ebay_profile && (
                        <>
                          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', alignSelf: 'center' }}>eBay</span>
                          <a href={a.ebay_profile} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--orange)', wordBreak: 'break-all', fontSize: 13 }}>
                            {a.ebay_profile}
                          </a>
                        </>
                      )}
                      {a.fb_groups && (
                        <>
                          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', alignSelf: 'start', paddingTop: 2 }}>Facebook</span>
                          <span style={{ color: 'var(--ink-soft)', lineHeight: 1.5 }}>{a.fb_groups}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {a.application_status === 'pending' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, minWidth: 140 }}>
                      <button
                        onClick={() => updateStatus(a.user_id, 'approved')}
                        disabled={working === a.user_id}
                        className="btn btn-primary btn-sm"
                        style={{ justifyContent: 'center' }}
                      >
                        {working === a.user_id ? '…' : '✓ Approve'}
                      </button>
                      <button
                        onClick={() => updateStatus(a.user_id, 'rejected')}
                        disabled={working === a.user_id}
                        className="btn btn-sm"
                        style={{ justifyContent: 'center', background: 'var(--rust)', color: 'var(--cream)', border: '2px solid var(--plum)' }}
                      >
                        {working === a.user_id ? '…' : '✕ Reject'}
                      </button>
                    </div>
                  )}

                  {a.application_status !== 'pending' && (
                    <button
                      onClick={() => updateStatus(a.user_id, a.application_status === 'approved' ? 'rejected' : 'approved')}
                      disabled={working === a.user_id}
                      className="btn btn-ghost btn-sm"
                      style={{ flexShrink: 0 }}
                    >
                      {working === a.user_id ? '…' : a.application_status === 'approved' ? 'Revoke' : 'Approve'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
