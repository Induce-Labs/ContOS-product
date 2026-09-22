-- ContOS user → one Postiz LinkedIn integration (nullable for legacy rows).
-- Partial unique index prevents the same integration from being claimed by two users.

ALTER TABLE public.postiz_connections
  ADD COLUMN IF NOT EXISTS postiz_integration_id text
  CHECK (
    postiz_integration_id IS NULL
    OR char_length(trim(postiz_integration_id)) > 0
  );

CREATE UNIQUE INDEX IF NOT EXISTS
postiz_connections_postiz_integration_id_unique
ON public.postiz_connections (postiz_integration_id)
WHERE postiz_integration_id IS NOT NULL;
