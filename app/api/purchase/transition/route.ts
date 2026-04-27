import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const PLUM = '#3d1f4a'
const ORANGE = '#e8742c'
const TEAL = '#2d7a6e'
const CREAM = '#f8ecd0'
const RULE = '#ecdbb8'
const INK_MUTE = '#7a6a8a'

type Action = 'paid' | 'shipped' | 'received' | 'cancelled'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n)
}

function shellHtml(headline: string, body: string) {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 22px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 28px;">${escapeHtml(headline)}</h1>
      </div>
      ${body}
      <hr style="border: none; border-top: 1px solid ${RULE}; margin: 24px 0 14px;" />
      <p style="font-size: 11px; color: ${INK_MUTE}; text-align: center; margin: 0;">Questions? <a href="mailto:jbanks@sports-collective.com" style="color: ${ORANGE};">jbanks@sports-collective.com</a></p>
    </div>
  `
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { skipped: true }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Sports Collective <noreply@sports-collective.com>', to, subject, html }),
    })
    return await res.json()
  } catch (e) {
    return { error: String(e) }
  }
}

export async function POST(req: NextRequest) {
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

  const body = await req.json() as {
    purchaseId: string
    action: Action
    paymentMethod?: string
    trackingNumber?: string
  }
  const { purchaseId, action, paymentMethod, trackingNumber } = body
  if (!purchaseId || !action) return NextResponse.json({ error: 'Missing purchaseId or action' }, { status: 400 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: purchase, error: purchErr } = await admin
    .from('purchases')
    .select('*, listing:listings(title)')
    .eq('id', purchaseId)
    .single()
  if (purchErr || !purchase) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })

  const isBuyer = user.id === purchase.buyer_id
  const isSeller = user.id === purchase.seller_id
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (action === 'paid' && (!isSeller || purchase.status !== 'unpaid')) {
    return NextResponse.json({ error: 'Only the seller can mark unpaid purchases as paid.' }, { status: 400 })
  }
  if (action === 'shipped' && (!isSeller || purchase.status !== 'paid')) {
    return NextResponse.json({ error: 'Only the seller can ship paid purchases.' }, { status: 400 })
  }
  if (action === 'received' && (!isBuyer || purchase.status !== 'shipped')) {
    return NextResponse.json({ error: 'Only the buyer can mark shipped purchases as received.' }, { status: 400 })
  }
  if (action === 'cancelled' && purchase.status !== 'unpaid') {
    return NextResponse.json({ error: 'Only unpaid purchases can be cancelled.' }, { status: 400 })
  }

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, email, display_name, handle')
    .in('user_id', [purchase.buyer_id, purchase.seller_id])
  const buyerProfile = profiles?.find(p => p.user_id === purchase.buyer_id)
  const sellerProfile = profiles?.find(p => p.user_id === purchase.seller_id)
  let buyerEmail = buyerProfile?.email || ''
  let sellerEmail = sellerProfile?.email || ''
  if (!buyerEmail) {
    const { data: u } = await admin.auth.admin.getUserById(purchase.buyer_id)
    buyerEmail = u?.user?.email || ''
  }
  if (!sellerEmail) {
    const { data: u } = await admin.auth.admin.getUserById(purchase.seller_id)
    sellerEmail = u?.user?.email || ''
  }
  const buyerName = buyerProfile?.display_name || buyerProfile?.handle || (buyerEmail ? buyerEmail.split('@')[0] : 'Buyer')
  const sellerName = sellerProfile?.display_name || sellerProfile?.handle || (sellerEmail ? sellerEmail.split('@')[0] : 'Seller')
  const listingTitle = purchase.listing?.title || 'Sports Collective listing'
  const total = Number(purchase.total)

  let updated: Record<string, unknown> | null = null
  if (action === 'paid') {
    const update: Record<string, unknown> = { status: 'paid', paid_at: new Date().toISOString() }
    if (paymentMethod) update.payment_method = paymentMethod
    const { data, error } = await admin.from('purchases').update(update).eq('id', purchaseId).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    updated = data
  } else if (action === 'shipped') {
    const update: Record<string, unknown> = { status: 'shipped', shipped_at: new Date().toISOString() }
    if (trackingNumber) update.tracking_number = trackingNumber
    const { data, error } = await admin.from('purchases').update(update).eq('id', purchaseId).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    updated = data
  } else if (action === 'received') {
    const { data, error } = await admin.from('purchases').update({ status: 'completed' }).eq('id', purchaseId).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    updated = data
  } else if (action === 'cancelled') {
    const { error } = await admin.rpc('cancel_purchase', { p_purchase_id: purchaseId })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const { data } = await admin.from('purchases').select('*').eq('id', purchaseId).single()
    updated = data
  }

  if (action === 'paid' && buyerEmail) {
    const html = shellHtml('Payment Confirmed', `
      <p style="font-size: 15px; line-height: 1.6;">${escapeHtml(sellerName)} confirmed receipt of your <strong>${fmtMoney(total)}</strong> payment for <strong>${escapeHtml(listingTitle)}</strong>.</p>
      ${paymentMethod ? `<p style="font-size: 13px; color: ${INK_MUTE};">Payment method noted: <strong>${escapeHtml(paymentMethod)}</strong></p>` : ''}
      <p style="font-size: 14px; line-height: 1.6;">The seller is preparing your card for shipment. You'll get another email when it ships.</p>
      <p style="font-size: 13px; color: ${INK_MUTE}; line-height: 1.6;">Track this order at <a href="https://sports-collective.com/purchases" style="color: ${ORANGE};">sports-collective.com/purchases</a>.</p>
    `)
      const r = await sendEmail(buyerEmail, `Payment confirmed: ${listingTitle}`, html)
    console.log('Transition email — paid:', JSON.stringify(r))
  } else if (action === 'shipped' && buyerEmail) {
    const html = shellHtml('Your Order is on the Way', `
      <p style="font-size: 15px; line-height: 1.6;">${escapeHtml(sellerName)} just shipped <strong>${escapeHtml(listingTitle)}</strong>.</p>
      ${trackingNumber ? `
        <div style="background: #fff8e8; border-left: 4px solid ${ORANGE}; padding: 14px 18px; margin: 18px 0;">
          <div style="font-size: 11px; letter-spacing: 0.15em; color: ${ORANGE}; font-weight: 700; margin-bottom: 8px;">TRACKING</div>
          <div style="font-family: 'Courier New', monospace; font-size: 16px; font-weight: 700; color: ${TEAL};">${escapeHtml(trackingNumber)}</div>
        </div>
      ` : `<p style="font-size: 13px; color: ${INK_MUTE};">No tracking number provided — likely shipped via PWE.</p>`}
      <p style="font-size: 13px; color: ${INK_MUTE}; line-height: 1.6;">Once it arrives, mark it as received at <a href="https://sports-collective.com/purchases" style="color: ${ORANGE};">sports-collective.com/purchases</a>.</p>
    `)
        const r = await sendEmail(buyerEmail, `Shipped: ${listingTitle}`, html)
    console.log('Transition email — shipped:', JSON.stringify(r))
  } else if (action === 'cancelled') {
    const recipient = isBuyer ? sellerEmail : buyerEmail
    const recipientName = isBuyer ? sellerName : buyerName
    const cancelledByLabel = isBuyer ? 'buyer' : 'seller'
    if (recipient) {
      const html = shellHtml('Purchase Cancelled', `
        <p style="font-size: 15px; line-height: 1.6;">Hi ${escapeHtml(recipientName)} — the ${cancelledByLabel} cancelled the purchase of <strong>${escapeHtml(listingTitle)}</strong>.</p>
        ${isBuyer
          ? `<p style="font-size: 14px; line-height: 1.6;">The listing has been put back on the marketplace.</p>`
          : `<p style="font-size: 14px; line-height: 1.6;">No charge was processed. The listing is now available again on the marketplace.</p>`
        }
      `)
            const r = await sendEmail(recipient, `Cancelled: ${listingTitle}`, html)
      console.log('Transition email — cancelled:', JSON.stringify(r))
    }
  }

  return NextResponse.json({ ok: true, purchase: updated })
}
