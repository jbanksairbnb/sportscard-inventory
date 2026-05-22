'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import SCLogo from '@/components/SCLogo';

type GradeResult = {
  grade_low: string;
  grade_high: string;
  confidence: 'low' | 'medium' | 'high';
  notes: string;
  centering_front?: string;
  centering_back?: string;
  corners?: string;
  edges?: string;
  surface?: string;
  top_flaws?: string[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    model: string;
  };
};

// Minimal validation harness for the AI card grader. Paste two image URLs
// (the same Supabase Storage public URLs your set rows already use for
// Image 1 / Image 2) plus the card's metadata, hit Evaluate, compare the
// AI's range against what PSA actually returned. Use known-graded cards
// to gauge accuracy before wiring this into the set editor.
export default function GradeTestPage() {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [year, setYear] = useState('');
  const [brand, setBrand] = useState('Topps');
  const [setTitle, setSetTitle] = useState('Base Set');
  const [cardNumber, setCardNumber] = useState('');
  const [player, setPlayer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GradeResult | null>(null);

  async function evaluate() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/cards/evaluate-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_front_url: front.trim(),
          image_back_url: back.trim(),
          year: year ? Number(year) : null,
          brand, set_title: setTitle, card_number: cardNumber, player,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed');
    } finally {
      setLoading(false);
    }
  }

  // Rough cost — Haiku 4.5 = $1/M in, $5/M out. Cached input @ ~0.1× rate.
  const cost = result ? (
    (result.usage.input_tokens * 1.0
      + result.usage.cache_read_input_tokens * 0.1
      + result.usage.cache_creation_input_tokens * 1.25
      + result.usage.output_tokens * 5.0) / 1_000_000
  ) : 0;

  const canSubmit = front.trim() && back.trim() && !loading;

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.94)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <Link href="/admin" className="btn btn-outline btn-sm">← Admin</Link>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', flex: 1 }}>🤖 AI Grade Test</div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section className="panel-bordered" style={{ padding: '24px 28px', marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 6 }}>Card to evaluate</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 18 }}>
            Paste the same Supabase Storage URLs you upload to set rows as Image 1 (front) and Image 2 (back).
            Use cards you&apos;ve already had professionally graded so you can compare the AI&apos;s range against PSA truth.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label className="input-label">Front image URL</label>
              <input value={front} onChange={e => setFront(e.target.value)}
                placeholder="https://...card-images/.../front.jpg"
                className="input-sc" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="input-label">Back image URL</label>
              <input value={back} onChange={e => setBack(e.target.value)}
                placeholder="https://...card-images/.../back.jpg"
                className="input-sc" style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '90px 140px 1fr 100px 1fr', gap: 10, marginBottom: 18 }}>
            <div>
              <label className="input-label">Year</label>
              <input value={year} onChange={e => setYear(e.target.value)} placeholder="1961" className="input-sc" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="input-label">Brand</label>
              <input value={brand} onChange={e => setBrand(e.target.value)} className="input-sc" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="input-label">Set</label>
              <input value={setTitle} onChange={e => setSetTitle(e.target.value)} className="input-sc" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="input-label">Card #</label>
              <input value={cardNumber} onChange={e => setCardNumber(e.target.value)} className="input-sc" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="input-label">Player</label>
              <input value={player} onChange={e => setPlayer(e.target.value)} className="input-sc" style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={evaluate} disabled={!canSubmit} className="btn btn-primary">
              {loading ? 'Evaluating…' : '🤖 Evaluate'}
            </button>
            {error && <span className="mono" style={{ fontSize: 12, color: 'var(--rust)', fontWeight: 700 }}>✗ {error}</span>}
          </div>
        </section>

        {(front || back) && (
          <section className="panel-bordered" style={{ padding: '24px 28px', marginBottom: 20 }}>
            <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 10 }}>Preview</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[{ label: 'Front', url: front }, { label: 'Back', url: back }].map(({ label, url }) => (
                <div key={label}>
                  <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 4 }}>{label}</div>
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={label} style={{ maxWidth: '100%', borderRadius: 8, border: '1.5px solid var(--rule)' }} />
                  ) : (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', border: '1.5px dashed var(--rule)', borderRadius: 8 }}>—</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {result && (
          <section className="panel-bordered" style={{ padding: '24px 28px', marginBottom: 20 }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 14 }}>AI Assessment</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div style={{
                padding: '12px 22px', background: 'var(--mustard)', border: '2px solid var(--plum)',
                borderRadius: 12, fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--plum)',
              }}>
                {result.grade_low === result.grade_high
                  ? result.grade_low
                  : `${result.grade_low} → ${result.grade_high}`}
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                Confidence: {result.confidence}
              </div>
            </div>

            <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, marginBottom: 14 }}>
              {result.notes}
            </div>

            {(result.corners || result.edges || result.surface) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 14 }}>
                {result.corners && (
                  <div>
                    <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Corners</div>
                    <div style={{ fontSize: 13, color: 'var(--plum)' }}>{result.corners}</div>
                  </div>
                )}
                {result.edges && (
                  <div>
                    <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Edges</div>
                    <div style={{ fontSize: 13, color: 'var(--plum)' }}>{result.edges}</div>
                  </div>
                )}
                {result.surface && (
                  <div>
                    <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Surface</div>
                    <div style={{ fontSize: 13, color: 'var(--plum)' }}>{result.surface}</div>
                  </div>
                )}
              </div>
            )}

            {(result.centering_front || result.centering_back) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                {result.centering_front && (
                  <div>
                    <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Centering — Front</div>
                    <div style={{ fontSize: 13, color: 'var(--plum)' }}>{result.centering_front}</div>
                  </div>
                )}
                {result.centering_back && (
                  <div>
                    <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>Centering — Back</div>
                    <div style={{ fontSize: 13, color: 'var(--plum)' }}>{result.centering_back}</div>
                  </div>
                )}
              </div>
            )}

            {result.top_flaws && result.top_flaws.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 4 }}>Top flaws</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
                  {result.top_flaws.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--rule)', display: 'flex', gap: 18, flexWrap: 'wrap' }} className="mono">
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Model: <strong>{result.usage.model}</strong></span>
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                Tokens: {result.usage.input_tokens} in · {result.usage.output_tokens} out
                {result.usage.cache_read_input_tokens > 0 && <> · {result.usage.cache_read_input_tokens} cached</>}
                {result.usage.cache_creation_input_tokens > 0 && <> · {result.usage.cache_creation_input_tokens} cache-write</>}
              </span>
              <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700 }}>≈ ${cost.toFixed(4)} this call</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
