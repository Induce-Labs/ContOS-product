-- ContOS Agents Phase 2 schema
-- Run in Supabase SQL editor. Does NOT recreate existing ContOS core tables.
-- Note: legacy `profiles` was removed Aug 2026; use avatars.profiling_data instead.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  avatar_id text,
  agent_type text NOT NULL,
  user_input text,
  context_snapshot jsonb,
  raw_response text,
  parsed_output jsonb,
  model_used text,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  status text DEFAULT 'success',
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_calls_user_id ON agent_calls (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_calls_avatar_id ON agent_calls (avatar_id);
CREATE INDEX IF NOT EXISTS idx_agent_calls_agent_type ON agent_calls (agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_calls_created_at ON agent_calls (created_at DESC);

CREATE TABLE IF NOT EXISTS playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text,
  topic text,
  rule_summary text,
  examples jsonb,
  tags text[],
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_category ON playbooks (category);
CREATE INDEX IF NOT EXISTS idx_playbooks_tags ON playbooks USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_playbooks_embedding
  ON playbooks
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_playbooks(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_category text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  category text,
  topic text,
  rule_summary text,
  examples jsonb,
  tags text[],
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.category,
    p.topic,
    p.rule_summary,
    p.examples,
    p.tags,
    (1 - (p.embedding <=> query_embedding))::float AS similarity
  FROM playbooks p
  WHERE p.embedding IS NOT NULL
    AND (filter_category IS NULL OR p.category = filter_category)
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;
