import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

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
  const itemId = String(body?.itemId || '').trim()
  const setSlug = String(body?.setSlug || '').trim()
  const cardNumber = String(body?.cardNumber || '').trim()
  const player = String(body?.player || '').trim()
  if (!itemId || !setSlug || !cardNumber) {
    return NextResponse.json({ error: 'itemId, setSlug, and cardNumber are required' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: setRow, error: fetchErr } = await admin
    .from('sets')
    .select('rows')
    .eq('user_id', user.id)
    .eq('slug', setSlug)
    .single()

  if (fetchErr || !setRow) {
    return NextResponse.json({ error: 'Set not found' }, { status: 404 })
  }

  const rows = (setRow.rows || []) as Record<string, unknown>[]
  const playerLower = player.toLowerCase()
  let updated = false
  const newRows = rows.map(row => {
    if (updated) return row
    const rowCardNum = String(row['Card #'] || '').trim()
    if (rowCardNum !== cardNumber) return row
    if (player) {
      const rowPlayer = String(row['Player'] || row['Description'] || '').trim().toLowerCase()
      if (rowPlayer !== playerLower) return row
    }
    updated = true
    return { ...row, Owned: 'Yes' }
  })

  if (!updated) {
    return NextResponse.json({ error: 'Card not found in set' }, { status: 404 })
  }

  const { error: updateErr } = await admin
    .from('sets')
    .update({ rows: newRows })
    .eq('user_id', user.id)
    .eq('slug', setSlug)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await admin
    .from('ebay_hidden_items')
    .upsert({ user_id: user.id, item_id: itemId }, { onConflict: 'user_id,item_id' })

  return NextResponse.json({ ok: true })
}
