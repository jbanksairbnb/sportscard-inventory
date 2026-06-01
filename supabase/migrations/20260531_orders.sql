-- Orders: group multiple purchased cards into a single invoice.
--
-- Until now every sold card lived as its own row in `purchases` with no link
-- to its siblings — a 5-card cart created 5 unrelated rows. This migration adds
-- an `orders` header that ties those rows together so we can render one invoice
-- per order and bucket sold cards by Claimed (unpaid) / Sold (paid) /
-- Shipped (shipped|completed).
--
-- The order header carries the shared ship-to address, shipping, totals, and
-- the order-level lifecycle (status / paid_at / shipped_at / tracking /
-- payment_method). Per-card `purchases` rows still hold their own status so the
-- existing single-card flows keep working; the order status is kept in sync as
-- the aggregate of its line items.

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null,
  seller_id       uuid not null,
  status          text not null default 'unpaid',
  -- shared shipping destination (identical across every card in the order)
  ship_to_name     text,
  ship_to_address1 text,
  ship_to_address2 text,
  ship_to_city     text,
  ship_to_state    text,
  ship_to_zip      text,
  ship_to_country  text,
  -- money + fulfilment, rolled up across the line items
  shipping_label  text,
  shipping_cost   numeric not null default 0,
  subtotal        numeric not null default 0,
  total           numeric not null default 0,
  payment_method  text,
  paid_at         timestamptz,
  shipped_at      timestamptz,
  tracking_number text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_orders_buyer  on public.orders(buyer_id);
create index if not exists idx_orders_seller on public.orders(seller_id);

-- Link each purchased card to its order (nullable: legacy rows are backfilled
-- below, and a deleted order shouldn't cascade-delete sale history).
alter table public.purchases
  add column if not exists order_id uuid references public.orders(id) on delete set null;

create index if not exists idx_purchases_order_id on public.purchases(order_id);

-- ── Backfill existing sold cards into orders ───────────────────────────────
-- Cards bought together share an identical ship-to address and were written in
-- the same checkout loop (within the same minute). Group on
-- buyer + seller + ship-to + the minute they were created, roll the line items
-- up into one order header, then stamp every member row with the new order_id.
-- The order's created_at is set to the group's earliest row so the minute-level
-- join back to the purchases holds.
with groups as (
  select
    buyer_id,
    seller_id,
    ship_to_name,
    ship_to_address1,
    ship_to_zip,
    date_trunc('minute', created_at)                          as bucket,
    min(created_at)                                            as created_at,
    (array_agg(ship_to_address2 order by created_at))[1]      as ship_to_address2,
    (array_agg(ship_to_city     order by created_at))[1]      as ship_to_city,
    (array_agg(ship_to_state    order by created_at))[1]      as ship_to_state,
    (array_agg(ship_to_country  order by created_at))[1]      as ship_to_country,
    (array_agg(shipping_label order by shipping_cost desc))[1] as shipping_label,
    sum(shipping_cost)                                        as shipping_cost,
    sum(item_price)                                           as subtotal,
    sum(total)                                                as total,
    max(payment_method)                                       as payment_method,
    max(paid_at)                                              as paid_at,
    max(shipped_at)                                           as shipped_at,
    max(tracking_number)                                      as tracking_number,
    case
      when bool_or(status = 'unpaid')    then 'unpaid'
      when bool_or(status = 'paid')      then 'paid'
      when bool_or(status = 'shipped')   then 'shipped'
      when bool_and(status = 'cancelled') then 'cancelled'
      else 'completed'
    end                                                       as status
  from public.purchases
  where order_id is null
  group by buyer_id, seller_id, ship_to_name, ship_to_address1, ship_to_zip, date_trunc('minute', created_at)
),
inserted as (
  insert into public.orders (
    buyer_id, seller_id, status,
    ship_to_name, ship_to_address1, ship_to_address2, ship_to_city, ship_to_state, ship_to_zip, ship_to_country,
    shipping_label, shipping_cost, subtotal, total,
    payment_method, paid_at, shipped_at, tracking_number, created_at
  )
  select
    buyer_id, seller_id, status,
    ship_to_name, ship_to_address1, ship_to_address2, ship_to_city, ship_to_state, ship_to_zip, ship_to_country,
    shipping_label, shipping_cost, subtotal, total,
    payment_method, paid_at, shipped_at, tracking_number, created_at
  from groups
  returning id, buyer_id, seller_id, ship_to_name, ship_to_address1, ship_to_zip, created_at
)
update public.purchases p
set order_id = i.id
from inserted i
where p.order_id is null
  and p.buyer_id = i.buyer_id
  and p.seller_id = i.seller_id
  and p.ship_to_name = i.ship_to_name
  and p.ship_to_address1 = i.ship_to_address1
  and p.ship_to_zip = i.ship_to_zip
  and date_trunc('minute', p.created_at) = date_trunc('minute', i.created_at);

-- ── Row-level security ─────────────────────────────────────────────────────
-- Mirror the purchases posture: a user can read the orders they're the buyer or
-- seller on. All writes go through server routes using the service-role key
-- (which bypasses RLS), so there are no client-facing write policies.
alter table public.orders enable row level security;

drop policy if exists orders_select_party on public.orders;
create policy orders_select_party on public.orders
  for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);
