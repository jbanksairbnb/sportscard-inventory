import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Handles every Supabase auth redirect: email confirmation, magic link, and
// password reset. For email confirmation specifically we use this to bootstrap
// the user_profiles row — when "Confirm email" is enabled in Supabase Auth,
// signUp() returns no session, so the profile cannot be created from /login.
// We create it here on first arrival, using the signup_intent stashed in
// user_metadata to decide where to route after confirmation.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') || '/home'

  if (!code) {
    return NextResponse.redirect(new URL('/home', request.url))
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(exchangeError.message)}`, request.url)
    )
  }

  // Bootstrap the profile if this is a fresh email confirmation. Skip when
  // a row already exists (re-confirmation, magic link to existing user, etc.)
  // so we never overwrite settings.
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const intent = (user.user_metadata?.signup_intent as 'buyer' | 'seller' | undefined) || 'buyer'

    const { data: existing } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!existing) {
      await supabase.from('user_profiles').upsert({
        user_id: user.id,
        email: user.email,
        application_status: 'approved',
        can_sell: false,
        wants_to_sell: false,
      }, { onConflict: 'user_id' })

      // Sellers go to /apply on first confirmation so they can submit
      // their application immediately. Buyers honor the requested `next`.
      if (intent === 'seller') {
        return NextResponse.redirect(new URL('/apply', request.url))
      }
    }
  }

  return NextResponse.redirect(new URL(next, request.url))
}
