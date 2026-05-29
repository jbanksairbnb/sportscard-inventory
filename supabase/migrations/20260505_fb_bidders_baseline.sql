-- Baseline schema for the FB-auction bidder tables.
--
-- `fb_bidders` and `fb_bidder_activity` were originally created directly in the
-- database ("Phase A SQL") rather than through tracked migrations, so the repo
-- never described them — which is how fb_bidders.updated_at went missing in some
-- environments. This migration reconciles that drift: it asserts the full schema
-- the application relies on (every column, index, the upsert's unique key, the
-- updated_at trigger, and RLS policies).
--
-- It is fully idempotent and non-destructive — safe to run against a database
-- that already has these tables (existing columns/data are left untouched) and
-- on a fresh database. It is dated before 20260506_fb_auction_bid_events.sql,
-- which foreign-keys fb_bidders, so a from-scratch run resolves in order.

-- ---------------------------------------------------------------------------
-- fb_bidders — a seller's saved bidder/buyer profiles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fb_bidders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  fb_handle text,
  member_user_id uuid,          -- links this bidder to a member account, if known
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Self-heal deployments that predate any of these columns.
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS member_user_id uuid;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS ix_fb_bidders_user ON fb_bidders(user_id);

-- Keep updated_at current even if a code path forgets to set it.
CREATE OR REPLACE FUNCTION set_fb_bidders_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fb_bidders_updated_at ON fb_bidders;
CREATE TRIGGER trg_fb_bidders_updated_at
  BEFORE UPDATE ON fb_bidders
  FOR EACH ROW
  EXECUTE FUNCTION set_fb_bidders_updated_at();

ALTER TABLE fb_bidders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fb_bidders_owner_select" ON fb_bidders;
CREATE POLICY "fb_bidders_owner_select" ON fb_bidders
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "fb_bidders_owner_insert" ON fb_bidders;
CREATE POLICY "fb_bidders_owner_insert" ON fb_bidders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "fb_bidders_owner_update" ON fb_bidders;
CREATE POLICY "fb_bidders_owner_update" ON fb_bidders
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "fb_bidders_owner_delete" ON fb_bidders;
CREATE POLICY "fb_bidders_owner_delete" ON fb_bidders
  FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- fb_bidder_activity — one row per (lot, bidder), upserted as bids/settlement
-- change. Drives the per-bidder rollups on the Bidders pages.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fb_bidder_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bidder_id uuid NOT NULL,
  auction_id uuid,
  lot_id uuid NOT NULL,
  bid_amount numeric,
  is_winner boolean NOT NULL DEFAULT false,
  is_paid boolean NOT NULL DEFAULT false,
  listing_year int,
  listing_brand text,
  listing_player text,
  listing_card_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Self-heal deployments that predate any of these columns.
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS auction_id uuid;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS bid_amount numeric;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS is_winner boolean NOT NULL DEFAULT false;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS listing_year int;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS listing_brand text;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS listing_player text;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS listing_card_number text;
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE fb_bidder_activity ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The app upserts on (lot_id, bidder_id) — this unique index backs that ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fb_bidder_activity_lot_bidder
  ON fb_bidder_activity(lot_id, bidder_id);
CREATE INDEX IF NOT EXISTS ix_fb_bidder_activity_user ON fb_bidder_activity(user_id);
CREATE INDEX IF NOT EXISTS ix_fb_bidder_activity_bidder ON fb_bidder_activity(bidder_id);
CREATE INDEX IF NOT EXISTS ix_fb_bidder_activity_auction ON fb_bidder_activity(auction_id);

-- Foreign keys, added only when the parent table exists and the constraint is
-- absent. This keeps the migration safe on databases where the auction tables
-- were themselves created out-of-band, while still wiring up referential
-- integrity (and cascading deletes) wherever the parents are present.
DO $$
BEGIN
  IF to_regclass('public.fb_bidders') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_bidder_activity_bidder_id_fkey') THEN
    ALTER TABLE fb_bidder_activity
      ADD CONSTRAINT fb_bidder_activity_bidder_id_fkey
      FOREIGN KEY (bidder_id) REFERENCES fb_bidders(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.fb_auctions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_bidder_activity_auction_id_fkey') THEN
    ALTER TABLE fb_bidder_activity
      ADD CONSTRAINT fb_bidder_activity_auction_id_fkey
      FOREIGN KEY (auction_id) REFERENCES fb_auctions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.fb_auction_lots') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_bidder_activity_lot_id_fkey') THEN
    ALTER TABLE fb_bidder_activity
      ADD CONSTRAINT fb_bidder_activity_lot_id_fkey
      FOREIGN KEY (lot_id) REFERENCES fb_auction_lots(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE fb_bidder_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fb_bidder_activity_owner_select" ON fb_bidder_activity;
CREATE POLICY "fb_bidder_activity_owner_select" ON fb_bidder_activity
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "fb_bidder_activity_owner_insert" ON fb_bidder_activity;
CREATE POLICY "fb_bidder_activity_owner_insert" ON fb_bidder_activity
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE policy is required for the (lot_id, bidder_id) upsert's conflict path.
DROP POLICY IF EXISTS "fb_bidder_activity_owner_update" ON fb_bidder_activity;
CREATE POLICY "fb_bidder_activity_owner_update" ON fb_bidder_activity
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "fb_bidder_activity_owner_delete" ON fb_bidder_activity;
CREATE POLICY "fb_bidder_activity_owner_delete" ON fb_bidder_activity
  FOR DELETE USING (auth.uid() = user_id);
