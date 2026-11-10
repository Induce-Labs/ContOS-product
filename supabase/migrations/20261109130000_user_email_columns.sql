-- Drop admin-only readable views; store user_email on base tables instead.
-- Triggers always overwrite user_email from auth.users (never trust clients).

DROP VIEW IF EXISTS public.agent_calls_readable;
DROP VIEW IF EXISTS public.agent_chat_stores_readable;
DROP VIEW IF EXISTS public.avatars_readable;
DROP VIEW IF EXISTS public.content_plan_items_readable;
DROP VIEW IF EXISTS public.user_profiles_readable;
DROP VIEW IF EXISTS public.postiz_connections_readable;

CREATE OR REPLACE FUNCTION public.contos_lookup_user_email(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.email
  FROM auth.users AS u
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.contos_lookup_user_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contos_lookup_user_email(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.contos_lookup_user_email(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contos_lookup_user_email(uuid) TO anon;

CREATE OR REPLACE FUNCTION public.contos_parse_user_id_text(p_user_id text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN p_user_id::uuid
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.contos_email_from_avatar(p_avatar_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.contos_lookup_user_email(a.user_id)
  FROM public.avatars AS a
  WHERE a.id = p_avatar_id;
$$;

CREATE OR REPLACE FUNCTION public.contos_email_from_competitor(p_competitor_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.contos_email_from_avatar(c.avatar_id)
  FROM public.competitors AS c
  WHERE c.id = p_competitor_id;
$$;

REVOKE ALL ON FUNCTION public.contos_email_from_avatar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contos_email_from_competitor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contos_email_from_avatar(uuid) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.contos_email_from_competitor(uuid) TO service_role, authenticated, anon;

-- Columns
ALTER TABLE public.avatars ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.agent_calls ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.agent_chat_stores ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.content_plan_items ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.postiz_connections ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.competitors ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.instagram_content_summaries ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.linkedin_content_summaries ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.twitter_content_summaries ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.instagram_scraped_content ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.linkedin_scraped_content ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.twitter_scraped_content ADD COLUMN IF NOT EXISTS user_email text;

-- Backfill
UPDATE public.avatars AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.user_profiles AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.agent_calls AS t
SET user_email = public.contos_lookup_user_email(public.contos_parse_user_id_text(t.user_id));

UPDATE public.agent_chat_stores AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.content_plan_items AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.postiz_connections AS t
SET user_email = public.contos_lookup_user_email(t.contos_user_id);

UPDATE public.competitors AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.instagram_content_summaries AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.linkedin_content_summaries AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.twitter_content_summaries AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.instagram_scraped_content AS t
SET user_email = public.contos_email_from_competitor(t.competitor_id);

UPDATE public.linkedin_scraped_content AS t
SET user_email = public.contos_email_from_competitor(t.competitor_id);

UPDATE public.twitter_scraped_content AS t
SET user_email = public.contos_email_from_competitor(t.competitor_id);

-- Trigger functions (always overwrite user_email from auth)
CREATE OR REPLACE FUNCTION public.contos_set_user_email_from_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  NEW.user_email := public.contos_lookup_user_email(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.contos_set_user_email_from_user_id_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  NEW.user_email := public.contos_lookup_user_email(
    public.contos_parse_user_id_text(NEW.user_id)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.contos_set_user_email_from_contos_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  NEW.user_email := public.contos_lookup_user_email(NEW.contos_user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.contos_set_user_email_from_avatar_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  NEW.user_email := public.contos_email_from_avatar(NEW.avatar_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.contos_set_user_email_from_competitor_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  NEW.user_email := public.contos_email_from_competitor(NEW.competitor_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.contos_cascade_avatar_user_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;

  v_email := public.contos_lookup_user_email(NEW.user_id);

  UPDATE public.competitors
  SET user_email = v_email
  WHERE avatar_id = NEW.id;

  UPDATE public.instagram_content_summaries
  SET user_email = v_email
  WHERE avatar_id = NEW.id;

  UPDATE public.linkedin_content_summaries
  SET user_email = v_email
  WHERE avatar_id = NEW.id;

  UPDATE public.twitter_content_summaries
  SET user_email = v_email
  WHERE avatar_id = NEW.id;

  UPDATE public.instagram_scraped_content AS s
  SET user_email = v_email
  FROM public.competitors AS c
  WHERE c.id = s.competitor_id AND c.avatar_id = NEW.id;

  UPDATE public.linkedin_scraped_content AS s
  SET user_email = v_email
  FROM public.competitors AS c
  WHERE c.id = s.competitor_id AND c.avatar_id = NEW.id;

  UPDATE public.twitter_scraped_content AS s
  SET user_email = v_email
  FROM public.competitors AS c
  WHERE c.id = s.competitor_id AND c.avatar_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contos_user_email_avatars ON public.avatars;
CREATE TRIGGER trg_contos_user_email_avatars
  BEFORE INSERT OR UPDATE OF user_id ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_user_id();

DROP TRIGGER IF EXISTS trg_contos_cascade_avatar_user_email ON public.avatars;
CREATE TRIGGER trg_contos_cascade_avatar_user_email
  AFTER UPDATE OF user_id ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_cascade_avatar_user_email();

DROP TRIGGER IF EXISTS trg_contos_user_email_user_profiles ON public.user_profiles;
CREATE TRIGGER trg_contos_user_email_user_profiles
  BEFORE INSERT OR UPDATE OF user_id ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_user_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_agent_calls ON public.agent_calls;
CREATE TRIGGER trg_contos_user_email_agent_calls
  BEFORE INSERT OR UPDATE OF user_id ON public.agent_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_user_id_text();

DROP TRIGGER IF EXISTS trg_contos_user_email_agent_chat_stores ON public.agent_chat_stores;
CREATE TRIGGER trg_contos_user_email_agent_chat_stores
  BEFORE INSERT OR UPDATE OF user_id ON public.agent_chat_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_user_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_content_plan_items ON public.content_plan_items;
CREATE TRIGGER trg_contos_user_email_content_plan_items
  BEFORE INSERT OR UPDATE OF user_id ON public.content_plan_items
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_user_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_postiz_connections ON public.postiz_connections;
CREATE TRIGGER trg_contos_user_email_postiz_connections
  BEFORE INSERT OR UPDATE OF contos_user_id ON public.postiz_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_contos_user_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_competitors ON public.competitors;
CREATE TRIGGER trg_contos_user_email_competitors
  BEFORE INSERT OR UPDATE OF avatar_id ON public.competitors
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_avatar_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_ig_summaries ON public.instagram_content_summaries;
CREATE TRIGGER trg_contos_user_email_ig_summaries
  BEFORE INSERT OR UPDATE OF avatar_id ON public.instagram_content_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_avatar_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_li_summaries ON public.linkedin_content_summaries;
CREATE TRIGGER trg_contos_user_email_li_summaries
  BEFORE INSERT OR UPDATE OF avatar_id ON public.linkedin_content_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_avatar_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_tw_summaries ON public.twitter_content_summaries;
CREATE TRIGGER trg_contos_user_email_tw_summaries
  BEFORE INSERT OR UPDATE OF avatar_id ON public.twitter_content_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_avatar_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_ig_scraped ON public.instagram_scraped_content;
CREATE TRIGGER trg_contos_user_email_ig_scraped
  BEFORE INSERT OR UPDATE OF competitor_id ON public.instagram_scraped_content
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_competitor_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_li_scraped ON public.linkedin_scraped_content;
CREATE TRIGGER trg_contos_user_email_li_scraped
  BEFORE INSERT OR UPDATE OF competitor_id ON public.linkedin_scraped_content
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_competitor_id();

DROP TRIGGER IF EXISTS trg_contos_user_email_tw_scraped ON public.twitter_scraped_content;
CREATE TRIGGER trg_contos_user_email_tw_scraped
  BEFORE INSERT OR UPDATE OF competitor_id ON public.twitter_scraped_content
  FOR EACH ROW
  EXECUTE FUNCTION public.contos_set_user_email_from_competitor_id();

COMMENT ON COLUMN public.avatars.user_email IS
  'Denormalized auth.users.email for Table Editor; maintained by trigger.';
COMMENT ON FUNCTION public.contos_lookup_user_email(uuid) IS
  'Resolve ContOS user email from auth.users for user_email column triggers.';
