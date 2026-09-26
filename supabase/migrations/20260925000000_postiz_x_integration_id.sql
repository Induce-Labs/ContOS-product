-- Separate X integration id per avatar. Does not change postiz_integration_id (LinkedIn).

ALTER TABLE public.postiz_connections
  ADD COLUMN IF NOT EXISTS postiz_x_integration_id text
  CHECK (
    postiz_x_integration_id IS NULL
    OR char_length(trim(postiz_x_integration_id)) > 0
  );

CREATE UNIQUE INDEX IF NOT EXISTS
postiz_connections_postiz_x_integration_id_unique
ON public.postiz_connections (postiz_x_integration_id)
WHERE postiz_x_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS postiz_connections_postiz_x_integration_id_idx
ON public.postiz_connections (postiz_x_integration_id)
WHERE postiz_x_integration_id IS NOT NULL;
