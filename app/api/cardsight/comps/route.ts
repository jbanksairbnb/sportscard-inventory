import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  activeListings,
  conditionLabel,
  fetchComps,
  fetchMarketplace,
  groupByMonth,
  isAutographTitle,
  isCompletedSale,
  isQualifiedGrade,
  marketBucket,
  matchesCard,
  monthEndDate,
  monthlySeries,
  resolveCard,
  searchListings,
  searchQuery,
  selectComps,
  stats,
  ungradedRecords,
  withinDays,
  fetchGradeCatalog,
  type ActiveListing,
  type MarketRecord,
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

// How far back a comp may come from. Thirty days, and no further.
//
// The obvious alternative — step the window out to 90 days, then a year, until
// enough sales turn up — was what this did, and it is worse than showing
// nothing. "What is this card worth now" has one honest answer window, and a
// median standing on a sale from last spring is not a smaller version of that
// answer; it is a different question wearing the same label. Completed sales
// are genuinely scarce once asks are excluded (the 1961 Mantle PSA 6 had three
// auctions in five months and none in the last 30 days), so an empty comps
// table is the common case for vintage, and it is the correct one. The longer
// view still exists a few inches below, in the monthly history, where it is
// labelled as history rather than as the current market.
const SALE_WINDOW_DAYS = 30;

// Below this the sample is too thin to read as a market. The rows still show;
// they are just flagged, because one sale is a data point, not a price.
const THIN_SALES = 3;

// The live market is only the live market. An ask last seen months ago says
// nothing about what is for sale today.
const ACTIVE_WINDOW_DAYS = 45;

// Ceiling on prefilled rows. Past a dozen the table stops being something a
// person reviews and re-weights, which is the whole exercise.
const MAX_COMP_ROWS = 12;

// Below this many completed sales in the window, go looking through listing
// titles as well. See wideNet().
const WIDEN_BELOW = THIN_SALES;

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

// What the card is currently listed for, and what that implies for a seller.
//
// Asks are NOT evidence of value — they are what sellers hoped for, and this
// card's own data shows how far that can drift. They answer a different and
// genuinely useful question: if you were selling tomorrow, what would you be
// competing against, and what have buyers already refused?
export type LiveAuction = {
  title: string | null;
  url: string | null;
  price: number;            // the current bid
  bidCount: number | null;
  endDate: string | null;
  condition: string | null;
};

