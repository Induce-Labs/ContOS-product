# Supermemory on Railway

## Purpose

Self-host Supermemory (server ≥ 0.0.9) in the ContOS Railway project so Agents can call the v5 `/ns` Memory API. ContOS does not ship Supermemory; it only consumes `SUPERMEMORY_BASE_URL` + `SUPERMEMORY_API_KEY`.

## Implementation overview

- Railway service: `supermemory` in project **Contos** / environment **production**
- Runtime: official Railway Supermemory template pattern — `debian:bookworm-slim` downloads and runs `supermemory-server` **0.0.9** onto the persistent volume (the prebuilt `supermemory/supermemory:0.0.9` image runs as non-root and cannot write Railway’s `/data` volume)
- Volume: `supermemory-volume` mounted at `/data` (graph DB, `/data/api-key`, embedding cache). Do not delete this volume.
- Public URL: `https://supermemory-production-430d.up.railway.app` (port **6767**)
- Custom domain `memory.contos.now` is attached but requires DNS (CNAME `memory` → `uvxxx6gi.up.railway.app` plus TXT `_railway-verify.memory`) before TLS verifies

## Architecture decisions

- Pin **0.0.9** via `SUPERMEMORY_SERVER_VERSION` (ContOS Agents use v5 `/ns` paths).
- LLM: ContOS has no live OpenAI key on Railway; Supermemory uses Agents’ OpenRouter key as `OPENAI_API_KEY` with `OPENAI_BASE_URL=https://openrouter.ai/api/v1`.
- Embeddings: local default (`Xenova/bge-base-en-v1.5`); first boot downloads the model.
- Bind: `SUPERMEMORY_HOST=0.0.0.0`, `PORT=6767`.

## Client configuration

Updated on both `contos-agents` and `contos-agents-worker`:

| Variable | Value |
| --- | --- |
| `SUPERMEMORY_BASE_URL` | Railway HTTPS URL above (switch to `https://memory.contos.now` after DNS) |
| `SUPERMEMORY_API_KEY` | Server-generated key from `/data/api-key` (read via `railway ssh -s supermemory -- cat /data/api-key`) |

## Service environment

| Variable | Notes |
| --- | --- |
| `SUPERMEMORY_SERVER_VERSION` | `0.0.9` |
| `SUPERMEMORY_DATA_DIR` | `/data` |
| `SUPERMEMORY_HOST` | `0.0.0.0` |
| `PORT` | `6767` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | OpenRouter-compatible LLM for memory extraction |

## Verify

- `GET /v3/health` → 200 `{"status":"ok"}`
- `GET /v3/projects` with `Authorization: Bearer <api-key>` → 200 (empty projects list is fine on a fresh volume)

## Known limitations

- New volume starts empty; no migration from the previous dead `memory.contos.now` host.
- Custom domain is not live until DNS records are updated.
- OpenRouter is used instead of native OpenAI; embedding stays local.

## Future improvements

- Point Agents at `https://memory.contos.now` once DNS verifies.
- Optional provider key rotation / dedicated OpenAI key if OpenRouter limits memory extraction quality.
