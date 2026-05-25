'use client';

import React from 'react';

// Top-of-page toggle for AI grading. Persists the seller's preference to
// localStorage so it survives across sessions and across scan flows.
// Surfaces a live cost meter + warning banner when caps are approached.

const STORAGE_KEY = 'sc:scan-ai-grade';

export function loadAIGradePreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true';
  } catch { return true; }
}

export function saveAIGradePreference(v: boolean) {
  try { localStorage.setItem(STORAGE_KEY, String(v)); } catch {}
}

export default function AIGradeToggle({
  enabled,
  onToggle,
  totalCost,
  evaluatedCount,
  totalCount,
  softCapHit,
  hardCapHit,
  hardCap,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  totalCost: number;
  evaluatedCount: number;
  totalCount: number;
  softCapHit: boolean;
  hardCapHit: boolean;
  hardCap: number;
}) {
  return (
    <div style={{
      border: '1.5px solid var(--rule)', borderRadius: 10,
      background: enabled ? 'rgba(217,150,68,0.08)' : 'transparent',
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 200 }}>
        <input type="checkbox" checked={enabled}
          onChange={e => onToggle(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: 'var(--orange)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--plum)' }}>
          🤖 AI-grade my scans
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
          (~$0.005/card · Haiku 4.5)
        </span>
      </label>

      {enabled && (
        <div style={{
          width: '100%', padding: '6px 10px', borderRadius: 6,
          background: 'rgba(217,150,68,0.12)', border: '1px solid var(--mustard)',
          fontSize: 11.5, color: 'var(--plum)',
        }}>
          ⚠ This will <strong>overwrite the existing condition</strong> on every scanned card. The AI&apos;s upper-bound grade is applied automatically; use the badge on any card to switch to the lower bound or Undo.
        </div>
      )}

      {enabled && totalCount > 0 && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>
          {evaluatedCount} / {totalCount} evaluated · ${totalCost.toFixed(4)}
        </div>
      )}

      {softCapHit && !hardCapHit && (
        <div style={{
          width: '100%', padding: '6px 10px', borderRadius: 6,
          background: 'rgba(217,150,68,0.18)', border: '1px solid var(--mustard)',
          fontSize: 11.5, color: 'var(--plum)',
        }}>
          ⚠ Soft cost cap reached. Hard cap at ${hardCap.toFixed(2)} — toggle off to stop new evaluations.
        </div>
      )}
      {hardCapHit && (
        <div style={{
          width: '100%', padding: '6px 10px', borderRadius: 6,
          background: 'rgba(197,74,44,0.12)', border: '1px solid var(--rust)',
          fontSize: 11.5, color: 'var(--rust)', fontWeight: 700,
        }}>
          ✗ Hard cost cap (${hardCap.toFixed(2)}) reached. Remaining cards in this batch were skipped. Toggle off and on to reset on the next upload.
        </div>
      )}
    </div>
  );
}
