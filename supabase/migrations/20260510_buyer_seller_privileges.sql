-- Buyer vs seller privileges.
--
-- Adds two columns to user_profiles:
--   can_sell      — admin-controlled flag that grants access to seller tools.
--   wants_to_sell — set by the user on /apply, surfaces their intent to the
--                   admin during the approval review.
--
-- Backfill: every currently approved user keeps selling access so we don't
-- strip privileges from anyone in the pilot. New applicants default to
-- can_sell=false; the admin must opt them in.
--
-- Hard guardrail: RESTRICTIVE RLS policies on every writeable seller table
-- require can_sell=true (or is_admin=true) for INSERT/UPDATE/DELETE. These
-- stack on top of any existing per-owner permissive policies — they don't
-- replace anything, only narrow it. SELECT is left untouched so buyer-only
-- users can still read public marketplace data.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_sell BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wants_to_sell BOOLEAN NOT NULL DEFAULT false;

UPDATE public.user_profiles
  SET can_sell = true
  WHERE application_status = 'approved'
    AND can_sell = false;

-- Helper: is the calling user allowed to operate on seller tables?
-- Used by every restrictive policy below. SECURITY DEFINER so the function
-- can read user_profiles even when the caller's RLS would block it (the
-- target is the caller's own row anyway).
CREATE OR REPLACE FUNCTION public.is_seller()
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT can_sell OR is_admin
       FROM public.user_profiles
      WHERE user_id = auth.uid()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_seller() TO authenticated;

-- ── Seller-only writes ────────────────────────────────────────────────────
-- One pair of RESTRICTIVE policies per writeable seller table. Each policy
-- targets a single command (INSERT / UPDATE / DELETE) so we can name them
-- descriptively. A RESTRICTIVE policy must be satisfied IN ADDITION to the
-- existing permissive ones, so we're only adding a guard, not replacing
-- ownership checks.

-- listings
DROP POLICY IF EXISTS listings_seller_only_insert ON public.listings;
CREATE POLICY listings_seller_only_insert ON public.listings
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS listings_seller_only_update ON public.listings;
CREATE POLICY listings_seller_only_update ON public.listings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_seller())
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS listings_seller_only_delete ON public.listings;
CREATE POLICY listings_seller_only_delete ON public.listings
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_seller());

-- fb_auctions and child tables (lots, templates, bidder activity)
DROP POLICY IF EXISTS fb_auctions_seller_only_insert ON public.fb_auctions;
CREATE POLICY fb_auctions_seller_only_insert ON public.fb_auctions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_auctions_seller_only_update ON public.fb_auctions;
CREATE POLICY fb_auctions_seller_only_update ON public.fb_auctions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_seller())
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_auctions_seller_only_delete ON public.fb_auctions;
CREATE POLICY fb_auctions_seller_only_delete ON public.fb_auctions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_seller());

DROP POLICY IF EXISTS fb_auction_lots_seller_only_insert ON public.fb_auction_lots;
CREATE POLICY fb_auction_lots_seller_only_insert ON public.fb_auction_lots
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_auction_lots_seller_only_update ON public.fb_auction_lots;
CREATE POLICY fb_auction_lots_seller_only_update ON public.fb_auction_lots
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_seller())
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_auction_lots_seller_only_delete ON public.fb_auction_lots;
CREATE POLICY fb_auction_lots_seller_only_delete ON public.fb_auction_lots
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_seller());

DROP POLICY IF EXISTS fb_auction_templates_seller_only_insert ON public.fb_auction_templates;
CREATE POLICY fb_auction_templates_seller_only_insert ON public.fb_auction_templates
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_auction_templates_seller_only_update ON public.fb_auction_templates;
CREATE POLICY fb_auction_templates_seller_only_update ON public.fb_auction_templates
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_seller())
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_auction_templates_seller_only_delete ON public.fb_auction_templates;
CREATE POLICY fb_auction_templates_seller_only_delete ON public.fb_auction_templates
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_seller());

-- fb_claim_sales and child tables
DROP POLICY IF EXISTS fb_claim_sales_seller_only_insert ON public.fb_claim_sales;
CREATE POLICY fb_claim_sales_seller_only_insert ON public.fb_claim_sales
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sales_seller_only_update ON public.fb_claim_sales;
CREATE POLICY fb_claim_sales_seller_only_update ON public.fb_claim_sales
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_seller())
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sales_seller_only_delete ON public.fb_claim_sales;
CREATE POLICY fb_claim_sales_seller_only_delete ON public.fb_claim_sales
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sale_lots_seller_only_insert ON public.fb_claim_sale_lots;
CREATE POLICY fb_claim_sale_lots_seller_only_insert ON public.fb_claim_sale_lots
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sale_lots_seller_only_update ON public.fb_claim_sale_lots;
CREATE POLICY fb_claim_sale_lots_seller_only_update ON public.fb_claim_sale_lots
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_seller())
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sale_lots_seller_only_delete ON public.fb_claim_sale_lots;
CREATE POLICY fb_claim_sale_lots_seller_only_delete ON public.fb_claim_sale_lots
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sale_items_seller_only_insert ON public.fb_claim_sale_items;
CREATE POLICY fb_claim_sale_items_seller_only_insert ON public.fb_claim_sale_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sale_items_seller_only_update ON public.fb_claim_sale_items;
CREATE POLICY fb_claim_sale_items_seller_only_update ON public.fb_claim_sale_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_seller())
  WITH CHECK (public.is_seller());

DROP POLICY IF EXISTS fb_claim_sale_items_seller_only_delete ON public.fb_claim_sale_items;
CREATE POLICY fb_claim_sale_items_seller_only_delete ON public.fb_claim_sale_items
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_seller());
