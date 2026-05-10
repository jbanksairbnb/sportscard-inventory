import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// POST /api/seller-terms
// Marks the calling user as having accepted the seller T&C. Refuses if
// can_sell isn't true (no point accepting terms if the admin hasn't
// approved selling yet) so we can't accidentally activate the wrong row.
export async function POST() {
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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_sell, is_admin, seller_terms_accepted_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile?.can_sell && !profile?.is_admin) {
    return NextResponse.json({ error: 'Selling not approved yet' }, { status: 403 })
  }

  if (profile.seller_terms_accepted_at) {
    return NextResponse.json({ ok: true, alreadyAccepted: true })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ seller_terms_accepted_at: new Date().toISOString() })
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
