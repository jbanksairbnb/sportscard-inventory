import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  fetchComps,
  monthlySeries,
  resolveCard,
  selectComps,
  stats,
  ungradedRecords,
  fetchGradeCatalog,
  type CompStats,
  type MatchTier,
  type TaggedRecord,
} from '@/lib/cardsight';

// Comps for the pricing research modal.
//
// Everything CardSight touches happens here rather than in the browser: the
// API key is server-only, and the resolution cache needs the service role to
// write. The client sends a card identity and gets back rows it can drop
// straight into the research table, plus the statistics for the panel above it.

export const runtime = 'nodejs';

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

type Body = {
  year?: number | null;
  brand?: string | null;
  number?: string | null;
  player?: string | null;
  grading_company?: string | null;  // 'PSA' | 'SGC' | ... | 'Raw' | null
  grade?: string | null;
  listing_type?: 'auction' | 'fixed';
};

export type CompRow = {
  price: number;
  sale_date: string;          // YYYY-MM-DD
  grade_company: string;
  grade_value: string;
  url: string;
  notes: string;
  weight_pct: number;
  listing_type: 'auction' | 'fixed';
};

export type CompsResponse = {
  matched: null | { name: string; release: string; set: string; year: string };
  tier: MatchTier | null;
  bucketLabel: string | null;
  rows: CompRow[];
  stats: CompStats | null;
  monthly: Array<{ month: string; stats: CompStats }> | null;
  ask: CompStats | null;        // Buy-It-Now asking prices, for reference only
  lastSale: string | null;
  truncated: boolean;
  note: string | null;
};

// Cache key. Lowercased and trimmed so "Topps" and "topps " collapse onto the
// one row the unique index expects.
function key(b: Body) {
  return {
    card_year: b.year!,
    card_brand: (b.brand ?? '').trim().toLowerCase(),
    card_number: String(b.number ?? '').trim().toLowerCase(),
    card_player: (b.player ?? '').trim().toLowerCase(),
  };
}

// Equal weights that sum to exactly 100. The modal unlocks Save only when the
// total is within 0.001 of 100, and floating-point thirds don't get there on
// their own, so the remainder lands on the first row.
function equalWeights(n: number): number[] {
  if (n <= 0) return [];
  const each = Math.floor((100 / n) * 100) / 100;
  const weights = Array<number>(n).fill(each);
  weights[0] = Math.round((100 - each * (n - 1)) * 100) / 100;
  return weights;
}

// Rows carry the comp's OWN grader and grade, not the card's. Once the ladder
// widens they differ, and that difference is exactly what the user needs to
// see to weight the row honestly.
function toRow(r: TaggedRecord, weight: number, tierNote: string): CompRow {
  return {
    price: Number(r.price),
    sale_date: r.date.slice(0, 10),
    grade_company: r.company,
    grade_value: r.grade,
    url: r.url ?? '',
    // The listing title is the audit trail: it's how a user spots that a comp
    // is an autograph, a reprint, or a trimmed card that shouldn't count.
    notes: [tierNote, r.title].filter(Boolean).join(' · '),
    weight_pct: weight,
    listing_type: r.listing_type,
  };
}

