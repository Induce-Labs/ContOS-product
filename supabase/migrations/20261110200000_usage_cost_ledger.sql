-- ContOS usage & estimated-cost ledger (admin / service_role).
-- user_email is physical column #1 on usage_events (Table Editor).

CREATE TABLE IF NOT EXISTS public.usage_price_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('openrouter', 'apify', 'supermemory')),
  model_or_actor text,
  unit text NOT NULL CHECK (
    unit IN ('token_in', 'token_out', 'token_embed', 'scrape_item', 'sm_op')
  ),
  unit_price_usd numeric(18, 12) NOT NULL CHECK (unit_price_usd >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_price_rates_lookup_uidx
  ON public.usage_price_rates (
    provider,
    COALESCE(model_or_actor, ''),
    unit,
    effective_from
  );

CREATE INDEX IF NOT EXISTS usage_price_rates_provider_unit_idx
  ON public.usage_price_rates (provider, unit, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.usage_events (
  user_email text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  avatar_id text,
  operation text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openrouter', 'apify', 'supermemory')),
  model_or_actor text,
  input_tokens int NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens int NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  embed_tokens int NOT NULL DEFAULT 0 CHECK (embed_tokens >= 0),
  scrape_items int NOT NULL DEFAULT 0 CHECK (scrape_items >= 0),
  sm_ops int NOT NULL DEFAULT 0 CHECK (sm_ops >= 0),
  estimated_cost_usd numeric(18, 10) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  source text NOT NULL CHECK (source IN ('agents', 'backend')),
  source_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS usage_events_user_created_idx
  ON public.usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_operation_created_idx
  ON public.usage_events (operation, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_avatar_created_idx
  ON public.usage_events (avatar_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_created_idx
  ON public.usage_events (created_at DESC);

ALTER TABLE public.usage_price_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.usage_price_rates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.usage_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.usage_price_rates TO service_role;
GRANT ALL ON public.usage_events TO service_role;

-- Seed rate card (estimates; edit in Table Editor without deploys)
INSERT INTO public.usage_price_rates (provider, model_or_actor, unit, unit_price_usd, notes)
SELECT v.provider, v.model_or_actor, v.unit, v.unit_price_usd, v.notes
FROM (
  VALUES
    ('openrouter'::text, 'moonshotai/kimi-k2.6'::text, 'token_in'::text, 0.65 / 1000000.0, 'USD per token; OpenRouter list ~$0.65/1M'),
    ('openrouter', 'moonshotai/kimi-k2.6', 'token_out', 3.41 / 1000000.0, 'USD per token; OpenRouter list ~$3.41/1M'),
    ('openrouter', 'google/gemini-2.5-flash', 'token_in', 0.30 / 1000000.0, 'Estimate; confirm on OpenRouter'),
    ('openrouter', 'google/gemini-2.5-flash', 'token_out', 2.50 / 1000000.0, 'Estimate; confirm on OpenRouter'),
    ('openrouter', 'openai/gpt-4o-mini', 'token_in', 0.15 / 1000000.0, 'OpenRouter-ish list; confirm'),
    ('openrouter', 'openai/gpt-4o-mini', 'token_out', 0.60 / 1000000.0, 'OpenRouter-ish list; confirm'),
    ('openrouter', 'openai/text-embedding-3-small', 'token_embed', 0.02 / 1000000.0, 'USD per embed token'),
    ('apify', 'apify/website-content-crawler', 'scrape_item', 0.002, 'Estimate USD per crawled page/item'),
    ('apify', 'apify/instagram-post-scraper', 'scrape_item', 0.0025, 'Estimate USD per post result'),
    ('apify', 'datadoping/linkedin-profile-posts-scraper', 'scrape_item', 0.0012, '~$1.20/1k posts (docs)'),
    ('apify', 'xquik/x-tweet-scraper', 'scrape_item', 0.002, 'Estimate USD per tweet result'),
    ('apify', 'apple_yang/instagram-transcripts-scraper', 'scrape_item', 0.01, 'Estimate USD per transcript URL'),
    ('supermemory', NULL, 'sm_op', 0, 'Self-hosted; meter ops not vendor tokens')
) AS v(provider, model_or_actor, unit, unit_price_usd, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.usage_price_rates r
  WHERE r.provider = v.provider
    AND r.unit = v.unit
    AND r.model_or_actor IS NOT DISTINCT FROM v.model_or_actor
);

CREATE OR REPLACE FUNCTION public.contos_usage_unit_price(
  p_provider text,
  p_model_or_actor text,
  p_unit text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (
      SELECT r.unit_price_usd
      FROM public.usage_price_rates r
      WHERE r.provider = p_provider
        AND r.unit = p_unit
        AND r.effective_from <= now()
        AND (
          r.model_or_actor IS NOT DISTINCT FROM NULLIF(trim(p_model_or_actor), '')
          OR (
            NULLIF(trim(p_model_or_actor), '') IS NOT NULL
            AND r.model_or_actor = NULLIF(trim(p_model_or_actor), '')
          )
        )
      ORDER BY
        CASE WHEN r.model_or_actor IS NOT NULL THEN 0 ELSE 1 END,
        r.effective_from DESC
      LIMIT 1
    ),
    (
      SELECT r.unit_price_usd
      FROM public.usage_price_rates r
      WHERE r.provider = p_provider
        AND r.unit = p_unit
        AND r.model_or_actor IS NULL
        AND r.effective_from <= now()
      ORDER BY r.effective_from DESC
      LIMIT 1
    ),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.contos_log_usage_event(
  p_user_id text DEFAULT NULL,
  p_avatar_id text DEFAULT NULL,
  p_operation text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_model_or_actor text DEFAULT NULL,
  p_input_tokens int DEFAULT 0,
  p_output_tokens int DEFAULT 0,
  p_embed_tokens int DEFAULT 0,
  p_scrape_items int DEFAULT 0,
  p_sm_ops int DEFAULT 0,
  p_status text DEFAULT 'success',
  p_error_message text DEFAULT NULL,
  p_source text DEFAULT 'agents',
  p_source_ref text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_uid uuid;
  v_cost numeric(18, 10);
  v_resolved_user_id text := NULLIF(trim(p_user_id), '');
  v_in int := GREATEST(COALESCE(p_input_tokens, 0), 0);
  v_out int := GREATEST(COALESCE(p_output_tokens, 0), 0);
  v_emb int := GREATEST(COALESCE(p_embed_tokens, 0), 0);
  v_items int := GREATEST(COALESCE(p_scrape_items, 0), 0);
  v_sm int := GREATEST(COALESCE(p_sm_ops, 0), 0);
BEGIN
  IF p_operation IS NULL OR length(trim(p_operation)) = 0 THEN
    RAISE EXCEPTION 'p_operation is required';
  END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('openrouter', 'apify', 'supermemory') THEN
    RAISE EXCEPTION 'Invalid p_provider: %', p_provider;
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('agents', 'backend') THEN
    RAISE EXCEPTION 'Invalid p_source: %', p_source;
  END IF;

  IF v_resolved_user_id IS NOT NULL THEN
    BEGIN
      v_uid := v_resolved_user_id::uuid;
      v_email := public.contos_lookup_user_email(v_uid);
    EXCEPTION WHEN invalid_text_representation THEN
      v_email := NULL;
    END;
  ELSIF p_avatar_id IS NOT NULL AND length(trim(p_avatar_id)) > 0 THEN
    SELECT a.user_email, a.user_id::text
    INTO v_email, v_resolved_user_id
    FROM public.avatars a
    WHERE a.id::text = trim(p_avatar_id)
    LIMIT 1;
  END IF;

  v_cost :=
    (v_in::numeric * public.contos_usage_unit_price(p_provider, p_model_or_actor, 'token_in'))
    + (v_out::numeric * public.contos_usage_unit_price(p_provider, p_model_or_actor, 'token_out'))
    + (v_emb::numeric * public.contos_usage_unit_price(p_provider, p_model_or_actor, 'token_embed'))
    + (v_items::numeric * public.contos_usage_unit_price(p_provider, p_model_or_actor, 'scrape_item'))
    + (v_sm::numeric * public.contos_usage_unit_price(p_provider, p_model_or_actor, 'sm_op'));

  INSERT INTO public.usage_events (
    user_email,
    user_id,
    avatar_id,
    operation,
    provider,
    model_or_actor,
    input_tokens,
    output_tokens,
    embed_tokens,
    scrape_items,
    sm_ops,
    estimated_cost_usd,
    status,
    error_message,
    source,
    source_ref,
    metadata
  ) VALUES (
    v_email,
    v_resolved_user_id,
    NULLIF(trim(p_avatar_id), ''),
    trim(p_operation),
    p_provider,
    NULLIF(trim(p_model_or_actor), ''),
    v_in,
    v_out,
    v_emb,
    v_items,
    v_sm,
    ROUND(v_cost, 10),
    COALESCE(NULLIF(trim(p_status), ''), 'success'),
    p_error_message,
    p_source,
    NULLIF(trim(p_source_ref), ''),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.contos_usage_unit_price(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contos_log_usage_event(
  text, text, text, text, text, int, int, int, int, int, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contos_usage_unit_price(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.contos_log_usage_event(
  text, text, text, text, text, int, int, int, int, int, text, text, text, text, jsonb
) TO service_role;

CREATE OR REPLACE VIEW public.usage_daily_by_user
WITH (security_invoker = true)
AS
SELECT
  (created_at AT TIME ZONE 'UTC')::date AS day_utc,
  user_email,
  user_id,
  operation,
  provider,
  COUNT(*)::bigint AS event_count,
  SUM(input_tokens)::bigint AS input_tokens,
  SUM(output_tokens)::bigint AS output_tokens,
  SUM(embed_tokens)::bigint AS embed_tokens,
  SUM(scrape_items)::bigint AS scrape_items,
  SUM(sm_ops)::bigint AS sm_ops,
  SUM(estimated_cost_usd)::numeric(18, 10) AS estimated_cost_usd
FROM public.usage_events
GROUP BY 1, 2, 3, 4, 5;

REVOKE ALL ON public.usage_daily_by_user FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usage_daily_by_user TO service_role;

COMMENT ON TABLE public.usage_price_rates IS
  'Editable ContOS unit-price card for estimated usage costs.';
COMMENT ON TABLE public.usage_events IS
  'Append-only ContOS usage ledger with estimated_cost_usd from usage_price_rates.';
COMMENT ON FUNCTION public.contos_log_usage_event IS
  'Insert one usage_events row; prices estimated_cost_usd from usage_price_rates.';
