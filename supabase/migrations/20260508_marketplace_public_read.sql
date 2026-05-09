-- Marketplace: let approved members read every active listing, not just their own.
--
-- The marketplace page queries `from('listings').select(...).eq('status','active')`
-- without applying any per-user filter. Without an RLS policy that exposes other
-- users' active listings, every marketplace request returns an empty list for
-- anyone who isn't the seller. This adds the missing read policy.
--
-- Existing per-owner policies (insert / update / delete on own listings) are not
-- modified — sellers continue to have full control over their inventory.

DROP POLICY IF EXISTS "marketplace read active listings" ON public.listings;

CREATE POLICY "marketplace read active listings"
  ON public.listings
  FOR SELECT
  TO authenticated
  USING (status = 'active' AND COALESCE(asking_price, 0) > 0);
