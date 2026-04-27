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

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n)
}

type EmailContext = {
  listingTitle: string
  itemPrice: number
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

function sellerEmailHtml(c: EmailContext) {
  const a2 = c.shipTo.address2 ? `<br/>${escapeHtml(c.shipTo.address2)}` : ''
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 22px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 28px;">You Made a Sale!</h1>
      </div>
      <p style="font-size: 15px; line-height: 1.6;"><strong>${escapeHtml(c.buyerName)}</strong> just bought <strong>${escapeHtml(c.listingTitle)}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: ${INK_MUTE};">Item</td><td style="padding: 6px 0; text-align: right;">${fmtMoney(c.itemPrice)}</td></tr>
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
      <p style="font-size: 13px; color: ${INK_MUTE}; line-height: 1.6;">Coordinate payment via your preferred method. Once paid, mark the sale as paid in your <a href="https://sports-collective.com/listings" style="color: ${ORANGE};">My Listings</a> page. Then ship the card and add tracking when available.</p>
      <hr style="border: none; border-top: 1px solid ${RULE}; margin: 24px 0 14px;" />
      <p style="font-size: 11px; color: ${INK_MUTE}; text-align: center; margin: 0;">Questions? <a href="mailto:jbanks@sports-collective.com" style="color: ${ORANGE};">jbanks@sports-collective.com</a></p>
    </div>
  `
}

function buyerEmailHtml(c: EmailContext) {
  const a2 = c.shipTo.address2 ? `<br/>${escapeHtml(c.shipTo.address2)}` : ''
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: ${PLUM}; background: ${CREAM}; padding: 32px 28px; border: 2px solid ${PLUM}; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 22px;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: ${ORANGE}; font-weight: 700; margin-bottom: 6px;">★ SPORTS COLLECTIVE ★</div>
        <h1 style="margin: 0; color: ${PLUM}; font-size: 28px;">Order Confirmed</h1>
      </div>
      <p style="font-size: 15px; line-height: 1.6;">Your purchase of <strong>${escapeHtml(c.listingTitle)}</strong> from <strong>${escapeHtml(c.sellerName)}</strong> is reserved.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: ${INK_MUTE};">Item</td><td style="padding: 6px 0; text-align: right;">${fmtMoney(c.itemPrice)}</td></tr>
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
      <p style="font-size: 13px; color: ${INK_MUTE}; line-height: 1.6;">Track your order at <a href="https://sports-collective.com/purchases" style="color: ${ORANGE};">sports-collective.com/purchases</a> once that page is live.</p>
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

  const { purchaseId } = await req.json()
  if (!purchaseId) return NextResponse.json({ error: 'Missing purchaseId' }, { status: 400 })

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
  if (user.id !== purchase.buyer_id && user.id !== purchase.seller_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, email, display_name, handle')
    .in('user_id', [purchase.buyer_id, purchase.seller_id])

  const buyer = profiles?.find(p => p.user_id === purchase.buyer_id)
  const seller = profiles?.find(p => p.user_id === purchase.seller_id)
  if (!buyer?.email || !seller?.email) {
    return NextResponse.json({ error: 'Cannot resolve emails' }, { status: 500 })
  }

  const ctx: EmailContext = {
    listingTitle: purchase.listing?.title || 'Sports Collective listing',
    itemPrice: Number(purchase.item_price),
    shippingLabel: purchase.shipping_label,
    shippingCost: Number(purchase.shipping_cost),
    total: Number(purchase.total),
    buyerName: buyer.display_name || buyer.handle || buyer.email.split('@')[0],
    buyerEmail: buyer.email,
    sellerName: seller.display_name || seller.handle || seller.email.split('@')[0],
    sellerEmail: seller.email,
    shipTo: {
      name: purchase.ship_to_name,
      address1: purchase.ship_to_address1,
      address2: purchase.ship_to_address2,
      city: purchase.ship_to_city,
      state: purchase.ship_to_state,
      zip: purchase.ship_to_zip,
      country: purchase.ship_to_country,
    },
  }

  const [sellerRes, buyerRes] = await Promise.all([
    sendEmail(seller.email, `You sold: ${ctx.listingTitle}`, sellerEmailHtml(ctx)),
    sendEmail(buyer.email, `Order confirmed: ${ctx.listingTitle}`, buyerEmailHtml(ctx)),
  ])
  console.log('Purchase email — seller:', JSON.stringify(sellerRes))
  console.log('Purchase email — buyer:', JSON.stringify(buyerRes))

  return NextResponse.json({ ok: true })
}
