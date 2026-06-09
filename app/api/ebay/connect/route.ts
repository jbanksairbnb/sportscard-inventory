import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizeUrl } from '@/lib/ebayOAuth'

// Kicks off the eBay account link: verifies the seller is logged in, sets a
// short-lived CSRF state cookie, and redirects to eBay's consent screen. The
// browser comes back to /api/ebay/callback after the seller consents.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const state = crypto.randomBytes(16).toString('hex')
  const res = NextResponse.redirect(buildAuthorizeUrl(state))
  res.cookies.set('ebay_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes to complete consent
  })
  return res
}
