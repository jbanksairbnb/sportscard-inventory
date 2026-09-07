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

// Bump when the matching logic in resolveCard() changes materially. Cached
// rows resolved by an older version are re-looked-up on next use, so a fix
// reaches the cards an earlier resolver got wrong without a mass backfill.
const CARDSIGHT_RESOLVER_VERSION = 2;

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
  // Which dropdown value the row should carry, so the Source column says where
  // the sale happened and whether it was an auction or a Buy-It-Now.
  source: 'cardsight_auction' | 'cardsight_bin' | 'other';
  // Only set when the marketplace isn't one our source list covers; the modal
  // shows it as a free-text label alongside 'other'.
  source_label: string | null;
};

// One month of sold comps, ready to store as a value-history mark.
export type HistoryPoint = {
  month: string;              // YYYY-MM
  asOf: string;               // YYYY-MM-DD, the month's most recent sale
  stats: CompStats;
  rows: CompRow[];
};

export type CompsResponse = {
  matched: null | { name: string; release: string; set: string; year: string };
  tier: MatchTier | null;
  bucketLabel: string | null;
  rows: CompRow[];
  stats: CompStats | null;
  monthly: Array<{ month: string; stats: CompStats }> | null;
  // Per-month medians we can write into card_value_history. Looser than
  // `monthly` (which gates on density before drawing a trend) because a
  // two-sale month is still a real data point once its sample size is shown.
  history: HistoryPoint[];
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
  // Every record CardSight returns today is from eBay, but `source` is a field
  // on the record rather than a constant, so map it instead of assuming. An
  // unrecognized marketplace falls back to the free-text source so a future
  // one shows up honestly rather than being mislabelled as eBay.
  const ebay = (r.source ?? '').toLowerCase() === 'ebay';
  const source = ebay
    ? (r.listing_type === 'fixed' ? 'cardsight_bin' as const : 'cardsight_auction' as const)
    : 'other' as const;
  return {
    price: Number(r.price),
    sale_date: r.date.slice(0, 10),
    grade_company: r.company,
    grade_value: r.grade,
    url: r.url ?? '',
    source,
    source_label: source === 'other'
      ? `CardSight · ${r.source} ${r.listing_type === 'fixed' ? 'Buy-It-Now' : 'auction'}`
      : null,
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

// Group sold comps into per-month medians we can store as value marks.
//
// Each point is dated to the month's most recent sale rather than to the day
// the import ran, so the resulting price history is a real timeline instead of
// a stack of marks all sharing today's date.
//
// Two sales is the floor. A single sale is a data point, not a median, and
// writing it into a price history gives a lone eBay result the authority of a
// monthly market value.
function buildHistory(records: TaggedRecord[], tierNote: string): HistoryPoint[] {
  const byMonth = new Map<string, TaggedRecord[]>();
  for (const r of records) {
    const m = r.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const out: HistoryPoint[] = [];
  for (const [month, rs] of byMonth) {
    if (rs.length < 2) continue;
    const s = stats(rs);
    if (!s) continue;
    const asOf = rs.map(r => r.date.slice(0, 10)).sort().at(-1)!;
    out.push({ month, asOf, stats: s, rows: rs.map(r => toRow(r, 0, tierNote)) });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
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
    .select('cardsight_card_id, not_found, matched_release, matched_set, matched_year, matched_name, resolver_version')
    .match(k)
    .maybeSingle();

  // A row an older resolver produced is not trustworthy — treat it as a miss.
  const fresh = cached && (cached.resolver_version ?? 1) >= CARDSIGHT_RESOLVER_VERSION;

  let cardId = fresh ? cached!.cardsight_card_id ?? null : null;
  let matched = fresh && cached && !cached.not_found
    ? {
        name: cached.matched_name ?? '',
        release: cached.matched_release ?? '',
        set: cached.matched_set ?? '',
        year: cached.matched_year ?? '',
      }
    : null;

  if (!fresh) {
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
      resolver_version: CARDSIGHT_RESOLVER_VERSION,
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
      monthly: null, history: [], ask: null, lastSale: null, truncated: false,
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
      // No stored history for ungraded cards: a month's median across unknown
      // conditions isn't a value, it's an average of different cards.
      history: [],
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
      // Buy-It-Now asks for the same grade. These become rows too — the
      // Source column names them as Buy-It-Now so they're distinguishable —
      // but they arrive weighted at zero, because an ask is what a seller
      // hoped for rather than what the card fetched and runs meaningfully
      // higher (13% on a PSA 9 Griffey). Visible as context, not counted.
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
      monthly: null, history: [], ask: null, lastSale: comps.lastSale, truncated: comps.truncated,
      note: `No graded sales found for this card in CardSight's window (their archive currently reaches back about five months).`,
    });
  }

  const tierNote = selection.tier === 'exact' ? '' : `widened to ${selection.bucketLabel}`;
  const askSelection = askComps ? selectComps(askComps.buckets, company, String(body.grade), 3) : null;

  // Prefill the ten most recent sold comps. More than that and the table stops
  // being reviewable, and the older tail is the least comparable anyway.
  const sold = selection.records.slice(0, 10);
  // A handful of asks for context. Fewer, because they don't carry weight.
  const asks = (askSelection?.records ?? []).slice(0, 3);

  // Sold comps carry the whole 100%. Asks come in at zero so the default
  // valuation stays bid-side while the seller can still see what people are
  // asking — and re-weight them if they disagree.
  const weights = equalWeights(sold.length);
  const rows = [
    ...sold.map((r, i) => toRow(r, weights[i], tierNote)),
    ...asks.map(r => toRow(r, 0, [tierNote, 'asking price, not a sale'].filter(Boolean).join(' · '))),
  ];
  // Unless there were no sales at all, in which case asks are all we have and
  // an unweighted table would be useless.
  if (!sold.length && asks.length) {
    const askWeights = equalWeights(asks.length);
    rows.forEach((r, i) => { r.weight_pct = askWeights[i]; });
  }

  // Monthly medians of the SOLD comps, for storing as value history. Two sales
  // is the floor: one sale is a single data point wearing the word "median".
  const history = buildHistory(selection.records, tierNote);

  return NextResponse.json<CompsResponse>({
    matched,
    tier: selection.tier,
    bucketLabel: selection.bucketLabel,
    rows,
    stats: stats(selection.records),
    monthly: monthlySeries(selection.records),
    history,
    ask: askSelection ? stats(askSelection.records) : null,
    lastSale: comps.lastSale,
    truncated: comps.truncated,
    note: selection.records.length < 3
      ? `Only ${selection.records.length} sale${selection.records.length === 1 ? '' : 's'} found — thin sample, weight accordingly.`
      : null,
  });
}
