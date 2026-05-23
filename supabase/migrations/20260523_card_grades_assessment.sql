-- card_grades.seller_assessment — directional rating from the
-- /admin/grader-accuracy dashboard. Values: 'correct' | 'too_high' |
-- 'too_low'. NULL = unrated. user_final_grade (already in the table)
-- captures the precise corrected grade when the seller bothers to enter
-- one; this column is the one-click directional version.
--
-- Together they drive prompt tuning and future few-shot anchoring:
--   - "correct" rows are anchor candidates
--   - "too_high"/"too_low" patterns reveal systematic bias

ALTER TABLE public.card_grades
  ADD COLUMN IF NOT EXISTS seller_assessment TEXT
    CHECK (seller_assessment IN ('correct', 'too_high', 'too_low'));

CREATE INDEX IF NOT EXISTS card_grades_assessment_idx
  ON public.card_grades (seller_assessment)
  WHERE seller_assessment IS NOT NULL;
