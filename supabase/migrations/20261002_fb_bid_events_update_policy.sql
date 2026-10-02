-- fb_auction_bid_events had SELECT / INSERT / DELETE policies but no UPDATE
-- policy. With RLS enabled that makes every UPDATE affect zero rows WITHOUT
-- raising an error, so logBidEvent's "fill in the bidder on the amount-only
-- row" step silently did nothing. Result: bids stayed unattributed (or kept the
-- previous bidder's name), the first bidder went missing, and bidder bid counts
-- came out low.
DROP POLICY IF EXISTS "fb_auction_bid_events_owner_update" ON fb_auction_bid_events;
CREATE POLICY "fb_auction_bid_events_owner_update"
  ON fb_auction_bid_events FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
