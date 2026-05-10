-- Seller Terms & Conditions acceptance + full-name capture.
--
-- Adds two columns to user_profiles:
--   seller_terms_accepted_at — timestamp when the user clicked "I Agree" on
--     /seller-terms. Null = not accepted. Required for selling.
--   full_name — collected on the /apply seller application for accountability.
--
-- Existing sellers (anyone with can_sell=true at migration time) are
-- backfilled to NOW() so they don't get locked out of selling tools when
-- the new code deploys. This means for current users we're treating the
-- migration moment as implicit acceptance — appropriate for the pilot.
--
-- The is_seller() function now requires terms acceptance in addition to
-- can_sell. RESTRICTIVE RLS policies that key off is_seller() inherit the
-- new check automatically; no policy changes needed.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS seller_terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS full_name TEXT;

UPDATE public.user_profiles
  SET seller_terms_accepted_at = NOW()
  WHERE can_sell = true
    AND seller_terms_accepted_at IS NULL;

CREATE OR REPLACE FUNCTION public.is_seller()
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (can_sell AND seller_terms_accepted_at IS NOT NULL) OR is_admin
       FROM public.user_profiles
      WHERE user_id = auth.uid()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_seller() TO authenticated;
