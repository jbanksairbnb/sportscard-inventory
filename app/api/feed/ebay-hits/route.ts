import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { rawGradeToPsa, targetGradeToPsa } from '@/lib/gradeEquivalence'

const RAW_GRADE_RANKS: Record<string, number> = {
  'P': 0, 'PR': 0, 'POOR': 0,
  'G': 1, 'GOOD': 1,
  'VG': 2, 'VERY GOOD': 2,
  'VG-EX': 3, 'VGEX': 3, 'VG-EXCELLENT': 3,
  'EX': 4, 'EXCELLENT': 4,
  'EX+': 5, 'EX-PLUS': 5,
  'EXMT': 6, 'EX-MT': 6, 'EX-MINT': 6, 'EXMINT': 6, 'EXCELLENT-MINT': 6,
  // "NR-MINT" / "NRMT" / "NR MT" all mean Near Mint in collector shorthand,
  // not "Mint". Important: must match before MINT in RAW_TOKEN_REGEX.
  'NM': 7, 'NEAR MINT': 7, 'NR-MINT': 7, 'NR MINT': 7, 'NRMT': 7, 'NR-MT': 7, 'NR MT': 7,
  'NM+': 8,
  'NM-MT': 9, 'NMMT': 9, 'NEAR MINT-MINT': 9, 'NR-MINT+': 9,
  'MINT': 10, 'MT': 10,
  'GEM MINT': 11, 'GEMMINT': 11, 'GEM-MINT': 11, 'GM': 11, 'GEM': 11,
}

function rawRank(label: string | null | undefined): number | null {
  if (!label) return null
  const trimmed = label.trim().toUpperCase()
  if (trimmed in RAW_GRADE_RANKS) return RAW_GRADE_RANKS[trimmed]
  return null
}

const NAME_SUFFIXES = new Set(['JR', 'JR.', 'SR', 'SR.', 'II', 'III', 'IV'])

// Strip team / position annotations that often follow the player name in
// set rows, e.g. "Mike Schmidt – Philadelphia Phillies", "Hank Aaron - HOF",
// "Bob Gibson (HOF)", "Tom Seaver, P". The eBay listing titles rarely
// include those bits, so we should match against the raw player name only.
function cleanPlayer(player: string): string {
  return player
    .replace(/[–—].*$/, '')   // en-dash / em-dash and everything after
    .replace(/\s-\s.*$/, '')             // " - " hyphen and everything after
    .replace(/\(.*?\)/g, '')             // parenthesized aside
    .replace(/,.*$/, '')                 // comma and everything after
    .trim()
}

function lastNameOf(player: string): string {
  const cleaned = cleanPlayer(player)
  const parts = cleaned.split(/\s+/).filter(p => !NAME_SUFFIXES.has(p.toUpperCase()))
  return parts[parts.length - 1] || ''
}

const SPORT_TEAMS: Record<string, string[]> = {
  baseball: ['yankees','red sox','dodgers','mets','cubs','astros','braves','phillies','pirates','reds','orioles','tigers','royals','twins','white sox','indians','guardians','brewers','rockies','mariners','angels','athletics','padres','marlins','rays','blue jays','diamondbacks','nationals','expos','cardinals','giants','senators'],
  football: ['cowboys','patriots','packers','steelers','49ers','jets','eagles','redskins','commanders','rams','chargers','broncos','chiefs','raiders','colts','titans','jaguars','texans','lions','bears','vikings','saints','falcons','buccaneers','seahawks','dolphins','browns','bills','bengals'],
  basketball: ['lakers','celtics','bulls','warriors','heat','spurs','pistons','knicks','nets','sixers','76ers','bucks','cavaliers','mavericks','rockets','suns','jazz','nuggets','thunder','hawks','magic','pacers','wizards','bullets','raptors','grizzlies','pelicans','timberwolves','hornets','clippers','trail blazers'],
  hockey: ['bruins','canadiens','maple leafs','blackhawks','red wings','penguins','flyers','capitals','islanders','devils','sabres','oilers','flames','canucks','sharks','ducks','avalanche','stars','predators','wild','blues','lightning','hurricanes','thrashers','coyotes','kraken','golden knights'],
}

