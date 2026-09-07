// CardSight AI — trading-card catalog and completed-sales comps.
//
// We use it read-only, as a comp source for the pricing research modal. Their
// collection/list/binder endpoints overlap what we already store in Supabase,
// so we deliberately ignore those.
//
// Two facts about their data shape everything below:
//
//   1. Pricing is keyed on THEIR card UUID, so every lookup is a two-step:
//      resolve our identity tuple (year/brand/number/player) to a card id,
//      then ask for that card's sales. Resolution is the expensive half —
//      one call per distinct card — so callers cache the id (see the
//      cardsight_cards table) and only the pricing half repeats.
//
//   2. The sales archive is SHALLOW. As of Sept 2026 it starts around
//      April 2026 — roughly five months, nothing older, confirmed by paging
//      `as_of_date` back to 2025 and getting empty responses. So "history"
//      here means months, not years, and any windowing has to survive
//      buckets of n=1. See monthlySeries().
//
// Records come back as individual timestamped listings (never aggregates),
// which is what lets us prefill the research table row-for-row.

const BASE = 'https://api.cardsight.ai/v1';

// Their per-request cap. Asking for more is silently clamped, and a response
// that hits it sets `messages`.
const MAX_RECORDS = 500;

export type CardIdentity = {
  year: number | null;
  brand: string | null;
  number: string | null;
  player: string | null;
};

// One completed listing. `listing_type` is the ask/bid split: 'auction' is a
// closed auction (something actually sold at this price), 'fixed' is a
// Buy-It-Now ASKING price, which is not the same thing and runs higher — on a
// PSA 9 Griffey the two medians differed by 13%. Never blend them silently.
export type CardSightRecord = {
  title: string | null;
  price: number;
  date: string;
  source: string;
  listing_type: 'auction' | 'fixed';
  url: string | null;
  image_url: string | null;
};

export type CompBucket = {
  company: string | null;   // null = ungraded ("raw" section)
  grade: string | null;
  records: CardSightRecord[];
};

// How much a listing type counts toward a blended value.
//
// An `auction` record is a card that changed hands: their timestamps cluster
// at 00:00-04:00 UTC, which is eBay's auction-close window. A `fixed` record
// is an ASK observed by a crawler — those timestamps cluster at 09:00-13:00
// UTC, a daily sweep, and the same listing reappears month after month while
// it fails to sell. Asks still carry information (they bound the top of the
// market and they're all you have on a quiet card), just less of it, so a
// completed auction counts double.
export const LISTING_WEIGHT: Record<CardSightRecord['listing_type'], number> = {
  auction: 2,
  fixed: 1,
};

// A record that remembers which bucket it came from. Once the ladder widens,
// the comps no longer share the card's own grade, and a row labelled with the
// TARGET grade would be a lie — a BCCG 10 is roughly a PSA 8, so showing one
// as "PSA 10" would quietly inflate the analysis. Every comp carries its true
// grader and grade from here on.
export type TaggedRecord = CardSightRecord & { company: string; grade: string };

export type CompStats = {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
};

// How far we had to widen from the card's actual grade to find enough comps.
// Surfaced to the user per row so a PSA 8 comp on an SGC 8 card is visible as
// a substitution rather than passed off as an exact match.
export type MatchTier = 'exact' | 'same-grade' | 'adjacent-grade' | 'ungraded';

export type CompSelection = {
  tier: MatchTier;
  bucketLabel: string;
  records: TaggedRecord[];
};

class CardSightError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'CardSightError';
  }
}

