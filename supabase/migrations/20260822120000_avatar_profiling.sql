-- Phase 2: Avatar profiling — extend projects, questions, responses, defaults, cap

-- ---------------------------------------------------------------------------
-- Extend projects (Avatar fields)
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS profiling_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS profiling_completeness numeric NOT NULL DEFAULT 0
    CHECK (profiling_completeness >= 0 AND profiling_completeness <= 100),
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS projects_one_default_per_user_idx
  ON public.projects (user_id)
  WHERE is_default = true;

-- ---------------------------------------------------------------------------
-- profiling_questions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiling_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('personal_branding', 'business')),
  question_key text NOT NULL CHECK (char_length(trim(question_key)) > 0),
  question text NOT NULL CHECK (char_length(trim(question)) > 0),
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiling_questions_type_key_unique UNIQUE (type, question_key)
);

CREATE INDEX IF NOT EXISTS profiling_questions_type_active_idx
  ON public.profiling_questions (type, is_active, display_order);

INSERT INTO public.profiling_questions (type, question_key, question, display_order, is_active)
VALUES
  ('personal_branding', 'expertise', 'What do you want to be known for online?', 1, true),
  ('personal_branding', 'audience', 'Who is your primary audience?', 2, true),
  ('personal_branding', 'topics', 'What topics, ideas, or areas do you consistently talk about?', 3, true),
  ('personal_branding', 'voice', 'What is your preferred communication style or tone?', 4, true),
  ('personal_branding', 'goals', 'What are your main goals for your personal brand?', 5, true)
ON CONFLICT (type, question_key) DO NOTHING;

INSERT INTO public.profiling_questions (type, question_key, question, display_order, is_active)
VALUES
  ('business', 'product', 'What does your business or product do, and what problem does it solve?', 1, true),
  ('business', 'icp', 'Who is your ideal customer?', 2, true),
  ('business', 'positioning', 'What makes your product or business different from competitors?', 3, true),
  ('business', 'competitors', 'Who are your main competitors or alternatives?', 4, true),
  ('business', 'goals', 'What are your primary business or marketing goals right now?', 5, true)
