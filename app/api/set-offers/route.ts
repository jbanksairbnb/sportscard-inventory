import { createClient } from '@supabase/supabase-js'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Offers on a public set showcase (/seller/<handle>/set/<slug>).
//
//   POST  — anyone (no sign-in): submit an offer. The set must be public and
//           accepting offers. The set's minimum offer is the seller's secret:
//           an offer under it is saved as 'auto_declined' (so the seller can
//           still see it) and the buyer is told it was declined, never what
//           the minimum is.
//   GET   — set owner: ?slug=<slug> lists the offers on that set.
//   PATCH — set owner: { id, status } marks an offer accepted / declined / new.

const MAX_OFFERS_PER_HOUR = 20

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function authed() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    },
  )
}

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  // Honeypot: a hidden field real visitors never fill in.
  if (clip(body.website, 200)) return NextResponse.json({ ok: true })

  const handle = clip(body.handle, 100)
  const slug = clip(body.slug, 200)
  const name = clip(body.name, 120)
  const contact = clip(body.contact, 200)
  const message = clip(body.message, 2000)
  const amount = Math.round(Number(body.amount) * 100) / 100

  if (!handle || !slug) return NextResponse.json({ error: 'Missing set' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!contact) return NextResponse.json({ error: 'Please enter an email, phone number or Facebook name so the seller can reach you.' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Please enter an offer amount.' }, { status: 400 })

  const db = admin()
  const { data: seller } = await db.from('user_profiles').select('user_id').eq('handle', handle).maybeSingle()
  if (!seller) return NextResponse.json({ error: 'Set not found' }, { status: 404 })

  const { data: set } = await db
    .from('sets')
    .select('title, public_enabled, accept_offers, min_offer')
    .eq('user_id', seller.user_id)
    .eq('slug', slug)
    .maybeSingle()
  if (!set || !set.public_enabled) return NextResponse.json({ error: 'Set not found' }, { status: 404 })
  if (!set.accept_offers) return NextResponse.json({ error: 'This set is not taking offers right now.' }, { status: 400 })
  // Light flood protection per set.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await db
    .from('set_offers')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', seller.user_id)
    .eq('set_slug', slug)
    .gte('created_at', since)
  if ((count ?? 0) >= MAX_OFFERS_PER_HOUR) {
    return NextResponse.json({ error: 'Too many offers on this set right now. Please try again later.' }, { status: 429 })
  }

  const min = set.min_offer != null ? Number(set.min_offer) : null
  const autoDeclined = min != null && amount < min

  const { error } = await db.from('set_offers').insert({
    owner_user_id: seller.user_id,
    set_slug: slug,
    set_title: set.title,
    amount,
    buyer_name: name,
    buyer_contact: contact,
    message: message || null,
    status: autoDeclined ? 'auto_declined' : 'new',
  })
  if (error) return NextResponse.json({ error: 'Could not send your offer. Please try again.' }, { status: 500 })

  if (autoDeclined) {
    return NextResponse.json({
      declined: true,
      error: "Sorry, the seller can't accept an offer at that amount. You're welcome to send a higher offer.",
    }, { status: 422 })
  }

  // Best effort: surface it in the owner's notifications too.
  await db.from('notifications').insert({
    user_id: seller.user_id,
    kind: 'set_offer',
    payload: { set_slug: slug, set_title: set.title, amount, buyer_name: name },
    link: `/set/${encodeURIComponent(slug)}/view`,
  }).then(() => undefined, () => undefined)

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const supabase = await authed()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const slug = new URL(req.url).searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  const { data, error } = await supabase
    .from('set_offers')
    .select('id, amount, buyer_name, buyer_contact, message, status, created_at')
    .eq('owner_user_id', user.id)
    .eq('set_slug', slug)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ offers: data || [] })
}

export async function PATCH(req: NextRequest) {
  const supabase = await authed()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { id?: string; status?: string }
  if (!body.id || !['new', 'accepted', 'declined'].includes(String(body.status))) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const { error } = await supabase
    .from('set_offers')
    .update({ status: body.status })
    .eq('id', body.id)
    .eq('owner_user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
