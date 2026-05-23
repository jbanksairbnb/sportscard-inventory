'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SCLogo from '@/components/SCLogo';

type Row = {
  id: string;
  created_at: string;
  source: string;
  year: number | null;
  brand: string | null;
  set_title: string | null;
  card_number: string | null;
  player: string | null;
  image_front_url: string | null;
  image_back_url: string | null;
  ai_model: string | null;
  ai_grade_low: string | null;
  ai_grade_high: string | null;
  ai_confidence: string | null;
  ai_notes: string | null;
  ai_corners: string | null;
  ai_edges: string | null;
  ai_surface: string | null;
  ai_cost_dollars: number | null;
  ai_latency_ms: number | null;
  ai_top_flaws: string[] | null;
  error_message: string | null;
  user_action: string | null;
  user_final_grade: string | null;
  professional_grade: string | null;
};

type Stats = {
  window_days: number;
  total: number;
  failed: number;
  failure_rate: number;
  total_cost_dollars: number;
  avg_latency_ms: number;
  confidence_counts: Record<string, number>;
};

// Admin-only dashboard for AI grader accuracy + failure-pattern analysis.
// Reads from card_grades (every evaluate-grade call lands a row, success
// or failure). Use this to:
//   - See which kinds of cards the model fails on
//   - Spot grade-bias patterns (corner harshness, era skew, etc.)
//   - Pick reference examples for future few-shot anchoring
export default function GraderAccuracyPage() {
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'fail'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '200');
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    const res = await fetch(`/api/admin/card-grades?${params}`);
    if (res.status === 403 || res.status === 401) { setUnauthorized(true); setLoading(false); return; }
    const data = await res.json();
    setRows(data.rows || []);
    setStats(data.stats || null);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter, sourceFilter]);

  if (unauthorized) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 40 }}>
        <div className="panel-bordered" style={{ padding: 32, maxWidth: 420, textAlign: 'center' }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>Admin only</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.94)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1300, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <Link href="/admin" className="btn btn-outline btn-sm">← Admin</Link>
          <Link href="/admin/grade-test" className="btn btn-outline btn-sm">🤖 Grade Test</Link>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', flex: 1 }}>🤖 Grader Accuracy</div>
        </div>
      </header>

      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '24px 28px 80px' }}>
        {stats && (
          <section className="panel-bordered" style={{ padding: 18, marginBottom: 18 }}>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 6 }}>
              Last {stats.window_days} days · across all sources
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
              <Stat label="Total graded" value={String(stats.total)} />
              <Stat label="Failure rate"
                value={`${(stats.failure_rate * 100).toFixed(1)}%`}
                hint={`${stats.failed} of ${stats.total}`}
                accent={stats.failure_rate > 0.1 ? 'rust' : undefined} />
              <Stat label="Total cost" value={`$${stats.total_cost_dollars.toFixed(3)}`} />
              <Stat label="Avg latency" value={`${stats.avg_latency_ms.toLocaleString()} ms`} />
              <Stat label="Confidence mix"
                value={`${stats.confidence_counts.high || 0}/${stats.confidence_counts.medium || 0}/${stats.confidence_counts.low || 0}`}
                hint="hi / med / lo" />
            </div>
          </section>
        )}

        <section className="panel-bordered" style={{ padding: '14px 18px', marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'success', 'fail'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={statusFilter === s ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                style={{ textTransform: 'capitalize' }}>{s}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['', 'scan-batch', 'scan-multi-card', 'scan-from-set', 'grade-test'].map(s => (
              <button key={s || 'all'} onClick={() => setSourceFilter(s)}
                className={sourceFilter === s ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                {s || 'any source'}
              </button>
            ))}
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 'auto' }}>
            {loading ? 'loading…' : `${rows.length} rows`}
          </span>
        </section>

        <section className="panel-bordered" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--mustard)', borderBottom: '2px solid var(--plum)' }}>
                <th style={th}>When</th>
                <th style={th}>Card</th>
                <th style={th}>Source</th>
                <th style={th}>AI grade</th>
                <th style={th}>Conf</th>
                <th style={th}>Cost</th>
                <th style={th}>Latency</th>
                <th style={th}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const card = [
                  r.year ? String(r.year) : '',
                  r.brand || '',
                  r.card_number ? `#${r.card_number}` : '',
                  r.player || '',
                ].filter(Boolean).join(' ');
                const isFail = !!r.error_message;
                const expanded = expandedId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      style={{
                        borderBottom: '1px solid var(--rule)',
                        background: isFail ? 'rgba(197,74,44,0.05)' : 'transparent',
                        cursor: 'pointer',
                      }}>
                      <td style={td}>{formatTime(r.created_at)}</td>
                      <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card || '(unnamed)'}
                      </td>
                      <td style={{ ...td, fontSize: 10.5 }}>{r.source}</td>
                      <td style={td}>
                        {isFail ? <span style={{ color: 'var(--rust)', fontWeight: 700 }}>✗ failed</span>
                          : (
                            <span className="mono" style={{ fontWeight: 700, color: 'var(--plum)' }}>
                              {r.ai_grade_low === r.ai_grade_high ? r.ai_grade_low : `${r.ai_grade_low} → ${r.ai_grade_high}`}
                            </span>
                          )}
                      </td>
                      <td style={{ ...td, fontSize: 11 }}>{r.ai_confidence || '—'}</td>
                      <td style={{ ...td, fontSize: 11 }}>{r.ai_cost_dollars ? `$${Number(r.ai_cost_dollars).toFixed(4)}` : '—'}</td>
                      <td style={{ ...td, fontSize: 11 }}>{r.ai_latency_ms ? `${r.ai_latency_ms} ms` : '—'}</td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {r.professional_grade ? `🏆 ${r.professional_grade}` : (r.user_final_grade || r.user_action || '—')}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 18, background: 'rgba(248,236,208,0.5)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {r.image_front_url && (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={r.image_front_url} alt="front"
                                  style={{ width: '100%', borderRadius: 6, border: '1.5px solid var(--rule)' }} />
                              )}
                              {r.image_back_url && (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={r.image_back_url} alt="back"
                                  style={{ width: '100%', borderRadius: 6, border: '1.5px solid var(--rule)' }} />
                              )}
                            </div>
                            <div>
                              {isFail ? (
                                <div>
                                  <div className="eyebrow" style={{ fontSize: 10, color: 'var(--rust)', marginBottom: 4 }}>Error</div>
                                  <div className="mono" style={{ fontSize: 12, color: 'var(--rust)', wordBreak: 'break-word' }}>
                                    {r.error_message}
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {r.ai_notes && <Field label="Notes" value={r.ai_notes} />}
                                  {r.ai_corners && <Field label="Corners" value={r.ai_corners} />}
                                  {r.ai_edges && <Field label="Edges" value={r.ai_edges} />}
                                  {r.ai_surface && <Field label="Surface" value={r.ai_surface} />}
                                  {r.ai_top_flaws && r.ai_top_flaws.length > 0 && (
                                    <Field label="Top flaws" value={r.ai_top_flaws.join(' · ')} />
                                  )}
                                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-mute)' }}>
                                    Model: {r.ai_model || '—'}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)' }}>No grades match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'rust' }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginBottom: 3 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, color: accent === 'rust' ? 'var(--rust)' : 'var(--plum)' }}>{value}</div>
      {hint && <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{hint}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span className="eyebrow" style={{ fontSize: 9.5, color: 'var(--ink-mute)' }}>{label} · </span>
      <span style={{ fontSize: 12.5, color: 'var(--plum)' }}>{value}</span>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString();
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--plum)', letterSpacing: '0.05em', textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };
