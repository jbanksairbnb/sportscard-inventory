import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Brand colors (kept in sync with /api/purchase/route.ts)
const PLUM = '#3d1f4a'
const ORANGE = '#e8742c'
const TEAL = '#2d7a6e'
const CREAM = '#f8ecd0'
const RULE = '#ecdbb8'
const INK_MUTE = '#7a6a8a'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n)
}

type LineItem = {
  title: string
  itemPrice: number
}

type BulkContext = {
  lines: LineItem[]
  subtotal: number
  shippingLabel: string
  shippingCost: number
  total: number
  buyerName: string
  buyerEmail: string
  sellerName: string
  sellerEmail: string
  shipTo: {
    name: string
    address1: string
    address2: string | null
    city: string
    state: string
    zip: string
    country: string
  }
}

function lineRows(c: BulkContext) {
  return c.lines.map(l => `
    <tr><td style="padding: 4px 0; color: ${INK_MUTE};">${escapeHtml(l.title)}</td>
        <td style="padding: 4px 0; text-align: right;">${fmtMoney(l.itemPrice)}</td></tr>`).join('')
}

function sellerEmailHtml(c: BulkContext) {
  const a2 = c.shipTo.address2 ? `<br/>${escapeHtml(c.shipTo.address2)}` : ''
  return `
    <div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 22px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 28px;">You Made ${c.lines.length} Sale${c.lines.length === 1 ? '' : 's'}!</h1>
      </div>
      <p style="font-size: 15px; line-height: 1.6;"><strong>${escapeHtml(c.buyerName)}</strong> just bought <strong>${c.lines.length} card${c.lines.length === 1 ? '' : 's'}</strong> in a single order:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
        ${lineRows(c)}
        <tr style="border-top: 1px solid ${RULE};"><td style="padding: 6px 0; color: ${INK_MUTE};">Subtotal</td><td style="padding: 6px 0; text-align: right;">${fmtMoney(c.subtotal)}</td></tr>
        <tr><td style="padding: 6px 0; color: ${INK_MUTE};">Shipping (${escapeHtml(c.shippingLabel)})</td><td style="padding: 6px 0; text-align: right;">${fmtMoney(c.shippingCost)}</td></tr>
        <tr style="border-top: 2px solid ${RULE};"><td style="padding: 8px 0; font-weight: 700;">Total Buyer Owes</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: ${TEAL}; font-size: 16px;">${fmtMoney(c.total)}</td></tr>
      </table>
      <div style="background: #fff8e8; border-left: 4px solid ${ORANGE}; padding: 14px 18px; margin: 18px 0;">
        <div style="font-size: 11px; letter-spacing: 0.15em; color: ${ORANGE}; font-weight: 700; margin-bottom: 8px;">SHIP TO</div>
        <div style="font-size: 14px; line-height: 1.5;">
          ${escapeHtml(c.shipTo.name)}<br/>
          ${escapeHtml(c.shipTo.address1)}${a2}<br/>
          ${escapeHtml(c.shipTo.city)}, ${escapeHtml(c.shipTo.state)} ${escapeHtml(c.shipTo.zip)}<br/>
          ${escapeHtml(c.shipTo.country)}
        </div>
      </div>
      <p style="font-size: 14px; line-height: 1.6;"><strong>Reach the buyer:</strong> <a href="mailto:${escapeHtml(c.buyerEmail)}" style="color: ${ORANGE};">${escapeHtml(c.buyerEmail)}</a></p>
      <p style="font-size: 13px; color: ${INK_MUTE}; line-height: 1.6;">Coordinate payment via your preferred method. Once paid, mark each sale as paid in your <a href="https://sports-collective.com/listings" style="color: ${ORANGE};">My Listings</a> page. Then ship the cards together and add tracking when available.</p>
      <hr style="border: none; border-top: 1px solid ${RULE}; margin: 24px 0 14px;" />
      <p style="font-size: 11px; color: ${INK_MUTE}; text-align: center; margin: 0;">Questions? <a href="mailto:jbanks@sports-collective.com" style="color: ${ORANGE};">jbanks@sports-collective.com</a></p>
    </div>
  `
}

