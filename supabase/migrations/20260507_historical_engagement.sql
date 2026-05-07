-- 20260507_historical_engagement.sql
-- Capture losing bidders and tag requests (FB "w" comments) in addition to
-- winning bids on historical_transactions.

ALTER TABLE historical_transactions
  ADD COLUMN IF NOT EXISTS engagement_type text NOT NULL DEFAULT 'won';

-- (Re-add constraint cleanly since older rows may exist with DEFAULT 'won'.)
ALTER TABLE historical_transactions
  DROP CONSTRAINT IF EXISTS historical_transactions_engagement_check;
ALTER TABLE historical_transactions
  ADD CONSTRAINT historical_transactions_engagement_check
  CHECK (engagement_type IN ('won', 'bid', 'tag_request'));

CREATE INDEX IF NOT EXISTS ix_historical_transactions_engagement
  ON historical_transactions(user_id, engagement_type);
