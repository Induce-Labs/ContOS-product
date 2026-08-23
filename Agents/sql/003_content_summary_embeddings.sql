-- ContOS Agents — instagram_content_summaries vector search

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE instagram_content_summaries
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_instagram_content_summaries_embedding
  ON instagram_content_summaries
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_instagram_content_summaries(
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
  FROM instagram_content_summaries cs
  WHERE cs.embedding IS NOT NULL
    AND (filter_avatar_id IS NULL OR cs.avatar_id = filter_avatar_id)
  ORDER BY cs.embedding::vector <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_instagram_content_summaries(vector, int, uuid) TO anon, authenticated, service_role;
