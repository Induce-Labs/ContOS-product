-- ContOS v1 core schema: projects, competitors, scraped_content, content_summaries

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) > 0),
  type text NOT NULL CHECK (type IN ('personal_branding', 'business')),
  status text NOT NULL DEFAULT 'onboarding' CHECK (
    status IN ('onboarding', 'scraping', 'ready', 'failed')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_user_id_idx ON public.projects (user_id);

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

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_projects_updated_at();

-- ---------------------------------------------------------------------------
-- competitors
-- ---------------------------------------------------------------------------
CREATE TABLE public.competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'twitter', 'reddit')),
  handle_or_url text NOT NULL CHECK (char_length(trim(handle_or_url)) > 0),
  scrape_status text NOT NULL DEFAULT 'pending' CHECK (
    scrape_status IN ('pending', 'in_progress', 'completed', 'failed')
  ),
  pipeline_step text NOT NULL DEFAULT 'queued' CHECK (
    pipeline_step IN ('queued', 'scraping', 'analyzing', 'done', 'failed')
  ),
  last_scraped_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX competitors_project_id_idx ON public.competitors (project_id);

-- ---------------------------------------------------------------------------
-- scraped_content
-- ---------------------------------------------------------------------------
CREATE TABLE public.scraped_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors (id) ON DELETE CASCADE,
  platform text NOT NULL,
  content_type text NOT NULL DEFAULT 'reel',
  external_id text NOT NULL,
  posted_at timestamptz,
  likes integer,
  views integer,
  shares integer,
  comments_count integer,
  caption text,
  transcript text,
  transcript_source text,
  raw_payload jsonb,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scraped_content_competitor_external_id_unique UNIQUE (competitor_id, external_id)
);

CREATE INDEX scraped_content_competitor_id_idx ON public.scraped_content (competitor_id);
CREATE INDEX scraped_content_posted_at_idx ON public.scraped_content (posted_at);

-- ---------------------------------------------------------------------------
-- content_summaries
-- ---------------------------------------------------------------------------
CREATE TABLE public.content_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  summary jsonb NOT NULL,
  model_used text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  embedding extensions.vector(1536)
);

CREATE INDEX content_summaries_project_id_idx ON public.content_summaries (project_id);
CREATE INDEX content_summaries_competitor_id_idx ON public.content_summaries (competitor_id);

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

CREATE TRIGGER content_summaries_validate_project
  BEFORE INSERT OR UPDATE ON public.content_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_content_summary_project();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_summaries ENABLE ROW LEVEL SECURITY;

-- projects: direct user ownership
CREATE POLICY projects_select_own ON public.projects
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY projects_insert_own ON public.projects
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY projects_update_own ON public.projects
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY projects_delete_own ON public.projects
  FOR DELETE
  USING (auth.uid() = user_id);

-- competitors: via project ownership
CREATE POLICY competitors_select_own ON public.competitors
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = competitors.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_insert_own ON public.competitors
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = competitors.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_update_own ON public.competitors
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = competitors.project_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = competitors.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_delete_own ON public.competitors
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = competitors.project_id
        AND p.user_id = auth.uid()
    )
  );

-- scraped_content: via competitor -> project ownership
CREATE POLICY scraped_content_select_own ON public.scraped_content
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = scraped_content.competitor_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY scraped_content_insert_own ON public.scraped_content
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = scraped_content.competitor_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY scraped_content_update_own ON public.scraped_content
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = scraped_content.competitor_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = scraped_content.competitor_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY scraped_content_delete_own ON public.scraped_content
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = scraped_content.competitor_id
        AND p.user_id = auth.uid()
    )
  );

-- content_summaries: via project ownership (denormalized project_id)
CREATE POLICY content_summaries_select_own ON public.content_summaries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = content_summaries.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY content_summaries_insert_own ON public.content_summaries
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = content_summaries.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY content_summaries_update_own ON public.content_summaries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = content_summaries.project_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = content_summaries.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY content_summaries_delete_own ON public.content_summaries
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = content_summaries.project_id
        AND p.user_id = auth.uid()
    )
  );
