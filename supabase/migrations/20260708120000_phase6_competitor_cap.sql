-- Phase 6: enforce max 10 competitors per project at the database layer

CREATE OR REPLACE FUNCTION public.enforce_competitor_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  competitor_count integer;
BEGIN
  SELECT COUNT(*)
  INTO competitor_count
  FROM public.competitors
  WHERE project_id = NEW.project_id;

  IF competitor_count >= 10 THEN
    RAISE EXCEPTION 'competitor_cap_exceeded'
      USING ERRCODE = 'check_violation',
            HINT = 'A project can have at most 10 competitors.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitors_enforce_cap ON public.competitors;

CREATE TRIGGER competitors_enforce_cap
  BEFORE INSERT ON public.competitors
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_competitor_cap();
