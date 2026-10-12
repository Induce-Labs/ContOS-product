-- ContOS Postiz OAuth connections: one encrypted organization token per ContOS user.
-- Backend/service-role only. No browser policies (RLS enabled as defense in depth).

CREATE TABLE IF NOT EXISTS public.postiz_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contos_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  postiz_organization_id text NOT NULL CHECK (char_length(trim(postiz_organization_id)) > 0),
  encrypted_access_token text NOT NULL CHECK (char_length(trim(encrypted_access_token)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT postiz_connections_contos_user_id_unique UNIQUE (contos_user_id)
);

CREATE INDEX IF NOT EXISTS postiz_connections_contos_user_id_idx
  ON public.postiz_connections (contos_user_id);

CREATE INDEX IF NOT EXISTS postiz_connections_postiz_organization_id_idx
  ON public.postiz_connections (postiz_organization_id);

CREATE OR REPLACE FUNCTION public.set_postiz_connections_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS postiz_connections_set_updated_at ON public.postiz_connections;
CREATE TRIGGER postiz_connections_set_updated_at
  BEFORE UPDATE ON public.postiz_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_postiz_connections_updated_at();

ALTER TABLE public.postiz_connections ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies for anon/authenticated.
-- ContOS backend uses the Supabase service role and filters by authenticated contos_user_id.
