-- Normalize legacy "EX-MT" → "EXMT" raw_grade values written by the
-- AI grader before #131. The dropdowns + sets + scan flows all use
-- "EXMT" (no hyphen) as canonical; this migration brings older
-- AI-graded rows into alignment so the cell shows as selected when
-- the seller opens the edit dropdown.
--
-- listings table: simple column update.
-- sets table: rows is a JSONB array of card-row objects, each of which
--   may have a "Raw Grade" key. We rewrite only the affected rows.

-- 1) Listings
UPDATE public.listings
   SET raw_grade = 'EXMT'
 WHERE raw_grade = 'EX-MT';

-- 2) Sets — rewrite the "Raw Grade" key inside each row of the JSONB
-- array. We only touch sets whose JSON text contains the legacy value
-- so unaffected rows aren't rewritten.
UPDATE public.sets
   SET rows = (
     SELECT jsonb_agg(
       CASE
         WHEN row_elem->>'Raw Grade' = 'EX-MT'
           THEN row_elem || jsonb_build_object('Raw Grade', 'EXMT')
         ELSE row_elem
       END
     )
     FROM jsonb_array_elements(rows::jsonb) AS row_elem
   )
 WHERE rows::text LIKE '%"EX-MT"%';
