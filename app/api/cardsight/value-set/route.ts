import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  fetchComps,
  fetchCompsBulk,
  exactRecords,
  isAutographTitle,
  isCompletedSale,
  isQualifiedGrade,
  matchesCard,
  resolveCard,
  searchListings,
  searchQuery,
  selectComps,
  stats,
  withinDays,
  type CompBucket,
  type TaggedRecord,
} from '@/lib/cardsight';

// Price a whole set in one pass.
//
// The research modal answers "what is this card worth" one card at a time, and
// a value mark only exists for cards somebody remembered to open. That makes
// the price history a history of what the owner happened to look at rather
// than of what they own. This route answers the same question for every card
// at once, so a collection can carry a real series.
//
// It deliberately does NOT write anything. The client shows what each card
// would become and the owner applies it — a sweep that silently overwrote
// hand-researched values would destroy exactly the work this app exists to
// keep.

export const runtime = 'nodejs';
export const maxDuration = 300;

// Must match the comps route: the same card asked the same question should not
// get two different answers depending on which screen asked.
const CARDSIGHT_RESOLVER_VERSION = 2;
const SALE_WINDOW_DAYS = 30;
const THIN_SALES = 3;

// How many cards one request will handle. Resolution is one API call per card
// the shared cache has never seen, at four calls a second, so a large set has
// to arrive in pieces or the function times out before it answers. The client
// chunks and shows progress; the ceiling here is a backstop.
const MAX_CARDS = 60;

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

type CardInput = {
  key: string;                       // the client's handle for this row
  year?: number | null;
  brand?: string | null;
  number?: string | null;
  player?: string | null;
  grading_company?: string | null;
  grade?: string | null;
};

export type ValuedCard = {
  key: string;
  // The median of completed sales in the window, or null when there were none.
  value: number | null;
  n: number;                         // sales behind that median
  low: number | null;
  high: number | null;
  lastSale: string | null;
  matched: string | null;            // what CardSight thinks the card is
  bucketLabel: string | null;        // which grade the comps came from
  // Why there is no value, in words the owner can act on.
  reason: 'ok' | 'thin' | 'no-sales' | 'not-in-catalog' | 'incomplete' | 'error';
  note: string | null;
  // True when some comps were recovered by title search rather than by
  // CardSight's own matcher. Same evidence, different chain of custody.
  viaSearch: boolean;
};

type CacheRow = {
  card_year: number;
  card_brand: string;
  card_number: string;
  card_player: string;
  cardsight_card_id: string | null;
  not_found: boolean;
  matched_name: string | null;
  matched_release: string | null;
  matched_year: string | null;
  resolver_version: number | null;
};

// The identity tuple, normalized exactly as the cache stores it.
function idKey(c: CardInput) {
  return {
    card_year: Number(c.year),
    card_brand: (c.brand ?? '').trim().toLowerCase(),
    card_number: String(c.number ?? '').trim().toLowerCase(),
    card_player: (c.player ?? '').trim().toLowerCase(),
  };
}

