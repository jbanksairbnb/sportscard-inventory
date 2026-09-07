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

// `auction` is the only listing type that records a completed sale.
//
// Measured on 335 records for the 1961 Topps Mantle #300: 84% of `fixed`
// timestamps land in a 09:00-13:00 UTC band, against 1% of `auction` ones —
// auctions cluster at 00:00-03:00, which is when eBay auctions close in US
// evening hours. `fixed` timestamps are a crawler's sweep, not a sale.
//
// The re-sightings settle it. Thirty of that card's 150 distinct asks appear
// more than once, a median of 33 days apart and up to 132; one PSA 6 shows
// $1,890 on 25 July and $1,890 again on 11 August. A sold listing cannot be
// observed four months later at a different price.
//
// The record carries no sold/active flag either — only date, price,
// listing_type, source, title and url — so a Buy-It-Now that DID sell is
// indistinguishable from one still sitting there. eBay has those completed
// BIN sales; this API does not expose them. Valuation therefore runs on
// auctions alone, and the asks are reported separately as the live market.
export function isCompletedSale(r: Pick<CardSightRecord, 'listing_type'>): boolean {
  return r.listing_type === 'auction';
}

// A record that remembers which bucket it came from. Once the ladder widens,
// the comps no longer share the card's own grade, and a row labelled with the
// TARGET grade would be a lie — a BCCG 10 is roughly a PSA 8, so showing one
// as "PSA 10" would quietly inflate the analysis. Every comp carries its true
// grader and grade from here on.
export type TaggedRecord = CardSightRecord & {
  company: string;
  grade: string;
  // True when the record reached us through /pricing/search and was verified
  // against the card by matchesCard() rather than by CardSight's own matcher.
  // The user sees it on the row: same evidence, a different chain of custody.
  viaSearch?: boolean;
};

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

// The same request discipline as call(), for the endpoints that take a body.
async function post<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // A collection sweep re-asks for the same cards on a schedule, so let the
      // platform serve the repeat within the hour rather than spending budget.
      next: { revalidate: 3600 },
    });
    if (res.ok) return res.json() as Promise<T>;

    const text = await res.text().catch(() => '');
    if (res.status === 429 && attempt < 4) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    throw new CardSightError(`CardSight ${path} returned ${res.status}: ${text.slice(0, 200)}`, res.status);
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

  // Autographs out; everything else is handed over intact. Repeat sightings of
  // one ask used to be collapsed here, but the sighting history is now the
  // evidence behind "listed 33 days, still unsold" — see activeListings() —
  // and asks no longer reach the valuation, so there is nothing to protect.
  return bucketPricing(res, opts.includeAutographs, MAX_RECORDS);
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

