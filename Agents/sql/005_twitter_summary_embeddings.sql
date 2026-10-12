-- Twitter content summary vector search (agentic RAG)
-- Note: table + match_twitter_content_summaries are created in
-- supabase/migrations/20260918120000_twitter_scraping.sql.
-- This file documents the Agents-side embedding contract.

-- Embedding column and HNSW index live on twitter_content_summaries.
-- Use Agents backfill_twitter_summary_embeddings to populate embeddings.
