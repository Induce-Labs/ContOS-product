-- Source-grounded marketing reference corpus for the Agents demo.
-- Service-role access only: the browser never reads raw source material directly.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.marketing_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  source_hash text NOT NULL,
  section text,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL CHECK (length(trim(content)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_hash, chunk_index)
);

ALTER TABLE public.marketing_knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS marketing_knowledge_chunks_embedding_idx
  ON public.marketing_knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS marketing_knowledge_chunks_source_idx
  ON public.marketing_knowledge_chunks (source_name, chunk_index);

CREATE OR REPLACE FUNCTION public.match_marketing_knowledge_chunks(
  query_embedding vector(1536),
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  source_name text,
  section text,
  chunk_index integer,
  content text,
  metadata jsonb,
  similarity real
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.id,
    c.source_name,
    c.section,
    c.chunk_index,
    c.content,
    c.metadata,
    (1 - (c.embedding <=> query_embedding))::real AS similarity
  FROM public.marketing_knowledge_chunks c
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
