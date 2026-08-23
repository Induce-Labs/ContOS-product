-- Schema rename for clarity (Aug 2026)
-- projects → avatars, project_id → avatar_id
-- scraped_content → instagram_scraped_content
-- content_summaries → instagram_content_summaries
-- profiles → dropped (legacy brand profile merged into avatars.profiling_data)

-- ---------------------------------------------------------------------------
-- A. Migrate legacy profiles into avatars, then drop profiles
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
  target_id uuid;
  merged jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RETURN;
  END IF;

  FOR rec IN SELECT * FROM public.profiles LOOP
    SELECT p.id INTO target_id
    FROM public.projects p
    WHERE p.user_id = rec.user_id
    ORDER BY p.is_default DESC, p.created_at ASC
    LIMIT 1;

    IF target_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT profiling_data INTO merged
    FROM public.projects
    WHERE id = target_id;

    merged := COALESCE(merged, '{}'::jsonb);

    IF NOT (merged ? 'voice') AND rec.brand_voice IS NOT NULL AND char_length(trim(rec.brand_voice)) > 0 THEN
      merged := merged || jsonb_build_object('voice', trim(rec.brand_voice));
    END IF;
    IF NOT (merged ? 'audience') AND rec.target_audience IS NOT NULL AND char_length(trim(rec.target_audience)) > 0 THEN
      merged := merged || jsonb_build_object('audience', trim(rec.target_audience));
    END IF;
    IF NOT (merged ? 'goals') AND rec.goals IS NOT NULL AND char_length(trim(rec.goals)) > 0 THEN
      merged := merged || jsonb_build_object('goals', trim(rec.goals));
    END IF;
    IF NOT (merged ? 'expertise') AND rec.industry IS NOT NULL AND char_length(trim(rec.industry)) > 0 THEN
      merged := merged || jsonb_build_object('expertise', trim(rec.industry));
    END IF;

    PERFORM set_config('contos.rebuild_profiling', 'on', true);
    UPDATE public.projects
    SET profiling_data = merged, updated_at = now()
    WHERE id = target_id;
    PERFORM set_config('contos.rebuild_profiling', 'off', true);
  END LOOP;
END $$;

DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_all ON public.profiles;
DROP TABLE IF EXISTS public.profiles;

-- ---------------------------------------------------------------------------
-- B. Drop triggers/functions that reference old table/column names
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS content_summaries_validate_project ON public.content_summaries;
DROP TRIGGER IF EXISTS linkedin_content_summaries_validate ON public.linkedin_content_summaries;
DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;
DROP TRIGGER IF EXISTS projects_guard_profiling_columns ON public.projects;
DROP TRIGGER IF EXISTS projects_set_default_on_insert ON public.projects;
DROP TRIGGER IF EXISTS projects_promote_default_on_delete ON public.projects;
DROP TRIGGER IF EXISTS projects_enforce_avatar_cap ON public.projects;
DROP TRIGGER IF EXISTS competitors_enforce_cap ON public.competitors;

DROP FUNCTION IF EXISTS public.validate_content_summary_project();
DROP FUNCTION IF EXISTS public.match_content_summaries(vector, int, uuid);
DROP FUNCTION IF EXISTS public.match_linkedin_content_summaries(vector, int, uuid);

-- ---------------------------------------------------------------------------
-- C. Rename Instagram tables
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.scraped_content RENAME TO instagram_scraped_content;
ALTER TABLE IF EXISTS public.content_summaries RENAME TO instagram_content_summaries;

-- ---------------------------------------------------------------------------
-- D. Rename projects → avatars
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.projects RENAME TO avatars;

