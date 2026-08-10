-- ContOS Agents — content_summaries vector search
-- content_summaries.embedding already exists in production; this adds index + RPC.

CREATE EXTENSION IF NOT EXISTS vector;

-- Ensure embedding column exists (no-op if already present)
ALTER TABLE content_summaries
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_content_summaries_embedding
  ON content_summaries
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_content_summaries(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  competitor_id uuid,
  project_id uuid,
  summary jsonb,
  model_used text,
  generated_at timestamptz,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    cs.id,
    cs.competitor_id,
    cs.project_id,
    cs.summary,
    cs.model_used,
    cs.generated_at,
    (1 - (cs.embedding <=> query_embedding))::float AS similarity
  FROM content_summaries cs
  WHERE cs.embedding IS NOT NULL
    AND (filter_project_id IS NULL OR cs.project_id = filter_project_id)
  ORDER BY cs.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_content_summaries(vector, int, uuid) TO anon, authenticated, service_role;
