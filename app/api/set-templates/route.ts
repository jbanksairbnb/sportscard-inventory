import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sport = url.searchParams.get('sport')

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let q = admin
    .from('set_templates')
    .select('id, year, brand, title, sport, card_count, is_official, created_at')
    .order('year', { ascending: true })
    .order('brand', { ascending: true })
    .order('title', { ascending: true })

  if (sport) q = q.eq('sport', sport.toLowerCase())

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Templates change rarely — admin-curated rosters. Edge-cache for 5 min
  // and serve stale for an hour while revalidating. Cuts cold-start +
  // DB-roundtrip latency for the dropdown on every /set/new visit.
  return NextResponse.json(
    { templates: data || [] },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } }
  )
}

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

  const body = await req.json().catch(() => ({}))
  const year = Number(body?.year)
  const brand = String(body?.brand || '').trim()
  const title = String(body?.title || '').trim()
  const sport = String(body?.sport || '').toLowerCase().trim()
  const rows = Array.isArray(body?.rows) ? body.rows : null

  if (!year || !brand || !title || !sport || !rows) {
    return NextResponse.json({ error: 'year, brand, title, sport, and rows are required' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await admin
    .from('set_templates')
    .upsert({
      year, brand, title, sport,
      rows,
      card_count: rows.length,
      uploaded_by: user.id,
      is_official: false,
    }, { onConflict: 'year,brand,title', ignoreDuplicates: true })
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data?.id || null, skipped: !data })
}
