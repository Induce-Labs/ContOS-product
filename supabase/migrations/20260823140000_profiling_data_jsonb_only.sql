-- Consolidate profiling answers into avatars.profiling_data (drop normalized response rows)

-- Final sync from avatar_profiling_responses → avatars.profiling_data
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.avatar_profiling_responses') IS NOT NULL THEN
    FOR r IN SELECT id FROM public.avatars LOOP
      PERFORM public.rebuild_avatar_profiling(r.id);
    END LOOP;
  END IF;
END $$;

-- Drop response-table rebuild chain
DROP TRIGGER IF EXISTS avatar_profiling_responses_rebuild ON public.avatar_profiling_responses;
DROP FUNCTION IF EXISTS public.trigger_rebuild_avatar_profiling();
DROP FUNCTION IF EXISTS public.rebuild_avatar_profiling(uuid);

-- Replace guard that blocked client writes to profiling_data
DROP TRIGGER IF EXISTS avatars_guard_profiling_columns ON public.avatars;
DROP FUNCTION IF EXISTS public.avatars_guard_profiling_columns();

-- Compute profiling_completeness from profiling_data on insert/update
CREATE OR REPLACE FUNCTION public.avatars_compute_profiling_completeness()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  total_active integer;
  answered_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.profiling_data IS NOT DISTINCT FROM OLD.profiling_data THEN
    IF NEW.profiling_completeness IS DISTINCT FROM OLD.profiling_completeness THEN
      NEW.profiling_completeness := OLD.profiling_completeness;
    END IF;
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO total_active
  FROM public.profiling_questions
  WHERE type = NEW.type AND is_active = true;

  SELECT COUNT(*) INTO answered_count
  FROM public.profiling_questions pq
  WHERE pq.type = NEW.type
    AND pq.is_active = true
    AND NEW.profiling_data ? pq.question_key
    AND jsonb_typeof(NEW.profiling_data -> pq.question_key) = 'string'
    AND char_length(trim(NEW.profiling_data ->> pq.question_key)) > 0;

  NEW.profiling_completeness := CASE
    WHEN total_active = 0 THEN 0
    ELSE round((answered_count::numeric / total_active::numeric) * 100, 2)
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatars_compute_profiling_completeness ON public.avatars;
CREATE TRIGGER avatars_compute_profiling_completeness
  BEFORE INSERT OR UPDATE OF profiling_data, type ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.avatars_compute_profiling_completeness();

-- Backfill completeness for existing avatars
UPDATE public.avatars
SET profiling_data = profiling_data;

-- Drop normalized response table
DROP POLICY IF EXISTS avatar_profiling_responses_select_own ON public.avatar_profiling_responses;
DROP POLICY IF EXISTS avatar_profiling_responses_insert_own ON public.avatar_profiling_responses;
DROP POLICY IF EXISTS avatar_profiling_responses_update_own ON public.avatar_profiling_responses;
DROP POLICY IF EXISTS avatar_profiling_responses_delete_own ON public.avatar_profiling_responses;

DROP TABLE IF EXISTS public.avatar_profiling_responses;
