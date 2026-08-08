-- LinkedIn scraping: extend platform CHECK + dedicated tables
-- Idempotent: safe to re-run in the Supabase SQL editor if MCP apply fails.

-- ---------------------------------------------------------------------------
-- competitors.platform: allow linkedin
-- ---------------------------------------------------------------------------
ALTER TABLE public.competitors
  DROP CONSTRAINT IF EXISTS competitors_platform_check;

ALTER TABLE public.competitors
  ADD CONSTRAINT competitors_platform_check
  CHECK (platform IN ('instagram', 'twitter', 'reddit', 'linkedin'));

-- ---------------------------------------------------------------------------
-- linkedin_scraped_content
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.linkedin_scraped_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors (id) ON DELETE CASCADE,
  external_id text NOT NULL,
  post_url text,
  posted_at timestamptz,
  caption text,
  likes integer,
  comments_count integer,
  shares integer,
  author_name text,
  author_headline text,
  raw_payload jsonb,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_scraped_content_competitor_external_id_unique
    UNIQUE (competitor_id, external_id)
);

CREATE INDEX IF NOT EXISTS linkedin_scraped_content_competitor_id_idx
  ON public.linkedin_scraped_content (competitor_id);

CREATE INDEX IF NOT EXISTS linkedin_scraped_content_posted_at_idx
  ON public.linkedin_scraped_content (posted_at);

-- ---------------------------------------------------------------------------
-- linkedin_content_summaries (distinct from Instagram content_summaries)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.linkedin_content_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  summary jsonb NOT NULL,
  model_used text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  embedding extensions.vector(1536)
);

CREATE INDEX IF NOT EXISTS linkedin_content_summaries_project_id_idx
  ON public.linkedin_content_summaries (project_id);

CREATE INDEX IF NOT EXISTS linkedin_content_summaries_competitor_id_idx
  ON public.linkedin_content_summaries (competitor_id);

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
      AND c.project_id = NEW.project_id
      AND c.platform = 'linkedin'
  ) THEN
    RAISE EXCEPTION
      'linkedin_content_summaries requires a linkedin competitor whose project_id matches (competitor_id %)',
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
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.linkedin_scraped_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_content_summaries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY linkedin_scraped_content_select_own ON public.linkedin_scraped_content
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.projects p ON p.id = c.project_id
        WHERE c.id = linkedin_scraped_content.competitor_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY linkedin_scraped_content_insert_own ON public.linkedin_scraped_content
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.projects p ON p.id = c.project_id
        WHERE c.id = linkedin_scraped_content.competitor_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY linkedin_scraped_content_update_own ON public.linkedin_scraped_content
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.projects p ON p.id = c.project_id
        WHERE c.id = linkedin_scraped_content.competitor_id
          AND p.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.projects p ON p.id = c.project_id
        WHERE c.id = linkedin_scraped_content.competitor_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY linkedin_scraped_content_delete_own ON public.linkedin_scraped_content
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.projects p ON p.id = c.project_id
        WHERE c.id = linkedin_scraped_content.competitor_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY linkedin_content_summaries_select_own ON public.linkedin_content_summaries
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = linkedin_content_summaries.project_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY linkedin_content_summaries_insert_own ON public.linkedin_content_summaries
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = linkedin_content_summaries.project_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY linkedin_content_summaries_update_own ON public.linkedin_content_summaries
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = linkedin_content_summaries.project_id
          AND p.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = linkedin_content_summaries.project_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY linkedin_content_summaries_delete_own ON public.linkedin_content_summaries
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = linkedin_content_summaries.project_id
          AND p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
