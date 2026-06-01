import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { markSourceRowOwned } from '@/lib/inventory'
import { recomputeOrder } from '@/lib/orders'

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

// POST /api/orders/transition
// Body: { orderId, action: 'paid'|'shipped'|'received'|'cancelled', paymentMethod?, trackingNumber? }
//
// Applies the action to every eligible line item in the order at once — so a
// multi-card order moves between Claimed → Sold → Shipped as a unit — then
// re-derives the order header and sends a single combined notification.
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
    orderId: string
    action: Action
    paymentMethod?: string
    trackingNumber?: string
  }
  const { orderId, action, paymentMethod, trackingNumber } = body
  if (!orderId || !action) return NextResponse.json({ error: 'Missing orderId or action' }, { status: 400 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()
  if (orderErr || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const isBuyer = user.id === order.buyer_id
  const isSeller = user.id === order.seller_id
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((action === 'paid' || action === 'shipped') && !isSeller) {
    return NextResponse.json({ error: 'Only the seller can record payment or shipping.' }, { status: 400 })
  }
  if (action === 'received' && !isBuyer) {
    return NextResponse.json({ error: 'Only the buyer can mark an order received.' }, { status: 400 })
  }

  const { data: lines } = await admin
    .from('purchases')
    .select('*, listing:listings(title)')
    .eq('order_id', orderId)
  if (!lines || lines.length === 0) return NextResponse.json({ error: 'Order has no items' }, { status: 404 })

  // The line statuses this action is allowed to advance.
  const eligibleFrom: Record<Action, string> = {
    paid: 'unpaid', shipped: 'paid', received: 'shipped', cancelled: 'unpaid',
  }
  const targets = lines.filter(l => l.status === eligibleFrom[action])
  if (targets.length === 0) {
    return NextResponse.json({ error: `No items in this order can be marked ${action}.` }, { status: 400 })
  }
  const targetIds = targets.map(l => l.id)

  if (action === 'paid') {
    const update: Record<string, unknown> = { status: 'paid', paid_at: new Date().toISOString() }
    if (paymentMethod) update.payment_method = paymentMethod
    const { error } = await admin.from('purchases').update(update).in('id', targetIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'shipped') {
    const update: Record<string, unknown> = { status: 'shipped', shipped_at: new Date().toISOString() }
    if (trackingNumber) update.tracking_number = trackingNumber
    const { error } = await admin.from('purchases').update(update).in('id', targetIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'received') {
    const { error } = await admin.from('purchases').update({ status: 'completed' }).in('id', targetIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'cancelled') {
    // Cancel each unpaid line through the RPC and restore its card to the
    // seller's inventory, mirroring the single-purchase cancel flow.
    for (const line of targets) {
      const { error } = await admin.rpc('cancel_purchase', { p_purchase_id: line.id })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (line.listing_id) {
        const { data: listing } = await admin
          .from('listings')
          .select('user_id, source_set_slug, source_card_number')
          .eq('id', line.listing_id)
          .maybeSingle()
        if (listing?.source_set_slug && listing?.source_card_number) {
          await markSourceRowOwned(admin, {
            sellerUserId: listing.user_id,
            setSlug: listing.source_set_slug,
            cardNumber: listing.source_card_number,
            owned: true,
          })
        }
      }
    }
  }

  await recomputeOrder(admin, orderId)
  const { data: updatedOrder } = await admin.from('orders').select('*').eq('id', orderId).single()

  // One combined notification to the relevant party.
  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, email, display_name, handle')
    .in('user_id', [order.buyer_id, order.seller_id])
  const buyerProfile = profiles?.find(p => p.user_id === order.buyer_id)
  const sellerProfile = profiles?.find(p => p.user_id === order.seller_id)
  const buyerEmail = buyerProfile?.email || ''
  const sellerEmail = sellerProfile?.email || ''
  const buyerName = buyerProfile?.display_name || buyerProfile?.handle || (buyerEmail ? buyerEmail.split('@')[0] : 'Buyer')
  const sellerName = sellerProfile?.display_name || sellerProfile?.handle || (sellerEmail ? sellerEmail.split('@')[0] : 'Seller')
  const n = targets.length
  const cards = `${n} card${n === 1 ? '' : 's'}`
  const total = Number(updatedOrder?.total ?? order.total)

  if (action === 'paid' && buyerEmail) {
    const html = shellHtml('Payment Confirmed', `
      <p style="font-size: 15px; line-height: 1.6;">${escapeHtml(sellerName)} confirmed your <strong>${fmtMoney(total)}</strong> payment for your order of <strong>${cards}</strong>.</p>
      ${paymentMethod ? `<p style="font-size: 13px; color: ${INK_MUTE};">Payment method noted: <strong>${escapeHtml(paymentMethod)}</strong></p>` : ''}
      <p style="font-size: 14px; line-height: 1.6;">The seller is preparing your cards for shipment.</p>
      <p style="font-size: 13px; color: ${INK_MUTE};">View your invoice at <a href="https://sports-collective.com/orders/${order.id}" style="color: ${ORANGE};">sports-collective.com/orders/${order.id}</a>.</p>
    `)
    console.log('Order transition email — paid:', JSON.stringify(await sendEmail(buyerEmail, `Payment confirmed — ${cards}`, html)))
  } else if (action === 'shipped' && buyerEmail) {
    const html = shellHtml('Your Order is on the Way', `
      <p style="font-size: 15px; line-height: 1.6;">${escapeHtml(sellerName)} just shipped your order of <strong>${cards}</strong>.</p>
      ${trackingNumber ? `
        <div style="background: #fff8e8; border-left: 4px solid ${ORANGE}; padding: 14px 18px; margin: 18px 0;">
          <div style="font-size: 11px; letter-spacing: 0.15em; color: ${ORANGE}; font-weight: 700; margin-bottom: 8px;">TRACKING</div>
          <div style="font-family: 'Courier New', monospace; font-size: 16px; font-weight: 700; color: ${TEAL};">${escapeHtml(trackingNumber)}</div>
        </div>
      ` : `<p style="font-size: 13px; color: ${INK_MUTE};">No tracking number provided — likely shipped via PWE.</p>`}
      <p style="font-size: 13px; color: ${INK_MUTE};">View your invoice at <a href="https://sports-collective.com/orders/${order.id}" style="color: ${ORANGE};">sports-collective.com/orders/${order.id}</a>.</p>
    `)
    console.log('Order transition email — shipped:', JSON.stringify(await sendEmail(buyerEmail, `Shipped — ${cards}`, html)))
  } else if (action === 'cancelled') {
    const recipient = isBuyer ? sellerEmail : buyerEmail
    const recipientName = isBuyer ? sellerName : buyerName
    const by = isBuyer ? 'buyer' : 'seller'
    if (recipient) {
      const html = shellHtml('Order Cancelled', `
        <p style="font-size: 15px; line-height: 1.6;">Hi ${escapeHtml(recipientName)} — the ${by} cancelled an order of <strong>${cards}</strong>. Those listings are back on the marketplace.</p>
      `)
      console.log('Order transition email — cancelled:', JSON.stringify(await sendEmail(recipient, `Cancelled — ${cards}`, html)))
    }
  }

  return NextResponse.json({ ok: true, order: updatedOrder, affected: targetIds.length })
}
