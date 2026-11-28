-- Small image shown to the right of the set's title on its public showcase
-- page: either an uploaded photo or one of the set's own card images.
ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS title_image text;
