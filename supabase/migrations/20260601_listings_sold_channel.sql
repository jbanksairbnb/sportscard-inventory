-- Mirror FB sale outcomes onto listings.
--
-- When a card sells through a Facebook auction or claim sale, the listing was
-- only flipped to status='sold' — the selling price, the channel (auction vs
-- claim), and the claimed-vs-paid state lived solely in the FB tables. This
-- adds two columns so My Listings can show the sale channel and bucket the card
-- as Claimed (committed, unpaid) vs Sold (paid) the same way marketplace orders
-- do, and so `sold_price` reflects the actual FB sale amount.
--
--   sold_channel — 'marketplace' | 'auction' | 'claim' (null = not sold here)
--   sold_state   — 'claimed' | 'sold' (null when not applicable)
--
-- `sold_price` already exists; FB syncs now populate it.

alter table public.listings
  add column if not exists sold_channel text,
  add column if not exists sold_state   text;

-- ── Backfill existing FB-sold listings ─────────────────────────────────────
-- Auction lots: winner chosen → Claimed, paid → Sold. Price = current_bid.
-- A committed auction's still-open lot stays Claimed with whatever bid exists.
update public.listings l
set sold_channel = 'auction',
    sold_state   = case when lot.status = 'paid' then 'sold' else 'claimed' end,
    sold_price   = coalesce(l.sold_price, lot.current_bid)
from public.fb_auction_lots lot
where lot.listing_id = l.id
  and l.status = 'sold'
  and l.sold_channel is null
  and lot.status in ('sold', 'paid');

-- Claim items: claimed/sold → Claimed, paid → Sold. Price = item price.
update public.listings l
set sold_channel = 'claim',
    sold_state   = case when it.claim_status = 'paid' then 'sold' else 'claimed' end,
    sold_price   = coalesce(l.sold_price, it.price)
from public.fb_claim_sale_items it
where it.listing_id = l.id
  and l.status = 'sold'
  and l.sold_channel is null
  and it.claim_status in ('claimed', 'sold', 'paid');

-- Everything else that's sold but wasn't matched above came through the
-- marketplace (it has a linked purchase). Tag it so metrics + the badge can
-- tell channels apart; state is left null (the order drives those buckets).
update public.listings
set sold_channel = 'marketplace'
where status = 'sold'
  and sold_channel is null;