function buyerEmailHtml(c: BulkContext) {
  const a2 = c.shipTo.address2 ? `<br/>${escapeHtml(c.shipTo.address2)}` : ''
  return `
    <div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 22px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 28px;">Order Confirmed</h1>
      </div>
      <p style="font-size: 15px; line-height: 1.6;">Your order from <strong>${escapeHtml(c.sellerName)}</strong> is reserved. ${c.lines.length} card${c.lines.length === 1 ? '' : 's'}:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
        ${lineRows(c)}
        <tr style="border-top: 1px solid ${RULE};"><td style="padding: 6px 0; color: ${INK_MUTE};">Subtotal</td><td style="padding: 6px 0; text-align: right;">${fmtMoney(c.subtotal)}</td></tr>
        <tr><td style="padding: 6px 0; color: ${INK_MUTE};">Shipping (${escapeHtml(c.shippingLabel)})</td><td style="padding: 6px 0; text-align: right;">${fmtMoney(c.shippingCost)}</td></tr>
        <tr style="border-top: 2px solid ${RULE};"><td style="padding: 8px 0; font-weight: 700;">Total Due</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: ${TEAL}; font-size: 16px;">${fmtMoney(c.total)}</td></tr>
      </table>
      <div style="background: #fff8e8; border-left: 4px solid ${ORANGE}; padding: 14px 18px; margin: 18px 0;">
        <div style="font-size: 11px; letter-spacing: 0.15em; color: ${ORANGE}; font-weight: 700; margin-bottom: 8px;">SHIPPING TO</div>
        <div style="font-size: 14px; line-height: 1.5;">
          ${escapeHtml(c.shipTo.name)}<br/>
          ${escapeHtml(c.shipTo.address1)}${a2}<br/>
          ${escapeHtml(c.shipTo.city)}, ${escapeHtml(c.shipTo.state)} ${escapeHtml(c.shipTo.zip)}<br/>
          ${escapeHtml(c.shipTo.country)}
        </div>
      </div>
      <p style="font-size: 14px; line-height: 1.6;"><strong>Pay the seller:</strong> <a href="mailto:${escapeHtml(c.sellerEmail)}" style="color: ${ORANGE};">${escapeHtml(c.sellerEmail)}</a> will reach out about payment via their preferred method (Venmo, PayPal, Zelle, etc.).</p>
      <p style="font-size: 13px; color: ${INK_MUTE}; line-height: 1.6;">Track your order at <a href="https://sports-collective.com/purchases" style="color: ${ORANGE};">sports-collective.com/purchases</a>.</p>
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

// POST /api/purchase/bulk
// Body: { purchaseIds: string[] }
// Sends a single combined invoice email to buyer + seller for an N-card cart.
// Validates that every purchase shares the same buyer + seller (single-seller
// cart constraint enforced on the client; double-checked here).
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

  const body = await req.json().catch(() => ({}))
  const purchaseIds: unknown = body.purchaseIds
  if (!Array.isArray(purchaseIds) || purchaseIds.length === 0) {
    return NextResponse.json({ error: 'Missing purchaseIds' }, { status: 400 })
  }
  if (purchaseIds.length > 50) {
    return NextResponse.json({ error: 'Too many items' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: purchases, error } = await admin
    .from('purchases')
    .select('*, listing:listings(title)')
    .in('id', purchaseIds as string[])

  if (error || !purchases || purchases.length === 0) {
    return NextResponse.json({ error: 'Purchases not found' }, { status: 404 })
  }

  // Single buyer / single seller — required for a combined invoice.
  const buyerIds = new Set(purchases.map(p => p.buyer_id))
  const sellerIds = new Set(purchases.map(p => p.seller_id))
  if (buyerIds.size !== 1 || sellerIds.size !== 1) {
    return NextResponse.json({ error: 'Mixed buyers/sellers in a single cart are not supported' }, { status: 400 })
  }
  const buyerId = [...buyerIds][0]
  const sellerId = [...sellerIds][0]

  // Caller must be the buyer or the seller — same auth posture as /api/purchase.
  if (user.id !== buyerId && user.id !== sellerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, email, display_name, handle')
    .in('user_id', [buyerId, sellerId])

  const buyer = profiles?.find(p => p.user_id === buyerId)
  const seller = profiles?.find(p => p.user_id === sellerId)
  if (!buyer?.email || !seller?.email) {
    return NextResponse.json({ error: 'Cannot resolve emails' }, { status: 500 })
  }

  // Combined shipping is recorded entirely on the first row of the cart and
  // 0 on the rest, so the cart total is just the SUM of shipping_cost across
  // rows. (Earlier carts that wrote the same value to every row are no longer
  // produced — the bulk-checkout client always splits this way now.)
  const shippingCost = purchases.reduce((s, p) => s + (Number(p.shipping_cost) || 0), 0)
  const shippingLabel = purchases[0].shipping_label || 'Shipping'
  const subtotal = purchases.reduce((s, p) => s + Number(p.item_price || 0), 0)
  const total = subtotal + shippingCost

  // Ship-to is identical across rows in a cart — pull from the first row.
  const first = purchases[0]
  const ctx: BulkContext = {
    lines: purchases.map(p => ({
      title: p.listing?.title || 'Sports Collective listing',
      itemPrice: Number(p.item_price),
    })),
    subtotal,
    shippingLabel,
    shippingCost,
    total,
    buyerName: buyer.display_name || buyer.handle || buyer.email.split('@')[0],
    buyerEmail: buyer.email,
    sellerName: seller.display_name || seller.handle || seller.email.split('@')[0],
    sellerEmail: seller.email,
    shipTo: {
      name: first.ship_to_name,
      address1: first.ship_to_address1,
      address2: first.ship_to_address2,
      city: first.ship_to_city,
      state: first.ship_to_state,
      zip: first.ship_to_zip,
      country: first.ship_to_country,
    },
  }

  const subject = `Order: ${ctx.lines.length} card${ctx.lines.length === 1 ? '' : 's'}`
  const [sellerRes, buyerRes] = await Promise.all([
    sendEmail(seller.email, `You sold ${ctx.lines.length} card${ctx.lines.length === 1 ? '' : 's'}`, sellerEmailHtml(ctx)),
    sendEmail(buyer.email, `Order confirmed — ${ctx.lines.length} card${ctx.lines.length === 1 ? '' : 's'}`, buyerEmailHtml(ctx)),
  ])
  console.log('Bulk purchase email — seller:', JSON.stringify(sellerRes))
  console.log('Bulk purchase email — buyer:', JSON.stringify(buyerRes))

  return NextResponse.json({ ok: true, count: purchases.length, total })
}
