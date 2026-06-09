import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens, saveConnection } from '@/lib/ebayOAuth'

// eBay redirects the seller's browser here after consent. We verify the CSRF
// state, exchange the authorization code for tokens, store the (encrypted)
// refresh token against the logged-in seller, then bounce back to the settings
// page. All failures land on the settings page with a readable ?error.
export const runtime = 'nodejs'

function settings(req: Request, params: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings/ebay?${params}`, req.url))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const denied = url.searchParams.get('error')

  // Seller declined consent on eBay.
  if (denied) return settings(req, 'error=declined')

  // CSRF check: the state we set on /connect must come back unchanged.
  const cookieState = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('ebay_oauth_state='))
    ?.split('=')[1]
  if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
    return settings(req, 'error=state')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  try {
    const tokens = await exchangeCodeForTokens(code)
    await saveConnection(user.id, tokens)
  } catch (e) {
    console.error('[ebay/callback] token exchange failed:', e)
    return settings(req, 'error=exchange')
  }

  const res = settings(req, 'connected=1')
  res.cookies.set('ebay_oauth_state', '', { path: '/', maxAge: 0 })
  return res
}