export type ActiveMarket = {
  n: number;
  // Null when the only live thing is a running auction and nothing is on ask.
  stats: CompStats | null;
  listings: Array<ActiveListing & {
    staleDays: number | null;
    condition: string | null;
    // Seen in today's marketplace snapshot, rather than inferred from a recent
    // crawl of the pricing archive. See buildActiveMarket().
    confirmed: boolean;
  }>;
  // Auctions running right now, soonest to close first. The only
  // forward-looking data in this API: an auction with bids on it is demand
  // that has not resolved yet, and its close date is a date the owner can put
  // in a diary. Everything else on this page is history.
  auctions: LiveAuction[];
  // Asks we have watched go unsold across at least two crawls. The clearest
  // signal on the page: a price the market has already declined.
  stale: { n: number; median: number | null; maxDaysListed: number };
  // Median ask against median sale. Above zero means sellers are asking more
  // than the card fetches — normal, but the size of the gap is the story.
  premiumPct: number | null;
  // How many of `listings` the marketplace confirms are still up.
  liveConfirmed: number;
  guidance: {
    // Undercut the cheapest live ask; the fastest honest sale.
    priceToMove: number | null;
    // What comparable cards have actually fetched.
    fairValue: number | null;
    // Where the optimists are. Reachable, but expect to wait.
    topOfMarket: number | null;
  };
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
  // The live Buy-It-Now market. Separate from `rows` on purpose: these are not
  // comps and must never reach the valuation.
  active: ActiveMarket | null;
  // Which window `rows` and `stats` were drawn from, in days.
  saleWindowDays: number | null;
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
    notes: [
      tierNote,
      // Where the row came from, when that isn't CardSight's own matcher. The
      // evidence is the same listing either way, but the user is entitled to
      // know which rows we vouched for ourselves.
      r.viaSearch ? 'title match' : '',
      r.listing_type === 'fixed' ? 'asking price, not a sale' : '',
      r.title,
    ].filter(Boolean).join(' · '),
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
    const s = stats(rs);
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
      monthly: null, history: [], ask: null, active: null, saleWindowDays: null,
      lastSale: null, truncated: false,
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
    let raw = ungradedRecords(comps.buckets).map(r => ({ ...r, company: '', grade: '' }));
    // Ungraded listings are exactly the ones sellers title loosely, so the
    // matcher misses more of them than it does slabs — on the 1967 Carew the
    // title search finds 47 raw copies against the card-id endpoint's nine.
    if (withinDays(raw.filter(isCompletedSale), SALE_WINDOW_DAYS).length < WIDEN_BELOW) {
      raw = [...raw, ...await wideNet(body, 'Raw', null, raw, wantsAutographs)];
    }
    const rawSales = raw.filter(isCompletedSale);
    return NextResponse.json<CompsResponse>({
      matched, tier: 'ungraded', bucketLabel: 'ungraded sales',
      rows: [],
      stats: stats(withinDays(rawSales, SALE_WINDOW_DAYS)),
      monthly: monthlySeries(rawSales),
      // No stored history for ungraded cards: a month's median across unknown
      // conditions isn't a value, it's an average of different cards.
      history: [],
      ask: null,
      active: buildActiveMarket(
        await liveShelf(cardId, '', '', wantsAutographs),
        raw, '', '', stats(withinDays(rawSales, SALE_WINDOW_DAYS)),
      ),
      saleWindowDays: SALE_WINDOW_DAYS,
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
      monthly: null, history: [], ask: null, active: null, saleWindowDays: null,
      lastSale: comps.lastSale, truncated: comps.truncated,
      note: `No graded sales found for this card in CardSight's window (their archive currently reaches back about five months).`,
    });
  }

  const tierNote = selection.tier === 'exact' ? '' : `widened to ${selection.bucketLabel}`;

  // Completed sales only. A Buy-It-Now record is a live ask, not a sale, and
  // pricing a card off what nobody has paid is how a $1,890 asking price
  // becomes a $1,890 "market value". See isCompletedSale().
  //
  // Qualified slabs come out too: "PSA 6 OC" sits in the PSA 6 bucket and
  // trades nowhere near it. See isQualifiedGrade().
  let comparable = selection.records.filter(r => !isQualifiedGrade(r.title));
  const qualifiedOut = selection.records.length - comparable.length;
  let sales = comparable.filter(isCompletedSale);

  // One window, held shut. When nothing sold in the last 30 days the table
  // stays empty and the note says why. See SALE_WINDOW_DAYS.
  let recent: TaggedRecord[] = withinDays(sales, SALE_WINDOW_DAYS);

  // Thin at the exact grade even after widening the bucket — the shortfall may
  // be CardSight's matcher rather than the market. Search the listing titles
  // and re-verify every hit locally. Only cards that need it pay the request.
  let salvaged = 0;
  if (recent.length < WIDEN_BELOW && selection.tier === 'exact') {
    const extra = await wideNet(body, company, String(body.grade), comparable, wantsAutographs);
    if (extra.length) {
      salvaged = extra.length;
      comparable = [...comparable, ...extra];
      sales = comparable.filter(isCompletedSale);
      recent = withinDays(sales, SALE_WINDOW_DAYS);
    }
  }

  const shown = recent.slice(0, MAX_COMP_ROWS);
  const trimmed = recent.length - shown.length;

  // Equal weights: every row is now a completed sale, so none outranks another
  // on listing type. The user re-weights for condition and eye appeal.
  const weights = proportionalWeights(shown.map(() => 1));
  const rows = shown.map((r, i) => toRow(r, weights[i], tierNote));

  // Monthly medians across the whole archive, for storing as price history.
  const history = buildHistory(sales, tierNote);

  const saleStats = stats(shown);
  const active = buildActiveMarket(
    await liveShelf(cardId, company, String(body.grade), wantsAutographs),
    comparable, company, String(body.grade), saleStats,
  );

  return NextResponse.json<CompsResponse>({
    matched,
    tier: selection.tier,
    bucketLabel: selection.bucketLabel,
    rows,
    stats: saleStats,
    monthly: monthlySeries(sales),
    history,
    ask: active?.stats ?? null,
    active,
    saleWindowDays: SALE_WINDOW_DAYS,
    lastSale: comps.lastSale,
    truncated: comps.truncated,
    note: compsNote(shown.length, trimmed, sales.length, active?.n ?? 0, qualifiedOut, salvaged),
  });
}