ON CONFLICT (type, question_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- avatar_profiling_responses (avatar_id = projects.id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avatar_profiling_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.profiling_questions (id) ON DELETE CASCADE,
  response jsonb NOT NULL DEFAULT '""'::jsonb,
  answered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avatar_profiling_responses_avatar_question_unique UNIQUE (avatar_id, question_id)
);

CREATE INDEX IF NOT EXISTS avatar_profiling_responses_avatar_id_idx
  ON public.avatar_profiling_responses (avatar_id);

-- Guard: clients cannot overwrite server-owned profiling columns
CREATE OR REPLACE FUNCTION public.projects_guard_profiling_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('contos.rebuild_profiling', true) IS DISTINCT FROM 'on' THEN
    NEW.profiling_data := OLD.profiling_data;
    NEW.profiling_completeness := OLD.profiling_completeness;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_guard_profiling_columns ON public.projects;
CREATE TRIGGER projects_guard_profiling_columns
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_guard_profiling_columns();

-- Rebuild profiling_data + completeness from responses
CREATE OR REPLACE FUNCTION public.rebuild_avatar_profiling(p_avatar_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  avatar_type text;
  total_active integer;
  answered_count integer;
  rebuilt jsonb := '{}'::jsonb;
  rec record;
  answer_text text;
BEGIN
  SELECT type INTO avatar_type
  FROM public.projects
  WHERE id = p_avatar_id;

  IF avatar_type IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO total_active
  FROM public.profiling_questions
  WHERE type = avatar_type AND is_active = true;

  FOR rec IN
    SELECT pq.question_key, apr.response
    FROM public.avatar_profiling_responses apr
    INNER JOIN public.profiling_questions pq ON pq.id = apr.question_id
    WHERE apr.avatar_id = p_avatar_id
      AND pq.type = avatar_type
      AND pq.is_active = true
  LOOP
    IF jsonb_typeof(rec.response) = 'string' THEN
      answer_text := rec.response #>> '{}';
    ELSIF jsonb_typeof(rec.response) = 'object' AND rec.response ? 'text' THEN
      answer_text := rec.response ->> 'text';
    ELSE
      answer_text := rec.response::text;
    END IF;

    IF answer_text IS NOT NULL AND char_length(trim(answer_text)) > 0 THEN
      rebuilt := rebuilt || jsonb_build_object(rec.question_key, trim(answer_text));
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO answered_count
  FROM jsonb_object_keys(rebuilt) AS keys(k);

  PERFORM set_config('contos.rebuild_profiling', 'on', true);

  UPDATE public.projects
  SET
    profiling_data = rebuilt,
    profiling_completeness = CASE
      WHEN total_active = 0 THEN 0
      ELSE round((answered_count::numeric / total_active::numeric) * 100, 2)
    END,
    updated_at = now()
  WHERE id = p_avatar_id;

  PERFORM set_config('contos.rebuild_profiling', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_rebuild_avatar_profiling()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rebuild_avatar_profiling(OLD.avatar_id);
    RETURN OLD;
  END IF;
  PERFORM public.rebuild_avatar_profiling(NEW.avatar_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatar_profiling_responses_rebuild ON public.avatar_profiling_responses;
CREATE TRIGGER avatar_profiling_responses_rebuild
  AFTER INSERT OR UPDATE OR DELETE ON public.avatar_profiling_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_rebuild_avatar_profiling();

-- ---------------------------------------------------------------------------
-- Default avatar lifecycle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projects_set_default_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count integer;
BEGIN
  SELECT COUNT(*) INTO existing_count
  FROM public.projects
  WHERE user_id = NEW.user_id
    AND id IS DISTINCT FROM NEW.id;

  IF existing_count = 0 THEN
    NEW.is_default := true;
  ELSIF NEW.is_default = true THEN
    UPDATE public.projects
    SET is_default = false
    WHERE user_id = NEW.user_id
      AND id IS DISTINCT FROM NEW.id
      AND is_default = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_default_on_insert ON public.projects;
CREATE TRIGGER projects_set_default_on_insert
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_set_default_on_insert();

CREATE OR REPLACE FUNCTION public.projects_promote_default_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_id uuid;
BEGIN
  IF OLD.is_default THEN
    SELECT id INTO next_id
    FROM public.projects
    WHERE user_id = OLD.user_id
      AND id IS DISTINCT FROM OLD.id
    ORDER BY created_at ASC
    LIMIT 1;

    IF next_id IS NOT NULL THEN
      UPDATE public.projects
      SET is_default = true
      WHERE id = next_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS projects_promote_default_on_delete ON public.projects;
CREATE TRIGGER projects_promote_default_on_delete
  AFTER DELETE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_promote_default_on_delete();

CREATE OR REPLACE FUNCTION public.set_default_avatar(p_avatar_id uuid)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.projects;
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id
  FROM public.projects
  WHERE id = p_avatar_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'avatar_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'avatar_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.projects
  SET is_default = false
  WHERE user_id = owner_id
    AND is_default = true
    AND id IS DISTINCT FROM p_avatar_id;

  UPDATE public.projects
  SET is_default = true, updated_at = now()
  WHERE id = p_avatar_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_avatar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_avatar(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Avatar cap (Basic = 3) — plan_limits.max_avatars placeholder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_avatar_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  avatar_count integer;
  max_avatars integer := 3;
BEGIN
  SELECT COUNT(*) INTO avatar_count
  FROM public.projects
  WHERE user_id = NEW.user_id;

  IF avatar_count >= max_avatars THEN
    RAISE EXCEPTION 'AVATAR_LIMIT_REACHED'
      USING ERRCODE = 'check_violation',
            HINT = 'You have reached the maximum number of avatars on your current plan.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_enforce_avatar_cap ON public.projects;
CREATE TRIGGER projects_enforce_avatar_cap
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_avatar_cap();

-- Backfill one default per user if missing
UPDATE public.projects p
SET is_default = true
WHERE p.id IN (
  SELECT DISTINCT ON (user_id) id
  FROM public.projects
  ORDER BY user_id, created_at ASC
)
AND NOT EXISTS (
  SELECT 1 FROM public.projects p2
  WHERE p2.user_id = p.user_id AND p2.is_default = true
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiling_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avatar_profiling_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiling_questions_select_authenticated ON public.profiling_questions;
CREATE POLICY profiling_questions_select_authenticated ON public.profiling_questions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS avatar_profiling_responses_select_own ON public.avatar_profiling_responses;
CREATE POLICY avatar_profiling_responses_select_own ON public.avatar_profiling_responses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = avatar_profiling_responses.avatar_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS avatar_profiling_responses_insert_own ON public.avatar_profiling_responses;
CREATE POLICY avatar_profiling_responses_insert_own ON public.avatar_profiling_responses
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = avatar_profiling_responses.avatar_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS avatar_profiling_responses_update_own ON public.avatar_profiling_responses;
CREATE POLICY avatar_profiling_responses_update_own ON public.avatar_profiling_responses
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = avatar_profiling_responses.avatar_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = avatar_profiling_responses.avatar_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS avatar_profiling_responses_delete_own ON public.avatar_profiling_responses;
CREATE POLICY avatar_profiling_responses_delete_own ON public.avatar_profiling_responses
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = avatar_profiling_responses.avatar_id
        AND p.user_id = auth.uid()
    )
  );
