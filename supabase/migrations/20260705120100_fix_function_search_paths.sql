CREATE OR REPLACE FUNCTION public.set_projects_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_content_summary_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.competitors c
    WHERE c.id = NEW.competitor_id
      AND c.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'content_summaries.project_id must match competitors.project_id for competitor_id %', NEW.competitor_id;
  END IF;

  RETURN NEW;
END;
$$;
