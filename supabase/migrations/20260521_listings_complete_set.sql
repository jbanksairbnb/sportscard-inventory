-- Complete-set marketplace listings.
--
-- Sellers can now list an entire set as one marketplace item (one
-- price, one shipment, one purchase) instead of per-card listings.
-- listings.listing_type discriminates between 'card' (existing
-- behavior) and 'set'. listings.set_slug points to the source set
-- on the seller's shelf when type='set'.
--
-- All per-card fields (card_number, player, raw_grade, etc.) stay
-- nullable and unused for type='set' rows. Title, asking_price,
-- description, photos, shipping_options work the same way.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS set_slug TEXT;
