-- Per-row identity for listing/set linkage.
--
-- listings.source_row_id stores the stable _id of the set row a listing
-- came from. Without it we can only key off (source_set_slug, source_card_number),
-- which collapses duplicate-card rows (e.g. two graded Brosnan #2's) into
-- the same source — flipping Owned on one flips all matching rows.
--
-- source_set_slug + source_card_number stay populated for backward compat
-- (older listings still work; new linkage uses source_row_id).

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS source_row_id TEXT;
