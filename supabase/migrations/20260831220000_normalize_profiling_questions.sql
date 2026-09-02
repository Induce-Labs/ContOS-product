-- Normalize profiling questions: canonical catalog + questionnaire templates (dedupe 108 → 47 rows)

-- ---------------------------------------------------------------------------
-- Templates (personal_branding | business; business_1/business_2/legacy business share business)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiling_questionnaire_templates (
  id text PRIMARY KEY,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiling_questionnaire_templates_id_check
    CHECK (id IN ('personal_branding', 'business'))
);

INSERT INTO public.profiling_questionnaire_templates (id, label)
VALUES
  ('personal_branding', 'Personal Brand'),
  ('business', 'Business')
ON CONFLICT (id) DO NOTHING;

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

-- ---------------------------------------------------------------------------
-- Canonical question catalog (one row per question_key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiling_questions_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key text NOT NULL,
  question text NOT NULL CHECK (char_length(trim(question)) > 0),
  is_required boolean NOT NULL DEFAULT true,
  input_kind text NOT NULL DEFAULT 'text',
  options jsonb,
  allow_other boolean NOT NULL DEFAULT false,
  placeholder text,
  section_label text,
  competitor_max integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiling_questions_catalog_question_key_unique UNIQUE (question_key),
  CONSTRAINT profiling_questions_catalog_input_kind_check
    CHECK (input_kind IN ('text', 'textarea', 'url', 'single_select', 'competitor_names'))
);

INSERT INTO public.profiling_questions_catalog (
  question_key,
  question,
  is_required,
  input_kind,
  options,
  allow_other,
  placeholder,
  section_label,
  competitor_max
)
SELECT DISTINCT ON (question_key)
  question_key,
  question,
  is_required,
  input_kind,
  options,
  allow_other,
  placeholder,
  section_label,
  competitor_max
FROM public.profiling_questions
ORDER BY question_key, type;

-- ---------------------------------------------------------------------------
-- Template ↔ question ordering (27 rows per template, not 108)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiling_template_questions (
  template_id text NOT NULL
    REFERENCES public.profiling_questionnaire_templates (id) ON DELETE CASCADE,
  question_key text NOT NULL
    REFERENCES public.profiling_questions_catalog (question_key) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (template_id, question_key)
);

CREATE INDEX IF NOT EXISTS profiling_template_questions_template_active_order_idx
  ON public.profiling_template_questions (template_id, is_active, display_order);

INSERT INTO public.profiling_template_questions (template_id, question_key, display_order, is_active)
SELECT 'personal_branding', question_key, display_order, is_active
FROM public.profiling_questions
WHERE type = 'personal_branding'
ON CONFLICT (template_id, question_key) DO NOTHING;

INSERT INTO public.profiling_template_questions (template_id, question_key, display_order, is_active)
SELECT 'business', question_key, display_order, is_active
FROM public.profiling_questions
WHERE type = 'business'
ON CONFLICT (template_id, question_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Replace legacy flat profiling_questions table with a resolved view
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.profiling_questions;

ALTER TABLE public.profiling_questions_catalog RENAME TO profiling_questions;

ALTER INDEX IF EXISTS profiling_questions_catalog_question_key_unique
  RENAME TO profiling_questions_question_key_unique;

ALTER TABLE public.profiling_questions
  RENAME CONSTRAINT profiling_questions_catalog_input_kind_check
  TO profiling_questions_input_kind_check;

CREATE OR REPLACE VIEW public.profiling_questions_by_type
WITH (security_invoker = true)
AS
SELECT
  ptq.template_id AS type,
  pq.id,
  pq.question_key,
  pq.question,
  ptq.display_order,
  ptq.is_active,
  pq.is_required,
  pq.input_kind,
  pq.options,
  pq.allow_other,
  pq.placeholder,
  pq.section_label,
  pq.competitor_max,
  pq.created_at
FROM public.profiling_template_questions ptq
INNER JOIN public.profiling_questions pq ON pq.question_key = ptq.question_key;

-- ---------------------------------------------------------------------------
-- Completeness: resolve avatar type → template → required active questions
-- ---------------------------------------------------------------------------
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
  FROM public.profiling_template_questions ptq
  INNER JOIN public.profiling_questions pq ON pq.question_key = ptq.question_key
  WHERE ptq.template_id = template_id
    AND ptq.is_active = true
    AND pq.is_required = true;

  SELECT COUNT(*) INTO answered_count
  FROM public.profiling_template_questions ptq
  INNER JOIN public.profiling_questions pq ON pq.question_key = ptq.question_key
  WHERE ptq.template_id = template_id
    AND ptq.is_active = true
    AND pq.is_required = true
    AND NEW.profiling_data ? pq.question_key
    AND (
      (
        jsonb_typeof(NEW.profiling_data -> pq.question_key) = 'string'
        AND char_length(trim(NEW.profiling_data ->> pq.question_key)) > 0
      )
      OR (
        jsonb_typeof(NEW.profiling_data -> pq.question_key) = 'object'
        AND char_length(trim(COALESCE(NEW.profiling_data -> pq.question_key ->> 'answer', ''))) > 0
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiling_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiling_questionnaire_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiling_template_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiling_questions_select_authenticated ON public.profiling_questions;
CREATE POLICY profiling_questions_select_authenticated ON public.profiling_questions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS profiling_questionnaire_templates_select_authenticated
  ON public.profiling_questionnaire_templates;
CREATE POLICY profiling_questionnaire_templates_select_authenticated
  ON public.profiling_questionnaire_templates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS profiling_template_questions_select_authenticated
  ON public.profiling_template_questions;
CREATE POLICY profiling_template_questions_select_authenticated
  ON public.profiling_template_questions
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.profiling_questions_by_type TO authenticated;
