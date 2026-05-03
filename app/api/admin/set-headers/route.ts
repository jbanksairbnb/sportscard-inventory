import { createServerClient } from '@supabase/ssr'
import { createClient, SupabaseClient, User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const BOOTSTRAP_ADMIN_EMAIL = 'jbanks@sports-collective.com'

function authedSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
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
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function isAdminUser(admin: SupabaseClient, user: User): Promise<boolean> {
  if (user.email === BOOTSTRAP_ADMIN_EMAIL) return true
  const { data } = await admin
    .from('user_profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle()
  return !!data?.is_admin
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export async function GET() {
  const supabase = authedSupabase(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = adminClient()
  if (!(await isAdminUser(admin, user))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await admin
    .from('set_headers')
    .select('id, year, brand, title, image_url, description, updated_at')
    .order('year', { ascending: false })
    .order('title', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ headers: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = authedSupabase(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = adminClient()
  if (!(await isAdminUser(admin, user))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData()
  const yearRaw = form.get('year')
  const brandRaw = form.get('brand')
  const titleRaw = form.get('title')
  const descriptionRaw = form.get('description')
  const file = form.get('image') as File | null
  const existingImageUrl = String(form.get('existing_image_url') || '')

  const year = Number(yearRaw)
  const brand = String(brandRaw || '').trim()
  const title = String(titleRaw || '').trim()
  const description = String(descriptionRaw || '').trim()

  if (!year || !brand || !title) {
    return NextResponse.json({ error: 'year, brand, and title are required' }, { status: 400 })
  }

  let image_url: string | null = existingImageUrl || null
  if (file && file.size > 0) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const folder = `${year}-${slugify(brand)}-${slugify(title)}`
    const path = `set-headers/${folder}/header-${Date.now()}.${ext}`
    const arrayBuffer = await file.arrayBuffer()
    const { error: upErr } = await admin.storage
      .from('card-images')
      .upload(path, new Uint8Array(arrayBuffer), {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      })
    if (upErr) return NextResponse.json({ error: 'Upload failed: ' + upErr.message }, { status: 500 })
    const { data: pub } = admin.storage.from('card-images').getPublicUrl(path)
    image_url = pub.publicUrl
  }

  const { data, error } = await admin
    .from('set_headers')
    .upsert(
      { year, brand, title, image_url, description, updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'year,brand,title' }
    )
    .select('id, year, brand, title, image_url, description, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ header: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = authedSupabase(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = adminClient()
  if (!(await isAdminUser(admin, user))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await admin.from('set_headers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