-- ---------------------------------------------------------------------------
-- E. Rename project_id → avatar_id on child tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.competitors RENAME COLUMN project_id TO avatar_id;
ALTER TABLE public.instagram_content_summaries RENAME COLUMN project_id TO avatar_id;
ALTER TABLE public.linkedin_content_summaries RENAME COLUMN project_id TO avatar_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_calls'
      AND column_name = 'project_id'
  ) THEN
    ALTER TABLE public.agent_calls RENAME COLUMN project_id TO avatar_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- F. Core avatar functions and triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_avatars_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatars_set_updated_at ON public.avatars;
CREATE TRIGGER avatars_set_updated_at
  BEFORE UPDATE ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.set_avatars_updated_at();

CREATE OR REPLACE FUNCTION public.avatars_guard_profiling_columns()
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

DROP TRIGGER IF EXISTS avatars_guard_profiling_columns ON public.avatars;
CREATE TRIGGER avatars_guard_profiling_columns
  BEFORE UPDATE ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.avatars_guard_profiling_columns();

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
  FROM public.avatars
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

  UPDATE public.avatars
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

CREATE OR REPLACE FUNCTION public.avatars_set_default_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count integer;
BEGIN
  SELECT COUNT(*) INTO existing_count
  FROM public.avatars
  WHERE user_id = NEW.user_id
    AND id IS DISTINCT FROM NEW.id;

  IF existing_count = 0 THEN
    NEW.is_default := true;
  ELSIF NEW.is_default = true THEN
    UPDATE public.avatars
    SET is_default = false
    WHERE user_id = NEW.user_id
      AND id IS DISTINCT FROM NEW.id
      AND is_default = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatars_set_default_on_insert ON public.avatars;
CREATE TRIGGER avatars_set_default_on_insert
  BEFORE INSERT ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.avatars_set_default_on_insert();

CREATE OR REPLACE FUNCTION public.avatars_promote_default_on_delete()
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
    FROM public.avatars
    WHERE user_id = OLD.user_id
      AND id IS DISTINCT FROM OLD.id
    ORDER BY created_at ASC
    LIMIT 1;

    IF next_id IS NOT NULL THEN
      UPDATE public.avatars
      SET is_default = true
      WHERE id = next_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS avatars_promote_default_on_delete ON public.avatars;
CREATE TRIGGER avatars_promote_default_on_delete
  AFTER DELETE ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.avatars_promote_default_on_delete();

CREATE OR REPLACE FUNCTION public.set_default_avatar(p_avatar_id uuid)
RETURNS public.avatars
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.avatars;
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id
  FROM public.avatars
  WHERE id = p_avatar_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'avatar_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'avatar_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.avatars
  SET is_default = false
  WHERE user_id = owner_id
    AND is_default = true
    AND id IS DISTINCT FROM p_avatar_id;

  UPDATE public.avatars
  SET is_default = true, updated_at = now()
  WHERE id = p_avatar_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_avatar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_avatar(uuid) TO authenticated;

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
  FROM public.avatars
  WHERE user_id = NEW.user_id;

  IF avatar_count >= max_avatars THEN
    RAISE EXCEPTION 'AVATAR_LIMIT_REACHED'
      USING ERRCODE = 'check_violation',
            HINT = 'You have reached the maximum number of avatars on your current plan.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatars_enforce_avatar_cap ON public.avatars;
CREATE TRIGGER avatars_enforce_avatar_cap
  BEFORE INSERT ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_avatar_cap();

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
  WHERE avatar_id = NEW.avatar_id;

  IF competitor_count >= 10 THEN
    RAISE EXCEPTION 'competitor_cap_exceeded'
      USING ERRCODE = 'check_violation',
            HINT = 'An avatar can have at most 10 competitors.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER competitors_enforce_cap
  BEFORE INSERT ON public.competitors
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_competitor_cap();

-- ---------------------------------------------------------------------------
-- G. Validation triggers for summary tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_instagram_content_summary_avatar()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.competitors c
    WHERE c.id = NEW.competitor_id
      AND c.avatar_id = NEW.avatar_id
  ) THEN
    RAISE EXCEPTION
      'instagram_content_summaries.avatar_id must match competitors.avatar_id for competitor_id %',
      NEW.competitor_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS instagram_content_summaries_validate_avatar ON public.instagram_content_summaries;