// Look up CardSight's UUID for a grader + grade, mirroring their whole grade
// catalogue into our table the first time we need it. The catalogue is small
// and static, so this populate happens once for the site's lifetime; every
// later lookup is a local read.
//
// Returns null when we can't map the grade (an unrecognized grader, or a
// grade string like "10 Pristine" we don't parse). The caller falls back to
// an unfiltered lookup, which still works — just with less depth.
async function gradeIdFor(
  admin: ReturnType<typeof adminClient>,
  company: string,
  grade: string,
): Promise<string | null> {
  const read = async () => {
    const { data } = await admin
      .from('cardsight_grades')
      .select('cardsight_grade_id')
      .ilike('company', company)
      .eq('grade', grade)
      // SGC numbers two distinct grades 10 (Pristine and Gem Mint). We can't
      // tell which a seller means from "SGC 10" alone, so take the lower —
      // Gem Mint is far commoner, and over-claiming Pristine would price the
      // card above what the user actually owns.
      .order('condition', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.cardsight_grade_id ?? null;
  };

  const hit = await read();
  if (hit) return hit;

  const { count } = await admin
    .from('cardsight_grades')
    .select('id', { count: 'exact', head: true });
  if (count && count > 0) return null;   // catalogue is present; this grade just isn't in it

  try {
    const catalog = await fetchGradeCatalog();
    if (catalog.length) {
      await admin.from('cardsight_grades').upsert(
        catalog.map(g => ({
          company: g.company,
          grade: g.grade,
          condition: g.condition,
          cardsight_grade_id: g.gradeId,
        })),
        { onConflict: 'company,grade,condition' },
      );
    }
  } catch {
    return null;   // pricing still works unfiltered
  }
  return read();
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  if (!process.env.CARDSIGHT_API_KEY) {
    return NextResponse.json({ error: 'CardSight is not configured' }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.year || !body.number || !body.player) {
    return NextResponse.json({ error: 'Need year, card number and player to look up comps' }, { status: 400 });
  }

  const admin = adminClient();
  const k = key(body);

  // Resolution is the expensive call, and the answer is the same for every
  // user on the site, so consult the shared cache first — including its record
  // of misses, which stops us re-spending a call on a card we know is absent.
  const { data: cached } = await admin
    .from('cardsight_cards')
    .select('cardsight_card_id, not_found, matched_release, matched_set, matched_year, matched_name')
    .match(k)
    .maybeSingle();

  let cardId = cached?.cardsight_card_id ?? null;
  let matched = cached && !cached.not_found
    ? {
        name: cached.matched_name ?? '',
        release: cached.matched_release ?? '',
        set: cached.matched_set ?? '',
        year: cached.matched_year ?? '',
      }
    : null;

  if (!cached) {
    let resolved;
    try {
      resolved = await resolveCard({
        year: body.year, brand: body.brand ?? null,
        number: String(body.number), player: body.player,
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
    await admin.from('cardsight_cards').upsert({
      ...k,
      cardsight_card_id: resolved?.id ?? null,
      not_found: !resolved,
      matched_release: resolved?.releaseName ?? null,
      matched_set: resolved?.setName ?? null,
      matched_year: resolved?.releaseYear ?? null,
      matched_name: resolved?.name ?? null,
      checked_at: new Date().toISOString(),
    }, { onConflict: 'card_year,card_brand,card_number,card_player' });
    cardId = resolved?.id ?? null;
    matched = resolved
      ? { name: resolved.name, release: resolved.releaseName, set: resolved.setName, year: resolved.releaseYear }
      : null;
  }

  if (!cardId) {
    return NextResponse.json<CompsResponse>({
      matched: null, tier: null, bucketLabel: null, rows: [], stats: null,
      monthly: null, ask: null, lastSale: null, truncated: false,
      note: 'This card is not in the CardSight catalog, so there are no comps to pull. Their pre-war coverage in particular has gaps.',
    });
  }

  const listingType = body.listing_type ?? 'auction';
  const company = (body.grading_company ?? '').trim();
  const isGraded = !!company && company.toLowerCase() !== 'raw' && !!body.grade;

  // Ungraded cards get statistics but no prefilled rows. CardSight exposes no
  // condition field on a listing, and a raw card's price is mostly condition —
  // handing over a $430 and a $3,938 sale as comparable "comps" would be
  // actively misleading. The distribution, clearly labelled, is honest.
  if (!isGraded) {
    let comps, askComps;
    try {
      comps = await fetchComps(cardId, { listingType });
      askComps = await fetchComps(cardId, { listingType: 'fixed' });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
    const raw = ungradedRecords(comps.buckets);
    const rawAsk = ungradedRecords(askComps.buckets);
    return NextResponse.json<CompsResponse>({
      matched, tier: 'ungraded', bucketLabel: 'ungraded sales',
      rows: [],
      stats: stats(raw),
      monthly: monthlySeries(raw),
      ask: stats(rawAsk),
      lastSale: comps.lastSale,
      truncated: comps.truncated,
      note: 'Ungraded sales carry no condition data, and condition drives most of the spread you see here. Treat this as a range to judge against, not as comps.',
    });
  }

  const gradeId = await gradeIdFor(admin, company, String(body.grade));

  // Ask for the exact grade by id when we can. That single call returns the
  // full depth for this grade — hundreds of sales on a busy card, where an
  // unfiltered call would have handed back a couple of dozen — and it's the
  // answer we want most of the time, so the common case costs one request.
  let comps, askComps = null as Awaited<ReturnType<typeof fetchComps>> | null;
  try {
    comps = await fetchComps(cardId, { listingType, gradeId: gradeId ?? undefined });
    if (gradeId) {
      // Buy-It-Now asks for the same grade. Never mixed into the rows: an ask
      // is what a seller hopes for, not what a card fetched, and it runs
      // meaningfully higher. Context only.
      askComps = await fetchComps(cardId, { listingType: 'fixed', gradeId });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  let selection = selectComps(comps.buckets, company, String(body.grade), 3);

  // Thin at the exact grade — widen. This needs every bucket, so it costs a
  // second, unfiltered call. Only vintage and scarce grades get this far.
  if (!selection || selection.records.length < 3) {
    try {
      const all = await fetchComps(cardId, { listingType });
      const widened = selectComps(all.buckets, company, String(body.grade), 3);
      if (widened && widened.records.length > (selection?.records.length ?? 0)) {
        selection = widened;
        comps = all;
      }
    } catch {
      // Keep the thin exact-grade result rather than failing the whole pull.
    }
  }

  if (!selection || !selection.records.length) {
    return NextResponse.json<CompsResponse>({
      matched, tier: null, bucketLabel: null, rows: [], stats: null,
      monthly: null, ask: null, lastSale: comps.lastSale, truncated: comps.truncated,
      note: `No graded sales found for this card in CardSight's window (their archive currently reaches back about five months).`,
    });
  }

  // Prefill the ten most recent comps. More than that and the table stops
  // being reviewable, and the older tail is the least comparable anyway.
  const take = selection.records.slice(0, 10);
  const weights = equalWeights(take.length);
  const tierNote = selection.tier === 'exact' ? '' : `widened to ${selection.bucketLabel}`;
  const rows = take.map((r, i) => toRow(r, weights[i], tierNote));

  // Stats use every comp in the selected bucket, not just the ten shown —
  // the median of 108 sales is a better anchor than the median of 10.
  const askSelection = askComps ? selectComps(askComps.buckets, company, String(body.grade), 3) : null;

  return NextResponse.json<CompsResponse>({
    matched,
    tier: selection.tier,
    bucketLabel: selection.bucketLabel,
    rows,
    stats: stats(selection.records),
    monthly: monthlySeries(selection.records),
    ask: askSelection ? stats(askSelection.records) : null,
    lastSale: comps.lastSale,
    truncated: comps.truncated,
    note: selection.records.length < 3
      ? `Only ${selection.records.length} sale${selection.records.length === 1 ? '' : 's'} found — thin sample, weight accordingly.`
      : null,
  });
}
