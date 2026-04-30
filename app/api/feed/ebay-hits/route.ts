import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const RAW_GRADE_RANKS: Record<string, number> = {
  'P': 0, 'PR': 0, 'POOR': 0,
  'G': 1, 'GOOD': 1,
  'VG': 2, 'VERY GOOD': 2,
  'VG-EX': 3, 'VGEX': 3, 'VG-EXCELLENT': 3,
  'EX': 4, 'EXCELLENT': 4,
  'EX+': 5, 'EX-PLUS': 5,
  'EXMT': 6, 'EX-MT': 6, 'EX-MINT': 6, 'EXMINT': 6, 'EXCELLENT-MINT': 6,
  'NM': 7, 'NEAR MINT': 7,
  'NM+': 8,
  'NM-MT': 9, 'NMMT': 9, 'NEAR MINT-MINT': 9,
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

function lastNameOf(player: string): string {
  const parts = player.trim().split(/\s+/).filter(p => !NAME_SUFFIXES.has(p.toUpperCase()))
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
    want.player,
  ].filter(Boolean)
  return parts.join(' ').trim()
}

function cacheKey(want: WantRow): string {
  return `${want.year}|${want.brand.toLowerCase()}|${want.cardNumber}|${want.player.toLowerCase()}`
}

const GRADED_REGEX = /\b(PSA|SGC|BGS|BVG|CGC|CSG|TAG|HGA|GMA)\s*[:#]?\s*(\d+(?:\.\d)?)/i
const RAW_TOKEN_REGEX = /\b(GEM\s*MINT|GEM-MINT|GEMMINT|GM|MINT|MT|NM-MT|NMMT|NEAR\s*MINT|NM\+|NM|EXMT|EX-MT|EXMINT|EXCELLENT-MINT|EX\+|EX|VG-EX|VGEX|VG|G|GOOD|POOR|PR|P)\b/i

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

function matchesCondition(detected: ConditionDetection, want: WantRow): boolean {
  if (!detected) return false

  const targetType = want.targetType === 'Raw' ? 'raw' : want.targetType === 'Graded' ? 'graded' : null
  if (targetType && detected.type !== targetType) return false

  if (detected.type === 'raw') {
    const lowRank = want.targetConditionLow ? rawRank(want.targetConditionLow) : 0
    const highRank = want.targetConditionHigh ? rawRank(want.targetConditionHigh) : 999
    if (lowRank === null || highRank === null) return true
    return detected.rawRanks.some(r => r >= lowRank && r <= highRank)
  }

  if (detected.type === 'graded') {
    if (want.targetGradingCompanies.length > 0 && detected.company &&
      !want.targetGradingCompanies.includes(detected.company)) return false
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

async function searchEbay(token: string, query: string, auctionsOnly: boolean): Promise<EbayItem[]> {
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '50')
  url.searchParams.set('filter', auctionsOnly ? 'buyingOptions:{AUCTION}' : 'buyingOptions:{FIXED_PRICE|AUCTION}')
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

async function searchEbayPaginated(token: string, query: string, auctionsOnly: boolean, maxResults: number): Promise<EbayItem[]> {
  const PAGE_SIZE = 200
  const all: EbayItem[] = []
  let offset = 0
  while (all.length < maxResults) {
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(PAGE_SIZE))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('filter', auctionsOnly ? 'buyingOptions:{AUCTION}' : 'buyingOptions:{FIXED_PRICE|AUCTION}')
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

function findWantForListing(item: EbayItem, wants: WantRow[]): WantRow | null {
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
    return want
  }
  return null
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
  try {
    const body = await req.json()
    forceRefresh = !!body?.forceRefresh
    setSlug = String(body?.setSlug || '').trim()
    auctionsOnly = !!body?.auctionsOnly
  } catch {}

  if (!setSlug) {
    return NextResponse.json({ error: 'setSlug is required' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const [setsResult, mappingsResult, hiddenResult] = await Promise.all([
    admin.from('sets').select('slug, title, year, brand, rows, default_target, sport')
      .eq('user_id', user.id).eq('slug', setSlug),
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
    const setDefault = (s.default_target || {}) as { type?: string; low?: string; high?: string; companies?: string }
    for (const row of (s.rows || []) as Record<string, unknown>[]) {
      if (String(row['Owned'] || '') === 'Yes') continue
      const player = String(row['Player'] || row['Description'] || '').trim()
      const cardNumber = String(row['Card #'] || '').trim()
      if (!player || !cardNumber) continue

      const explicitType = String(row['Target Type'] || '').trim()
      const explicitLow = String(row['Target Condition - Low'] || row['Target Condition'] || '').trim()
      const explicitHigh = String(row['Target Condition - High'] || '').trim()
      const explicitCompaniesRaw = String(row['Target Grading Companies'] || '').trim()
      const hasExplicit = !!(explicitType || explicitLow || explicitHigh || explicitCompaniesRaw)

      const targetType = hasExplicit ? explicitType : (setDefault.type || '').trim()
      const targetLow = hasExplicit ? explicitLow : (setDefault.low || '').trim()
      const targetHigh = hasExplicit ? explicitHigh : (setDefault.high || '').trim()
      const targetCompaniesRaw = hasExplicit ? explicitCompaniesRaw : (setDefault.companies || '').trim()

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
      })
    }
  }

  if (wants.length === 0) return NextResponse.json({ hits: [], wantCount: 0 })

  const uniqueWants = new Map<string, WantRow>()
  for (const w of wants) {
    const k = cacheKey(w)
    if (!uniqueWants.has(k)) uniqueWants.set(k, w)
  }

  const MAX_QUERIES_PER_REQUEST = 200
  const wantsToProcess = Array.from(uniqueWants.values()).slice(0, MAX_QUERIES_PER_REQUEST)

  const cacheKeys = wantsToProcess.map(w => cacheKey(w))
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

  const itemsPerWant = await parallelMap(wantsToProcess, SEARCH_CONCURRENCY, async (want) => {
    const key = cacheKey(want)
    const cached = cacheMap.get(key)
    const isFresh = cached && new Date(cached.expires_at).getTime() > Date.now()
    if (!forceRefresh && isFresh) {
      return { want, items: (cached.results as EbayItem[]) || [] }
    }
    let tok: string
    try {
      tok = await ensureToken()
    } catch (e) {
      throw e
    }
    const query = buildQuery(want)
    const items = await searchEbay(tok, query, auctionsOnly)
    cacheUpserts.push({
      cache_key: key,
      query,
      results: items,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    })
    return { want, items }
  }).catch(e => {
    return { error: String(e) }
  })

  if (!Array.isArray(itemsPerWant) && itemsPerWant && 'error' in itemsPerWant) {
    return NextResponse.json({ error: itemsPerWant.error }, { status: 500 })
  }

  const allWants = Array.from(uniqueWants.values())
  const setYear = allWants[0]?.year || 0
  const setBrand = allWants[0]?.brand || ''

  const prioritySellerStats: Record<string, { returned: number; matched: number }> = {}
  const prioritySellerListings: { item: EbayItem; want: WantRow }[] = []
  if (setYear && setBrand) {
    for (const sellerKw of PRIORITY_SELLER_KEYWORDS) {
      const psKey = `priority|${setYear}|${setBrand.toLowerCase()}|${sellerKw}|${auctionsOnly ? 'a' : 'all'}`
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
          psItems = await searchEbayPaginated(tok, psQuery, auctionsOnly, 2000)
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
        const matchedWant = findWantForListing(item, allWants)
        if (matchedWant) {
          prioritySellerListings.push({ item, want: matchedWant })
          prioritySellerStats[sellerKw].matched++
        }
      }
    }
  }

  if (cacheUpserts.length > 0) {
    await admin.from('ebay_search_cache').upsert(cacheUpserts, { onConflict: 'cache_key' })
  }

  const allHits: Hit[] = []
  for (const result of (itemsPerWant as { want: WantRow; items: EbayItem[] }[])) {
    const { want, items } = result
    for (const item of items) {
      if (!listingMatchesCard(item, want)) continue
      if (auctionsOnly && !(item.buyingOptions || []).includes('AUCTION')) continue
      const detected = detectListingCondition(item.title, mappings)
      if (!matchesCondition(detected, want)) continue
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

  for (const { item, want } of prioritySellerListings) {
    if (auctionsOnly && !(item.buyingOptions || []).includes('AUCTION')) continue
    const detected = detectListingCondition(item.title, mappings)
    if (!matchesCondition(detected, want)) continue
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
    wantCount: uniqueWants.size,
    queriedCount: wantsToProcess.length,
    prioritySellerStats,
  })
}