// Go looking for the listings CardSight's matcher never tied to this card.
//
// /pricing/{card_id} only ever returns records their matcher has already
// linked, and on a card whose catalogue name is nothing like what sellers
// type, that is a minority of the market. The 1967 Topps Carew rookie is
// filed as "A. League Rookie Stars (Rod Carew / Hank Allen)": at PSA 6 the
// card-id endpoint has one record and it is an ask, so the grade shows no
// completed sales at all. The same card searched by title returns two real
// auction sales, at $756 and $775, plus four asks — which is the difference
// between "no data" and a valuation.
//
// The search index does not know what card it is returning, so every hit is
// re-verified locally against the identity the owner recorded before it is
// allowed anywhere near a price. See matchesCard(): year, number, player,
// grade, and no reprints, lots or autographs. Anything that fails is dropped
// silently — a wider net is only worth having if the mesh is tight.
async function wideNet(
  body: Body, company: string, grade: string | null,
  have: TaggedRecord[], wantsAutographs: boolean,
): Promise<TaggedRecord[]> {
  const q = searchQuery({
    year: body.year ?? null, brand: body.brand ?? null,
    number: body.number ?? null, player: body.player ?? null,
  });
  // Too little to search on would return the whole index and match on noise.
  if (q.split(/\s+/).filter(Boolean).length < 2) return [];

  let hits;
  try {
    hits = await searchListings(q, { listingType: 'both', period: 'all', limit: 100 });
  } catch {
    return [];   // A failed widening is a thin table, not a broken one.
  }

  // Records we already hold, by listing URL. CardSight's matcher and its text
  // index overlap heavily on the cards where the matcher works at all.
  const seen = new Set(have.map(r => r.url ?? '').filter(Boolean));

  const out: TaggedRecord[] = [];
  for (const h of hits) {
    if (h.url && seen.has(h.url)) continue;
    if (!Number.isFinite(Number(h.price)) || Number(h.price) <= 0) continue;
    if (!matchesCard(h.title, {
      year: body.year ?? null,
      number: body.number ?? null,
      player: body.player ?? null,
      company, grade,
    }, { allowAutographs: wantsAutographs })) continue;
    if (h.url) seen.add(h.url);
    out.push({
      title: h.title, price: Number(h.price), date: h.date,
      source: h.source, listing_type: h.listing_type,
      url: h.url, image_url: h.image_url,
      company, grade: grade ?? '', viaSearch: true,
    });
  }
  return out;
}

// What is on the shelf for this grade right now.
//
// A failure here costs the live-market panel and nothing else: comps, history
// and valuation all come from the pricing archive, so a marketplace outage
// should not take the page down with it.
async function liveShelf(
  cardId: string, company: string, grade: string, wantsAutographs: boolean,
): Promise<MarketRecord[]> {
  try {
    const buckets = await fetchMarketplace(cardId, { includeAutographs: wantsAutographs });
    return marketBucket(buckets, company, grade);
  } catch {
    return [];
  }
}

// Build the live market picture for the grade we matched on.
//
// Two sources, and neither is sufficient alone.
//
// /marketplace is the authoritative present tense — it says what is on the
// shelf right now, with a condition on each listing and, on the auctions, a
// bid count and a closing time. But its coverage thins out badly on exactly
// the cards this app is for: the 1961 Mantle PSA 6 has nine live asks in the
// pricing archive and none at all in the marketplace snapshot; the 1986 Fleer
// Jordan PSA 8 has fifty against nine. Switching to it wholesale would empty
// the panel on most vintage.
//
// So the archive stays the base — every ask seen in a recent crawl — and the
// marketplace adds to it: listings the archive missed, a condition where it
// overlaps, and the running auctions, which the archive cannot contain at all
// because an auction that has not ended has no sale record.
function buildActiveMarket(
  live: MarketRecord[],
  history: TaggedRecord[],
  company: string,
  grade: string,
  saleStats: CompStats | null,
): ActiveMarket | null {
  const liveAsks = live.filter(r => r.listing_type === 'fixed');
  const byTitle = new Map(liveAsks.map(r => [titleKey(r.title), r] as const));

  // The archive's view, with its clock intact.
  const fromArchive = activeListings(history, company, grade)
    .filter(l => withinDays([{ date: l.lastSeen }], ACTIVE_WINDOW_DAYS).length > 0)
    .map(l => {
      const seen = byTitle.get(titleKey(l.title));
      if (seen) byTitle.delete(titleKey(l.title));
      return {
        ...l,
        // Only claim a listing is stale when we have watched it survive the
        // gap between two crawls. One sighting means we know nothing of its age.
        staleDays: l.sightings > 1 ? l.daysListed : null,
        condition: conditionLabel(seen?.condition),
        // Confirmed on the shelf as of the marketplace snapshot, rather than
        // inferred from a recent crawl.
        confirmed: !!seen,
      };
    });

  // Whatever the marketplace has that the archive never saw. No sighting
  // history, so no age — but it is definitely for sale, which the archive
  // entries only probably are.
  const fromMarket = [...byTitle.values()].map(r => ({
    price: Number(r.price),
    title: r.title,
    url: r.url,
    company: company || null,
    grade: grade || null,
    firstSeen: '', lastSeen: '', sightings: 1, daysListed: 0, priceCut: 0,
    staleDays: null as number | null,
    condition: conditionLabel(r.condition),
    confirmed: true,
  }));

  const asks = [...fromArchive, ...fromMarket].sort((a, b) => a.price - b.price);

  const auctions: LiveAuction[] = live
    .filter(r => r.listing_type === 'auction')
    .map(r => ({
      title: r.title,
      url: r.url,
      price: Number(r.price),
      bidCount: typeof r.bid_count === 'number' ? r.bid_count : null,
      endDate: r.end_date ?? null,
      condition: conditionLabel(r.condition),
    }))
    .sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'));

  if (!asks.length && !auctions.length) return null;

  const askStats = stats(asks.map(l => ({ price: l.price })));
  const staleList = asks.filter(l => l.staleDays !== null && l.staleDays >= 14);
  const staleStats = stats(staleList.map(l => ({ price: l.price })));

  const premiumPct = askStats && saleStats && saleStats.median > 0
    ? ((askStats.median - saleStats.median) / saleStats.median) * 100
    : null;

  return {
    n: asks.length,
    stats: askStats,
    listings: asks,
    auctions,
    liveConfirmed: asks.filter(l => l.confirmed).length,
    stale: {
      n: staleList.length,
      median: staleStats?.median ?? null,
      maxDaysListed: staleList.reduce((m, l) => Math.max(m, l.staleDays ?? 0), 0),
    },
    premiumPct,
    guidance: {
      // Undercutting the cheapest ask only sells the card if the shelf is
      // priced near what the card actually fetches. When every live ask sits
      // above the last sale — the 1961 Mantle's cheapest is $1,500 against a
      // $1,152 sale — beating the shelf still leaves you above the market, so
      // the clearing price wins. Rounded to a figure a person would type.
      priceToMove: askStats
        ? roundPrice(saleStats ? Math.min(askStats.min * 0.97, saleStats.median) : askStats.min * 0.97)
        : (saleStats ? roundPrice(saleStats.median) : null),
      fairValue: saleStats ? roundPrice(saleStats.median) : null,
      topOfMarket: askStats ? roundPrice(askStats.p75) : null,
    },
  };
}

