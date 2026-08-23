# Live Supabase data (no mocks)

## Purpose
Agents and MCP tools read production Supabase rows — especially LinkedIn competitor summaries — and use row `embedding` columns for agentic RAG. All competitor reads are scoped to the **authenticated user’s project**.

## Security contract
- Invoke/ingest require `Authorization: Bearer <supabase_access_token>`
- `user_id` comes from the JWT; `project_id` must be owned by that user
- Optional `tagged_avatar_ids` must all belong to that user (403 otherwise)
- Summary RAG always filters by `project_id` / resolved avatar ids (no cross-project reads)
- `fetch_profile` reads `avatars.profiling_data` for the avatar

## LinkedIn + Instagram agentic RAG
1. Embed summary JSON → row `embedding` (1536-dim)
2. On platform agent / context-ON chat: embed the user query
3. MCP `similarity_search` returns top-k matches for **this project**:
   - LinkedIn → `linkedin_content_summaries`
   - Instagram → `instagram_content_summaries` (platform=instagram)
4. Those summaries + brand profile + playbooks are assembled into CONTEXT
5. The LLM reasons only over retrieved chunks

Backfill (JWT + admin allowlist when `LLM_ENV=prod`):
- `POST /api/embeddings/backfill-linkedin-summaries`
- `POST /api/embeddings/backfill-summaries`

Optional SQL:
- `sql/004_linkedin_summary_embeddings.sql`
- `sql/003_content_summary_embeddings.sql`

## Known limitations
- Live Apify scrape not wired inside Agents (use ContOS scrape Backend)
- Product chat UI lives in ContOS Frontend (`/dashboard/:projectId/agents`)

## Future improvements
- Auto-embed on summary insert
- Wire Apify → scrape → summarize → embed pipeline