// A qualified grade is not the grade.
//
// PSA appends a qualifier when one flaw holds a card back — OC off-centre, MC
// miscut, ST stain, PD print defect, MK marks, OF out of focus — and the slab
// still reads "PSA 6". It trades nothing like a clean PSA 6, and the pricing
// response gives us the number without the qualifier, so the two land in the
// same bucket. On the 1961 Mantle #300 that inverted the whole picture: two of
// the three PSA 6 "sales" were OC copies at $555 and $625 against a clean one
// at $1,152, which would have set this card's fair value at $625 while the
// cheapest ask on the board was $1,250.
//
// The title is the only place the qualifier survives. `(?!\.)` is what keeps
// "PSA 7 St. Louis Cardinals" out of it — ST is a real qualifier, but not when
// it is the abbreviation for Saint. Audited over 3,289 live titles: 36 flagged,
// every one a genuine qualifier.
const QUALIFIED_GRADE =
  /\((?:oc|mc|st|pd|mk|of)\)|\b(?:psa|sgc|bgs)\s*\d+(?:\.\d)?\s*\(?\s*(?:oc|mc|st|pd|mk|of)\b(?!\.)|\bqualifier\b/i;

export function isQualifiedGrade(title: string | null | undefined): boolean {
  return QUALIFIED_GRADE.test(title ?? '');
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
// Split one title's sightings, oldest first, into runs of non-increasing price.
// Each run is one listing's life; the last element is its current ask.
function splitOnPriceRise(sightings: CardSightRecord[]): CardSightRecord[][] {
  const sorted = sightings.slice().sort((a, b) => a.date.localeCompare(b.date));
  const runs: CardSightRecord[][] = [];
  let run: CardSightRecord[] = [];
  for (const r of sorted) {
    if (run.length && Number(r.price) > Number(run[run.length - 1].price)) {
      runs.push(run);
      run = [];
    }
    run.push(r);
  }
  if (run.length) runs.push(run);
  return runs;
}

// One live Buy-It-Now, with how long it has been sitting there.
//
// The re-sightings we collapse above are the only clock we have on a listing:
// seeing the same ask in two crawls a month apart is direct evidence it did
// not sell in between. That makes an old, unsold ask the most informative
// number on the page for someone deciding what to charge — it is a price the
// market has already declined.
export type ActiveListing = {
  price: number;          // the current ask
  title: string | null;
  url: string | null;
  company: string | null; // null for an ungraded listing
  grade: string | null;
  firstSeen: string;      // ISO date of the earliest sighting
  lastSeen: string;
  sightings: number;
  daysListed: number;     // 0 when we have only ever seen it once
  priceCut: number;       // how far the seller has come down since first seen
};

// Fold a bucket's raw ask records into the live listings they represent, and
// keep the history: how many times we have seen each one and how long it has
// been sitting there.
export function activeListings(
  records: CardSightRecord[],
  company: string | null,
  grade: string | null,
): ActiveListing[] {
  const groups = new Map<string, CardSightRecord[]>();
  const singles: CardSightRecord[] = [];
  for (const r of records) {
    if (r.listing_type !== 'fixed') continue;
    const k = (r.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k) { singles.push(r); continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const build = (run: CardSightRecord[]): ActiveListing => {
    const first = run[0];
    const last = run[run.length - 1];
    const days = Math.max(0, Math.round(
      (Date.parse(last.date) - Date.parse(first.date)) / 86400_000,
    ));
    return {
      price: Number(last.price),
      title: last.title,
      url: last.url,
      company,
      grade,
      firstSeen: first.date,
      lastSeen: last.date,
      sightings: run.length,
      daysListed: days,
      priceCut: Math.max(0, Number(first.price) - Number(last.price)),
    };
  };
  const out = singles.map(r => build([r]));
  for (const sightings of groups.values()) {
    for (const run of splitOnPriceRise(sightings)) out.push(build(run));
  }
  return out.sort((a, b) => a.price - b.price);
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

// The records sitting in the exact company+grade bucket, however few.
//
// selectComps() deliberately hands back its WIDEST tier when nothing reaches
// minSamples, which means a card with two PSA 6 sales reports as
// 'adjacent-grade'. That is the right answer for filling a table and the wrong
// one for deciding whether the exact grade is thin — and thin exact grades are
// precisely the ones worth searching harder for. Callers that need to know
// what they really have at the grade asked for use this instead of the tier.
export function exactRecords(
  buckets: CompBucket[],
  company: string,
  grade: string,
): TaggedRecord[] {
  const c = company.trim().toUpperCase();
  return buckets
    .filter(b => b.company !== null && b.company.toUpperCase() === c && b.grade === grade)
    .flatMap(b => b.records.map(r => ({ ...r, company: b.company!, grade: b.grade! })));
}

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

// Statistics over completed sales.
//
// No listing-type weighting any more: everything that reaches here is an
// auction, because that is the only kind of record that represents a sale.
// See isCompletedSale().
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
  records: Array<{ price: number; date: string }>,
  { minPerBucket = 4, minBuckets = 3 }: { minPerBucket?: number; minBuckets?: number } = {},
): MonthPoint[] | null {
  const points = groupByMonth(records)
    .filter(([, rs]) => rs.length >= minPerBucket)
    .map(([month, rs]) => ({ month, monthEnd: monthEndDate(month), stats: stats(rs)! }));
  return points.length >= minBuckets ? points : null;
}

// ——— The wide net ——————————————————————————————————————————————

// One hit from /pricing/search, CardSight's free-text search over listing
// titles. Same shape as a pricing record plus two optional pieces of context:
// the card their matcher tied it to, and the grade it parsed. Both are absent
// far more often than they are present, which is the entire point of this
// endpoint — see searchListings().
export type SearchRecord = CardSightRecord & {
  matched_card?: {
    card_id: string;
    name: string | null;
    number: string | null;
    set?: { set_id: string; name: string | null; year: string | null; release: string | null } | null;
  } | null;
  grade?: {
    grade_id: string;
    grade_value: string | null;
    company_name: string | null;
    company_id: string | null;
  } | null;
};

// Search listing titles directly, ignoring the card catalogue.
//
// /pricing/{card_id} only returns listings CardSight's matcher has already
// tied to that card, and on cards whose real name is nothing like the name
// sellers type, that matcher misses most of the market. The 1967 Topps Carew
// rookie is catalogued as "A. League Rookie Stars (Rod Carew / Hank Allen)":
// the card-id endpoint returns 32 records for it, while this endpoint returns
// 91 for the same card, of which 70 carry no matched_card at all — listings
// like "1967 Topps #569 AL Rookies w/ Rod Carew RC Rookie HOF PSA 6 EX-MT"
// that are unmistakably this card to a human and invisible to the matcher.
//
// The cost of the wider net is that it is a text search: it will also return
// other cards, other years, reprints and lots. Nothing from here should reach
// a valuation without passing matchesCard().
export async function searchListings(
  q: string,
  opts: { listingType?: 'auction' | 'fixed' | 'both'; period?: string; limit?: number } = {},
): Promise<SearchRecord[]> {
  const res = await call<{ results?: SearchRecord[] }>('/pricing/search', {
    q,
    period: opts.period ?? 'all',
    listing_type: opts.listingType ?? 'both',
    limit: Math.min(opts.limit ?? 100, 100),
  });
  return res.results ?? [];
}

// The query to hand searchListings() for a card the owner has described.
//
// Deliberately the plain-language form a seller would type — year, brand,
// player, number — rather than the catalogue's name for the card. The whole
// reason this path exists is that the two differ.
export function searchQuery(identity: CardIdentity): string {
  return [identity.year, identity.brand, identity.player, identity.number]
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .join(' ')
    .slice(0, 200);
}

// ——— Verifying a title match ——————————————————————————————————

// Reprints, reproductions and fantasy cards carry the real card's year, number
// and player, so every identity check below passes them, and they sell for a
// couple of dollars. The Carew search returns two: a $2 "Topps Reprint 1967
// #569" auction and a $15 reprint. One of those in a five-sale window drags a
// $600 median to $500. They do not appear in the card-id endpoint's curated
// records, so this guard exists for the search path specifically.
const REPRINT_TITLE =
  /\b(re-?prints?|re-?produ(ction|ced)|repro|novelty|fantasy|custom(?:\s+made)?|aceo|broder|counterfeit|fake|replica)\b/i;

export function isReprintTitle(title: string | null | undefined): boolean {
  return REPRINT_TITLE.test(title ?? '');
}

// A lot is priced as a lot. "Lot of 12 1967 Topps including #569 Carew" is a
// real completed sale at a real price and tells you nothing about this card.
// Set breaks are the deliberate exception: "1967 Topps Set-Break #300 Mantle"
// is one card, sold singly, and is exactly the comp we want.
const LOT_TITLE =
  /\blots?\s+of\b|\b\d+\s*(?:card|cards)\s+lot\b|\bcard\s+lot\b|\bbundle\b|\bcomplete\s+set\b|\bteam\s+set\b|\bstarter\s+set\b|\bcollection\s+of\b/i;

export function isLotTitle(title: string | null | undefined): boolean {
  return LOT_TITLE.test(title ?? '');
}

// Every grading company we have seen in a title, including the ones whose
// scales don't line up with PSA's. Parsing them all matters even for the ones
// we would never accept as a comp: "KSA 6" has to be *recognised* as a grade
// so that it can be rejected as a PSA 6, rather than falling through the
// grade check as an unbranded card.
const GRADERS = 'psa|sgc|bgs|bvg|bccg|cgc|csg|hga|ksa|gma|isa|pro|tag|rcg|ags|mnt|ace|mba|gai|pgi|wcg|scg|pcg|csa|sga|dga';

// A grade a title actually claims. The trailing lookahead is the difference
// between a slab and a sales pitch: "Ken Griffey Jr #1 (RC) Easy PSA 9-10" is
// a RAW card at $250 whose seller is guessing, and it matched "PSA 9" happily
// until the range was excluded — against real PSA 9 sales of $450-550, that
// one row would have cut the median by a third.
const GRADER_TITLE = new RegExp(`\\b(${GRADERS})\\s*#?\\s*(10|\\d(?:\\.5)?)\\b(?!\\s*[-–—/]\\s*\\d)`, 'gi');

// Any grader named at all, with or without a number.
const GRADER_WORD = new RegExp(`\\b(${GRADERS})\\b`, 'gi');

// Phrases that mean "this card is not in fact graded". Sellers of raw cards
// invoke graders constantly — as an aspiration, a service they will pay for,
// or an invitation to the buyer to judge — and every one of those titles would
// otherwise read as a slab.
const UNGRADED_CLAIM =
  /\b(raw|ungraded|un-graded|not\s+graded|you\s+be\s+the\s+judge|would\s+grade|will\s+grade|should\s+grade|grades?\s+(?:easy|out|at|well)|easy\s+(?:psa|sgc|bgs)|ready\s+to\s+(?:grade|submit)|(?:psa|sgc|bgs)[-\s]*ready|candidate|worthy)\b/i;

// Distinct grading companies named in a title.
function graderWords(title: string): string[] {
  return [...new Set([...title.matchAll(GRADER_WORD)].map(m => m[1].toUpperCase()))];
}

export type TitleGrade = { company: string; grade: string };

// Every distinct grader+grade pair stated in a title.
//
// Returns all of them rather than the first, because a title naming two is
// either a mixed lot or an autograph slab ("PSA 3 DNA 10"), and both are
// things the caller must be able to refuse.
export function titleGrades(title: string | null | undefined): TitleGrade[] {
  const out: TitleGrade[] = [];
  const seen = new Set<string>();
  for (const m of (title ?? '').matchAll(GRADER_TITLE)) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ company: m[1].toUpperCase(), grade: m[2] });
    }
  }
  return out;
}

