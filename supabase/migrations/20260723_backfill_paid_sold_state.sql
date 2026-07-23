-- Backfill: paid FB sales that got stranded in the Claimed bucket.
--
-- My Listings buckets a sold card as Claimed (won/committed, unpaid) vs Sold
-- (paid) from the listing's mirrored `sold_state`. That mirror is written by the
-- FB sync helpers whenever a lot/item changes state. One path missed it: the
-- auction "Mark all sold (paid)" bulk action flipped lots to 'paid' without
-- re-running the listing sync, so those listings kept sold_state='claimed' and
-- stayed in Claimed even though the auction shows them as SOLD. The code path is
-- fixed to sync going forward; this reconciles the rows that already drifted.
--
-- Forward-only and idempotent: it only promotes 'claimed' → 'sold' where the
-- underlying lot/item is actually paid, and never demotes.

-- Auction lots marked paid → listing belongs in Sold.
update public.listings l
set sold_state = 'sold'
from public.fb_auction_lots lot
where lot.listing_id = l.id
  and lot.status = 'paid'
  and l.status = 'sold'
  and l.sold_channel = 'auction'
  and l.sold_state is distinct from 'sold';

-- Claim items marked paid → listing belongs in Sold. The claim bulk path
-- already syncs correctly, but this reconciles any historical drift too.
update public.listings l
set sold_state = 'sold'
from public.fb_claim_sale_items it
where it.listing_id = l.id
  and it.claim_status = 'paid'
  and l.status = 'sold'
  and l.sold_channel = 'claim'
  and l.sold_state is distinct from 'sold';
