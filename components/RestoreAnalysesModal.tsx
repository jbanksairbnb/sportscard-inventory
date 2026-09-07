'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { insertValueHistoryRows } from '@/lib/recordValueMark';
import {
  findRestorableAnalyses,
  countPerCard,
  type MarkForRestore,
  type RestorableAnalysis,
  type SessionForRestore,
} from '@/lib/restoreAnalyses';

// Put every saved analysis back on its card's price chart, in one pass.
//
// The research modal offers this one card at a time, which is right when you're
// already looking at the card. It is the wrong shape for a collection that
// accumulated hundreds of analyses before the history table existed — nobody is
// opening three hundred cards to click three hundred buttons.
//
// Deliberately collection-wide rather than scoped to the set it's launched
// from: this is a one-time repair, and making it per-set would reproduce the
// tedium it exists to remove. The header says so plainly, because a button on a
// set page that quietly reaches past the set would be a nasty surprise.

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Called after marks are written, so the page can refresh its trends. */
  onDone?: (restored: number) => void;
};

type Phase = 'scanning' | 'review' | 'writing' | 'done' | 'error';

const PAGE = 1000;

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export default function RestoreAnalysesModal({ open, onClose, userId, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('scanning');
  const [items, setItems] = useState<RestorableAnalysis[]>([]);
  const [perCard, setPerCard] = useState<Map<string, number>>(new Map());
  const [scanned, setScanned] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [written, setWritten] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;

    (async () => {
      setPhase('scanning');
      setError(null);
      setItems([]);
      setWritten(0);
      const supabase = createClient();

      try {
        // Page through both tables. A collection with years of research runs
        // past PostgREST's default row cap, and a silently truncated scan would
        // report "nothing to restore" on exactly the collections that need it
        // most.
        const sessions: SessionForRestore[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error: e } = await supabase
            .from('market_research_sessions')
            .select('id, card_year, card_brand, card_number, card_player, card_grade, card_grading_company, card_raw_grade, listing_id, set_slug, set_card_number, market_value, notes, created_at, updated_at, market_research_data_points(position, source, source_label, grade_company, grade_value, sale_date, price, weight_pct, url, notes)')
            .eq('user_id', userId)
            .not('market_value', 'is', null)
            .order('updated_at', { ascending: false })
            .range(from, from + PAGE - 1);
          if (e) throw new Error(e.message);
          const page = (data || []) as unknown as SessionForRestore[];
          sessions.push(...page);
          if (cancelled) return;
          setScanned(sessions.length);
          if (page.length < PAGE) break;
        }

        const marks: MarkForRestore[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error: e } = await supabase
            .from('card_value_history')
            .select('content_hash, source_session_id')
            .eq('user_id', userId)
            .range(from, from + PAGE - 1);
          if (e) throw new Error(e.message);
          const page = (data || []) as unknown as MarkForRestore[];
          marks.push(...page);
          if (page.length < PAGE) break;
        }
        if (cancelled) return;

        const found = findRestorableAnalyses(userId, sessions, marks);
        setItems(found);
        setPerCard(countPerCard(found, sessions));
        setSkipped(sessions.length - found.length);
        // Everything is pre-ticked: each one is the owner's own work, and the
        // restore is additive — it charts an analysis that already exists and
        // changes no card's current value.
        setChosen(new Set(found.map(f => f.sessionId)));
        setPhase('review');
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
  }, [open, userId]);

  const picked = useMemo(() => items.filter(i => chosen.has(i.sessionId)), [items, chosen]);
  const oldest = items.length ? items[items.length - 1].at : null;
  const newest = items.length ? items[0].at : null;

  async function write() {
    setPhase('writing');
    setWritten(0);
    const { inserted, error: e } = await insertValueHistoryRows(
      picked.map(p => p.payload),
      done => setWritten(done),
    );
    setWritten(inserted);
    if (e) {
      // Partial success is the common failure here, and it matters: the marks
      // already written are real, and re-running skips them rather than
      // doubling them.
      setError(`${e}${inserted > 0 ? ` — ${inserted} of ${picked.length} were restored before this failed; running again picks up the rest.` : ''}`);
      setPhase('error');
      if (inserted > 0) onDone?.(inserted);
      return;
    }
    setPhase('done');
    onDone?.(inserted);
  }

  if (!open) return null;

  const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 700, fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' };
  const td: React.CSSProperties = { padding: '6px 8px', fontSize: 12.5, verticalAlign: 'top' };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 880, padding: 24, background: 'var(--cream)' }}>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>Restore price history</div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: 11 }}>
            ✕ Close
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.55, marginTop: 0, marginBottom: 16 }}>
          Analyses you saved before a value was committed never got a point on their card&rsquo;s price
          chart — the comps survived, the chart entry didn&rsquo;t. This puts them back, each one dated to
          the day you did the work rather than to today. It runs across <strong>your whole collection</strong>,
          not just this set, and it only adds history: no card&rsquo;s current value changes.
        </p>

        {phase === 'scanning' && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
            Checking your saved analyses… {scanned > 0 && <span className="mono">{scanned} so far</span>}
          </div>
        )}

        {phase === 'error' && (
          <div style={{ padding: '10px 12px', background: 'var(--paper)', border: '1.5px solid var(--rust)', borderRadius: 6, color: 'var(--rust)', fontSize: 12.5, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {phase === 'review' && items.length === 0 && (
          <div style={{ padding: '18px 16px', background: 'var(--paper)', border: '1px dashed var(--rule)', borderRadius: 8, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
            Nothing to restore — every saved analysis in your collection is already on its card&rsquo;s
            price chart.
            {scanned > 0 && <> <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>({scanned} checked)</span></>}
          </div>
        )}

        {(phase === 'review' || phase === 'writing' || phase === 'done') && items.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                <strong>{items.length}</strong> {items.length === 1 ? 'analysis' : 'analyses'} to restore
              </span>
              {oldest && newest && (
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  {new Date(oldest).toLocaleDateString()} – {new Date(newest).toLocaleDateString()}
                </span>
              )}
              {skipped > 0 && (
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  {skipped} already charted
                </span>
              )}
              {phase === 'review' && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                    onClick={() => setChosen(new Set(items.map(i => i.sessionId)))}>
                    Select all
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                    onClick={() => setChosen(new Set())}>
                    Select none
                  </button>
                </div>
              )}
            </div>

            <div style={{ maxHeight: 420, overflowY: 'auto', border: '1.5px solid var(--rule)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--cream)', boxShadow: '0 1px 0 var(--rule)' }}>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-mute)' }}>
                    <th style={th} />
                    <th style={th}>Card</th>
                    <th style={th}>Condition</th>
                    <th style={{ ...th, textAlign: 'right' }}>Value</th>
                    <th style={{ ...th, textAlign: 'right' }}>Comps</th>
                    <th style={{ ...th, textAlign: 'right' }}>Dated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.sessionId} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                      <td style={td}>
                        <input type="checkbox" disabled={phase !== 'review'}
                          checked={chosen.has(it.sessionId)}
                          onChange={e => setChosen(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(it.sessionId); else next.delete(it.sessionId);
                            return next;
                          })} />
                      </td>
                      <td style={{ ...td, color: 'var(--ink)', maxWidth: 300 }}>{it.label}</td>
                      <td style={{ ...td, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{it.condition}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--plum)', whiteSpace: 'nowrap' }}>
                        {fmtMoney(it.value)}
                      </td>
                      <td className="mono" style={{ ...td, textAlign: 'right', color: 'var(--ink-mute)' }}>{it.comps}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right', color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
                        {new Date(it.at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {[...perCard.values()].some(n => n > 1) && (
              <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', lineHeight: 1.5, marginTop: 8, marginBottom: 0 }}>
                Some cards appear more than once — separate analyses of the same card on different
                dates. Restoring them all is what gives that card a price series rather than a single
                point.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              {phase !== 'done' && (
                <button type="button" onClick={write} disabled={!picked.length || phase === 'writing'}
                  className="btn btn-primary" style={{ fontSize: 13 }}>
                  {phase === 'writing'
                    ? `Restoring… ${written}/${picked.length}`
                    : `Restore ${picked.length} ${picked.length === 1 ? 'analysis' : 'analyses'}`}
                </button>
              )}
              {phase === 'done' && (
                <>
                  <span style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 700 }}>
                    ✓ Restored {written} {written === 1 ? 'analysis' : 'analyses'}.
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    Open any of these cards and the price history will show the work, dated when you did it.
                  </span>
                  <button type="button" onClick={onClose} className="btn btn-primary" style={{ fontSize: 13, marginLeft: 'auto' }}>
                    Done
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
