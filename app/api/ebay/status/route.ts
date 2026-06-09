import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConnection } from '@/lib/ebayOAuth'

// Read-only connection status for the settings page. Returns only safe,
// derived fields — never the refresh token (that lives in a service-role-only
// table and is read solely by server-side push/poll code).
export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conn = await getConnection(user.id)
  if (!conn) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    environment: conn.environment,
    ebayUser: conn.ebay_user,
    refreshTokenExpiresAt: conn.refresh_token_expires_at,
    setupComplete: Boolean(
      conn.fulfillment_policy_id && conn.payment_policy_id && conn.return_policy_id && conn.merchant_location_key,
    ),
  })
}
