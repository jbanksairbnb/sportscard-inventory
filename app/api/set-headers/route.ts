import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const year = Number(url.searchParams.get('year'))
  const brand = String(url.searchParams.get('brand') || '').trim()
  const title = String(url.searchParams.get('title') || '').trim()
  if (!year || !brand || !title) {
    return NextResponse.json({ header: null })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await admin
    .from('set_headers')
    .select('id, year, brand, title, image_url, description, updated_at')
    .eq('year', year)
    .eq('brand', brand)
    .eq('title', title)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ header: data || null })
}
