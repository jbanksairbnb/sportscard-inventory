import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { addMonths, buildSnapshot, extractCards, extractItemCards, monthOf, type SetInput } from '@/lib/collectionValue'
import type { CollectionItem } from '@/lib/collectionItems'

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

  // Singles & items, grouped by owner. A missing table (migration not run)
  // just means nobody has items yet.
  const itemsByUser = new Map<string, CollectionItem[]>()
  for (let from = 0; ; from += PAGE * 10) {
    const { data, error } = await admin
      .from('collection_items')
      .select('*')
      .order('user_id').order('id')
      .range(from, from + PAGE * 10 - 1)
    if (error || !data) break
    for (const r of data as any[]) {
      const list = itemsByUser.get(r.user_id) ?? []
      list.push({ ...r, qty: Number(r.qty), cost: Number(r.cost), value: Number(r.value) } as CollectionItem)
      itemsByUser.set(r.user_id, list)
    }
    if (data.length < PAGE * 10) break
  }

  let written = 0
  const failures: string[] = []
  let current: string | null = null
  let bucket: SetInput[] = []
  const seenUsers = new Set<string>()

  async function snapshotUser(userId: string, sets: SetInput[]) {
    seenUsers.add(userId)
    const cards = [...extractCards(sets), ...extractItemCards(itemsByUser.get(userId) ?? [])]
    const snap = buildSnapshot(cards, month, 'month_end')
    if (snap.owned_cards > 0) {
      const { error } = await admin.from('collection_value_snapshots').upsert({
        user_id: userId, ...snap,
      })
      if (error) failures.push(`${userId}: ${error.message}`)
      else written++
    }
  }

  async function flush() {
    if (!current) return
    await snapshotUser(current, bucket)
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

  // Owners who have items but no sets still get a snapshot.
  for (const [userId] of itemsByUser) {
    if (!seenUsers.has(userId)) await snapshotUser(userId, [])
  }

  return NextResponse.json({ month, written, failures })
}
