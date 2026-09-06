# Phase i18n — Multi-language translation

## Purpose

Support English, Hindi, Chinese, French, and Spanish across ContOS:

1. **Static UI** via i18next locale catalogs
2. **Dashboard language selector** with `localStorage` persistence
3. **On-demand dynamic content translation** (summaries, posts, agent output) through a cache-first Agents API / Celery task

## Architecture

```text
Language selector (DashboardTopBar)
  → i18next locale + localStorage contos_locale
  → Static chrome from /locales/{lng}/common.json

Dynamic scraped/generated text
  → useTranslatedTexts hook
  → POST /api/translate (JWT)
  → translate_batch service
       ├─ translation_cache (Postgres / Supabase)
       └─ OpenRouter (TRANSLATION_MODEL) on miss

Background warm-cache (optional)
  → Celery translate.translate_content on website queue
```

English (`target_lang == source_lang`) is always a no-op.

## Frontend

| Piece | Path |
| --- | --- |
| Init | [`Frontend/src/i18n/index.ts`](../Frontend/src/i18n/index.ts) |
| Constants | `SUPPORTED_LANGUAGES = ["en","hi","zh","fr","es"]` |
| Catalogs | [`Frontend/public/locales/{en,hi,zh,fr,es}/common.json`](../Frontend/public/locales/en/common.json) |
| Selector | [`LanguageSelector.tsx`](../Frontend/src/components/LanguageSelector.tsx) in TopBar + ProfilingStep |
| Dynamic hook | [`useTranslatedTexts.ts`](../Frontend/src/hooks/useTranslatedTexts.ts) |
| Profiling Qs | [`useLocalizedQuestionnaire.ts`](../Frontend/src/hooks/useLocalizedQuestionnaire.ts) |
| Answer EN I/O | [`profilingLocale.ts`](../Frontend/src/lib/profilingLocale.ts) |
| API client | `translateTexts()` in [`agentsApi.ts`](../Frontend/src/lib/agentsApi.ts) |

Storage key: `contos_locale` (same `contos_*` pattern as last avatar).

### Profiling questionnaire flow

1. Questions load from Supabase in English (`profiling_questionnaires`).
2. UI translates question / options / placeholders to the active locale for display (`useLocalizedQuestionnaire` + chunked `translateTexts` in batches of 12, with one client retry).
3. User answers in the selected language; on save, free-text answers are translated to English and written to `avatars.profiling_data` (English `question` + `answer`). Select options map back to English labels without an LLM call (`optionMaps` / `englishOptions` on display questions).
4. On load / language change, stored English answers are translated to the locale for the draft UI (wizard + review). Translate failures keep English draft text and surface an error — no silent invention.
5. Language selector is shared (`LanguageSelector`) on the dashboard top bar and the profiling wizard header.

Agents and profile summaries continue to consume English profiling data. Backend OpenRouter calls also use batches of 12 with batched cache lookups so large questionnaires do not drop JSON keys under concurrent load.

### Helper tests

```bash
cd Frontend && npx --yes tsx scripts/test-profiling-locale.ts
```

Covers option reverse-map, `shouldTranslateAnswerToEnglish` skip-when-en, and URL passthrough (`looksLikeUrl`).

### Analytics

Competitor intelligence body text (captions, hooks, themes, signals, why-it-performed) uses `useTranslatedTexts` in `CompetitorSummaryCard`.

**Dynamic / all languages:** The hook re-runs whenever summary text changes (dashboard polls every 5s — new competitors finish scraping → new summary → auto-translate into the active UI language: `hi` / `zh` / `fr` / `es`). Switching the language selector also re-translates. English is a passthrough. Requests are chunked (12) with one retry and client+Postgres cache so repeats are cheap.

Content-type badges and metric chrome use i18next (`competitors.summaryCard.contentTypes.*`).

### Languages covered

Selector and `/api/translate` allowlist are the same set: **en, hi, zh, fr, es**. No per-language special cases for dynamic content — every non-English target uses the same on-demand path.

### Profiling field chrome

Field placeholders / competitor hints use `profiling.field.*`. Validation returns `profiling.validation.*` keys resolved with `t()` in the wizard/review hooks. Both surfaces show `agents.translating` while questions or answers localize.