function detectSport(title: string): Set<string> {
  const sports = new Set<string>()
  const lower = title.toLowerCase()
  if (/\b(baseball|mlb)\b/.test(lower)) sports.add('baseball')
  if (/\b(football|nfl)\b/.test(lower)) sports.add('football')
  if (/\b(basketball|nba)\b/.test(lower)) sports.add('basketball')
  if (/\b(hockey|nhl)\b/.test(lower)) sports.add('hockey')
  if (sports.size > 0) return sports
  for (const [sport, teams] of Object.entries(SPORT_TEAMS)) {
    for (const team of teams) {
      if (lower.includes(team)) { sports.add(sport); break }
    }
  }
  return sports
}

function listingMatchesSport(title: string, targetSport: string): boolean {
  if (!targetSport) return true
  const detected = detectSport(title)
  if (detected.size === 0) return true
  return detected.has(targetSport.toLowerCase())
}

const SPORT_ASPECT_VALUES: Record<string, string> = {
  baseball: 'Baseball',
  basketball: 'Basketball',
  football: 'Football',
  hockey: 'Ice Hockey',
}
function aspectFilterForSport(sport: string): string | null {
  if (!sport) return null
  const value = SPORT_ASPECT_VALUES[sport.toLowerCase()]
  if (!value) return null
  return `categoryId:64482,Sport:{${value}}`
}

type WantRow = {
  setSlug: string
  setTitle: string
  setSport: string
  year: number
  brand: string
  cardNumber: string
  player: string
  targetType: string
  targetConditionLow: string
  targetConditionHigh: string
  targetGradingCompanies: string[]
  // Set-level toggles (from sets.default_target). When on, the match
  // logic widens — see matchesCondition below for the rules.
  includeEquivalentGrades: boolean
  // For "show upgrades" rows: the user already owns this card and only
  // wants listings strictly better than their owned grade. Null when
  // the row isn't an upgrade-target (the typical unowned-want case).
  ownedConditionPsa: number | null
}

type EbayItem = {
  itemId: string
  title: string
  price?: { value: string; currency: string }
  currentBidPrice?: { value: string; currency: string }
  bidCount?: number
  image?: { imageUrl: string }
  thumbnailImages?: { imageUrl: string }[]
  condition?: string
  itemWebUrl: string
  seller?: { username: string; feedbackPercentage?: string; feedbackScore?: number }
  buyingOptions?: string[]
  itemEndDate?: string
  itemLocation?: { country?: string }
}

type Hit = EbayItem & {
  matched_set_slug: string
  matched_set_title: string
  matched_card: string
  matched_card_number: string
  matched_player: string
  detected_grade?: { type: 'raw' | 'graded'; rank?: number; grade?: number; company?: string; label?: string }
}

type RawGradeMapping = {
  source_pattern: string
  mapped_ranks: number[]
}

type ConditionDetection =
  | { type: 'graded'; grade: number; company: string }
  | { type: 'raw'; rawRanks: number[] }
  | null

let cachedToken: { token: string; expiresAt: number } | null = null

