import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || ''

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

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let isAdmin = !!BOOTSTRAP_ADMIN_EMAIL && user.email === BOOTSTRAP_ADMIN_EMAIL
  if (!isAdmin) {
    const { data: callerProfile } = await admin
      .from('user_profiles').select('is_admin').eq('user_id', user.id).maybeSingle()
    isAdmin = !!callerProfile?.is_admin
  }
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const items = Array.isArray(body?.items) ? body.items : []
  if (items.length === 0) return NextResponse.json({ error: 'items required' }, { status: 400 })

  type Item = { year: number; brand: string; title: string; sport: string; rows: unknown[] }
  const cleaned: Item[] = []
  for (const it of items) {
    const year = Number(it?.year)
    const brand = String(it?.brand || '').trim()
    const title = String(it?.title || '').trim()
    const sport = String(it?.sport || '').toLowerCase().trim()
    const rows = Array.isArray(it?.rows) ? it.rows : null
    if (!year || !brand || !title || !sport || !rows) continue
    cleaned.push({ year, brand, title, sport, rows })
  }

  if (cleaned.length === 0) return NextResponse.json({ error: 'no valid items' }, { status: 400 })

  const records = cleaned.map(it => ({
    year: it.year, brand: it.brand, title: it.title, sport: it.sport,
    rows: it.rows,
    card_count: it.rows.length,
    uploaded_by: user.id,
    is_official: true,
  }))

  const { error, data } = await admin
    .from('set_templates')
    .upsert(records, { onConflict: 'year,brand,title' })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inserted: (data || []).length })
}
