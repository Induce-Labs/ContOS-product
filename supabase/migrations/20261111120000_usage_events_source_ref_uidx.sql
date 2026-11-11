-- Idempotent metering refs for Supermemory OpenRouter ingest only.
-- Broader uniqueness on all source_ref values is blocked by existing
-- non-SM duplicates (e.g. reused job UUIDs).

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_sm_or_source_ref_uidx
  ON public.usage_events (source_ref)
  WHERE source_ref LIKE 'sm-or:%';

COMMENT ON INDEX public.usage_events_sm_or_source_ref_uidx IS
  'Idempotent Supermemory OpenRouter metering refs (sm-or:date:model:kind).';
