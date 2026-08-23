-- LinkedIn content summary vector search (agentic RAG)

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE linkedin_content_summaries
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_linkedin_content_summaries_embedding
  ON linkedin_content_summaries
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_linkedin_content_summaries(
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
  FROM linkedin_content_summaries s
  WHERE s.embedding IS NOT NULL
    AND (filter_avatar_id IS NULL OR s.avatar_id = filter_avatar_id)
  ORDER BY s.embedding::vector <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_linkedin_content_summaries(vector, int, uuid)
  TO anon, authenticated, service_role;
