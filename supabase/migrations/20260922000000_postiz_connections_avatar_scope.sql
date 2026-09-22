-- ContOS Postiz connections: avatar-scoped (one dedicated org/token per avatar).
-- Legacy rows keep avatar_id NULL and are never reassigned by this migration.

ALTER TABLE public.postiz_connections
  ADD COLUMN IF NOT EXISTS avatar_id uuid
  REFERENCES public.avatars (id) ON DELETE CASCADE;

ALTER TABLE public.postiz_connections
  DROP CONSTRAINT IF EXISTS postiz_connections_contos_user_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS postiz_connections_avatar_id_unique
ON public.postiz_connections (avatar_id)
WHERE avatar_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS postiz_connections_avatar_id_idx
ON public.postiz_connections (avatar_id);

-- Fail clearly if duplicate organization IDs exist before enforcing uniqueness.
DO $$
DECLARE
  duplicate_orgs text;
BEGIN
  SELECT string_agg(postiz_organization_id, ', ' ORDER BY postiz_organization_id)
  INTO duplicate_orgs
  FROM (
    SELECT postiz_organization_id
    FROM public.postiz_connections
    GROUP BY postiz_organization_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF duplicate_orgs IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create unique index on postiz_connections.postiz_organization_id: duplicate organization IDs exist (%). Resolve duplicates manually before re-running this migration. Existing rows were not modified.',
      duplicate_orgs;
  END IF;
END $$;

DROP INDEX IF EXISTS public.postiz_connections_postiz_organization_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS postiz_connections_postiz_organization_id_unique
ON public.postiz_connections (postiz_organization_id);