async function getEbayToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const appId = process.env.EBAY_APP_ID
  const certId = process.env.EBAY_CERT_ID
  if (!appId || !certId) throw new Error('Missing EBAY_APP_ID or EBAY_CERT_ID env vars')
  const auth = Buffer.from(`${appId}:${certId}`).toString('base64')
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  })
  if (!res.ok) throw new Error(`eBay token fetch failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return data.access_token
}

function buildQuery(want: WantRow): string {
  const parts = [
    String(want.year),
    want.brand,
    cleanPlayer(want.player),
  ].filter(Boolean)
  return parts.join(' ').trim()
}

// v2: switched to cleanPlayer-based queries (was including " - Team Name" in
// the search). Bumped to invalidate stale cache entries from v1.
function cacheKey(want: WantRow): string {
  return `v2|${want.year}|${want.brand.toLowerCase()}|${want.cardNumber}|${cleanPlayer(want.player).toLowerCase()}|${want.setSport || 'any'}`
}

const GRADED_REGEX = /\b(PSA|SGC|BGS|BVG|CGC|CSG|TAG|HGA|GMA|AGS)\s*[:#]?\s*(\d+(?:\.\d)?)/i
// Looser match for the priority-seller bypass: just the company token, no
// grade number required. Lets us drop a raw priority listing from a graded
// want without needing the seller to format the grade.
const GRADED_COMPANY_REGEX = /\b(PSA|SGC|BGS|BVG|CGC|CSG|TAG|HGA|GMA|AGS)\b/i
// Order matters — alternation is left-to-right. Compound tokens like "NR-MINT"
// must come before MINT/MT so the substring "MINT" inside them doesn't win.
const RAW_TOKEN_REGEX = /\b(GEM\s*MINT|GEM-MINT|GEMMINT|GM|NR-MINT|NR\s*MINT|NRMT|NR-MT|NR\s*MT|NM-MT|NMMT|NEAR\s*MINT-MINT|NEAR\s*MINT|MINT|MT|NM\+|NM|EXMT|EX-MT|EXMINT|EXCELLENT-MINT|EX\+|EX|VG-EX|VGEX|VG|G|GOOD|POOR|PR|P)\b/i

function detectListingCondition(title: string, mappings: RawGradeMapping[]): ConditionDetection {
  const gMatch = title.match(GRADED_REGEX)
  if (gMatch) {
    const grade = parseFloat(gMatch[2])
    if (!Number.isNaN(grade) && grade >= 1 && grade <= 10) {
      return { type: 'graded', grade, company: gMatch[1].toUpperCase() }
    }
  }
  const upper = title.toUpperCase()
  for (const m of mappings) {
    if (upper.includes(m.source_pattern.toUpperCase())) {
      if (m.mapped_ranks.length > 0) return { type: 'raw', rawRanks: m.mapped_ranks }
    }
  }
  const rMatch = title.match(RAW_TOKEN_REGEX)
  if (rMatch) {
    const rank = rawRank(rMatch[1].replace(/\s+/g, ' ').toUpperCase())
    if (rank !== null) {
      return { type: 'raw', rawRanks: [rank] }
    }
  }
  return null
}

// RAW_GRADE_RANKS uses uppercase aliases (NRMT, EXMINT, etc.). To
// look up a PSA-equivalent we need the canonical label the
// gradeEquivalence table uses (NM, EXMT, etc.). This table translates.
const RANKED_ALIAS_TO_CANON: Record<string, string> = {
  'P': 'P', 'PR': 'P', 'POOR': 'P',
  'G': 'G', 'GOOD': 'G',
  'VG': 'VG', 'VERY GOOD': 'VG',
  'VG-EX': 'VG-EX', 'VGEX': 'VG-EX', 'VG-EXCELLENT': 'VG-EX',
  'EX': 'EX', 'EXCELLENT': 'EX',
  'EX+': 'EX+', 'EX-PLUS': 'EX+',
  'EXMT': 'EXMT', 'EX-MT': 'EXMT', 'EX-MINT': 'EXMT', 'EXMINT': 'EXMT', 'EXCELLENT-MINT': 'EXMT',
  'NM': 'NM', 'NEAR MINT': 'NM', 'NR-MINT': 'NM', 'NR MINT': 'NM', 'NRMT': 'NM', 'NR-MT': 'NM', 'NR MT': 'NM',
  'NM+': 'NM+',
  'NM-MT': 'NM-MT', 'NMMT': 'NM-MT', 'NEAR MINT-MINT': 'NM-MT', 'NR-MINT+': 'NM-MT',
  'MINT': 'Mint', 'MT': 'Mint',
  'GEM MINT': 'Gem Mint', 'GEMMINT': 'Gem Mint', 'GEM-MINT': 'Gem Mint', 'GM': 'Gem Mint', 'GEM': 'Gem Mint',
}

// Translate a detected listing condition into a single PSA-equivalent
// number. Raw listings may detect to multiple ranks (a title saying
// "VG-EX" matches both VG and EX in RAW_TOKEN_REGEX); use the high end
// so we don't drop a listing whose true grade could still satisfy the
// target. Graded listings already carry one number.
function detectedToPsa(detected: ConditionDetection): number | null {
  if (!detected) return null
  if (detected.type === 'graded') return detected.grade
  let best: number | null = null
  for (const rank of detected.rawRanks) {
    const aliasEntry = Object.entries(RAW_GRADE_RANKS).find(([, r]) => r === rank)
    if (!aliasEntry) continue
    const canon = RANKED_ALIAS_TO_CANON[aliasEntry[0]] || aliasEntry[0]
    const psa = rawGradeToPsa(canon)
    if (psa !== null && (best === null || psa > best)) best = psa
  }
  return best
}

function matchesCondition(detected: ConditionDetection, want: WantRow): boolean {
  if (!detected) return false

  // Graded company whitelist always applies (raw listings carry no
  // company so the filter never excludes them).
  if (detected.type === 'graded' && want.targetGradingCompanies.length > 0 &&
    detected.company && !want.targetGradingCompanies.includes(detected.company)) return false

  // Upgrade-on-owned: when the row is an upgrade target (the user owns
  // the card at a lower grade), require the listing to be strictly
  // better than the owned grade. The target range below still applies
  // on top — we don't want to surface gem-mint listings on a row whose
  // target tops out at NM.
  if (want.ownedConditionPsa !== null) {
    const detectedPsa = detectedToPsa(detected)
    if (detectedPsa === null) return false
    if (detectedPsa <= want.ownedConditionPsa) return false
  }

  if (want.includeEquivalentGrades) {
    // Cross-type matching: both raw and graded listings compete on the
    // same PSA-equivalent scale, so a Raw EX target accepts a PSA 5
    // listing and vice versa. The company whitelist above is the only
    // type-aware filter that survives.
    const detectedPsa = detectedToPsa(detected)
    if (detectedPsa === null) return false
    const lowPsa = want.targetConditionLow
      ? targetGradeToPsa(want.targetType, want.targetConditionLow) ?? 1
      : 1
    const highPsa = want.targetConditionHigh
      ? targetGradeToPsa(want.targetType, want.targetConditionHigh) ?? 10
      : 10
    return detectedPsa >= lowPsa && detectedPsa <= highPsa
  }

  // Strict (legacy) matching: type must match.
  const targetType = want.targetType === 'Raw' ? 'raw' : want.targetType === 'Graded' ? 'graded' : null
  if (targetType && detected.type !== targetType) return false

  // Defense: if the want specifies grading companies but Target Type is blank,
  // treat it as Graded intent. Without this, a row with companies=PSA but no
  // explicit Target Type would let raw listings through.
  if (!targetType && want.targetGradingCompanies.length > 0 && detected.type !== 'graded') return false

  if (detected.type === 'raw') {
    const lowRank = want.targetConditionLow ? rawRank(want.targetConditionLow) : 0
    const highRank = want.targetConditionHigh ? rawRank(want.targetConditionHigh) : 999
    if (lowRank === null || highRank === null) return true
    return detected.rawRanks.some(r => r >= lowRank && r <= highRank)
  }

  if (detected.type === 'graded') {
    const low = want.targetConditionLow ? parseFloat(want.targetConditionLow) : 1
    const high = want.targetConditionHigh ? parseFloat(want.targetConditionHigh) : 10
    if (Number.isNaN(low) || Number.isNaN(high)) return true
    return detected.grade >= low && detected.grade <= high
  }

  return false
}

function listingMatchesCard(item: EbayItem, want: WantRow): boolean {
  const title = item.title.toLowerCase()
  if (!title.includes(String(want.year))) return false
  if (!title.includes(want.brand.toLowerCase())) return false
  const lastName = lastNameOf(want.player).toLowerCase()
  if (lastName.length >= 3 && !title.includes(lastName)) return false
  if (!listingMatchesSport(item.title, want.setSport)) return false
  return true
}

async function searchEbay(token: string, query: string, auctionsOnly: boolean, aspectFilter: string | null = null): Promise<EbayItem[]> {
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '50')
  url.searchParams.set('filter', auctionsOnly ? 'buyingOptions:{AUCTION}' : 'buyingOptions:{FIXED_PRICE|AUCTION}')
  if (aspectFilter) url.searchParams.set('aspect_filter', aspectFilter)
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  })
  if (!res.ok) {
    console.error('eBay search failed:', res.status, await res.text())
    return []
  }
  const data = await res.json() as { itemSummaries?: EbayItem[] }
  return data.itemSummaries || []
}

async function searchEbayPaginated(token: string, query: string, auctionsOnly: boolean, maxResults: number, aspectFilter: string | null = null): Promise<EbayItem[]> {
  const PAGE_SIZE = 200
  const all: EbayItem[] = []
  let offset = 0
  while (all.length < maxResults) {
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(PAGE_SIZE))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('filter', auctionsOnly ? 'buyingOptions:{AUCTION}' : 'buyingOptions:{FIXED_PRICE|AUCTION}')
    if (aspectFilter) url.searchParams.set('aspect_filter', aspectFilter)
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    })
    if (!res.ok) {
      console.error('eBay paginated search failed:', res.status, await res.text())
      break
    }
    const data = await res.json() as { itemSummaries?: EbayItem[]; total?: number; next?: string }
    const items = data.itemSummaries || []
    all.push(...items)
    if (items.length < PAGE_SIZE) break
    if (data.total !== undefined && offset + items.length >= data.total) break
    offset += PAGE_SIZE
  }
  return all
}

const PRIORITY_SELLER_KEYWORDS = ['gmcards']

// Every want whose card this listing could be. Returns all matches (not
// just the first) so the priority-seller path can pick the want whose
// target condition the listing actually satisfies — important when the
// same card is wanted with different targets across sets.
function findWantsForListing(item: EbayItem, wants: WantRow[]): WantRow[] {
  const matches: WantRow[] = []
  const title = item.title.toLowerCase()
  for (const want of wants) {
    if (!title.includes(String(want.year))) continue
    if (!title.includes(want.brand.toLowerCase())) continue
    const lastName = lastNameOf(want.player).toLowerCase()
    if (lastName.length >= 3 && !title.includes(lastName)) continue
    if (!listingMatchesSport(item.title, want.setSport)) continue
    const cardNum = want.cardNumber.trim()
    if (cardNum) {
      const cardRegex = new RegExp(`(^|\\s|#|no\\.?\\s*)${cardNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[^0-9])`, 'i')
      if (!cardRegex.test(item.title)) continue
    }
    matches.push(want)
  }
  return matches
}

