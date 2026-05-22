-- Set "purpose" — a soft classification a seller chooses to keep
-- personal-collection sets visually separate from sets they intend to
-- sell. Default is 'personal' so existing data needs no migration.
--
-- Possible values (validated at the app layer, not the DB):
--   personal   — personal collection (default)
--   inventory  — building to sell later
--   for-sale   — actively listed as a complete set on the marketplace
--                (the app flips this automatically when a complete-set
--                listing is published / unpublished, but seller can
--                override)

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'personal';