function tupleKey(k: ReturnType<typeof idKey>): string {
  return `${k.card_year}|${k.card_brand}|${k.card_number}|${k.card_player}`;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  if (!process.env.CARDSIGHT_API_KEY) {
    return NextResponse.json({ error: 'CardSight is not configured' }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { cards?: CardInput[] };
  const cards = (body.cards ?? []).slice(0, MAX_CARDS);
  if (!cards.length) return NextResponse.json({ results: [] });

  const admin = adminClient();
  const out = new Map<string, ValuedCard>();

  // A card we cannot name cannot be looked up. Say so per row rather than
  // failing the batch, so one blank line in a set doesn't cost the other 200.
  const usable: CardInput[] = [];
  for (const c of cards) {
    if (!c.year || !c.number || !c.player) {
      out.set(c.key, blank(c.key, 'incomplete', 'Needs a year, card number and player before it can be looked up.'));
      continue;
    }
    usable.push(c);
  }

  // ── Resolve ───────────────────────────────────────────────────────────────
  // One query for the whole batch's cache, then one API call per genuine miss.
  // On a set the owner has researched before this is usually all cache.
  const tuples = new Map<string, CardInput[]>();
  for (const c of usable) {
    const t = tupleKey(idKey(c));
    if (!tuples.has(t)) tuples.set(t, []);
    tuples.get(t)!.push(c);
  }

  const { data: cachedRows } = await admin
    .from('cardsight_cards')
    .select('card_year, card_brand, card_number, card_player, cardsight_card_id, not_found, matched_name, matched_release, matched_year, resolver_version')
    .in('card_number', [...new Set(usable.map(c => String(c.number).trim().toLowerCase()))]);

  const cache = new Map<string, CacheRow>();
  for (const r of (cachedRows ?? []) as CacheRow[]) {
    cache.set(tupleKey({
      card_year: r.card_year, card_brand: r.card_brand,
      card_number: r.card_number, card_player: r.card_player,
    }), r);
  }

  // tuple → { id, label } for everything we managed to resolve.
  const resolved = new Map<string, { id: string | null; label: string | null }>();

  for (const [t, group] of tuples) {
    const hit = cache.get(t);
    const fresh = hit && (hit.resolver_version ?? 1) >= CARDSIGHT_RESOLVER_VERSION;
    if (fresh) {
      resolved.set(t, {
        id: hit!.not_found ? null : hit!.cardsight_card_id,
        label: hit!.matched_name
          ? `${hit!.matched_year ?? ''} ${hit!.matched_release ?? ''} · ${hit!.matched_name}`.trim()
          : null,
      });
      continue;
    }

    const c = group[0];
    try {
      const card = await resolveCard({
        year: c.year!, brand: c.brand ?? null,
        number: String(c.number), player: c.player!,
      });
      await admin.from('cardsight_cards').upsert({
        ...idKey(c),
        cardsight_card_id: card?.id ?? null,
        not_found: !card,
        matched_release: card?.releaseName ?? null,
        matched_set: card?.setName ?? null,
        matched_year: card?.releaseYear ?? null,
        matched_name: card?.name ?? null,
        resolver_version: CARDSIGHT_RESOLVER_VERSION,
        checked_at: new Date().toISOString(),
      }, { onConflict: 'card_year,card_brand,card_number,card_player' });
      resolved.set(t, {
        id: card?.id ?? null,
        label: card ? `${card.releaseYear} ${card.releaseName} · ${card.name}` : null,
      });
    } catch {
      // A resolution failure is this card's problem, not the batch's.
      resolved.set(t, { id: null, label: null });
    }
  }

  // ── Price ─────────────────────────────────────────────────────────────────
  const ids = [...new Set([...resolved.values()].map(r => r.id).filter((x): x is string => !!x))];
  let priced = new Map<string, { buckets: CompBucket[]; lastSale: string | null; truncated: boolean }>();
  if (ids.length) {
    try {
      priced = await fetchCompsBulk(ids, { listingType: 'both', period: 'all' });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  // ── Value ─────────────────────────────────────────────────────────────────
  for (const [t, group] of tuples) {
    const r = resolved.get(t);
    for (const c of group) {
      if (!r || !r.id) {
        out.set(c.key, blank(c.key, 'not-in-catalog',
          'Not in the CardSight catalog, so there are no comps to pull.'));
        continue;
      }
      out.set(c.key, await valueOne(c, r.id, r.label, priced.get(r.id)));
    }
  }

  return NextResponse.json({ results: cards.map(c => out.get(c.key)).filter(Boolean) });
}

function blank(key: string, reason: ValuedCard['reason'], note: string): ValuedCard {
  return {
    key, value: null, n: 0, low: null, high: null, lastSale: null,
    matched: null, bucketLabel: null, reason, note, viaSearch: false,
  };
}

// One card's 30-day median, by the same rules the research modal uses.
async function valueOne(
  c: CardInput,
  cardId: string,
  label: string | null,
  comps: { buckets: CompBucket[]; lastSale: string | null; truncated: boolean } | undefined,
): Promise<ValuedCard> {
  const company = (c.grading_company ?? '').trim();
  const grade = c.grade == null ? '' : String(c.grade).trim();
  const isGraded = !!company && company.toLowerCase() !== 'raw' && !!grade;
  const wantsAutographs = isAutographTitle(c.player);

  // Ungraded cards get no value. CardSight publishes no condition on a
  // completed sale, and a raw card's price is mostly condition — the 1967
  // Carew's raw sales run $180 to $1,950 for the same card. A median across
  // that is a number with no meaning, and putting it in the Value column
  // would be worse than leaving the column alone.
  if (!isGraded) {
    return { ...blank(c.key, 'no-sales',
      'Ungraded — condition drives the price and CardSight does not record it on sold listings, so there is no honest single value. Research it individually.'),
      matched: label };
  }

  let buckets = comps?.buckets ?? [];
  let lastSale = comps?.lastSale ?? null;

  // The bulk endpoint spends 100 rows across every grade of the card, so a
  // thin bucket here may be crowding rather than a quiet market. Re-ask for
  // this one card at full depth before concluding anything.
  let selection = selectComps(buckets, company, grade, 3);
  if (!selection || selection.records.length < THIN_SALES) {
    try {
      const deep = await fetchComps(cardId, {
        listingType: 'both', includeAutographs: wantsAutographs,
      });
      const widened = selectComps(deep.buckets, company, grade, 3);
      if (widened && widened.records.length > (selection?.records.length ?? 0)) {
        selection = widened;
        buckets = deep.buckets;
        lastSale = deep.lastSale;
      }
    } catch {
      // Keep the shallow answer rather than failing the card.
    }
  }

  if (!selection || !selection.records.length) {
    return { ...blank(c.key, 'no-sales', 'No graded sales for this card in CardSight’s archive.'), matched: label };
  }

  let comparable = selection.records.filter(r => !isQualifiedGrade(r.title));
  let recent = withinDays(comparable.filter(isCompletedSale), SALE_WINDOW_DAYS);
  let viaSearch = false;

  // Same wide net the comps route casts, gated the same way: on the count at
  // the grade actually asked for, not on selection.tier, which reports the
  // widest tier whenever everything is thin. See exactRecords().
  const exactSales = withinDays(
    exactRecords(buckets, company, grade)
      .filter(r => !isQualifiedGrade(r.title))
      .filter(isCompletedSale),
    SALE_WINDOW_DAYS,
  );

  if (exactSales.length < THIN_SALES) {
    try {
      const q = searchQuery({
        year: c.year ?? null, brand: c.brand ?? null,
        number: c.number ?? null, player: c.player ?? null,
      });
      if (q.split(/\s+/).filter(Boolean).length >= 2) {
        const seen = new Set(comparable.map(r => r.url ?? '').filter(Boolean));
        const hits = await searchListings(q, { listingType: 'both', period: 'all', limit: 100 });
        const extra: TaggedRecord[] = [];
        for (const h of hits) {
          if (h.url && seen.has(h.url)) continue;
          if (!Number.isFinite(Number(h.price)) || Number(h.price) <= 0) continue;
          if (!matchesCard(h.title, {
            year: c.year ?? null, number: c.number ?? null, player: c.player ?? null,
            company, grade,
          }, { allowAutographs: wantsAutographs })) continue;
          if (h.url) seen.add(h.url);
          extra.push({
            title: h.title, price: Number(h.price), date: h.date,
            source: h.source, listing_type: h.listing_type,
            url: h.url, image_url: h.image_url,
            company, grade, viaSearch: true,
          });
        }
        if (extra.length) {
          // Widening has to earn its keep — see the comps route. If the exact
          // grade now has as many recent sales as the widened pool, use it.
          const exactRecent = withinDays([...exactSales, ...extra.filter(isCompletedSale)], SALE_WINDOW_DAYS);
          if (selection.tier !== 'exact' && exactRecent.length >= recent.length) {
            comparable = [
              ...exactRecords(buckets, company, grade).filter(r => !isQualifiedGrade(r.title)),
              ...extra,
            ];
            selection = { tier: 'exact', bucketLabel: `${company} ${grade}`, records: comparable };
          } else {
            comparable = [...comparable, ...extra];
          }
          recent = withinDays(comparable.filter(isCompletedSale), SALE_WINDOW_DAYS);
          viaSearch = recent.some(r => r.viaSearch);
        }
      }
    } catch {
      // The wide net is a bonus; its failure is not this card's failure.
    }
  }

  const s = stats(recent);
  if (!s) {
    const archive = comparable.filter(isCompletedSale).length;
    return {
      ...blank(c.key, 'no-sales', archive
        ? `No completed sales in the last ${SALE_WINDOW_DAYS} days. ${archive} older sale${archive === 1 ? '' : 's'} in the archive.`
        : `No completed sales for this card — CardSight's sold data covers auctions only.`),
      matched: label,
      bucketLabel: selection.bucketLabel,
      lastSale,
    };
  }

  return {
    key: c.key,
    value: Math.round(s.median * 100) / 100,
    n: s.n,
    low: s.min,
    high: s.max,
    lastSale,
    matched: label,
    bucketLabel: selection.tier === 'exact' ? null : selection.bucketLabel,
    reason: s.n < THIN_SALES ? 'thin' : 'ok',
    note: s.n < THIN_SALES
      ? `Only ${s.n} sale${s.n === 1 ? '' : 's'} in ${SALE_WINDOW_DAYS} days — thin.`
      : null,
    viaSearch,
  };
}
