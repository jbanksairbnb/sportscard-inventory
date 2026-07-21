'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SCLogo from '@/components/SCLogo';

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
  is_admin?: boolean;
  can_sell?: boolean;
  wants_to_sell?: boolean;
  full_name?: string | null;
  seller_terms_accepted_at?: string | null;
  seller_references?: string[] | null;
};

export default function AdminPage() {
  const router = useRouter();
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [working, setWorking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adminWorking, setAdminWorking] = useState<string | null>(null);
  const [sellerWorking, setSellerWorking] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/admin/applicants');
      if (res.status === 401) {
        setUnauthorized(true);
      } else if (res.ok) {
        const { applicants, currentUserId } = await res.json();
        setApplicants((applicants || []) as Applicant[]);
        setCurrentUserId(currentUserId || '');
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleDelete(userId: string, name: string) {
    if (!confirm(`Permanently delete "${name}"? This removes them from auth and cannot be undone.`)) return;
    setDeleting(userId);
    const res = await fetch('/api/admin/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      alert('Delete failed: ' + error);
    } else {
      setApplicants(prev => prev.filter(a => a.user_id !== userId));
    }
    setDeleting(null);
  }
  async function updateStatus(userId: string, status: 'approved' | 'rejected') {
    setWorking(userId);
    const res = await fetch('/api/admin/applicants', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, status }),
    });
    if (res.ok) {
      setApplicants(prev => prev.map(a => a.user_id === userId ? { ...a, application_status: status } : a));
    } else {
      const { error } = await res.json();
      alert('Update failed: ' + error);
    }
    setWorking(null);
  }

  async function toggleAdmin(userId: string, isAdmin: boolean) {
    setAdminWorking(userId);
    const res = await fetch('/api/admin/applicants', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, isAdmin }),
    });
    if (res.ok) {
      setApplicants(prev => prev.map(a => a.user_id === userId ? { ...a, is_admin: isAdmin } : a));
    } else {
      const { error } = await res.json();
      alert('Update failed: ' + error);
    }
    setAdminWorking(null);
  }

  async function toggleSeller(userId: string, canSell: boolean) {
    setSellerWorking(userId);
    const res = await fetch('/api/admin/applicants', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, canSell }),
    });
    if (res.ok) {
      setApplicants(prev => prev.map(a => a.user_id === userId ? { ...a, can_sell: canSell } : a));
    } else {
      const { error } = await res.json();
      alert('Update failed: ' + error);
    }
    setSellerWorking(null);
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
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Admin ★</div>
          <button onClick={() => router.push('/home')} className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>← Home</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <div style={{ marginBottom: 28 }}>
          <div className="section-head" style={{ marginBottom: 16 }}>
            <span className="eyebrow" style={{ fontSize: 14 }}>★ Set Library ★</span>
          </div>
          <div style={{ background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, padding: '18px 22px', marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div className="display" style={{ fontSize: 17, color: 'var(--plum)', marginBottom: 6 }}>Manage Set Library</div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55, margin: 0 }}>
                  Browse every checklist available to users on the New Set page. Edit year / brand / title / sport, delete obsolete entries, search the catalog, and bulk-upload new CSVs — all on one page.
                </p>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--plum)', fontWeight: 700 }}>How to build the upload file ▾</summary>
                  <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
                    <p style={{ margin: '6px 0' }}><strong>Required columns</strong> (exact names, in any order):</p>
                    <code style={{ display: 'block', background: 'var(--cream)', padding: '8px 10px', borderRadius: 6, fontSize: 11, color: 'var(--plum)', wordBreak: 'break-word' }}>
                      Card #, Player, Owned, Raw Grade, Graded, Grading Company, Grade, Cost, Value, Target Price, Sale Price, Date Purchased, Purchased From, Upload Image(s)
                    </code>
                    <p style={{ margin: '10px 0 4px' }}><strong>For checklists</strong>, only <span className="mono">Card #</span> and <span className="mono">Player</span> need to be populated — leave the other columns empty (or blank).</p>
                    <p style={{ margin: '10px 0 4px' }}><strong>Filename convention</strong> (recommended; metadata auto-fills from name):</p>
                    <code style={{ display: 'block', background: 'var(--cream)', padding: '8px 10px', borderRadius: 6, fontSize: 11, color: 'var(--plum)' }}>
                      1971-topps-base-set-baseball.csv<br />
                      1986-topps-football.csv<br />
                      1989-upper-deck-baseball.csv
                    </code>
                    <p style={{ margin: '10px 0 4px' }}>The bulk page parses year, brand, and sport from the filename and you can edit per-row before upload. Title format saved as: <span className="mono">{'<year>'} {'<brand>'} — {'<description>'}</span>.</p>
                  </div>
                </details>
              </div>
              <button onClick={() => router.push('/admin/templates')} className="btn btn-primary">
                Open Library →
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, padding: '18px 22px', marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div className="display" style={{ fontSize: 17, color: 'var(--plum)', marginBottom: 6 }}>Set Headers</div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55, margin: 0 }}>
                  Add a hero image and description for any canonical set. Shows up at the top of every user&apos;s set page that matches.
                </p>
              </div>
              <button onClick={() => router.push('/admin/set-headers')} className="btn btn-primary">
                Manage Headers →
              </button>
            </div>
          </div>

          <div className="section-head" style={{ marginBottom: 16 }}>
            <span className="eyebrow" style={{ fontSize: 14 }}>★ AI Grader ★</span>
          </div>
          <div style={{ background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, padding: '18px 22px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div className="display" style={{ fontSize: 17, color: 'var(--plum)', marginBottom: 6 }}>🤖 Grader Accuracy</div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55, margin: 0 }}>
                  Every AI grade attempt is logged here — success, failure, cost, latency, and the model&apos;s per-attribute findings. Rate grades (correct / too high / too low) to feed prompt tuning and accuracy tracking.
                </p>
              </div>
              <button onClick={() => router.push('/admin/grader-accuracy')} className="btn btn-primary">
                Open Report →
              </button>
            </div>
          </div>
          <div style={{ background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, padding: '18px 22px', marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div className="display" style={{ fontSize: 17, color: 'var(--plum)', marginBottom: 6 }}>🤖 Grade Test</div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55, margin: 0 }}>
                  One-off validation harness: paste two image URLs + metadata, see the model&apos;s grade range with full per-attribute breakdown. Useful for sanity-checking prompt changes against known-graded cards.
                </p>
              </div>
              <button onClick={() => router.push('/admin/grade-test')} className="btn btn-outline">
                Open Test →
              </button>
            </div>
          </div>

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
            {filtered.map(a => {
              // Prefer a human-readable name for the heading; fall back through
              // profile name → real name → handle → email before the generic
              // "New Applicant" so admins can identify who they're managing.
              const applicantName = a.display_name || a.full_name || a.handle || a.email || 'New Applicant';
              return (
              <div key={a.user_id} className="panel-bordered" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>
                        {applicantName}
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                        background: a.application_status === 'approved' ? 'var(--teal)' : a.application_status === 'rejected' ? 'var(--rust)' : 'var(--mustard)',
                        color: a.application_status === 'pending' ? 'var(--plum)' : 'var(--cream)',
                      }}>
                        {a.application_status.toUpperCase()}
                      </span>
                      {a.is_admin && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                          background: 'var(--plum)', color: 'var(--mustard)',
                        }}>
                          ★ ADMIN
                        </span>
                      )}
                      {a.can_sell && a.seller_terms_accepted_at && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                          background: 'var(--teal)', color: 'var(--cream)',
                        }}>
                          ✓ SELLER
                        </span>
                      )}
                      {a.can_sell && !a.seller_terms_accepted_at && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                          background: 'var(--mustard)', color: 'var(--plum)',
                        }}
                          title="Selling approved; user hasn't accepted T&C yet">
                          TERMS PENDING
                        </span>
                      )}
                      {a.wants_to_sell && !a.can_sell && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 100,
                          background: 'var(--mustard)', color: 'var(--plum)',
                        }}
                          title="Applicant requested selling privileges">
                          REQUESTED SELLING
                        </span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 12 }}>
                      {a.email
                        ? <span>{a.email}</span>
                        : <span style={{ fontStyle: 'italic' }}>No email on file</span>}
                      {a.full_name && a.full_name !== applicantName && <span style={{ marginLeft: 10 }}>· {a.full_name}</span>}
                      {a.applied_at && <span style={{ marginLeft: 10 }}>· Applied {new Date(a.applied_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                    </div>

                    {a.collection_description && (
                      <div style={{ marginBottom: 10 }}>
                        <div className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', marginBottom: 4 }}>Notes</div>
                        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-soft)', fontStyle: 'italic', borderLeft: '3px solid var(--mustard)', paddingLeft: 12 }}>
                          &ldquo;{a.collection_description}&rdquo;
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
                          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', alignSelf: 'start', paddingTop: 2 }}>FB Groups</span>
                          <span style={{ color: 'var(--ink-soft)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.fb_groups}</span>
                        </>
                      )}
                      {a.seller_references && a.seller_references.length > 0 && (
                        <>
                          <span className="eyebrow" style={{ fontSize: 9, color: 'var(--orange)', alignSelf: 'start', paddingTop: 2 }}>
                            Refs ({a.seller_references.length})
                          </span>
                          <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                            {a.seller_references.map((r, i) => (
                              <li key={i} style={{ margin: '2px 0' }}>{r}</li>
                            ))}
                          </ol>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, minWidth: 140 }}>
                    {a.application_status === 'pending' && (
                      <>
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
                      </>
                    )}
                    {a.application_status !== 'pending' && (
                      <button
                        onClick={() => updateStatus(a.user_id, a.application_status === 'approved' ? 'rejected' : 'approved')}
                        disabled={working === a.user_id}
                        className="btn btn-ghost btn-sm"
                        style={{ justifyContent: 'center' }}
                      >
                        {working === a.user_id ? '…' : a.application_status === 'approved' ? 'Revoke' : 'Approve'}
                      </button>
                    )}
                    {a.application_status === 'approved' && (
                      <button
                        onClick={() => toggleSeller(a.user_id, !a.can_sell)}
                        disabled={sellerWorking === a.user_id}
                        className="btn btn-sm"
                        style={{
                          justifyContent: 'center',
                          background: a.can_sell ? 'transparent' : 'var(--teal)',
                          color: a.can_sell ? 'var(--teal)' : 'var(--cream)',
                          border: '2px solid var(--teal)',
                        }}
                      >
                        {sellerWorking === a.user_id ? '…' : a.can_sell ? 'Revoke Selling' : '✓ Grant Selling'}
                      </button>
                    )}
                    {a.application_status === 'approved' && a.user_id !== currentUserId && (
                      <button
                        onClick={() => toggleAdmin(a.user_id, !a.is_admin)}
                        disabled={adminWorking === a.user_id}
                        className="btn btn-sm"
                        style={{
                          justifyContent: 'center',
                          background: a.is_admin ? 'transparent' : 'var(--plum)',
                          color: a.is_admin ? 'var(--plum)' : 'var(--mustard)',
                          border: '2px solid var(--plum)',
                        }}
                      >
                        {adminWorking === a.user_id ? '…' : a.is_admin ? 'Remove Admin' : '★ Make Admin'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(a.user_id, a.display_name || a.full_name || a.handle || a.email || 'this user')}
                      disabled={deleting === a.user_id || a.user_id === currentUserId}
                      className="btn btn-sm"
                      style={{ justifyContent: 'center', background: 'transparent', color: 'var(--ink-mute)', border: '1.5px solid var(--rule)' }}
                    >
                      {deleting === a.user_id ? '…' : '🗑 Delete'}
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
