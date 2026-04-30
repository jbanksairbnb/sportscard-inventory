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

type WantRow = {
  setSlug: string
  setTitle: string
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
    want.cardNumber ? `#${want.cardNumber}` : '',
  ].filter(Boolean)
  return parts.join(' ').trim()
}

function cacheKey(want: WantRow): string {
  return `${want.year}|${want.brand.toLowerCase()}|${want.cardNumber}|${want.player.toLowerCase()}`
}

const GRADED_REGEX = /\b(PSA|SGC|BGS|BVG|CGC|CSG|TAG|HGA|GMA)\s*[:#]?\s*(\d+(?:\.\d)?)/i
const RAW_TOKEN_REGEX = /\b(GEM\s*MINT|GEM-MINT|GEMMINT|GM|MINT|MT|NM-MT|NMMT|NEAR\s*MINT|NM\+|NM|EXMT|EX-MT|EXMINT|EXCELLENT-MINT|EX\+|EX|VG-EX|VGEX|VG|G|GOOD|POOR|PR|P)\b/i

function detectListingCondition(title: string): { type: 'raw' | 'graded'; grade?: number; company?: string; rawRank?: number } | null {
  const gMatch = title.match(GRADED_REGEX)
  if (gMatch) {
    const grade = parseFloat(gMatch[2])
    if (!Number.isNaN(grade) && grade >= 1 && grade <= 10) {
      return { type: 'graded', grade, company: gMatch[1].toUpperCase() }
    }
  }
  const rMatch = title.match(RAW_TOKEN_REGEX)
  if (rMatch) {
    const rank = rawRank(rMatch[1].replace(/\s+/g, ' ').toUpperCase())
    if (rank !== null) {
      return { type: 'raw', rawRank: rank }
    }
  }
  return null
}

function matchesCondition(detected: ReturnType<typeof detectListingCondition>, want: WantRow): boolean {
  if (!want.targetType && !want.targetConditionLow && !want.targetConditionHigh) return true

  const targetType = want.targetType === 'Raw' ? 'raw' : want.targetType === 'Graded' ? 'graded' : null

  if (!detected) {
    return !targetType
  }

  if (targetType && detected.type !== targetType) return false

  if (detected.type === 'raw' && detected.rawRank !== undefined) {
    const lowRank = want.targetConditionLow ? rawRank(want.targetConditionLow) : 0
    const highRank = want.targetConditionHigh ? rawRank(want.targetConditionHigh) : 999
    if (lowRank === null || highRank === null) return true
    return detected.rawRank >= lowRank && detected.rawRank <= highRank
  }

  if (detected.type === 'graded' && detected.grade !== undefined) {
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
  const playerWords = want.player.toLowerCase().split(/\s+/).filter(w => w.length >= 3)
  if (playerWords.length > 0 && !playerWords.every(w => title.includes(w))) return false
  const cardNum = want.cardNumber.trim()
  if (cardNum) {
    const cardRegex = new RegExp(`(^|\\s|#|no\\.?\\s*)${cardNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[^0-9])`, 'i')
    if (!cardRegex.test(item.title)) return false
  }
  return true
}

async function searchEbay(token: string, query: string): Promise<EbayItem[]> {
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '20')
  url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}')
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

const CACHE_TTL_HOURS = 6

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
  try {
    const body = await req.json()
    forceRefresh = !!body?.forceRefresh
    setSlug = String(body?.setSlug || '').trim()
  } catch {}

  if (!setSlug) {
    return NextResponse.json({ error: 'setSlug is required' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: setsData } = await admin
    .from('sets')
    .select('slug, title, year, brand, rows, default_target')
    .eq('user_id', user.id)
    .eq('slug', setSlug)

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

  const MAX_QUERIES_PER_REQUEST = 50
  const wantsToProcess = Array.from(uniqueWants.values()).slice(0, MAX_QUERIES_PER_REQUEST)

  const cacheKeys = wantsToProcess.map(w => cacheKey(w))
  const { data: cacheRows } = await admin
    .from('ebay_search_cache')
    .select('cache_key, results, expires_at')
    .in('cache_key', cacheKeys)

  const cacheMap = new Map((cacheRows || []).map(r => [r.cache_key, r]))

  let token: string | null = null

  const allHits: Hit[] = []

  for (const want of wantsToProcess) {
    const key = cacheKey(want)
    const cached = cacheMap.get(key)
    let items: EbayItem[] = []

    const isFresh = cached && new Date(cached.expires_at).getTime() > Date.now()
    if (!forceRefresh && isFresh) {
      items = (cached.results as EbayItem[]) || []
    } else {
      if (!token) {
        try {
          token = await getEbayToken()
        } catch (e) {
          return NextResponse.json({ error: String(e) }, { status: 500 })
        }
      }
      const query = buildQuery(want)
      items = await searchEbay(token, query)
      const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString()
      await admin.from('ebay_search_cache').upsert({
        cache_key: key,
        query,
        results: items,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt,
      }, { onConflict: 'cache_key' })
    }

    for (const item of items) {
      if (!listingMatchesCard(item, want)) continue
      const detected = detectListingCondition(item.title)
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
          rank: detected.rawRank,
          grade: detected.grade,
          company: detected.company,
          label: item.title,
        } : undefined,
      })
    }
  }

  const { data: hiddenRows } = await admin
    .from('ebay_hidden_items')
    .select('item_id')
    .eq('user_id', user.id)
  const hiddenIds = new Set((hiddenRows || []).map(r => r.item_id))

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
  })
}
