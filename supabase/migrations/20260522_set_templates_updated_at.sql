-- set_templates.updated_at — admin Set Library shows last-edit
-- timestamps and PATCH writes them. The column was missing in
-- production, surfacing as `column set_templates.updated_at does
-- not exist` on /admin/templates GET (which silently degraded to
-- "(0)" until #120 surfaced the real error).

ALTER TABLE public.set_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Auto-bump on every row write so callers don't have to remember.
CREATE OR REPLACE FUNCTION public.set_templates_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_templates_touch_updated_at ON public.set_templates;
CREATE TRIGGER set_templates_touch_updated_at
  BEFORE UPDATE ON public.set_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_templates_touch_updated_at();