async function parallelMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

const CACHE_TTL_HOURS = 6
const SEARCH_CONCURRENCY = 8

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let forceRefresh = false
  let setSlug = ''
  let auctionsOnly = false
  let groupYear: number | null = null
  let groupBrand = ''
  try {
    const body = await req.json()
    forceRefresh = !!body?.forceRefresh
    setSlug = String(body?.setSlug || '').trim()
    auctionsOnly = !!body?.auctionsOnly
    if (body?.year != null && String(body.year).trim() !== '') {
      const y = Number(body.year)
      if (Number.isFinite(y)) groupYear = y
    }
    groupBrand = String(body?.brand || '').trim()
  } catch {}

  // Two modes:
  //   single-set — body.setSlug → scan one set
  //   group      — body.year + body.brand → scan EVERY set the user owns
  //                with that year/brand at once. This is what powers
  //                "search all my 1970 Topps sets in one shot". setSlug
  //                takes precedence so existing single-set callers are
  //                untouched.
  const groupMode = !setSlug && groupYear !== null && !!groupBrand
  if (!setSlug && !groupMode) {
    return NextResponse.json({ error: 'setSlug or year+brand is required' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const setsQuery = groupMode
    ? admin.from('sets').select('slug, title, year, brand, rows, default_target, sport')
        .eq('user_id', user.id).eq('year', groupYear).ilike('brand', groupBrand)
    : admin.from('sets').select('slug, title, year, brand, rows, default_target, sport')
        .eq('user_id', user.id).eq('slug', setSlug)

  const [setsResult, mappingsResult, hiddenResult] = await Promise.all([
    setsQuery,
    admin.from('raw_grade_mappings').select('source_pattern, mapped_grades')
      .eq('user_id', user.id),
    admin.from('ebay_hidden_items').select('item_id').eq('user_id', user.id),
  ])

  const setsData = setsResult.data
  const mappings: RawGradeMapping[] = ((mappingsResult.data || []) as { source_pattern: string; mapped_grades: string[] }[])
    .map(m => ({
      source_pattern: m.source_pattern,
      mapped_ranks: (m.mapped_grades || []).map(g => rawRank(g)).filter((r): r is number => r !== null),
    }))
    .filter(m => m.mapped_ranks.length > 0)
  const hiddenIds = new Set((hiddenResult.data || []).map(r => r.item_id))

  const wants: WantRow[] = []
  for (const s of (setsData || [])) {
    const setDefault = (s.default_target || {}) as {
      type?: string; low?: string; high?: string; companies?: string;
      // Set-level toggles persisted on default_target. JSONB extends
      // freely so no migration was needed.
      include_equivalent_grades?: boolean;
      include_upgrades?: boolean;
    }
    const includeEquivalent = !!setDefault.include_equivalent_grades
    const includeUpgrades = !!setDefault.include_upgrades
    for (const row of (s.rows || []) as Record<string, unknown>[]) {
      const isOwned = String(row['Owned'] || '') === 'Yes'
      const player = String(row['Player'] || row['Description'] || '').trim()
      const cardNumber = String(row['Card #'] || '').trim()
      if (!player || !cardNumber) continue

      const explicitType = String(row['Target Type'] || '').trim()
      const explicitLow = String(row['Target Condition - Low'] || row['Target Condition'] || '').trim()
      const explicitHigh = String(row['Target Condition - High'] || '').trim()
      const explicitCompaniesRaw = String(row['Target Grading Companies'] || '').trim()

      // Per-field fallback to set default. Earlier this used an all-or-nothing
      // `hasExplicit` check — if ANY of the four per-row fields were set, all
      // four switched to the row's value (so a row with only a Low specified
      // would silently lose the set's "Graded" Target Type and fall back to
      // Any, letting raw cards through a Graded set search). Now each field
      // independently checks its own value.
      const targetType = explicitType || (setDefault.type || '').trim()
      const targetLow = explicitLow || (setDefault.low || '').trim()
      const targetHigh = explicitHigh || (setDefault.high || '').trim()
      const targetCompaniesRaw = explicitCompaniesRaw || (setDefault.companies || '').trim()

      let ownedConditionPsa: number | null = null
      if (isOwned) {
        // Without the upgrade flag, owned rows are skipped entirely
        // (legacy behavior). With it, surface the row but require the
        // detected listing grade to beat the owned grade in
        // matchesCondition.
        if (!includeUpgrades) continue
        const gradingCo = String(row['Grading Company'] || '').trim()
        const gradeStr = String(row['Grade'] || '').trim()
        const rawGrade = String(row['Raw Grade'] || '').trim()
        if (gradingCo && gradeStr) {
          const g = parseFloat(gradeStr)
          if (Number.isFinite(g)) ownedConditionPsa = g
        } else if (rawGrade) {
          ownedConditionPsa = rawGradeToPsa(rawGrade)
        }
        // If we can't read the owned grade we can't tell whether a
        // listing is an upgrade — skip the row rather than spam the
        // feed with every listing for cards the user already has.
        if (ownedConditionPsa === null) continue
        // Skip rows whose owned grade already meets/beats the target —
        // no upgrade to find. Translates raw EX → PSA 5 etc. via the
        // shared mapping.
        const targetHighPsa = targetHigh ? targetGradeToPsa(targetType, targetHigh) : null
        if (targetHighPsa !== null && ownedConditionPsa >= targetHighPsa) continue
      }

      wants.push({
        setSlug: s.slug,
        setTitle: s.title || `${s.year} ${s.brand}`,
        setSport: String(s.sport || '').toLowerCase().trim(),
        year: s.year || 0,
        brand: s.brand || '',
        cardNumber,
        player,
        targetType,
        targetConditionLow: targetLow,
        targetConditionHigh: targetHigh,
        targetGradingCompanies: targetCompaniesRaw
          ? targetCompaniesRaw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
          : [],
        includeEquivalentGrades: includeEquivalent,
        ownedConditionPsa,
      })
    }
  }

  if (wants.length === 0) return NextResponse.json({ hits: [], wantCount: 0 })

  // Group wants by their eBay query key. Within a group every want shares
  // year/brand/card#/player/sport — so ONE eBay query serves them all — but
  // they may carry DIFFERENT target conditions (the same card wanted raw in
  // one set and graded in another). We keep every want in the group so each
  // target is matched independently. An earlier version collapsed each group
  // to its first want, which silently dropped the other sets' targets and
  // could lose legitimate hits in group mode.
  const queryGroups = new Map<string, WantRow[]>()
  for (const w of wants) {
    const k = cacheKey(w)
    const arr = queryGroups.get(k)
    if (arr) arr.push(w)
    else queryGroups.set(k, [w])
  }

  const MAX_QUERIES_PER_REQUEST = 200
  const groupsToProcess = Array.from(queryGroups.entries()).slice(0, MAX_QUERIES_PER_REQUEST)

  const cacheKeys = groupsToProcess.map(([k]) => k)
  const { data: cacheRows } = await admin
    .from('ebay_search_cache')
    .select('cache_key, results, expires_at')
    .in('cache_key', cacheKeys)

  const cacheMap = new Map((cacheRows || []).map(r => [r.cache_key, r]))

  let token: string | null = null
  const tokenLock: { promise: Promise<string> | null } = { promise: null }
  async function ensureToken(): Promise<string> {
    if (token) return token
    if (!tokenLock.promise) tokenLock.promise = getEbayToken()
    token = await tokenLock.promise
    return token
  }

  const cacheUpserts: Array<{ cache_key: string; query: string; results: EbayItem[]; fetched_at: string; expires_at: string }> = []

  const itemsPerGroup = await parallelMap(groupsToProcess, SEARCH_CONCURRENCY, async ([key, groupWants]) => {
    const rep = groupWants[0]
    const cached = cacheMap.get(key)
    const isFresh = cached && new Date(cached.expires_at).getTime() > Date.now()
    if (!forceRefresh && isFresh) {
      return { wants: groupWants, items: (cached.results as EbayItem[]) || [] }
    }
    let tok: string
    try {
      tok = await ensureToken()
    } catch (e) {
      throw e
    }
    const query = buildQuery(rep)
    const aspectFilter = aspectFilterForSport(rep.setSport)
    const items = await searchEbay(tok, query, auctionsOnly, aspectFilter)
    cacheUpserts.push({
      cache_key: key,
      query,
      results: items,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    })
    return { wants: groupWants, items }
  }).catch(e => {
    return { error: String(e) }
  })

  if (!Array.isArray(itemsPerGroup) && itemsPerGroup && 'error' in itemsPerGroup) {
    return NextResponse.json({ error: itemsPerGroup.error }, { status: 500 })
  }

  const allWants = wants
  const setYear = allWants[0]?.year || 0
  const setBrand = allWants[0]?.brand || ''
  const setSport = allWants[0]?.setSport || ''
  const setAspectFilter = aspectFilterForSport(setSport)

  const prioritySellerStats: Record<string, { returned: number; matched: number }> = {}
  const prioritySellerListings: { item: EbayItem; wants: WantRow[] }[] = []
  if (setYear && setBrand) {
    for (const sellerKw of PRIORITY_SELLER_KEYWORDS) {
      const psKey = `priority|${setYear}|${setBrand.toLowerCase()}|${sellerKw}|${auctionsOnly ? 'a' : 'all'}|${setSport || 'any'}`
      const { data: psCached } = await admin
        .from('ebay_search_cache')
        .select('cache_key, results, expires_at')
        .eq('cache_key', psKey)
        .maybeSingle()
      const psFresh = psCached && new Date(psCached.expires_at).getTime() > Date.now()
      let psItems: EbayItem[] = []
      if (!forceRefresh && psFresh) {
        psItems = (psCached.results as EbayItem[]) || []
      } else {
        try {
          const tok = await ensureToken()
          const psQuery = `${setYear} ${setBrand} ${sellerKw}`
          psItems = await searchEbayPaginated(tok, psQuery, auctionsOnly, 2000, setAspectFilter)
          cacheUpserts.push({
            cache_key: psKey,
            query: psQuery,
            results: psItems,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
          })
        } catch (e) {
          console.error('priority seller scan failed:', e)
        }
      }
      prioritySellerStats[sellerKw] = { returned: psItems.length, matched: 0 }
      for (const item of psItems) {
        const matchedWants = findWantsForListing(item, allWants)
        if (matchedWants.length > 0) {
          prioritySellerListings.push({ item, wants: matchedWants })
          prioritySellerStats[sellerKw].matched++
        }
      }
    }
  }

  if (cacheUpserts.length > 0) {
    await admin.from('ebay_search_cache').upsert(cacheUpserts, { onConflict: 'cache_key' })
  }

  const allHits: Hit[] = []
  for (const result of (itemsPerGroup as { wants: WantRow[]; items: EbayItem[] }[])) {
    const { wants: groupWants, items } = result
    for (const item of items) {
      if (auctionsOnly && !(item.buyingOptions || []).includes('AUCTION')) continue
      // Every want in the group shares year/brand/player, so the card-match
      // check is identical across them — run it once against the first want.
      if (!listingMatchesCard(item, groupWants[0])) continue
      const detected = detectListingCondition(item.title, mappings)
      // Attribute the listing to the first want whose target condition it
      // satisfies: a raw listing lands on the raw-target set, a graded
      // listing on the graded-target set. This is how the same card wanted
      // with different targets across sets each gets the right hits.
      const want = groupWants.find(w => matchesCondition(detected, w))
      if (!want) continue
      allHits.push({
        ...item,
        matched_set_slug: want.setSlug,
        matched_set_title: want.setTitle,
        matched_card: `${want.year} ${want.brand} #${want.cardNumber} ${want.player}`,
        matched_card_number: want.cardNumber,
        matched_player: want.player,
        detected_grade: detected ? {
          type: detected.type,
          rank: detected.type === 'raw' ? detected.rawRanks[0] : undefined,
          grade: detected.type === 'graded' ? detected.grade : undefined,
          company: detected.type === 'graded' ? detected.company : undefined,
          label: item.title,
        } : undefined,
      })
    }
  }

  // Priority-seller hits: apply the same condition filter as the regular
  // search path for RAW wants. An earlier version of this loop skipped
  // matchesCondition() for raw priority listings on the theory that "the
  // user trusts these sellers enough to see everything they list" — but
  // that let LOW GRADE / VG-VGEX cards leak into EX/NM searches even when
  // the set's default target said otherwise. The user trusts these sellers
  // enough to scan their whole inventory, NOT enough to ignore the grade
  // they put right in their own title. Anything matchesCondition() rejects
  // — including titles with no recognizable grade token (detected=null) —
  // gets dropped here too, since serving a card whose grade we can't read
  // is worse than not serving it.
  //
  // GRADED wants keep the existing company-token-only check (no grade-
  // range filter) so we don't shrink the graded results the user reports
  // as working well. If we ever want graded priority listings to obey the
  // grade range, add `&& matchesCondition(detected, want)` to the
  // `targetType === 'Graded'` branch — but flag it as a behavior change
  // for graded searches.
  for (const { item, wants: itemWants } of prioritySellerListings) {
    if (auctionsOnly && !(item.buyingOptions || []).includes('AUCTION')) continue
    const detected = detectListingCondition(item.title, mappings)
    // Pick the first want this listing satisfies. Graded wants keep the
    // looser company-token check (preserves the working graded behavior);
    // raw / Any wants get the full condition filter. Trying each want lets
    // a listing land on the correct set when the same card is wanted with
    // different targets across sets.
    const want = itemWants.find(w =>
      w.targetType === 'Graded'
        ? GRADED_COMPANY_REGEX.test(item.title)
        : matchesCondition(detected, w)
    )
    if (!want) continue
    allHits.push({
      ...item,
      matched_set_slug: want.setSlug,
      matched_set_title: want.setTitle,
      matched_card: `${want.year} ${want.brand} #${want.cardNumber} ${want.player}`,
      matched_card_number: want.cardNumber,
      matched_player: want.player,
      detected_grade: detected ? {
        type: detected.type,
        rank: detected.type === 'raw' ? detected.rawRanks[0] : undefined,
        grade: detected.type === 'graded' ? detected.grade : undefined,
        company: detected.type === 'graded' ? detected.company : undefined,
        label: item.title,
      } : undefined,
    })
  }

  const seen = new Set<string>()
  const dedupedHits = allHits.filter(h => {
    if (hiddenIds.has(h.itemId)) return false
    if (seen.has(h.itemId)) return false
    seen.add(h.itemId)
    return true
  })

  return NextResponse.json({
    hits: dedupedHits,
    wantCount: queryGroups.size,
    queriedCount: groupsToProcess.length,
    setCount: (setsData || []).length,
    prioritySellerStats,
  })
}
