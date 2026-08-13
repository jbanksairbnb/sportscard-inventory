'use client';

// Update a single card's value straight from the inventory view. The owner gets
// two ways to set it: type a number, or open the full research table to build a
// weighted comp. A "view history" shortcut jumps to the value detail popup when
// the card already has marks. Purely presentational — the parent owns the writes
// (persisting the Value field, recording the mark, refreshing history).

import React, { useEffect, useState } from 'react';

function parseMoney(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

type Props = {
  open: boolean;
  onClose: () => void;
  cardTitle: string;
  conditionLabel: string;
  currentValue: number | null;
  imageFront?: string | null;
  imageBack?: string | null;
  hasHistory: boolean;
  onSave: (value: number) => void;      // persist a typed value
  onResearch: () => void;               // open the market-research table
  onViewHistory: () => void;            // open the value history/chart popup
};

export default function ValueUpdateModal({
  open, onClose, cardTitle, conditionLabel, currentValue,
  imageFront, imageBack, hasHistory, onSave, onResearch, onViewHistory,
}: Props) {
  const [draft, setDraft] = useState('');

  // Re-seed the input each time the modal opens for a (possibly different) card.
  useEffect(() => {
    if (open) setDraft(currentValue !== null ? currentValue.toFixed(2) : '');
  }, [open, currentValue]);

  if (!open) return null;

  const parsed = parseMoney(draft);
  const canSave = parsed !== null && (currentValue === null || Math.abs(parsed - currentValue) >= 0.005);
  const imgs = [
    { url: imageFront || '', label: 'Front' },
    { url: imageBack || '', label: 'Back' },
  ].filter(i => i.url);

  function save() {
    if (parsed === null) return;
    onSave(parsed);
    onClose();
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 210,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '60px 16px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 440, padding: 22, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>💲 Update Value</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2 }}>
              {cardTitle} <span style={{ color: 'var(--orange)' }}>· {conditionLabel}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕</button>
        </div>

        {imgs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {imgs.map(i => (
              <a key={i.label} href={i.url} target="_blank" rel="noreferrer"
                title={`Open ${i.label.toLowerCase()} scan in a new tab`} style={{ lineHeight: 0 }}>
                <img loading="lazy" decoding="async" src={i.url} alt={i.label}
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--plum)', cursor: 'zoom-in' }} />
              </a>
            ))}
          </div>
        )}

        <label className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-mute)', display: 'block', marginBottom: 4 }}>
          Enter a value
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-mute)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>$</span>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSave) save(); }}
              inputMode="decimal"
              placeholder="0.00"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 22px',
                fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--plum)',
                background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 8,
              }}
            />
          </div>
          <button type="button" onClick={save} disabled={!canSave}
            className="btn btn-primary btn-sm" style={{ opacity: canSave ? 1 : 0.5 }}>
            Save
          </button>
        </div>
        {currentValue !== null && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginBottom: 14 }}>
            Current: {fmtMoney(currentValue)}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { onResearch(); onClose(); }}
            className="btn btn-ghost btn-sm">📈 Research market price</button>
          {hasHistory && (
            <button type="button" onClick={() => { onViewHistory(); onClose(); }}
              className="btn btn-ghost btn-sm">📊 View history &amp; chart</button>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '10px 0 0' }}>
          Typing a value records a dated mark so its movement is tracked. Research builds a
          weighted comp and does the same.
        </p>
      </div>
    </div>
  );
}
