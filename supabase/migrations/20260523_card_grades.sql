-- card_grades: every AI grading attempt is logged here. Drives the
-- /admin/grader-accuracy dashboard, future prompt tuning (we can see
-- which patterns the model gets wrong), and eventual few-shot anchoring
-- (validated rows become reference examples).
--
-- This table is INSERT-only from the API route and append-mostly from
-- the client (a PATCH endpoint marks user actions like "used high" or
-- "undo"). No deletes — even failures are kept for failure-pattern
-- analysis.

CREATE TABLE IF NOT EXISTS public.card_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Where the call came from. Lets us slice accuracy by surface
  -- (scan-batch vs grade-test vs scan-multi-card) when tuning.
  source TEXT NOT NULL,

  -- Card metadata sent to the model
  year INT,
  brand TEXT,
  set_title TEXT,
  card_number TEXT,
  player TEXT,
  image_front_url TEXT,
  image_back_url TEXT,

  -- AI response (null on failure)
  ai_model TEXT,
  ai_grade_low TEXT,
  ai_grade_high TEXT,
  ai_confidence TEXT,
  ai_notes TEXT,
  ai_corners TEXT,
  ai_edges TEXT,
  ai_surface TEXT,
  ai_centering_front TEXT,
  ai_centering_back TEXT,
  ai_top_flaws JSONB,
  ai_cost_dollars NUMERIC(10, 5),
  ai_latency_ms INT,

  -- Outcome
  applied_grade TEXT,        -- what got written to the row/listing
  user_action TEXT,          -- 'auto_low' | 'used_low' | 'used_high' | 'undo' | 'dismiss'
  user_final_grade TEXT,     -- if seller edited the grade manually after

  -- Failure detail
  error_message TEXT,

  -- For future ground-truth comparison: if the seller later sends the
  -- card off to PSA/SGC/BGS and records the real grade, we can join
  -- back here and measure accuracy.
  professional_grade TEXT,
  professional_grader TEXT
);

CREATE INDEX IF NOT EXISTS card_grades_user_created_idx
  ON public.card_grades (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS card_grades_source_created_idx
  ON public.card_grades (source, created_at DESC);
CREATE INDEX IF NOT EXISTS card_grades_failure_idx
  ON public.card_grades (created_at DESC)
  WHERE error_message IS NOT NULL;

-- RLS: sellers see their own rows; service-role (admin) sees everything.
ALTER TABLE public.card_grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS card_grades_read_own ON public.card_grades;
CREATE POLICY card_grades_read_own ON public.card_grades
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS card_grades_insert_own ON public.card_grades;
CREATE POLICY card_grades_insert_own ON public.card_grades
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS card_grades_update_own ON public.card_grades;
CREATE POLICY card_grades_update_own ON public.card_grades
  FOR UPDATE USING (auth.uid() = user_id);
