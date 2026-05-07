-- Historical transactions: prior-to-Sports-Collective sales data the seller
-- imports manually or via CSV. Same shape as live activity (bidder, card,
-- amount) so it merges into bidder profiles, metrics, and tag suggestions.

CREATE TABLE IF NOT EXISTS historical_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bidder_id uuid REFERENCES fb_bidders(id) ON DELETE SET NULL,
  bidder_name text NOT NULL,
  bidder_fb_handle text,
  occurred_at date,
  -- Card snapshot (no FK to listings — a historical sale may not have a
  -- corresponding active listing).
  year int,
  brand text,
  card_number text,
  player text,
  condition_note text,
  amount numeric,
  channel text CHECK (channel IS NULL OR channel IN ('fb_auction', 'fb_claim', 'other')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_historical_transactions_user
  ON historical_transactions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_historical_transactions_bidder
  ON historical_transactions(bidder_id);
CREATE INDEX IF NOT EXISTS ix_historical_transactions_player
  ON historical_transactions(user_id, lower(player));

ALTER TABLE historical_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "historical_transactions_owner_select" ON historical_transactions;
CREATE POLICY "historical_transactions_owner_select"
  ON historical_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "historical_transactions_owner_insert" ON historical_transactions;
CREATE POLICY "historical_transactions_owner_insert"
  ON historical_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "historical_transactions_owner_update" ON historical_transactions;
CREATE POLICY "historical_transactions_owner_update"
  ON historical_transactions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "historical_transactions_owner_delete" ON historical_transactions;
CREATE POLICY "historical_transactions_owner_delete"
  ON historical_transactions FOR DELETE
  USING (auth.uid() = user_id);
