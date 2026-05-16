-- Inventory tag number. Free-form text the seller assigns to a listing so
-- they can find the physical card when it sells. Buyer-facing surfaces
-- never expose this; it's seller bookkeeping only.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS tag_number TEXT;
