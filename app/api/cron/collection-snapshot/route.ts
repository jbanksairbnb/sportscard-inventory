import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { addMonths, buildSnapshot, extractCards, monthOf, type SetInput } from '@/lib/collectionValue'

// Monthly close-of-month snapshot of every user's collection value.
//
// Vercel Cron (vercel.json) calls this at 00:15 UTC on the 1st, so what it reads
// is the collection as it stood at the close of the previous month. Vercel sends
// `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET set the route is
// closed. `?month=YYYY-MM` re-runs a specific month (it is an upsert).

export const runtime = 'nodejs'
export const maxDuration = 300

const PAGE = 100

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const month = req.nextUrl.searchParams.get('month') || addMonths(monthOf(new Date()), -1)
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Bad month' }, { status: 400 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  let written = 0
  const failures: string[] = []
  let current: string | null = null
  let bucket: SetInput[] = []

  async function flush() {
    if (!current) return
    const snap = buildSnapshot(extractCards(bucket), month, 'month_end')
    if (snap.owned_cards > 0) {
      const { error } = await admin.from('collection_value_snapshots').upsert({
        user_id: current, ...snap,
      })
      if (error) failures.push(`${current}: ${error.message}`)
      else written++
    }
    bucket = []
  }

  // Ordered by (user_id, slug) so each user's sets arrive contiguously, even
  // across page boundaries.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('sets')
      .select('user_id, slug, title, year, brand, purpose, rows')
      .order('user_id').order('slug')
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message, written }, { status: 500 })
    for (const s of data || []) {
      if (s.user_id !== current) { await flush(); current = s.user_id }
      bucket.push(s as SetInput)
    }
    if (!data || data.length < PAGE) break
  }
  await flush()

  return NextResponse.json({ month, written, failures })
}
