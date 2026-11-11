-- Rate card for Supermemory extraction model (openai/gpt-4.1-mini via OpenRouter).

INSERT INTO public.usage_price_rates (provider, model_or_actor, unit, unit_price_usd, notes)
SELECT v.provider, v.model_or_actor, v.unit, v.unit_price_usd, v.notes
FROM (
  VALUES
    ('openrouter'::text, 'openai/gpt-4.1-mini'::text, 'token_in'::text, 0.40 / 1000000.0, 'OpenRouter-ish list for SM extraction; confirm'),
    ('openrouter', 'openai/gpt-4.1-mini', 'token_out', 1.60 / 1000000.0, 'OpenRouter-ish list for SM extraction; confirm')
) AS v(provider, model_or_actor, unit, unit_price_usd, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.usage_price_rates r
  WHERE r.provider = v.provider
    AND r.unit = v.unit
    AND r.model_or_actor IS NOT DISTINCT FROM v.model_or_actor
);