// Tokens too common to identify anyone.
const PLAYER_STOPWORDS = new Set([
  'rookie', 'rookies', 'card', 'cards', 'base', 'set', 'topps', 'bowman',
  'fleer', 'donruss', 'upper', 'deck', 'score', 'leaf', 'stars', 'star',
  'league', 'baseball', 'football', 'basketball', 'hockey', 'high', 'number',
  'series', 'graded', 'vintage', 'mint',
]);

// Does this listing title describe the card we were asked about?
//
// The search endpoint hands back whatever the text index matched, so this is
// the gate that decides what may enter a valuation. It is deliberately
// unforgiving: a comp we wrongly reject costs the user a row, and a comp we
// wrongly accept quietly moves the number they are about to trust.
//
// Every clause has to pass. Absence of evidence is a rejection, not a pass —
// a title that never states a grade cannot be shown as a PSA 6 comp, because
// it is just as likely to be the raw copy.
export function matchesCard(
  title: string | null | undefined,
  want: {
    year: number | null;
    number: string | null;
    player: string | null;
    company: string | null;   // '' / 'Raw' / null for ungraded
    grade: string | null;
  },
  opts: { allowAutographs?: boolean } = {},
): boolean {
  const t = (title ?? '').trim();
  if (!t) return false;

  if (isReprintTitle(t) || isLotTitle(t) || isQualifiedGrade(t)) return false;
  if (!opts.allowAutographs && isAutographTitle(t)) return false;

  // Year, stated in full. Vintage sellers write it; it is the cheapest way to
  // keep a 1968 Carew out of a 1967 Carew's comps.
  if (want.year != null && !new RegExp(`\\b${want.year}\\b`).test(t)) return false;

  // Card number, as its own token. The optional '#' and 'No.' cover how it is
  // actually written; the boundaries keep #569 from matching 1569 or 56.
  if (want.number) {
    const n = want.number.trim().replace(/^#/, '');
    if (n && !new RegExp(`(?:^|[^0-9a-z])(?:#|no\\.?\\s*)?${escapeRe(n)}(?![0-9a-z])`, 'i').test(t)) {
      return false;
    }
  }

  // At least one distinctive word from the player the owner recorded. On "Rod
  // Carew" that is "carew" — "rod" is under the length floor, which is what we
  // want, since a three-letter token matches far too much.
  if (want.player) {
    const tokens = want.player
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !PLAYER_STOPWORDS.has(w));
    if (tokens.length && !tokens.some(w => new RegExp(`\\b${escapeRe(w)}`, 'i').test(t))) {
      return false;
    }
  }

  // Grade. Both directions are strict, and for the same reason: the price gap
  // between a raw 1967 Carew and a PSA 8 one is two orders of magnitude.
  const graded = !!want.company && want.company.toLowerCase() !== 'raw' && !!want.grade;
  const found = titleGrades(t);
  const graders = graderWords(t);
  if (graded) {
    // Exactly one grade, from exactly one company, and both have to be ours.
    // Two of either means a lot or a crossover listing we cannot read
    // confidently — "Mickey Mantle Psa 6 MBA Bronze" is one card described by
    // two graders and we do not know which slab is being sold. None means we
    // cannot tell this is a slab at all.
    if (found.length !== 1 || graders.length !== 1) return false;
    if (found[0].company !== want.company!.trim().toUpperCase()) return false;
    if (!sameGrade(found[0].grade, want.grade!)) return false;
    // And the seller must be describing a slab, not predicting one.
    if (UNGRADED_CLAIM.test(t)) return false;
  } else {
    // Ungraded: no grader named at all, with or without a number. A raw
    // listing that name-drops PSA is either aspirational or a crossover, and
    // we are not going to guess which.
    if (found.length || graders.length) return false;
  }

  return true;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// '8' and '8.0' are the same grade; '8' and '8.5' are not.
function sameGrade(a: string, b: string): boolean {
  const n = (s: string) => Number(String(s).trim().replace(/^#/, ''));
  const x = n(a), y = n(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

// ——— The live shelf ————————————————————————————————————————————

// One listing that is for sale right now, from /marketplace/{card_id}.
//
// Not the same thing as a pricing record. There is no `date`, because the
// listing has not ended; there IS a `condition`, which the pricing endpoint
// never gives us; and an auction carries the two facts that make it worth
// watching — what it is bid to, and when it closes.
export type MarketRecord = {
  title: string | null;
  price: number | null;
  source: string;
  // 'search' is neither: it is a link to an eBay results page CardSight
  // returns when it has no individual listing to show. It has no price and
  // must never be counted as inventory.
  listing_type: 'auction' | 'fixed' | 'search';
  url: string | null;
  image_url: string | null;
  condition: string | null;
  end_date?: string | null;
  bid_count?: number | null;
};

export type MarketBucket = { company: string | null; grade: string | null; records: MarketRecord[] };

type MarketplaceResponse = {
  raw?: { count: number; records: MarketRecord[] };
  graded?: Array<{
    company_name: string;
    grades: Array<{ grade_value: string; grade_id: string; count: number; records: MarketRecord[] }>;
  }>;
};

// What is actually for sale, right now.
//
// The live picture used to be inferred from the pricing endpoint: a `fixed`
// record seen in a recent crawl was treated as a listing still standing. That
// is a reasonable guess and this is the fact — CardSight publishes the live
// shelf directly, and it comes with a condition on each listing and, on the
// auctions, a bid count and a closing time. An auction closing in two days
// with four bids on it is the only forward-looking number available anywhere
// in this API; everything else describes what already happened.
//
// The one thing it does NOT carry is how long a listing has been up, because
// there are no repeat sightings in a snapshot of the present. That clock still
// comes from the pricing archive — see activeListings().
export async function fetchMarketplace(
  cardId: string,
  opts: { gradeId?: string; includeAutographs?: boolean } = {},
): Promise<MarketBucket[]> {
  const res = await call<MarketplaceResponse>(`/marketplace/${cardId}`, {
    listing_type: 'both',
    grade_id: opts.gradeId,
  });

  const clean = (records: MarketRecord[] | undefined): MarketRecord[] =>
    (records ?? []).filter(r =>
      r.listing_type !== 'search' &&
      Number.isFinite(Number(r.price)) && Number(r.price) > 0 &&
      (opts.includeAutographs || !isAutographTitle(r.title)) &&
      !isQualifiedGrade(r.title) &&
      !isReprintTitle(r.title) &&
      !isLotTitle(r.title));

  const buckets: MarketBucket[] = [];
  const raw = clean(res.raw?.records);
  if (raw.length) buckets.push({ company: null, grade: null, records: raw });
  for (const c of res.graded ?? []) {
    for (const g of c.grades ?? []) {
      const records = clean(g.records);
      if (records.length) buckets.push({ company: c.company_name, grade: g.grade_value, records });
    }
  }
  return buckets;
}

// The live records for one grade, using the same widening rules as comps: an
// exact bucket if there is one, otherwise nothing. Guidance for a seller has
// to be about their grade, not a neighbouring one.
export function marketBucket(
  buckets: MarketBucket[],
  company: string,
  grade: string,
): MarketRecord[] {
  const graded = !!company && company.toLowerCase() !== 'raw' && !!grade;
  if (!graded) {
    return buckets.find(b => b.company === null)?.records ?? [];
  }
  const c = company.trim().toLowerCase();
  const g = String(grade).trim();
  return buckets.find(b =>
    (b.company ?? '').toLowerCase() === c && String(b.grade ?? '').trim() === g,
  )?.records ?? [];
}

// Condition as CardSight reports it, in words a person uses.
export function conditionLabel(c: string | null | undefined): string | null {
  if (!c || c === 'UNKNOWN') return null;
  return c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, m => m.toUpperCase());
}

// ——— Pricing many cards at once ————————————————————————————————

// POST /pricing takes up to 100 card ids and answers for all of them in one
// round trip, which is the difference between pricing a collection and pricing
// a card. Two differences from the single-card endpoint matter:
//
//   - `limit` caps at 100 rows per card here, against 500 there, and that
//     budget is still shared across every grade bucket. A card with a busy
//     PSA 9 market can come back thin at PSA 4 for no reason but crowding, so
//     a caller that needs depth on one grade should follow up per-card.
//   - There is no grade filter, so we always take the whole spread and pick
//     the bucket locally.
//
// Partial failure is normal: each result carries its own `success`, and one
// bad id does not spoil the batch.
export async function fetchCompsBulk(
  cardIds: string[],
  opts: { listingType?: 'auction' | 'fixed' | 'both'; period?: string; includeAutographs?: boolean } = {},
): Promise<Map<string, { buckets: CompBucket[]; lastSale: string | null; truncated: boolean }>> {
  const out = new Map<string, { buckets: CompBucket[]; lastSale: string | null; truncated: boolean }>();
  const ids = [...new Set(cardIds.filter(Boolean))];

  for (let i = 0; i < ids.length; i += BULK_CARDS) {
    const chunk = ids.slice(i, i + BULK_CARDS);
    const res = await post<{ results?: Array<{ card_id: string; success: boolean; data?: PricingResponse }> }>(
      '/pricing',
      {
        card_ids: chunk,
        listing_type: opts.listingType ?? 'both',
        period: opts.period ?? 'all',
        limit: BULK_ROWS,
      },
    );
    for (const r of res.results ?? []) {
      if (!r.success || !r.data) continue;
      out.set(r.card_id, bucketPricing(r.data, opts.includeAutographs));
    }
  }
  return out;
}

// Their documented ceilings, both enforced server-side with a 400.
const BULK_CARDS = 100;
const BULK_ROWS = 100;

// The bucketing half of fetchComps(), shared so the single-card and bulk paths
// cannot drift on what counts as a comp.
function bucketPricing(
  res: PricingResponse,
  includeAutographs?: boolean,
  cap: number = BULK_ROWS,
): { buckets: CompBucket[]; lastSale: string | null; truncated: boolean } {
  const clean = (records: CardSightRecord[]): CardSightRecord[] =>
    includeAutographs ? records : records.filter(r => !isAutographTitle(r.title));

  const buckets: CompBucket[] = [];
  if (res.raw?.records?.length) {
    const records = clean(res.raw.records);
    if (records.length) buckets.push({ company: null, grade: null, records });
  }
  for (const company of res.graded ?? []) {
    for (const g of company.grades ?? []) {
      const records = clean(g.records ?? []);
      if (records.length) {
        buckets.push({ company: company.company_name, grade: g.grade_value, records });
      }
    }
  }
  return {
    buckets,
    lastSale: res.meta?.last_sale_date ?? null,
    truncated: (res.meta?.total_records ?? 0) >= cap,
  };
}
