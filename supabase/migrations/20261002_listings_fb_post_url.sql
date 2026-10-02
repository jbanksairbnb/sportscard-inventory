-- Optional Facebook post link a seller can attach directly to a listing.
-- Shown as the "View & bid on Facebook" button on the public listing page
-- (/l/<id>). When set it wins over links saved on auctions / claim sales.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS fb_post_url TEXT;
