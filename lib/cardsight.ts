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
};

// Basketball and hockey releases are seasons ("1986-87"), and our card_year is
// an int, so a straight year match misses every one of them. Try the plain
// year first (right for baseball and football, which is most of the catalog),
// then the two season spellings.
function yearVariants(year: number): string[] {
  const next = String((year + 1) % 100).padStart(2, '0');
  return [String(year), `${year}-${next}`];
}

// Resolve our identity tuple to a CardSight card id.
//
// We use the structured /catalog/cards filters rather than the fuzzy
// /catalog/search, because search is unreliable at exactly the job that
// matters: asked for "1986 Fleer Michael Jordan" it returns a 2006
// anniversary reprint, while the filtered lookup returns the real
// 1986-87 Fleer #57. Wrong card silently priced is worse than no price.
//
// Returns null when the card genuinely isn't in their catalog — a real
// outcome, not an error. Their pre-war baseball coverage has holes (1940
// Play Ball, for one, is absent entirely).
export async function resolveCard(identity: CardIdentity): Promise<CatalogCard | null> {
  const { year, brand, number, player } = identity;
  if (!year || !number || !player) return null;

  for (const y of yearVariants(year)) {
    // Brand first; it disambiguates same-numbered cards across releases. If
    // our brand string doesn't match their release naming we retry without it
    // rather than give up — number + year + player is usually unique enough.
    for (const withBrand of brand ? [true, false] : [false]) {
      const res = await call<{ cards: CatalogCard[]; total_count: number }>('/catalog/cards', {
        name: player,
        number,
        year: y,
        releaseName: withBrand ? brand! : undefined,
        take: 5,
      });
      const cards = res.cards ?? [];
      // Only trust an unambiguous hit. Several matches means our tuple didn't
      // pin one card down, and guessing the first is how you price a reprint
      // as an original.
      if (cards.length === 1) return cards[0];
      if (cards.length > 1 && withBrand) return cards[0];
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
  opts: { listingType?: 'auction' | 'fixed' | 'both'; period?: string; gradeId?: string } = {},
): Promise<{ buckets: CompBucket[]; lastSale: string | null; truncated: boolean }> {
  const res = await call<PricingResponse>(`/pricing/${cardId}`, {
    period: opts.period ?? 'all',
    listing_type: opts.listingType ?? 'auction',
    grade_id: opts.gradeId,
    limit: MAX_RECORDS,
  });

  const buckets: CompBucket[] = [];
  if (res.raw?.records?.length) {
    buckets.push({ company: null, grade: null, records: res.raw.records });
  }
  for (const company of res.graded ?? []) {
    for (const g of company.grades ?? []) {
      buckets.push({ company: company.company_name, grade: g.grade_value, records: g.records ?? [] });
    }
  }
  return {
    buckets,
    lastSale: res.meta?.last_sale_date ?? null,
    truncated: (res.meta?.total_records ?? 0) >= MAX_RECORDS,
  };
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

export type MonthPoint = { month: string; stats: CompStats };

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
  records: Array<{ price: number; date: string }>,
  { minPerBucket = 4, minBuckets = 3 }: { minPerBucket?: number; minBuckets?: number } = {},
): MonthPoint[] | null {
  const byMonth = new Map<string, Array<{ price: number; date: string }>>();
  for (const r of records) {
    const m = r.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const points = [...byMonth.entries()]
    .filter(([, rs]) => rs.length >= minPerBucket)
    .map(([month, rs]) => ({ month, stats: stats(rs)! }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return points.length >= minBuckets ? points : null;
}
