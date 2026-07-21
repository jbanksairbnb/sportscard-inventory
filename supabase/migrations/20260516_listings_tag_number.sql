-- Inventory tag number. Free-form text the seller assigns to a listing so
-- they can find the physical card when it sells. Surfaced buyer-facing as
-- "Item #" (storefront + marketplace) and in the seller's own My Listings
-- view; hidden whenever the value is blank.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS tag_number TEXT;
