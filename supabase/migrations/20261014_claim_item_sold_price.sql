-- Actual sale price for a claim-sale item.
--
-- `price` is the price the card was listed at; buyers often negotiate, so the
-- amount actually paid can differ. `sold_price` records that amount. It is
-- nullable: null means "sold at the listed price", so existing rows and the
-- normal no-haggle sale need no data. Everything that totals or invoices a
-- claim item should read coalesce(sold_price, price).

alter table public.fb_claim_sale_items
  add column if not exists sold_price numeric;
