-- Historical transactions: add cost (for profit math) and group (FB group the
-- listing was sold in, so imports tie back to the same fb_groups list the rest
-- of the app uses).

ALTER TABLE historical_transactions
  ADD COLUMN IF NOT EXISTS cost numeric;

ALTER TABLE historical_transactions
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES fb_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_historical_transactions_group
  ON historical_transactions(user_id, group_id);