// How activeListings() decides two records are the same listing. Shared so the
// live shelf and the sighting history line up on the same key.
function titleKey(title: string | null | undefined): string {
  return (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Round to a figure a seller would actually list at.
function roundPrice(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = n >= 1000 ? 25 : n >= 200 ? 5 : 1;
  return Math.round(n / step) * step;
}

// What to say about the sample above the table. The counts matter more than
// any adjective here: a blended figure standing on one auction and four asks
// deserves to be read differently from one standing on twelve auctions, and
// only the breakdown tells the user which they have.
function compsNote(
  shown: number, trimmed: number,
  totalSales: number, activeAsks: number, qualifiedOut: number, salvaged: number,
): string | null {
  const qualified = qualifiedOut > 0
    ? ` ${qualifiedOut} qualified slab${qualifiedOut === 1 ? '' : 's'} (OC, MC, ST…) set aside — same grade number, different card.`
    : '';
  const live = activeAsks
    ? ` ${activeAsks} Buy-It-Now ask${activeAsks === 1 ? '' : 's'} are listed right now — those are in the live-market panel, not here, because an ask is not a sale.`
    : '';
  const wide = salvaged
    ? ` ${salvaged} of these CardSight had not linked to this card — we found them by title and checked the year, number, player and grade ourselves. They are marked "title match" in the Notes column.`
    : '';

  if (!shown) {
    const older = totalSales
      ? ` ${totalSales} older sale${totalSales === 1 ? '' : 's'} sit${totalSales === 1 ? 's' : ''} in CardSight's archive and feed the monthly history below — history, not a current comp, which is why the window stays at ${SALE_WINDOW_DAYS} days rather than reaching back to fill this table.`
      : ` CardSight's archive holds no completed sales for this card at all — only asking prices. Their sold data covers auctions; eBay's completed Buy-It-Now sales are not in it.`;
    return `No completed sales in the last ${SALE_WINDOW_DAYS} days.${older}${qualified}${live}`;
  }

  const capped = trimmed > 0
    ? ` ${trimmed} more sale${trimmed === 1 ? '' : 's'} in the window ${trimmed === 1 ? 'is' : 'are'} not shown.`
    : '';
  const thin = shown < THIN_SALES
    ? ` Only ${shown} sale${shown === 1 ? '' : 's'} — thin, weight accordingly.`
    : '';
  const depth = totalSales > shown ? ` ${totalSales} sales sit in the archive overall and all of them feed the monthly history below.` : '';

  return `${shown} completed auction sale${shown === 1 ? '' : 's'} in the last ${SALE_WINDOW_DAYS} days.${thin}${wide}${qualified}${capped}${live}${depth}`;
}
