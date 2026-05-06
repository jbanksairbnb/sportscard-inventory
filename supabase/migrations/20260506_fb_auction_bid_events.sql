-- Track every FB auction bid change so we can compute # of bids and unique
-- bidders per lot/auction.

CREATE TABLE IF NOT EXISTS fb_auction_bid_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  auction_id uuid NOT NULL REFERENCES fb_auctions(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES fb_auction_lots(id) ON DELETE CASCADE,
  amount numeric,
  bidder_id uuid REFERENCES fb_bidders(id) ON DELETE SET NULL,
  bidder_name text,
  bidder_fb_handle text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fb_auction_bid_events_lot ON fb_auction_bid_events(lot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_fb_auction_bid_events_auction ON fb_auction_bid_events(auction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_fb_auction_bid_events_user ON fb_auction_bid_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_fb_auction_bid_events_bidder ON fb_auction_bid_events(bidder_id);

ALTER TABLE fb_auction_bid_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fb_auction_bid_events_owner_select" ON fb_auction_bid_events;
CREATE POLICY "fb_auction_bid_events_owner_select"
  ON fb_auction_bid_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "fb_auction_bid_events_owner_insert" ON fb_auction_bid_events;
CREATE POLICY "fb_auction_bid_events_owner_insert"
  ON fb_auction_bid_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "fb_auction_bid_events_owner_delete" ON fb_auction_bid_events;
CREATE POLICY "fb_auction_bid_events_owner_delete"
  ON fb_auction_bid_events FOR DELETE
  USING (auth.uid() = user_id);

-- Aggregate per lot. RLS on the underlying table restricts rows to the owner.
CREATE OR REPLACE VIEW fb_auction_lot_bid_stats AS
SELECT
  lot_id,
  auction_id,
  user_id,
  COUNT(*)::int AS bid_count,
  COUNT(DISTINCT COALESCE(bidder_id::text, lower(coalesce(bidder_name, ''))))::int AS unique_bidders,
  MAX(created_at) AS last_bid_at
FROM fb_auction_bid_events
GROUP BY lot_id, auction_id, user_id;
