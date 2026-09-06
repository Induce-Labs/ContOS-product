-- Translation cache for on-demand OpenRouter translations (service_role only).

CREATE TABLE IF NOT EXISTS public.translation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash text NOT NULL,
  source_lang text NOT NULL,
  target_lang text NOT NULL,
  translated_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT translation_cache_source_lang_check
    CHECK (source_lang IN ('en', 'hi', 'zh', 'fr', 'es')),
  CONSTRAINT translation_cache_target_lang_check
    CHECK (target_lang IN ('en', 'hi', 'zh', 'fr', 'es')),
  CONSTRAINT translation_cache_langs_distinct_check
    CHECK (source_lang <> target_lang),
  CONSTRAINT translation_cache_hash_langs_unique
    UNIQUE (source_hash, source_lang, target_lang)
);

CREATE INDEX IF NOT EXISTS translation_cache_created_at_idx
  ON public.translation_cache (created_at);

ALTER TABLE public.translation_cache ENABLE ROW LEVEL SECURITY;

-- No client policies: only service_role (bypasses RLS) may read/write.
COMMENT ON TABLE public.translation_cache IS
  'Cached OpenRouter translations keyed by SHA-256(source_lang + NUL + text). No source text stored.';
