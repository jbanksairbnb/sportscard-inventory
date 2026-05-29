-- Bidder profiles (fb_bidders) gained contact/address fields and an edit
-- timestamp over time, but those columns were applied directly to the database
-- rather than through a tracked migration. Saving a bidder profile writes
-- `updated_at`, which fails with "Could not find the 'updated_at' column of
-- 'fb_bidders' in the schema cache" on any environment missing it.
--
-- This migration is idempotent: it (re)asserts every profile column the app
-- reads/writes so the schema matches the code regardless of how far a given
-- database has drifted. Existing data and columns are left untouched.

ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE fb_bidders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Keep updated_at accurate even if a future code path forgets to set it.
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
