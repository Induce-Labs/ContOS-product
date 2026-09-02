-- Single-table profiling questionnaires: one row per template, questions stored as JSONB array (2 rows total)

CREATE TABLE IF NOT EXISTS public.profiling_questionnaires (
  id text PRIMARY KEY,
  label text NOT NULL,
  questions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiling_questionnaires_id_check
    CHECK (id IN ('personal_branding', 'business')),
  CONSTRAINT profiling_questionnaires_questions_is_array
    CHECK (jsonb_typeof(questions) = 'array')
);

INSERT INTO public.profiling_questionnaires (id, label, questions)
SELECT
  ptq.template_id,
  pqt.label,
  jsonb_agg(
    jsonb_build_object(
      'key', pq.question_key,
      'question', pq.question,
      'display_order', ptq.display_order,
      'is_active', ptq.is_active,
      'required', pq.is_required,
      'input_kind', pq.input_kind,
      'options', pq.options,
      'allow_other', pq.allow_other,
      'placeholder', pq.placeholder,
      'section_label', pq.section_label,
      'competitor_max', pq.competitor_max
    )
    ORDER BY ptq.display_order
  )
FROM public.profiling_template_questions ptq
INNER JOIN public.profiling_questions pq ON pq.question_key = ptq.question_key
INNER JOIN public.profiling_questionnaire_templates pqt ON pqt.id = ptq.template_id
GROUP BY ptq.template_id, pqt.label
ON CONFLICT (id) DO UPDATE
SET
  label = EXCLUDED.label,
  questions = EXCLUDED.questions,
  updated_at = now();

DROP VIEW IF EXISTS public.profiling_questions_by_type;
DROP TABLE IF EXISTS public.profiling_template_questions;
DROP TABLE IF EXISTS public.profiling_questions;
DROP TABLE IF EXISTS public.profiling_questionnaire_templates;

CREATE OR REPLACE FUNCTION public.resolve_profiling_template(p_avatar_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_avatar_type = 'personal_branding' THEN 'personal_branding'
    WHEN p_avatar_type IN ('business', 'business_1', 'business_2') THEN 'business'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.avatars_compute_profiling_completeness()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  template_id text;
  total_required integer;
  answered_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.profiling_data IS NOT DISTINCT FROM OLD.profiling_data THEN
    IF NEW.profiling_completeness IS DISTINCT FROM OLD.profiling_completeness THEN
      NEW.profiling_completeness := OLD.profiling_completeness;
    END IF;
    RETURN NEW;
  END IF;

  template_id := public.resolve_profiling_template(NEW.type);

  IF template_id IS NULL THEN
    NEW.profiling_completeness := 0;
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO total_required
  FROM public.profiling_questionnaires pqnr
  CROSS JOIN LATERAL jsonb_array_elements(pqnr.questions) AS elem
  WHERE pqnr.id = template_id
    AND COALESCE((elem->>'is_active')::boolean, true) = true
    AND COALESCE((elem->>'required')::boolean, true) = true;

  SELECT COUNT(*) INTO answered_count
  FROM public.profiling_questionnaires pqnr
  CROSS JOIN LATERAL jsonb_array_elements(pqnr.questions) AS elem
  WHERE pqnr.id = template_id
    AND COALESCE((elem->>'is_active')::boolean, true) = true
    AND COALESCE((elem->>'required')::boolean, true) = true
    AND NEW.profiling_data ? (elem->>'key')
    AND (
      (
        jsonb_typeof(NEW.profiling_data -> (elem->>'key')) = 'string'
        AND char_length(trim(NEW.profiling_data ->> (elem->>'key'))) > 0
      )
      OR (
        jsonb_typeof(NEW.profiling_data -> (elem->>'key')) = 'object'
        AND char_length(trim(COALESCE(NEW.profiling_data -> (elem->>'key') ->> 'answer', ''))) > 0
      )
    );

  NEW.profiling_completeness := CASE
    WHEN total_required = 0 THEN 0
    ELSE round((answered_count::numeric / total_required::numeric) * 100, 2)
  END;

  RETURN NEW;
END;
$$;

UPDATE public.avatars
SET profiling_data = profiling_data;

ALTER TABLE public.profiling_questionnaires ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiling_questionnaires_select_authenticated
  ON public.profiling_questionnaires;
CREATE POLICY profiling_questionnaires_select_authenticated
  ON public.profiling_questionnaires
  FOR SELECT
  TO authenticated
  USING (true);