### One-off UI catalog translation

```bash
python scripts/translate_ui_strings.py
```

Reads `en/common.json`, calls OpenRouter once per target language, writes `hi`/`zh`/`fr`/`es`. Requires `OPENROUTER_API_KEY`. Model: `TRANSLATION_MODEL` (default `openai/gpt-4o-mini`).

## Backend (Agents)

| Piece | Path |
| --- | --- |
| Constants | [`Agents/backend/constants.py`](../Agents/backend/constants.py) |
| Service | [`Agents/backend/services/translate.py`](../Agents/backend/services/translate.py) |
| Celery task | `translate.translate_content` in [`tasks/translate.py`](../Agents/backend/tasks/translate.py) |
| Enqueue | [`services/enqueue_translate.py`](../Agents/backend/services/enqueue_translate.py) |
| HTTP | `POST /api/translate` in [`main.py`](../Agents/backend/main.py) |

### API

```http
POST /api/translate
Authorization: Bearer <supabase jwt>
Content-Type: application/json

{ "texts": ["Hello"], "target_lang": "hi", "source_lang": "en" }

→ 200 { "translations": ["..."], "target_lang": "hi", "source_lang": "en" }
```

Limits (400 on violation): max 40 strings, 4k chars each, 24k chars total. Languages must be in `SUPPORTED_LANGUAGES`.

### Cache table

Migration: [`supabase/migrations/20260906120000_translation_cache.sql`](../supabase/migrations/20260906120000_translation_cache.sql)

- Columns: `source_hash`, `source_lang`, `target_lang`, `translated_text`, `created_at`
- Unique `(source_hash, source_lang, target_lang)`
- `source_hash` = SHA-256(`source_lang + "\0" + text`) — **source text is not stored**
- RLS enabled, no client policies (service_role only)

### Env

| Variable | Default | Notes |
| --- | --- | --- |
| `TRANSLATION_MODEL` | `openai/gpt-4o-mini` | OpenRouter model for translation |
| `TRANSLATION_MAX_RETRIES` | `3` | In-process LLM retries |
| `CELERY_TASK_MAX_RETRIES` | `2` | Celery task retries |
| `OPENROUTER_API_KEY` | — | Required |

Declared in [`Agents/backend/.env.example`](../Agents/backend/.env.example).

## Architecture decisions

- **On-demand** dynamic translation (not eager pipeline) so English storage stays canonical and cost stays low.
- **Agent replies** use generation-time `response_language` on `POST /api/agents/invoke`: a high-priority system-prompt instruction **plus** a short reminder on the final user turn. For Instagram/LinkedIn/Twitter structured JSON, that includes **hooks, captions, CTAs, hashtags, transcripts, top_hooks, caption_formulas** — fully in the UI language with **no code-mixing** (e.g. no Hinglish) — not only reasoning. Mid-thread UI language switches override English competitor-source bias. Not post-hoc translation of SSE tokens.
- **Postgres cache** rather than Redis: translations are durable content; Redis is reserved for broker/locks/rate limits.
- **Same website queue** for Celery translation (no extra worker); dashboard path uses in-process `translate_batch` for one RTT.
- Shared `SUPPORTED_LANGUAGES` duplicated in Frontend TS + Agents Python (no monorepo shared package yet).

## Security

- Translate API requires JWT; languages allowlisted; payload size capped
- API key never exposed to the browser
- Cache is global by content hash (no user_id); no source text stored
- Structured logs omit full post bodies

## Known limitations

- Locale is client-only (`localStorage`); not synced to `user_profiles`
- Live SSE token streams are not translated mid-flight
- Profiling questionnaire rows stay English in Supabase; UI translates on demand
- Catalog files for hi/zh/fr/es may lag `en` until `scripts/translate_ui_strings.py` is re-run for new keys
- `profile_summary` / `website_summary` are not rendered in the UI today (English remains fine for agents)
- Requires `public.translation_cache` migration applied; without it `/api/translate` fails and Profiling/Analytics stay English

## Future improvements

- Persist preferred language on `user_profiles`
- Dedicated Celery `translate` queue if website rate limits contend
- Eager optional pre-translation for top summaries after scrape
