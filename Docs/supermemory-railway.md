# Supermemory on Railway

## Purpose

Self-host Supermemory (server ≥ 0.0.9) in the ContOS Railway project so Agents can call the v5 `/ns` Memory API. ContOS does not ship Supermemory; it only consumes `SUPERMEMORY_BASE_URL` + `SUPERMEMORY_API_KEY`. The public Memory Graph UI at `https://memory.contos.now` is also served from this service.

## Implementation overview

- Railway service: `supermemory` in project **Contos** / environment **production**
- Runtime: `debian:bookworm-slim` downloads and runs `supermemory-server` **0.0.9** onto the persistent volume (the prebuilt `supermemory/supermemory:0.0.9` image runs as non-root and cannot write Railway’s `/data` volume)
- Volume: `supermemory-volume` mounted at `/data` (graph DB, `/data/api-key`, console proxy scripts). Do not delete this volume without rotating Agents’ `SUPERMEMORY_API_KEY`.
- Public URL / custom domain: `https://memory.contos.now` (Railway `PORT` **6767**)
- Start path: deploy `startCommand` bootstraps `/data/sm-console-proxy.py` + `/data/sm-start.sh` (sources in `scripts/`), then runs the start script
- Railway memory limit: **2.5 GB** (service instance limit) to bound usage-based memory billing

## Architecture decisions

- Pin **0.0.9** via `SUPERMEMORY_SERVER_VERSION` (ContOS Agents use v5 `/ns` paths).
- LLM extraction: OpenRouter via `OPENAI_API_KEY` + `OPENAI_BASE_URL=https://openrouter.ai/api/v1`.
- **Remote embeddings** (cost/RAM): `openai-compatible` → OpenRouter `openai/text-embedding-3-small` @ **1536d**. Local Xenova embeddings were removed because they held a multi‑GB always-on RSS baseline on Railway.
- Switching embedding provider required wiping the on-volume store (`data/`, `embedding-plan.json`, models cache). Existing Railway memories were not migrated; ContOS profile sync re-populates.
- Ingest remains lean: `SUPERMEMORY_EMBEDDING_RAM_LIMIT=512mb`, `SUPERMEMORY_INGEST_CONCURRENCY=1`.
- Process layout:
  - `supermemory-server` binds `127.0.0.1:6768`
  - `scripts/supermemory-console-proxy.py` listens on public `$PORT` and reverse-proxies upstream
  - Proxy patches `GET /local-console.js` (Bearer strip, session key persist, list fallback)
- Config changes that must take effect in a new deploy use `railway environment edit` / `variable set` + deploy (not bare `railway redeploy` of an old manifest)

## Client configuration

Updated on both `contos-agents` and `contos-agents-worker`:

| Variable | Value |
| --- | --- |
| `SUPERMEMORY_BASE_URL` | `https://memory.contos.now` |
| `SUPERMEMORY_API_KEY` | Server-generated key from `/data/api-key` (read via `railway ssh -s supermemory -- cat /data/api-key`) |

After any store wipe that rotates `/data/api-key`, update both Agents services immediately.

## Service environment

| Variable | Notes |
| --- | --- |
| `SUPERMEMORY_SERVER_VERSION` | `0.0.9` |
| `SUPERMEMORY_DATA_DIR` | `/data` |
| `SUPERMEMORY_HOST` | `127.0.0.1` (binary private; proxy publishes `$PORT`) |
| `PORT` | `6767` (public proxy listen port) |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | OpenRouter LLM for memory extraction |
| `SUPERMEMORY_EMBEDDING_PROVIDER` | `openai-compatible` |
| `SUPERMEMORY_EMBEDDING_BASE_URL` | `https://openrouter.ai/api/v1` |
| `SUPERMEMORY_EMBEDDING_MODEL` | `openai/text-embedding-3-small` |
| `SUPERMEMORY_EMBEDDING_DIMENSIONS` | `1536` |
| `SUPERMEMORY_EMBEDDING_RAM_LIMIT` | `512mb` |
| `SUPERMEMORY_INGEST_CONCURRENCY` | `1` |
| `SUPERMEMORY_SKIP_EMBEDDING_PREWARM` | `1` |
| `SUPERMEMORY_LOCAL_EMBEDDING_*` | Retained but unused while provider is remote |

## Memory Graph dashboard

1. Open `https://memory.contos.now`
2. Paste the raw `sm_…` key from `/data/api-key` (with or without a leading `Bearer ` — the patched console normalizes it)
3. Confirm documents load; reload should keep the key for the tab session

## Verify

- Boot logs: `embeddings  openai-compatible · openai/text-embedding-3-small · 1536d` (not Xenova)
- `GET /v3/health` → 200 `{"status":"ok"}`
- `GET /local-console.js` contains `contos-sm-console-proxy`
- `POST /v3/documents/list` with `Authorization: Bearer <api-key>` → 200
- Railway metrics: memory well under the previous ~4.7 GB local-embedding peaks

## Known limitations

- Console proxy does not inject auth for anonymous clients; a valid API key is still required.
- Store wipe for embedding cutover emptied Railway memories; sync from ContOS is required to refill.
- Storage engine can still hold a non-trivial baseline RSS even with remote embeddings.
- Changing embedding provider/dimensions again needs another fresh store / re-ingest.
- Changing `deploy.startCommand` via GraphQL `serviceInstanceUpdate` alone does not update the next `railway redeploy` image-as-is; commit via `railway environment edit`.

## Usage metering (OpenRouter → ContOS)

Supermemory’s OpenRouter spend (extraction LLM + remote embeddings) is ingested into ContOS `usage_events` as `supermemory_llm` / `supermemory_embed`.

1. SM service uses a **dedicated** OpenRouter inference key (`OPENAI_API_KEY` on `supermemory`).
2. Agents services hold `OPENROUTER_MANAGEMENT_KEY` and preferably `SUPERMEMORY_OPENROUTER_API_KEY_HASH`.
3. Celery Beat schedules `usage.ingest_supermemory_openrouter` daily (UTC); admin can also `POST /api/admin/usage/supermemory-openrouter/ingest`.
4. See [supabase-usage-cost-ledger.md](./supabase-usage-cost-ledger.md).

Deploy a **beat** process (`Procfile` target `beat`) alongside `web` + `worker` so the schedule runs. Copy `OPENROUTER_MANAGEMENT_KEY` (and the hash) onto `contos-agents`, `contos-agents-worker`, and the beat service.

## Future improvements

- Upstream Memory Graph fix for double-`Bearer` so the console proxy can be removed.
- If Railway memory spend is still too high, move SM to a small fixed-cost VPS.
