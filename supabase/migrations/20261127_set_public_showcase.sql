-- Public set showcase: a shareable, read-only "for sale" page per set at
-- /seller/<handle>/set/<slug>, reachable without signing in (linked from
-- Facebook posts). Everything here is opt-in per set via public_enabled.
--
-- The public page is rendered server-side with the service role and only
-- emits a whitelisted subset of each card row (number, player, grade, value,
-- images) — never cost, purchase dates or other private columns.

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS public_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS asking_price      numeric,
  ADD COLUMN IF NOT EXISTS accept_offers     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_offer         numeric,
  -- When false, the public "rest of the set" grid hides per-card values. The
  -- set total, gainers/decliners and the top 16 still show values.
  ADD COLUMN IF NOT EXISTS show_card_values  boolean NOT NULL DEFAULT true,
  -- [{ "card": "184", "note": "Hall of Famer, centered" }, ...]
  ADD COLUMN IF NOT EXISTS key_cards         jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS condition_notes   text,
  ADD COLUMN IF NOT EXISTS sale_terms        text;

-- Offers made by public visitors on a set's showcase page. Inserted only by
-- the /api/set-offers route (service role) after it checks the set is public,
-- accepts offers, and the amount meets min_offer. The set owner reads and
-- updates status through RLS.
CREATE TABLE IF NOT EXISTS public.set_offers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL,
  set_slug       text NOT NULL,
  set_title      text,
  amount         numeric NOT NULL CHECK (amount > 0),
  buyer_name     text NOT NULL,
  buyer_contact  text NOT NULL,
  message        text,
  status         text NOT NULL DEFAULT 'new',  -- new | accepted | declined
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS set_offers_owner_slug_idx
  ON public.set_offers (owner_user_id, set_slug, created_at DESC);

ALTER TABLE public.set_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "set_offers_owner_select" ON public.set_offers;
CREATE POLICY "set_offers_owner_select" ON public.set_offers
  FOR SELECT USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "set_offers_owner_update" ON public.set_offers;
CREATE POLICY "set_offers_owner_update" ON public.set_offers
  FOR UPDATE USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
