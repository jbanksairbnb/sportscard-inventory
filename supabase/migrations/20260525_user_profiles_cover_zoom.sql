-- user_profiles.cover_zoom — multiplier applied to the cover banner
-- on top of object-fit:cover. 1.0 = identical to current "cover"
-- behavior (default), >1.0 zooms in, <1.0 zooms out. UI clamps to a
-- sensible range (e.g. 0.5–3.0) but the column itself is open-ended.
--
-- Default 1.0 means existing covers render unchanged after the
-- migration runs.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS cover_zoom NUMERIC NOT NULL DEFAULT 1.0;
