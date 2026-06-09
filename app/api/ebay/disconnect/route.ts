import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteConnection } from '@/lib/ebayOAuth'

// Unlink the seller's eBay account: drops the stored connection (and its
// refresh token). The seller can also revoke access from eBay's side; either
// way the next listing push will prompt a reconnect.
export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await deleteConnection(user.id)
  return NextResponse.json({ ok: true })
}
