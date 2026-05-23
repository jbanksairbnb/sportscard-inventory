'use client';

import { useCallback, useRef, useState } from 'react';

// Concurrent AI card grading with cost tracking + cap. Drives the three
// bulk scan flows (multi-card, batch, scan-from-set). Each page owns its
// own row state; this hook only tracks per-row AI status + cost. Pages
// apply the AI suggestion to their rows themselves (typically by setting
// Raw Grade = result.grade_low).

export type AIGradeRowContext = {
  year: number | null;
  brand: string | null;
  set_title: string | null;
  card_number: string | null;
  player: string | null;
  image_front_url: string;
  // Back image is optional — the API + grader handle front-only cards by
  // reducing confidence and noting the gap in the notes field. Skipping
  // back-less cards entirely meant some scans never got an AI grade,
  // which is what "couldn't be graded" was on the review screen.
  image_back_url: string | null;
};

export type AIGradeResult = {
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

export type AIGradeStatus =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'done'; result: AIGradeResult; dismissed: boolean }
  | { state: 'error'; error: string };

export type AIGradeItem = { id: string; context: AIGradeRowContext };

// 3 in flight keeps us well under Anthropic's per-minute rate limits.
// Was 5 — caused ~50% failure rate on 14-listing batches due to 429s.
// Retry-with-backoff in the grader is the primary defense; this is belt+suspenders.
const CONCURRENCY = 3;
const DEFAULT_SOFT_CAP = 0.50;
const DEFAULT_HARD_CAP = 2.00;

// Haiku 4.5 = $1/M in, $5/M out. Cached input @ 0.1x rate, cache write @ 1.25x.
function costFromUsage(u: AIGradeResult['usage']): number {
  return (
    u.input_tokens * 1.0 +
    u.cache_read_input_tokens * 0.1 +
    u.cache_creation_input_tokens * 1.25 +
    u.output_tokens * 5.0
  ) / 1_000_000;
}

export function useAIGrade(options?: {
  enabled?: boolean;
  hardCapDollars?: number;
  softCapDollars?: number;
  // Tagged onto every logged grade in the DB so the admin dashboard can
  // slice accuracy by surface. Pass the page identifier e.g. "scan-batch".
  source?: string;
}) {
  const hardCap = options?.hardCapDollars ?? DEFAULT_HARD_CAP;
  const softCap = options?.softCapDollars ?? DEFAULT_SOFT_CAP;

  const [statuses, setStatuses] = useState<Record<string, AIGradeStatus>>({});
  const [totalCost, setTotalCost] = useState(0);
  const totalCostRef = useRef(0);
  const inFlightRef = useRef<Set<string>>(new Set());

  const setStatus = useCallback((id: string, s: AIGradeStatus) => {
    setStatuses(prev => ({ ...prev, [id]: s }));
  }, []);

  const evaluateOne = useCallback(async (item: AIGradeItem) => {
    setStatus(item.id, { state: 'pending' });
    try {
      const res = await fetch('/api/cards/evaluate-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_front_url: item.context.image_front_url,
          image_back_url: item.context.image_back_url,
          year: item.context.year,
          brand: item.context.brand,
          set_title: item.context.set_title,
          card_number: item.context.card_number,
          player: item.context.player,
          source: options?.source,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const result = data as AIGradeResult;
      const c = costFromUsage(result.usage);
      totalCostRef.current += c;
      setTotalCost(totalCostRef.current);
      setStatus(item.id, { state: 'done', result, dismissed: false });
    } catch (e) {
      setStatus(item.id, { state: 'error', error: e instanceof Error ? e.message : 'failed' });
    }
  }, [setStatus]);

  const evaluate = useCallback(async (items: AIGradeItem[]) => {
    if (!options?.enabled) return;
    // Seed all as pending so the UI shows spinners immediately.
    setStatuses(prev => {
      const next = { ...prev };
      for (const it of items) if (!next[it.id]) next[it.id] = { state: 'pending' };
      return next;
    });

    const queue = [...items];
    async function worker() {
      while (queue.length > 0) {
        // Stop pulling new work if we've blown the hard cap. In-flight calls
        // continue, but no new ones start. UI surfaces a banner.
        if (totalCostRef.current >= hardCap) {
          // Mark anything left in the queue as errored so the UI doesn't
          // show eternal pending.
          while (queue.length > 0) {
            const skipped = queue.shift()!;
            setStatus(skipped.id, { state: 'error', error: 'cost-cap-reached' });
          }
          break;
        }
        const next = queue.shift();
        if (!next) break;
        inFlightRef.current.add(next.id);
        try { await evaluateOne(next); } finally { inFlightRef.current.delete(next.id); }
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
    await Promise.all(workers);
  }, [options?.enabled, hardCap, evaluateOne, setStatus]);

  const dismissResult = useCallback((id: string) => {
    setStatuses(prev => {
      const s = prev[id];
      if (!s || s.state !== 'done') return prev;
      return { ...prev, [id]: { ...s, dismissed: true } };
    });
  }, []);

  // Re-fire a single row's evaluation. Used by the badge's Retry button
  // when the first attempt errored (transient API failure, etc.). Caller
  // passes the original item so we re-use the same context + id.
  const retry = useCallback((item: AIGradeItem) => evaluateOne(item), [evaluateOne]);

  return {
    statuses,
    totalCost,
    softCapHit: totalCost >= softCap && totalCost < hardCap,
    hardCapHit: totalCost >= hardCap,
    softCap,
    hardCap,
    evaluate,
    retry,
    dismissResult,
  };
}
