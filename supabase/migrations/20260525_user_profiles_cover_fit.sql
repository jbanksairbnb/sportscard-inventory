-- user_profiles.cover_fit — controls object-fit behavior for the cover
-- banner. 'cover' (default) crops to fill the container; 'contain'
-- shows the entire image with letterbox bars. Per-user preference set
-- from the Adjust cover toolbar.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS cover_fit TEXT NOT NULL DEFAULT 'cover'
    CHECK (cover_fit IN ('cover', 'contain'));
