import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  fetchComps,
  groupByMonth,
  isAutographTitle,
  LISTING_WEIGHT,
  monthEndDate,
  monthlySeries,
  resolveCard,
  selectComps,
  ungradedRecords,
  weightedStats,
  withinDays,
  fetchGradeCatalog,
  type CompStats,
  type MatchTier,
  type MonthPoint,
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

// How far back a comp may come from. A comp is an answer to "what is this card
// worth now", and a five-month-old sale answers a different question — so the
// prefilled table is deliberately a recent-activity window, not the archive.
// The archive still feeds the monthly trend line and the stored price history,
// where age is the point rather than a problem.
const COMP_WINDOW_DAYS = 30;

// Ceiling on prefilled rows. Past a dozen the table stops being something a
// person reviews and re-weights, which is the whole exercise.
const MAX_COMP_ROWS = 12;

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

// One month of comps, ready to store as a value-history mark.
export type HistoryPoint = {
  month: string;              // YYYY-MM
  // The date the mark is filed under: the last day of the month it describes
  // (clamped to today for the month still in progress). Using the close of the
  // month rather than the month's last sale is what makes the price-history
  // chart read as an evenly spaced monthly series.
  monthEnd: string;           // YYYY-MM-DD
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
  monthly: MonthPoint[] | null;
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

// Weights proportional to `units`, summing to exactly 100. The modal unlocks
// Save only when the total is within 0.001 of 100, and shares of a hundred
// rarely divide cleanly, so the rounding remainder lands on the first row.
//
// Callers pass LISTING_WEIGHT per row, which makes a completed auction count
// double a Buy-It-Now ask. Equal units give equal weights, so this covers the
// all-auction case too.
function proportionalWeights(units: number[]): number[] {
  const total = units.reduce((s, u) => s + u, 0);
  if (!units.length || total <= 0) return units.map(() => 0);
  const weights = units.map(u => Math.floor((u / total) * 10000) / 100);
  const sum = weights.reduce((s, w) => s + w, 0);
  weights[0] = Math.round((weights[0] + (100 - sum)) * 100) / 100;
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
    // is a reprint or a trimmed card that shouldn't count. A Buy-It-Now says
    // so in words as well as in the Source column, because the distinction
    // between what a card fetched and what someone hoped for is the single
    // easiest thing to misread in this table.
    notes: [tierNote, r.listing_type === 'fixed' ? 'asking price, not a sale' : '', r.title]
      .filter(Boolean).join(' · '),
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

  // Is the catalogue actually populated FOR THIS COMPANY? The check used to
  // ask whether the table held any rows at all, which meant a mirror that died
  // part-way through — the grade catalogue costs ~30 calls against a 4-req/sec
  // limit, so a 429 mid-sweep is a real outcome — left us permanently
  // convinced the catalogue was complete. Every later lookup then returned
  // null and every pricing call ran unfiltered, quietly sharing the 500-row
  // response cap across all grades instead of spending it on the one asked
  // for. Scoping the check to the company retries the missing half.
  const { count } = await admin
    .from('cardsight_grades')
    .select('id', { count: 'exact', head: true })
    .ilike('company', company);
  if (count && count > 0) return null;   // this company is mirrored; the grade just isn't in it

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
  const out: HistoryPoint[] = [];
  for (const [month, rs] of groupByMonth(records)) {
    // Each month is valued on its own sales alone — no carry-over from the
    // month before, no rolling window. A monthly price series that borrowed
    // from its neighbours would smooth away the movement it exists to show.
    if (rs.length < 2) continue;
    const s = weightedStats(rs);
    if (!s) continue;
    const asOf = rs.map(r => r.date.slice(0, 10)).sort().at(-1)!;
    out.push({
      month,
      monthEnd: monthEndDate(month),
      asOf,
      stats: s,
      // Every listing behind the month, kept as the mark's evidence so the
      // user can open the point later and see what it was built from. They
      // carry no weight: the month's value is the weighted median of the whole
      // set, so no single row owns a share of it.
      rows: rs.map(r => toRow(r, 0, tierNote)),
    });
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

  const company = (body.grading_company ?? '').trim();
  const isGraded = !!company && company.toLowerCase() !== 'raw' && !!body.grade;

  // Signed copies are normally stripped out — CardSight files a "PSA AUTO 10"
  // slab in the PSA 10 bucket — but a card the owner has recorded AS an
  // autograph wants exactly those comps, so it opts back in.
  const wantsAutographs = isAutographTitle(body.player);

  // Ungraded cards get statistics but no prefilled rows. CardSight exposes no
  // condition field on a listing, and a raw card's price is mostly condition —
  // handing over a $430 and a $3,938 sale as comparable "comps" would be
  // actively misleading. The distribution, clearly labelled, is honest.
  if (!isGraded) {
    let comps;
    try {
      comps = await fetchComps(cardId, { listingType: 'both', includeAutographs: wantsAutographs });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
    const raw = ungradedRecords(comps.buckets);
    const rawAsk = raw.filter(r => r.listing_type === 'fixed');
    return NextResponse.json<CompsResponse>({
      matched, tier: 'ungraded', bucketLabel: 'ungraded sales',
      rows: [],
      stats: weightedStats(withinDays(raw, COMP_WINDOW_DAYS)),
      monthly: monthlySeries(raw),
      // No stored history for ungraded cards: a month's median across unknown
      // conditions isn't a value, it's an average of different cards.
      history: [],
      ask: weightedStats(withinDays(rawAsk, COMP_WINDOW_DAYS)),
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
  //
  // One call covers both jobs: `both` brings completed auctions and Buy-It-Now
  // asks back together, and the whole archive comes with them, so the recent
  // comps window is a local filter rather than a second round trip.
  const fetchOpts = { listingType: 'both' as const, includeAutographs: wantsAutographs };
  let comps;
  try {
    comps = await fetchComps(cardId, { ...fetchOpts, gradeId: gradeId ?? undefined });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  let selection = selectComps(comps.buckets, company, String(body.grade), 3);

  // Thin at the exact grade — widen. This needs every bucket, so it costs a
  // second, unfiltered call. Only vintage and scarce grades get this far.
  if (!selection || selection.records.length < 3) {
    try {
      const all = await fetchComps(cardId, fetchOpts);
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

  // The comps table is a recent-activity window: completed auctions and
  // Buy-It-Now asks from the last 30 days, most recent first.
  const inWindow = withinDays(selection.records, COMP_WINDOW_DAYS);
  const recent = inWindow.slice(0, MAX_COMP_ROWS);
  const trimmed = inWindow.length - recent.length;   // in-window but past the row cap
  const older = selection.records.length - inWindow.length;

  // Auctions carry twice the weight of asks. Both are evidence; only one of
  // them is a transaction. See LISTING_WEIGHT.
  const weights = proportionalWeights(recent.map(r => LISTING_WEIGHT[r.listing_type] ?? 1));
  const rows = recent.map((r, i) => toRow(r, weights[i], tierNote));

  // Monthly values across the whole archive, for storing as price history.
  const history = buildHistory(selection.records, tierNote);

  const soldCount = recent.filter(r => r.listing_type === 'auction').length;
  const askCount = recent.length - soldCount;

  return NextResponse.json<CompsResponse>({
    matched,
    tier: selection.tier,
    bucketLabel: selection.bucketLabel,
    rows,
    stats: weightedStats(recent),
    monthly: monthlySeries(selection.records),
    history,
    ask: weightedStats(recent.filter(r => r.listing_type === 'fixed')),
    lastSale: comps.lastSale,
    truncated: comps.truncated,
    note: compsNote(recent.length, soldCount, askCount, older, trimmed),
  });
}

// What to say about the sample above the table. The counts matter more than
// any adjective here: a blended figure standing on one auction and four asks
// deserves to be read differently from one standing on twelve auctions, and
// only the breakdown tells the user which they have.
function compsNote(
  total: number, sold: number, asks: number, older: number, trimmed: number,
): string | null {
  // Say what isn't on the table as well as what is. A user who can see two
  // listings and is told nothing about the twelve behind them has no way to
  // know whether the sample is the market or a slice of it.
  const outside = older > 0
    ? ` ${older} older listing${older === 1 ? '' : 's'} sit${older === 1 ? 's' : ''} outside the window — they still feed the monthly history below.`
    : '';
  const capped = trimmed > 0
    ? ` ${trimmed} more in the window ${trimmed === 1 ? 'is' : 'are'} not shown; the stats above cover the ${total} listed.`
    : '';
  if (!total) {
    return `No listings in the last ${COMP_WINDOW_DAYS} days.${outside || ' CardSight\u2019s archive reaches back about five months.'}`;
  }
  const parts = [
    sold ? `${sold} completed auction${sold === 1 ? '' : 's'}` : '',
    asks ? `${asks} Buy-It-Now ask${asks === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' and ');
  const thin = total < 3 ? ' Thin sample — weight accordingly.' : '';
  return `Last ${COMP_WINDOW_DAYS} days: ${parts}. Auctions are weighted double, because an ask is what a seller wanted, not what the card fetched.${thin}${capped}${outside}`;
}
