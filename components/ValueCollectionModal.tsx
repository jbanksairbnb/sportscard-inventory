'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ValueSetModal from '@/components/ValueSetModal';
import {
  sweepTargetsForSet, formatSweepValue, type SweepTarget,
} from '@/lib/sweepTargets';

// Price every graded card you own, across every set, in one pass.
//
// The set editor's sweep answers "what is this set worth today". This asks the
// same question of the collection, which is the one that actually builds a
// price history: a series only means anything if the same cards are measured
// every time, and that can't depend on which sets the owner happened to open.
//
// The review, the protections and the marking rules are the set sweep's — this
// component only widens the net and owns the writing back, because there is no
// open editor grid here to hand values to.

type LoadedSet = {
  slug: string;
  title: string;
  year: number | null;
  brand: string | null;
  rows: Array<Record<string, unknown>>;
};

type Props = {
  userId: string;
  onClose: () => void;
  // Fired after values land, so the caller can refresh its set summaries.
  onSaved?: () => void;
};

export default function ValueCollectionModal({ userId, onClose, onSaved }: Props) {
  const [sets, setSets] = useState<LoadedSet[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('sets')
        .select('slug, title, year, brand, rows')
        .eq('user_id', userId);
      if (cancelled) return;
      if (error) { setLoadError(error.message); return; }
      setSets(((data ?? []) as Array<Record<string, unknown>>).map(s => ({
        slug: String(s.slug),
        title: String(s.title || `${s.year || ''} ${s.brand || ''}`.trim() || s.slug),
        year: Number(s.year) || null,
        brand: String(s.brand || '') || null,
        rows: (s.rows || []) as Array<Record<string, unknown>>,
      })));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const targets: SweepTarget[] = useMemo(() => {
    if (!sets) return [];
    const out: SweepTarget[] = [];
    for (const s of sets) {
      out.push(...sweepTargetsForSet(
        { slug: s.slug, title: s.title, year: s.year, brand: s.brand },
        s.rows,
      ));
    }
    // Oldest sets first is meaningless here; group by set so the review table
    // reads as a walk through the collection rather than a shuffle.
    out.sort((a, b) => a.setSlug.localeCompare(b.setSlug) || a.rowIndex - b.rowIndex);
    return out;
  }, [sets]);

  // Write the accepted values back, one set at a time.
  //
  // Rows are re-read per set rather than written from the copy loaded when the
  // modal opened: a long sweep is minutes of wall time, and another tab (or
  // the set editor itself) may have moved on since. Each row is checked
  // against the card it was priced as before being overwritten, so a set that
  // gained or lost rows mid-run loses the stale writes rather than pasting a
  // Drysdale's price onto a Koufax.
  async function persist(accepted: Array<{ target: SweepTarget; value: number }>) {
    if (!accepted.length) return;
    const supabase = createClient();
    const bySet = new Map<string, Array<{ target: SweepTarget; value: number }>>();
    for (const a of accepted) {
      if (!bySet.has(a.target.setSlug)) bySet.set(a.target.setSlug, []);
      bySet.get(a.target.setSlug)!.push(a);
    }

    const failed: string[] = [];
    let skipped = 0;

    for (const [slug, items] of bySet) {
      const { data, error } = await supabase
        .from('sets')
        .select('rows')
        .eq('user_id', userId)
        .eq('slug', slug)
        .maybeSingle();
      if (error || !data) { failed.push(slug); continue; }

      const rows = [...((data.rows || []) as Array<Record<string, unknown>>)];
      for (const { target, value } of items) {
        const row = rows[target.rowIndex];
        if (!row) { skipped++; continue; }
        const sameCard =
          String(row['Card #'] || '').trim() === String(target.descriptor.card_number || '').trim() &&
          String(row['Player'] || '').trim() === String(target.descriptor.player || '').trim();
        if (!sameCard) { skipped++; continue; }
        rows[target.rowIndex] = { ...row, Value: formatSweepValue(value) };
      }

      // The same summary columns the set editor and the want list recompute on
      // save, so the home page's totals stay in step with the rows.
      const toNum = (x: unknown) => {
        const n = Number(String(x ?? '').replace(/[$,]/g, '').trim());
        return Number.isFinite(n) ? n : 0;
      };
      const total = rows.length;
      const ownedCount = rows.filter(r => String(r['Owned'] || '') === 'Yes').length;
      const totalCost = rows.reduce((a, r) => a + toNum(r['Cost']), 0);
      const totalValue = rows.reduce((a, r) => a + toNum(r['Value']), 0);
      const { error: writeError } = await supabase.from('sets').update({
        rows,
        row_count: total,
        owned_count: ownedCount,
        owned_pct: total ? (ownedCount / total) * 100 : 0,
        total_cost: totalCost,
        total_value: totalValue,
        gain_loss: totalValue - totalCost,
        updated_at: Date.now(),
      }).eq('user_id', userId).eq('slug', slug);
      if (writeError) failed.push(slug);
    }

    if (failed.length || skipped) {
      setSaveError([
        failed.length ? `${failed.length} set${failed.length === 1 ? '' : 's'} could not be saved (${failed.join(', ')})` : '',
        skipped ? `${skipped} row${skipped === 1 ? '' : 's'} changed underneath the sweep and were left alone` : '',
      ].filter(Boolean).join('; '));
    }
    onSaved?.();
  }

  // Still reading the collection, or nothing in it to price.
  if (!sets || loadError || !targets.length) {
    return (
      <div onClick={onClose} style={shade}>
        <div onClick={e => e.stopPropagation()} style={{ ...sheet, maxWidth: 520 }}>
          <div style={{ padding: '18px 20px' }}>
            <strong style={{ color: 'var(--plum)', fontSize: 16 }}>Value your collection</strong>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '10px 0 14px' }}>
              {loadError
                ? `Couldn’t read your sets: ${loadError}`
                : !sets
                  ? 'Reading your sets…'
                  : 'No cards to price. The sweep looks for cards you own that are graded — a grading company and a grade — since CardSight’s sold data only covers graded copies.'}
            </p>
            <button type="button" onClick={onClose} className="btn btn-outline btn-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <ValueSetModal
        open
        onClose={onClose}
        userId={userId}
        targets={targets}
        heading="Value your collection"
        scopeNote={`across ${new Set(targets.map(t => t.setSlug)).size} set${new Set(targets.map(t => t.setSlug)).size === 1 ? '' : 's'} — graded cards you own, since CardSight’s sold data doesn’t cover raw copies`}
        onApply={persist}
      />
      {saveError && (
        <div style={{
          position: 'fixed', left: 16, bottom: 16, zIndex: 70, maxWidth: 420,
          background: 'var(--paper)', border: '1.5px solid var(--rust)', borderRadius: 8,
          padding: '10px 12px', fontSize: 12.5, color: 'var(--rust)',
          boxShadow: '0 6px 18px rgba(42,20,52,0.25)',
        }}>
          {saveError}
        </div>
      )}
    </>
  );
}

const shade: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(42,20,52,0.55)', zIndex: 60,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto',
};
const sheet: React.CSSProperties = {
  background: 'var(--paper)', border: '2px solid var(--plum)', borderRadius: 10,
  width: '100%', boxShadow: '0 10px 30px rgba(42,20,52,0.3)',
};