function apiKey(): string {
  const k = process.env.CARDSIGHT_API_KEY;
  if (!k) throw new CardSightError('CARDSIGHT_API_KEY is not set');
  return k;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// CardSight allows 4 requests per SECOND and says so in the 429 body. That's
// easy to trip — mirroring their grade catalogue alone is ~30 calls back to
// back — so every request retries on 429 with a widening pause. Anything else
// fails fast: a 404 won't fix itself.
async function call<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ''}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-API-Key': apiKey() },
      // Comps move slowly, so let the platform serve repeat lookups from cache
      // rather than spending request budget on them.
      next: { revalidate: 3600 },
    });
    if (res.ok) return res.json() as Promise<T>;

    const body = await res.text().catch(() => '');
    if (res.status === 429 && attempt < 4) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    throw new CardSightError(`CardSight ${path} returned ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
}

// ——— Resolution ———————————————————————————————————————————————

type CatalogCard = {
  id: string;
  number: string;
  name: string;
  setName: string;
  releaseName: string;
  releaseYear: string;
  attributes?: string[] | null;
};

// Basketball and hockey releases are seasons ("1986-87"), and our card_year is
// an int, so a straight year match misses every one of them. Try the plain
// year first (right for baseball and football, which is most of the catalog),
// then the season spelling.
function yearVariants(year: number): string[] {
  const next = String((year + 1) % 100).padStart(2, '0');
  return [String(year), `${year}-${next}`];
}

// Words that describe a card rather than name anybody on it. Dropped before
// comparing names so "RC" and "rookie" can't stand in for a real match.
const DESCRIPTIVE_WORDS = new Set([
  'rc', 'rookie', 'card', 'hof', 'auto', 'autograph', 'sp', 'the', 'and', 'psa', 'sgc', 'bgs',
]);

function nameTokens(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of (s ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (t.length > 1 && !DESCRIPTIVE_WORDS.has(t)) out.add(t);
  }
  return out;
}

// How well a catalogue card's name matches what the seller typed.
//
// Our `player` field is free text — "Rickey Henderson - Oakland Athletics RC",
// "robinson, jackie", "NOLAN RYAN RC" — while CardSight's is a clean name. So
// we compare in BOTH directions and take the better of the two, because each
// direction fails on a different real card:
//
//   * The description is usually longer than the name (it carries the team and
//     "RC"), so ask how much of the CARD's name appears in the description.
//     "Rickey Henderson" is fully inside the string above → 1.0.
//   * Multi-player rookies invert that: 1968 Topps #177 is filed as "Mets 1968
//     Rookie Stars (Jerry Koosman / Nolan Ryan)", far longer than "Nolan Ryan
//     RC". So also ask how much of the DESCRIPTION appears in the name.
function nameScore(cardName: string, description: string): number {
  const card = nameTokens(cardName);
  const desc = nameTokens(description);
  if (!card.size || !desc.size) return 0;
  let shared = 0;
  for (const t of card) if (desc.has(t)) shared += 1;
  return Math.max(shared / card.size, shared / desc.size);
}

// Some multi-player rookies name nobody at all: 1982 Topps #21, the Cal Ripken
// Jr. rookie, is simply "Orioles Future Stars". No amount of name comparison
// will confirm it, so a rookie flag on both sides is the corroboration we have.
// Small enough that it only decides otherwise-tied candidates.
const RC_BONUS = 0.35;

function scoreCandidate(card: CatalogCard, description: string, wantsRookie: boolean): number {
  let s = nameScore(card.name, description);
  if (wantsRookie && (card.attributes ?? []).includes('RC')) s += RC_BONUS;
  return s;
}

// Resolve our identity tuple to a CardSight card id.
//
// We do NOT send our player text as their `name` filter. That filter is a
// substring match against their clean card name, so any extra word the seller
// typed makes it match nothing at all — "Rickey Henderson - Oakland Athletics
// RC" returns zero rows while "Rickey Henderson" returns the card. Instead we
// pull every card at this year/number/release and decide locally, where we can
// be lenient in a way a substring filter cannot.
//
// Deciding locally is also what keeps us honest: year + number alone is NOT
// unique — 1982 Topps #21 is a Cal Ripken rookie in baseball and a Bills team
// card in football, and 1980 Topps #482 is both Rickey Henderson and Bob
// Parsons. So a candidate has to actually beat the others on the name before
// we accept it. Returning null beats pricing the wrong card.
export async function resolveCard(identity: CardIdentity): Promise<CatalogCard | null> {
  const { year, brand, number, player } = identity;
  if (!year || !number || !player) return null;
  const wantsRookie = /\b(rc|rookie)\b/i.test(player);

  for (const y of yearVariants(year)) {
    // Brand narrows the field, but sellers write "Topps" where the catalogue
    // says "Topps Traded", so fall back to year + number if it finds nothing.
    for (const withBrand of brand ? [true, false] : [false]) {
      const res = await call<{ cards: CatalogCard[]; total_count: number }>('/catalog/cards', {
        number,
        year: y,
        releaseName: withBrand ? brand! : undefined,
        take: 25,
      });

      // Their catalogue carries exact duplicates of some cards (two rows for
      // the 1968 Ryan). Collapsing them stops a duplicate from tying with
      // itself and looking ambiguous.
      const unique = new Map<string, CatalogCard>();
      for (const c of res.cards ?? []) {
        if (!unique.has(c.name.toLowerCase())) unique.set(c.name.toLowerCase(), c);
      }
      if (!unique.size) continue;

      const ranked = [...unique.values()]
        .map(c => ({ card: c, score: scoreCandidate(c, player, wantsRookie) }))
        .sort((a, b) => b.score - a.score);

      const [best, second] = ranked;
      // A clear winner, or nothing. Two candidates the seller's text can't
      // separate is exactly the case where guessing goes wrong.
      if (best.score > 0 && best.score > (second?.score ?? 0)) return best.card;
    }
  }
  return null;
}

// ——— Comps ————————————————————————————————————————————————————

type PricingResponse = {
  card: { card_id: string; name: string; number: string; set: { name: string; year: string; release: string } };
  raw: { count: number; records: CardSightRecord[] };
  graded: Array<{
    company_name: string;
    company_id: string;
    grades: Array<{ grade_value: string; grade_id: string; count: number; records: CardSightRecord[] }>;
  }>;
  meta: { total_records: number; last_sale_date: string | null };
  messages?: Array<{ type: string; message: string }> | null;
};

// Fetch comps for a card and bucket them by grader + grade.
//
// Pass `gradeId` when you know the grade you want. The 500-row cap is shared
// across every bucket in the response, so an unfiltered call on a card with
// hundreds of sales starves the individual grades — a PSA 9 Griffey that has
// 200+ auction sales came back with 27 of them once the raw section had taken
// its share. Filtering server-side spends the whole budget on the grade that
// matters. The unfiltered form is still the right call for widening, where we
// need to see every bucket at once.
export async function fetchComps(
  cardId: string,
  opts: {
    listingType?: 'auction' | 'fixed' | 'both';
    period?: string;
    gradeId?: string;
    includeAutographs?: boolean;
  } = {},
): Promise<{ buckets: CompBucket[]; lastSale: string | null; truncated: boolean }> {
  const res = await call<PricingResponse>(`/pricing/${cardId}`, {
    period: opts.period ?? 'all',
    listing_type: opts.listingType ?? 'auction',
    grade_id: opts.gradeId,
    limit: MAX_RECORDS,
  });

  const clean = (records: CardSightRecord[], listingAware: boolean): CardSightRecord[] => {
    const kept = opts.includeAutographs ? records : records.filter(r => !isAutographTitle(r.title));
    return listingAware ? collapseRelistings(kept) : kept;
  };

  const buckets: CompBucket[] = [];
  if (res.raw?.records?.length) {
    const records = clean(res.raw.records, true);
    if (records.length) buckets.push({ company: null, grade: null, records });
  }
  for (const company of res.graded ?? []) {
    for (const g of company.grades ?? []) {
      const records = clean(g.records ?? [], true);
      if (records.length) {
        buckets.push({ company: company.company_name, grade: g.grade_value, records });
      }
    }
  }
  return {
    buckets,
    lastSale: res.meta?.last_sale_date ?? null,
    truncated: (res.meta?.total_records ?? 0) >= MAX_RECORDS,
  };
}

// ——— Record hygiene ———————————————————————————————————————————

// A signed card is a different market from the same card unsigned, and
// CardSight files them together. PSA issues a separate *Autograph* grade
// alongside the *Card* grade, but the pricing response exposes only one grade
// per record, so a "PSA AUTO 10" slab lands in the PSA 10 bucket: on the 1967
// Carew rookie, every single PSA 10 "sale" was an autographed card at ~$600,
// against a genuine PSA 10 worth six figures. Eight of that card's 23 graded
// records were signed copies.
//
// The title is the only signal we get, so we read it. A card the owner says is
// itself an autograph opts back in — see fetchComps({ includeAutographs }).
const AUTOGRAPH_TITLE = /\b(auto|autos|autod|autoed|autograph|autographs|autographed|signed|signature|inscribed|jsa|psa\s*\/?\s*dna|beckett\s+witness)\b/i;

export function isAutographTitle(title: string | null | undefined): boolean {
  return AUTOGRAPH_TITLE.test(title ?? '');
}

// Collapse repeat sightings of one unsold listing down to its latest price.
//
// Their crawler re-observes active Buy-It-Now listings on a roughly monthly
// cadence and emits a fresh record each time, with a new short-link URL, so
// there is no listing id to group on. The pattern is unmistakable in the data:
// on the 1974 Parker, a BGS 4.5 at $70 appears on 2026-08-04 and again on
// 2026-09-04; a PSA 6 at $100 on 08-07 and again on 09-07. Nineteen of that
// card's 91 asks were re-sightings.
//
// Left alone they would corrupt exactly what we're building: one stubborn
// seller's unsold card would contribute a data point to every month of the
// price history. Keyed on the title because that's what stays constant while
// the price drifts — the same Parker slab (serial 12170349 in its title) shows
// $355.12, then $285.30 a fortnight later, before finally selling at auction
// for $257.37.
//
// Completed auctions are NEVER collapsed: a seller who reuses one title
// template across listings really did sell three different copies, and those
// are three real sales.
function collapseRelistings(records: CardSightRecord[]): CardSightRecord[] {
  const latest = new Map<string, CardSightRecord>();
  const out: CardSightRecord[] = [];
  for (const r of records) {
    if (r.listing_type !== 'fixed') { out.push(r); continue; }
    const k = (r.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // An untitled ask can't be matched to anything, so it stands on its own.
    if (!k) { out.push(r); continue; }
    const prev = latest.get(k);
    if (!prev || r.date > prev.date) latest.set(k, r);
  }
  return [...out, ...latest.values()];
}

// Records no older than `days`. The pricing endpoint takes a `period` and
// honours it server-side ("30d" really does return only the last 30 days), but
// we re-apply the cut locally: one call serves both the short comps window and
// the full-archive history, and a client-side filter is the same answer for
// free rather than a second request.
export function withinDays<T extends { date: string }>(records: T[], days: number): T[] {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  return records.filter(r => r.date >= cutoff);
}

// ——— Grade catalogue ——————————————————————————————————————————

export type GradeRef = { company: string; grade: string; condition: string | null; gradeId: string };

// The full grader → grade → UUID table, so we can turn "SGC 4" into the
// grade_id the pricing endpoint filters on. Small, static, and worth caching
// in our own database: it costs one call per grading company plus two, and it
// changes about never.
//
// Note that a grade value is NOT unique within a company — SGC has two grades
// numbered 10 (Pristine and Gem Mint) — so callers keying a map must include
// the condition or accept the first match deliberately.
export async function fetchGradeCatalog(): Promise<GradeRef[]> {
  const { companies } = await call<{ companies: Array<{ id: string; name: string }> }>('/grades/companies', {});
  const out: GradeRef[] = [];
  for (const c of companies ?? []) {
    const { types } = await call<{ types: Array<{ id: string; name: string }> }>(
      `/grades/companies/${c.id}/types`, {},
    );
    // 'Card' is the numeric grade of the card itself; the other type is the
    // autograph grade, which is a different scale and not what we price on.
    const cardType = (types ?? []).find(t => t.name === 'Card');
    if (!cardType) continue;
    const { grades } = await call<{ grades: Array<{ id: string; grade: string; condition: string | null }> }>(
      `/grades/companies/${c.id}/types/${cardType.id}/grades`, {},
    );
    for (const g of grades ?? []) {
      out.push({ company: c.name, grade: String(g.grade), condition: g.condition, gradeId: g.id });
    }
  }
  return out;
}

// ——— Grade matching ———————————————————————————————————————————

function gradeNumber(grade: string | null): number | null {
  if (!grade) return null;
  const n = parseFloat(grade);
  return Number.isFinite(n) ? n : null;
}

// Pick comps for a graded card, widening only as far as we have to.
//
// Tiers run exact company+grade → same numeric grade at any company →
// half-grade neighbours. We stop at the first tier holding `minSamples`,
// because a wider net is a worse comp: an SGC 4 is not a PSA 4, and a PSA 5
// is not a PSA 4 at all. Widening is a fallback for thin vintage data, not a
// default — in our 1953-1987 range a specific grade often has only 1-5 sales
// in the entire available window.
export function selectComps(
  buckets: CompBucket[],
  company: string,
  grade: string,
  minSamples = 3,
): CompSelection | null {
  const target = gradeNumber(grade);
  const graded = buckets.filter(b => b.company !== null);

  const exact = graded.filter(
    b => b.company?.toUpperCase() === company.toUpperCase() && b.grade === grade,
  );
  // Cross-grader widening only holds between graders on a comparable scale.
  // BCCG and BGS's BCCG-era slabs grade far softer than PSA/SGC at the same
  // number — a BCCG 10 trades around a PSA 8 — so folding them into a
  // "grade 10" pool would drag the median toward a card the seller doesn't
  // own. They still appear in the catalogue and in the ungraded/other
  // buckets; they're just not substitutes.
  const comparable = (c: string | null) => !!c && !SOFT_SCALE_GRADERS.has(c.toUpperCase());
  const sameGrade = graded.filter(
    b => target !== null && gradeNumber(b.grade) === target && comparable(b.company),
  );
  const adjacent = graded.filter(b => {
    const n = gradeNumber(b.grade);
    return target !== null && n !== null && Math.abs(n - target) === 0.5 && comparable(b.company);
  });

  const tiers: Array<{ tier: MatchTier; label: string; pool: CompBucket[] }> = [
    { tier: 'exact', label: `${company} ${grade}`, pool: exact },
    { tier: 'same-grade', label: `grade ${grade}, any grader`, pool: sameGrade },
    { tier: 'adjacent-grade', label: `grade ${grade} ±0.5, any grader`, pool: [...sameGrade, ...adjacent] },
  ];

  let widest: CompSelection | null = null;
  for (const { tier, label, pool } of tiers) {
    // Tag on the way out so each comp keeps the grader and grade it actually
    // carries, whatever grade we were searching for.
    const records = pool.flatMap(b =>
      b.records.map(r => ({ ...r, company: b.company!, grade: b.grade! })),
    );
    if (!records.length) continue;
    widest = { tier, bucketLabel: label, records: sortByDateDesc(records) };
    if (records.length >= minSamples) return widest;
  }
  // Everything we found was thinner than minSamples — hand back the widest
  // net rather than nothing, and let the caller show the sample size.
  return widest;
}

// Graders whose numbers don't line up with the PSA/SGC/BGS scale, so they're
// excluded from cross-grader substitution.
const SOFT_SCALE_GRADERS = new Set(['BCCG', 'GMA', 'HGA', 'PRO', 'ISA']);

// Ungraded sales for a card. Kept separate from selectComps because these
// are NOT comparable to each other, let alone to a graded card: CardSight
// exposes no condition field on a listing (records carry only title, price,
// date, source, listing_type, url, image_url), and the seller's title
// mentions a condition word barely 40-60% of the time, in loose vocabulary
// ("VG-VGEX", "NR-MINT"). The resulting spread is enormous — ungraded 1953
// Robinsons ran $430 to $3,938 — and that spread is condition, not market.
// So callers should present these as a distribution, never as comps to weight.
export function ungradedRecords(buckets: CompBucket[]): CardSightRecord[] {
  const raw = buckets.find(b => b.company === null);
  return raw ? sortByDateDesc(raw.records) : [];
}

function sortByDateDesc<T extends { date: string }>(records: T[]): T[] {
  return records.slice().sort((a, b) => b.date.localeCompare(a.date));
}

// ——— Statistics ———————————————————————————————————————————————

export function stats(records: Array<{ price: number }>): CompStats | null {
  const prices = records.map(r => Number(r.price)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!prices.length) return null;
  const at = (q: number) => prices[Math.min(prices.length - 1, Math.floor(q * prices.length))];
  const mid = Math.floor(prices.length / 2);
  return {
    n: prices.length,
    mean: prices.reduce((s, p) => s + p, 0) / prices.length,
    median: prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2,
    min: prices[0],
    max: prices[prices.length - 1],
    p25: at(0.25),
    p75: at(0.75),
  };
}

// A record carrying enough to be weighted. Loose on purpose so both raw
// CardSightRecords and TaggedRecords satisfy it.
type Weighable = { price: number; listing_type: CardSightRecord['listing_type'] };

// Statistics that count a completed auction twice and an ask once.
//
// Implemented by repeating each record LISTING_WEIGHT times before taking the
// order statistics. With integer weights this is exact — no interpolation, no
// approximation — and it keeps median/quartiles as real observed prices rather
// than synthetic points between them.
//
// `n` reports the number of real records, not the expanded count: the user is
// being told how many sales back the number, and inflating that to 34 when
// there were 20 would misrepresent the sample.
export function weightedStats(records: Weighable[]): CompStats | null {
  const expanded: number[] = [];
  let realCount = 0;
  let weightSum = 0;
  let weightedTotal = 0;
  for (const r of records) {
    const price = Number(r.price);
    if (!Number.isFinite(price)) continue;
    realCount += 1;
    const w = LISTING_WEIGHT[r.listing_type] ?? 1;
    weightSum += w;
    weightedTotal += w * price;
    for (let i = 0; i < w; i++) expanded.push(price);
  }
  if (!realCount) return null;
  expanded.sort((a, b) => a - b);
  const at = (q: number) => expanded[Math.min(expanded.length - 1, Math.floor(q * expanded.length))];
  const mid = Math.floor(expanded.length / 2);
  return {
    n: realCount,
    mean: weightedTotal / weightSum,
    median: expanded.length % 2 ? expanded[mid] : (expanded[mid - 1] + expanded[mid]) / 2,
    min: expanded[0],
    max: expanded[expanded.length - 1],
    p25: at(0.25),
    p75: at(0.75),
  };
}

// The last calendar day of a YYYY-MM, as YYYY-MM-DD — never in the future.
//
// Monthly marks are stamped to the close of the month they describe, so the
// price-history chart reads as a monthly series ("5/31") instead of labelling
// each point with whatever day the month's last sale happened to fall on
// ("5/29"). The current month has no close yet, so it's clamped to today.
export function monthEndDate(month: string, now: Date = new Date()): string {
  const [y, m] = month.split('-').map(Number);
  // Day 0 of the following month is the last day of this one.
  const end = new Date(Date.UTC(y, m, 0));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return (end > today ? today : end).toISOString().slice(0, 10);
}

// Group records into calendar months, each month holding only its own sales.
export function groupByMonth<T extends { date: string }>(records: T[]): Array<[string, T[]]> {
  const byMonth = new Map<string, T[]>();
  for (const r of records) {
    const m = r.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export type MonthPoint = { month: string; monthEnd: string; stats: CompStats };

// Per-month stats, but only when the data can carry them.
//
// We deliberately don't commit to a fixed bucket size. The archive is about
// five months deep, and density varies by three orders of magnitude across
// our own era: a 1980 Henderson PSA 7 sees ~20 sales a month, a 1968 Ryan
// PSA 6 saw one sale, total. Monthly buckets on the Ryan would be a chart of
// single data points masquerading as a trend, and bi-weekly would be worse.
// So: return a series only if enough months clear `minPerBucket`, and let the
// caller fall back to a single aggregate when this returns null.
export function monthlySeries(
  records: Array<Weighable & { date: string }>,
  { minPerBucket = 4, minBuckets = 3 }: { minPerBucket?: number; minBuckets?: number } = {},
): MonthPoint[] | null {
  const points = groupByMonth(records)
    .filter(([, rs]) => rs.length >= minPerBucket)
    .map(([month, rs]) => ({ month, monthEnd: monthEndDate(month), stats: weightedStats(rs)! }));
  return points.length >= minBuckets ? points : null;
}
