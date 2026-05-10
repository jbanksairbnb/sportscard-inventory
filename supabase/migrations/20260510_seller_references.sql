-- Seller application revamp: capture structured references.
--
-- The /apply form now requires 5 references (collector names + how to
-- reach them) in addition to FB groups. Stored as TEXT[] so we can render
-- each reference as its own row in /admin without parsing.
--
-- The legacy fb_groups column stays — it now holds the FB groups the
-- applicant is a member of, separate from the personal references.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS seller_references TEXT[];
