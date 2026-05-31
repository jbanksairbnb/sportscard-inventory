import type { SupabaseClient } from '@supabase/supabase-js'

// Order lifecycle, kept in lockstep with the per-card `purchases.status` values.
export type OrderStatus = 'unpaid' | 'paid' | 'shipped' | 'completed' | 'cancelled'

// The slice of a `purchases` row this module needs. Numeric columns arrive as
// strings from PostgREST, so everything money-shaped is coerced with Number().
type PurchaseRow = {
  id: string
  order_id: string | null
  buyer_id: string
  seller_id: string
  item_price: number | string | null
  shipping_cost: number | string | null
  total: number | string | null
  shipping_label: string | null
  status: string
  ship_to_name: string | null
  ship_to_address1: string | null
  ship_to_address2: string | null
  ship_to_city: string | null
  ship_to_state: string | null
  ship_to_zip: string | null
  ship_to_country: string | null
  payment_method: string | null
  paid_at: string | null
  shipped_at: string | null
  tracking_number: string | null
  created_at: string
}

// Roll the per-card statuses up into a single order status. An order is only as
// far along as its least-progressed *active* (non-cancelled) line: it stays
// "unpaid" (Claimed) until every card is at least paid, "paid" (Sold) until
// every card has shipped, and so on. An order whose every line is cancelled is
// itself cancelled.
export function deriveOrderStatus(statuses: string[]): OrderStatus {
  const active = statuses.filter(s => s !== 'cancelled')
  if (active.length === 0) return 'cancelled'
  if (active.some(s => s === 'unpaid')) return 'unpaid'
  if (active.some(s => s === 'paid')) return 'paid'
  if (active.some(s => s === 'shipped')) return 'shipped'
  return 'completed'
}

// Build the order-header column values from its line items. Shipping is summed
// (the bulk checkout puts the full combined-shipping figure on the first row
// and 0 on the rest, so the sum is the true cart shipping), and the shared
// ship-to is taken from the first row since it is identical across the cart.
function headerFromRows(rows: PurchaseRow[]) {
  const first = rows[0]
  const subtotal = rows.reduce((s, r) => s + (Number(r.item_price) || 0), 0)
  const shipping = rows.reduce((s, r) => s + (Number(r.shipping_cost) || 0), 0)
  const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0)
  const shippingLabel =
    [...rows].sort((a, b) => (Number(b.shipping_cost) || 0) - (Number(a.shipping_cost) || 0))[0]
      ?.shipping_label || first.shipping_label

  const max = (vals: (string | null)[]) =>
    vals.filter((v): v is string => !!v).sort().at(-1) ?? null

  return {
    status: deriveOrderStatus(rows.map(r => r.status)),
    ship_to_name: first.ship_to_name,
    ship_to_address1: first.ship_to_address1,
    ship_to_address2: first.ship_to_address2,
    ship_to_city: first.ship_to_city,
    ship_to_state: first.ship_to_state,
    ship_to_zip: first.ship_to_zip,
    ship_to_country: first.ship_to_country,
    shipping_label: shippingLabel,
    shipping_cost: shipping,
    subtotal,
    total,
    payment_method: max(rows.map(r => r.payment_method)),
    paid_at: max(rows.map(r => r.paid_at)),
    shipped_at: max(rows.map(r => r.shipped_at)),
    tracking_number: max(rows.map(r => r.tracking_number)),
  }
}

// Ensure the given purchase rows all belong to a single order, creating the
// header if needed, and return the order id. Reuses an existing order_id if any
// of the rows already carry one (the single-card flow + a later add could both
// touch the same order). Requires every row to share one buyer and one seller.
// Pass an admin (service-role) client so the header insert/update bypasses RLS.
export async function ensureOrderForPurchases(
  admin: SupabaseClient,
  purchaseIds: string[],
): Promise<string | null> {
  if (purchaseIds.length === 0) return null

  const { data: rows, error } = await admin
    .from('purchases')
    .select('*')
    .in('id', purchaseIds)
    .order('created_at', { ascending: true })
  if (error || !rows || rows.length === 0) return null

  const buyerIds = new Set(rows.map((r: PurchaseRow) => r.buyer_id))
  const sellerIds = new Set(rows.map((r: PurchaseRow) => r.seller_id))
  if (buyerIds.size !== 1 || sellerIds.size !== 1) return null

  const existingOrderId = rows.find((r: PurchaseRow) => r.order_id)?.order_id ?? null
  const header = headerFromRows(rows as PurchaseRow[])

  let orderId = existingOrderId
  if (orderId) {
    await admin.from('orders').update(header).eq('id', orderId)
  } else {
    const { data: created, error: insErr } = await admin
      .from('orders')
      .insert({
        buyer_id: rows[0].buyer_id,
        seller_id: rows[0].seller_id,
        created_at: rows[0].created_at,
        ...header,
      })
      .select('id')
      .single()
    if (insErr || !created) return null
    orderId = created.id
  }

  await admin.from('purchases').update({ order_id: orderId }).in('id', purchaseIds)
  return orderId
}

// Re-derive an order header from its current line items. Call after a line
// item's status changes so the order's status/timestamps/totals stay accurate.
export async function recomputeOrder(admin: SupabaseClient, orderId: string): Promise<void> {
  const { data: rows } = await admin
    .from('purchases')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (!rows || rows.length === 0) return
  await admin.from('orders').update(headerFromRows(rows as PurchaseRow[])).eq('id', orderId)
}
