'use client';

import React, { useState } from 'react';
import type { AIGradeStatus } from '@/lib/ai/use-ai-grade';

// Compact per-row 🤖 indicator with hover popover. States:
//   - pending    → small spinner
//   - error      → red ✗ with click-to-see reason + Retry
//   - done       → orange 🤖 badge; hover for full assessment
//   - done + dismissed → no badge at all (seller has overridden via Undo)
//
// If `appliedGrade` is set, the badge label reflects the currently-applied
// value (auto-fill UX). Without it, the badge falls back to showing the
// AI's range (opt-in UX).
export default function AIGradeBadge({
  status,
  appliedGrade,
  onUseLow,
  onUseHigh,
  onUndo,
  onDismiss,
  onRetry,
}: {
  status: AIGradeStatus | undefined;
  appliedGrade?: string;
  onUseLow?: () => void;
  onUseHigh?: () => void;
  onUndo?: () => void;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!status || status.state === 'idle') return null;

  if (status.state === 'pending') {
    return (
      <span title="AI evaluating…" style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700,
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: 100,
          border: '2px solid var(--ink-mute)', borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite', display: 'inline-block',
        }} />
        <span>AI</span>
        <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </span>
    );
  }

  if (status.state === 'error') {
    // Friendly reason for the most common error from the hook
    const isCostCap = status.error === 'cost-cap-reached';
    const reason = isCostCap
      ? 'Cost cap reached — toggle off and on to reset.'
      : status.error;
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <button type="button"
          onClick={() => setOpen(o => !o)}
          title={reason}
          style={{
            background: 'rgba(197,74,44,0.10)', border: '1.5px solid var(--rust)',
            borderRadius: 100, padding: '1px 8px', cursor: 'pointer',
            fontSize: 11, color: 'var(--rust)', fontWeight: 700,
            fontFamily: 'var(--font-mono)',
          }}>
          🤖 ✗ failed
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 51,
              minWidth: 260, maxWidth: 360,
              background: 'var(--cream)', border: '2px solid var(--rust)', borderRadius: 10,
              padding: 12, boxShadow: '0 8px 24px rgba(42,20,52,0.22)',
            }}>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--rust)', marginBottom: 4 }}>AI grading failed</div>
              <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 10, wordBreak: 'break-word' }}>
                {reason}
              </div>
              {onRetry && !isCostCap && (
                <button type="button" onClick={() => { onRetry(); setOpen(false); }}
                  className="btn btn-outline btn-sm">Retry</button>
              )}
            </div>
          </>
        )}
      </span>
    );
  }

  // status.state === 'done'
  if (status.dismissed) return null;

  const r = status.result;
  const range = r.grade_low === r.grade_high ? r.grade_low : `${r.grade_low} → ${r.grade_high}`;
  // When the page is auto-applying grades, show what's currently in the
  // cell rather than the range — gives the seller a clear "this is what
  // was saved" signal. Range still appears in the popover.
  const label = appliedGrade ? `${appliedGrade} applied` : range;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button"
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        title={`AI suggests ${range} (${r.confidence} confidence)`}
        style={{
          background: 'var(--mustard)', border: '1.5px solid var(--plum)',
          borderRadius: 100, padding: '1px 8px', cursor: 'pointer',
          fontSize: 11, color: 'var(--plum)', fontWeight: 700,
          fontFamily: 'var(--font-mono)',
        }}>
        🤖 {label}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div
            onMouseLeave={() => setOpen(false)}
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 51,
              minWidth: 320, maxWidth: 380,
              background: 'var(--cream)', border: '2px solid var(--plum)', borderRadius: 10,
              padding: 14, boxShadow: '0 8px 24px rgba(42,20,52,0.22)',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                padding: '5px 14px', background: 'var(--mustard)', border: '1.5px solid var(--plum)',
                borderRadius: 8, fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--plum)',
              }}>
                {range}
              </div>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
                {r.confidence} confidence
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 10 }}>
              {r.notes}
            </div>
            {r.corners && (
              <div style={{ marginBottom: 6 }}>
                <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>Corners · </span>
                <span style={{ fontSize: 11.5, color: 'var(--plum)' }}>{r.corners}</span>
              </div>
            )}
            {r.edges && (
              <div style={{ marginBottom: 6 }}>
                <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>Edges · </span>
                <span style={{ fontSize: 11.5, color: 'var(--plum)' }}>{r.edges}</span>
              </div>
            )}
            {r.surface && (
              <div style={{ marginBottom: 6 }}>
                <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>Surface · </span>
                <span style={{ fontSize: 11.5, color: 'var(--plum)' }}>{r.surface}</span>
              </div>
            )}
            {(r.centering_front || r.centering_back) && (
              <div style={{ marginBottom: 6, fontSize: 11.5, color: 'var(--plum)' }}>
                <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>Centering · </span>
                {r.centering_front && <span>F: {r.centering_front}</span>}
                {r.centering_front && r.centering_back && ' · '}
                {r.centering_back && <span>B: {r.centering_back}</span>}
              </div>
            )}
            {r.top_flaws && r.top_flaws.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-mute)', marginBottom: 2 }}>Top flaws</div>
                <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, color: 'var(--ink)' }}>
                  {r.top_flaws.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--rule)' }}>
              {onUseLow && (
                <button type="button" onClick={() => { onUseLow(); setOpen(false); }}
                  className="btn btn-outline btn-sm" style={{ flex: 1 }}>
                  Use {r.grade_low}
                </button>
              )}
              {onUseHigh && r.grade_low !== r.grade_high && (
                <button type="button" onClick={() => { onUseHigh(); setOpen(false); }}
                  className="btn btn-outline btn-sm" style={{ flex: 1 }}>
                  Use {r.grade_high}
                </button>
              )}
              {onUndo && (
                <button type="button" onClick={() => { onUndo(); setOpen(false); }}
                  className="btn btn-ghost btn-sm">Undo</button>
              )}
              {onDismiss && (
                <button type="button" onClick={() => { onDismiss(); setOpen(false); }}
                  className="btn btn-ghost btn-sm">Dismiss</button>
              )}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
