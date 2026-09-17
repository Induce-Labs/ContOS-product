-- X/Twitter scraping: dedicated tables (no engagement metric columns)
-- Idempotent: safe to re-run in the Supabase SQL editor if MCP apply fails.
-- Uses avatar_id / avatars (post-rename schema).

-- ---------------------------------------------------------------------------
-- twitter_scraped_content
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.twitter_scraped_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors (id) ON DELETE CASCADE,
  external_id text NOT NULL,
  post_url text,
  posted_at timestamptz,
  caption text,
  author_name text,
  author_username text,
  author_followers integer,
  author_description text,
  raw_payload jsonb,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twitter_scraped_content_competitor_external_id_unique
    UNIQUE (competitor_id, external_id)
);

CREATE INDEX IF NOT EXISTS twitter_scraped_content_competitor_id_idx
  ON public.twitter_scraped_content (competitor_id);

CREATE INDEX IF NOT EXISTS twitter_scraped_content_posted_at_idx
  ON public.twitter_scraped_content (posted_at);

-- ---------------------------------------------------------------------------
-- twitter_content_summaries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.twitter_content_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors (id) ON DELETE CASCADE,
  avatar_id uuid NOT NULL REFERENCES public.avatars (id) ON DELETE CASCADE,
  summary jsonb NOT NULL,
  model_used text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  embedding extensions.vector(1536)
);

CREATE INDEX IF NOT EXISTS twitter_content_summaries_avatar_id_idx
  ON public.twitter_content_summaries (avatar_id);

CREATE INDEX IF NOT EXISTS twitter_content_summaries_competitor_id_idx
  ON public.twitter_content_summaries (competitor_id);

CREATE INDEX IF NOT EXISTS idx_twitter_content_summaries_embedding
  ON public.twitter_content_summaries
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.validate_twitter_content_summary()
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
      AND c.platform = 'twitter'
  ) THEN
    RAISE EXCEPTION
      'twitter_content_summaries requires a twitter competitor whose avatar_id matches (competitor_id %)',
      NEW.competitor_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS twitter_content_summaries_validate ON public.twitter_content_summaries;
CREATE TRIGGER twitter_content_summaries_validate
  BEFORE INSERT OR UPDATE ON public.twitter_content_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_twitter_content_summary();

CREATE OR REPLACE FUNCTION public.match_twitter_content_summaries(
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
  FROM public.twitter_content_summaries s
  WHERE s.embedding IS NOT NULL
    AND (filter_avatar_id IS NULL OR s.avatar_id = filter_avatar_id)
  ORDER BY s.embedding::vector <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_twitter_content_summaries(vector, int, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.twitter_scraped_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.twitter_content_summaries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY twitter_scraped_content_select_own ON public.twitter_scraped_content
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.avatars a ON a.id = c.avatar_id
        WHERE c.id = twitter_scraped_content.competitor_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY twitter_scraped_content_insert_own ON public.twitter_scraped_content
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.avatars a ON a.id = c.avatar_id
        WHERE c.id = twitter_scraped_content.competitor_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY twitter_scraped_content_update_own ON public.twitter_scraped_content
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.avatars a ON a.id = c.avatar_id
        WHERE c.id = twitter_scraped_content.competitor_id
          AND a.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.avatars a ON a.id = c.avatar_id
        WHERE c.id = twitter_scraped_content.competitor_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY twitter_scraped_content_delete_own ON public.twitter_scraped_content
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1
        FROM public.competitors c
        INNER JOIN public.avatars a ON a.id = c.avatar_id
        WHERE c.id = twitter_scraped_content.competitor_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY twitter_content_summaries_select_own ON public.twitter_content_summaries
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.avatars a
        WHERE a.id = twitter_content_summaries.avatar_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY twitter_content_summaries_insert_own ON public.twitter_content_summaries
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.avatars a
        WHERE a.id = twitter_content_summaries.avatar_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY twitter_content_summaries_update_own ON public.twitter_content_summaries
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.avatars a
        WHERE a.id = twitter_content_summaries.avatar_id
          AND a.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.avatars a
        WHERE a.id = twitter_content_summaries.avatar_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY twitter_content_summaries_delete_own ON public.twitter_content_summaries
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.avatars a
        WHERE a.id = twitter_content_summaries.avatar_id
          AND a.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