CREATE TRIGGER instagram_content_summaries_validate_avatar
  BEFORE INSERT OR UPDATE ON public.instagram_content_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_instagram_content_summary_avatar();

CREATE OR REPLACE FUNCTION public.validate_linkedin_content_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.competitors c
    WHERE c.id = NEW.competitor_id
      AND c.avatar_id = NEW.avatar_id
      AND c.platform = 'linkedin'
  ) THEN
    RAISE EXCEPTION
      'linkedin_content_summaries requires a linkedin competitor whose avatar_id matches (competitor_id %)',
      NEW.competitor_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS linkedin_content_summaries_validate ON public.linkedin_content_summaries;
CREATE TRIGGER linkedin_content_summaries_validate
  BEFORE INSERT OR UPDATE ON public.linkedin_content_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_linkedin_content_summary();

-- ---------------------------------------------------------------------------
-- H. Embedding RPC functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_instagram_content_summaries(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_avatar_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  competitor_id uuid,
  avatar_id uuid,
  summary jsonb,
  model_used text,
  generated_at timestamptz,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    cs.id,
    cs.competitor_id,
    cs.avatar_id,
    cs.summary,
    cs.model_used,
    cs.generated_at,
    (1 - (cs.embedding::vector <=> query_embedding))::float AS similarity
  FROM public.instagram_content_summaries cs
  WHERE cs.embedding IS NOT NULL
    AND (filter_avatar_id IS NULL OR cs.avatar_id = filter_avatar_id)
  ORDER BY cs.embedding::vector <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_instagram_content_summaries(vector, int, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_linkedin_content_summaries(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_avatar_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  competitor_id uuid,
  avatar_id uuid,
  summary jsonb,
  model_used text,
  generated_at timestamptz,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    s.id,
    s.competitor_id,
    s.avatar_id,
    s.summary,
    s.model_used,
    s.generated_at,
    (1 - (s.embedding::vector <=> query_embedding))::float AS similarity
  FROM public.linkedin_content_summaries s
  WHERE s.embedding IS NOT NULL
    AND (filter_avatar_id IS NULL OR s.avatar_id = filter_avatar_id)
  ORDER BY s.embedding::vector <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_linkedin_content_summaries(vector, int, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- I. RLS policies (drop old, recreate with new names)
-- ---------------------------------------------------------------------------

-- avatars
DROP POLICY IF EXISTS projects_select_own ON public.avatars;
DROP POLICY IF EXISTS projects_insert_own ON public.avatars;
DROP POLICY IF EXISTS projects_update_own ON public.avatars;
DROP POLICY IF EXISTS projects_delete_own ON public.avatars;

CREATE POLICY avatars_select_own ON public.avatars
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY avatars_insert_own ON public.avatars
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY avatars_update_own ON public.avatars
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY avatars_delete_own ON public.avatars
  FOR DELETE USING (auth.uid() = user_id);

-- competitors
DROP POLICY IF EXISTS competitors_select_own ON public.competitors;
DROP POLICY IF EXISTS competitors_insert_own ON public.competitors;
DROP POLICY IF EXISTS competitors_update_own ON public.competitors;
DROP POLICY IF EXISTS competitors_delete_own ON public.competitors;

CREATE POLICY competitors_select_own ON public.competitors
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_insert_own ON public.competitors
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_update_own ON public.competitors
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_delete_own ON public.competitors
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

-- instagram_scraped_content
DROP POLICY IF EXISTS scraped_content_select_own ON public.instagram_scraped_content;
DROP POLICY IF EXISTS scraped_content_insert_own ON public.instagram_scraped_content;
DROP POLICY IF EXISTS scraped_content_update_own ON public.instagram_scraped_content;
DROP POLICY IF EXISTS scraped_content_delete_own ON public.instagram_scraped_content;

CREATE POLICY instagram_scraped_content_select_own ON public.instagram_scraped_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_scraped_content_insert_own ON public.instagram_scraped_content
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_scraped_content_update_own ON public.instagram_scraped_content
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_scraped_content_delete_own ON public.instagram_scraped_content
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

-- instagram_content_summaries
DROP POLICY IF EXISTS content_summaries_select_own ON public.instagram_content_summaries;
DROP POLICY IF EXISTS content_summaries_insert_own ON public.instagram_content_summaries;
DROP POLICY IF EXISTS content_summaries_update_own ON public.instagram_content_summaries;
DROP POLICY IF EXISTS content_summaries_delete_own ON public.instagram_content_summaries;

CREATE POLICY instagram_content_summaries_select_own ON public.instagram_content_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_content_summaries_insert_own ON public.instagram_content_summaries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_content_summaries_update_own ON public.instagram_content_summaries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_content_summaries_delete_own ON public.instagram_content_summaries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

-- linkedin_scraped_content
DROP POLICY IF EXISTS linkedin_scraped_content_select_own ON public.linkedin_scraped_content;
DROP POLICY IF EXISTS linkedin_scraped_content_insert_own ON public.linkedin_scraped_content;
DROP POLICY IF EXISTS linkedin_scraped_content_update_own ON public.linkedin_scraped_content;
DROP POLICY IF EXISTS linkedin_scraped_content_delete_own ON public.linkedin_scraped_content;

CREATE POLICY linkedin_scraped_content_select_own ON public.linkedin_scraped_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_scraped_content_insert_own ON public.linkedin_scraped_content
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_scraped_content_update_own ON public.linkedin_scraped_content
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_scraped_content_delete_own ON public.linkedin_scraped_content
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

-- linkedin_content_summaries
DROP POLICY IF EXISTS linkedin_content_summaries_select_own ON public.linkedin_content_summaries;
DROP POLICY IF EXISTS linkedin_content_summaries_insert_own ON public.linkedin_content_summaries;
DROP POLICY IF EXISTS linkedin_content_summaries_update_own ON public.linkedin_content_summaries;
DROP POLICY IF EXISTS linkedin_content_summaries_delete_own ON public.linkedin_content_summaries;

CREATE POLICY linkedin_content_summaries_select_own ON public.linkedin_content_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_content_summaries_insert_own ON public.linkedin_content_summaries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_content_summaries_update_own ON public.linkedin_content_summaries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_content_summaries_delete_own ON public.linkedin_content_summaries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

-- avatar_profiling_responses
DROP POLICY IF EXISTS avatar_profiling_responses_select_own ON public.avatar_profiling_responses;
DROP POLICY IF EXISTS avatar_profiling_responses_insert_own ON public.avatar_profiling_responses;
DROP POLICY IF EXISTS avatar_profiling_responses_update_own ON public.avatar_profiling_responses;
DROP POLICY IF EXISTS avatar_profiling_responses_delete_own ON public.avatar_profiling_responses;

CREATE POLICY avatar_profiling_responses_select_own ON public.avatar_profiling_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_profiling_responses.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY avatar_profiling_responses_insert_own ON public.avatar_profiling_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_profiling_responses.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY avatar_profiling_responses_update_own ON public.avatar_profiling_responses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_profiling_responses.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_profiling_responses.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY avatar_profiling_responses_delete_own ON public.avatar_profiling_responses
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_profiling_responses.avatar_id AND a.user_id = auth.uid()
    )
  );

-- Drop obsolete functions (renamed replacements exist)
DROP FUNCTION IF EXISTS public.set_projects_updated_at();
DROP FUNCTION IF EXISTS public.projects_guard_profiling_columns();
DROP FUNCTION IF EXISTS public.projects_set_default_on_insert();
DROP FUNCTION IF EXISTS public.projects_promote_default_on_delete();
