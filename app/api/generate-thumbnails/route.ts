import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Generates static thumbnails for a batch of the signed-in user's card images.
// The heavy lifting (fetch a resized copy + store it beside the original) runs
// server-side, so there are no browser cross-origin limits and we control the
// request rate — the opposite of the view-time burst that overwhelms the
// on-the-fly image transform endpoint.
//
// Any authenticated user may call this, but ONLY for images under their own
// `<userId>/…` storage prefix. Callers send batches (see MAX_PATHS) and loop.

export const maxDuration = 60

const BUCKET = 'card-images'
const THUMB_SUFFIX = '.thumb.jpg'
const THUMB_WIDTH = 700
const THUMB_QUALITY = 72
const MAX_PATHS = 40      // cap per request so a batch finishes well within the timeout
const CONCURRENCY = 6

function authedSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
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

function toThumbPath(path: string): string {
  if (path.endsWith(THUMB_SUFFIX)) return path
  const dot = path.lastIndexOf('.')
  const stem = dot === -1 ? path : path.slice(0, dot)
  return `${stem}${THUMB_SUFFIX}`
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

export async function POST(req: NextRequest) {
  const supabase = authedSupabase(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { paths?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const rawPaths = Array.isArray(body.paths) ? body.paths : []

  // Accept only this user's own originals; skip thumbnails; dedupe; cap size.
  const seen = new Set<string>()
  const paths: string[] = []
  for (const p of rawPaths) {
    if (typeof p !== 'string') continue
    if (!p.startsWith(`${user.id}/`)) continue
    if (p.endsWith(THUMB_SUFFIX)) continue
    if (seen.has(p)) continue
    seen.add(p)
    paths.push(p)
    if (paths.length >= MAX_PATHS) break
  }
  if (paths.length === 0) {
    return NextResponse.json({ processed: 0, made: 0, skipped: 0, failed: 0 })
  }

  const admin = adminClient()
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')
  let made = 0, skipped = 0, failed = 0

  async function processOne(path: string) {
    const thumbPath = toThumbPath(path)
    try {
      // Already has a thumbnail? Skip the work.
      const head = await fetch(`${base}/storage/v1/object/public/${BUCKET}/${encodePath(thumbPath)}`, { method: 'HEAD' })
      if (head.ok) { skipped++; return }
      // Fetch a resized copy via the render endpoint, store it as a static object.
      const renderUrl = `${base}/storage/v1/render/image/public/${BUCKET}/${encodePath(path)}?width=${THUMB_WIDTH}&quality=${THUMB_QUALITY}&resize=contain`
      const res = await fetch(renderUrl)
      if (!res.ok) throw new Error(`render ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      const { error } = await admin.storage.from(BUCKET).upload(thumbPath, bytes, { upsert: true, contentType: 'image/jpeg' })
      if (error) throw new Error(error.message)
      made++
    } catch {
      failed++
    }
  }

  // Bounded concurrency pool.
  let cursor = 0
  async function worker() {
    while (cursor < paths.length) {
      const i = cursor++
      await processOne(paths[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker))

  return NextResponse.json({ processed: paths.length, made, skipped, failed })
}
