-- Read-only views that prepend auth.users.email for Table Editor browsing.
-- Base tables are unchanged; ContOS app code continues to write user_id only.
-- Intended for dashboard / service_role inspection (PII). Not exposed to anon.

CREATE OR REPLACE VIEW public.agent_calls_readable
WITH (security_invoker = true)
AS
SELECT
  u.email AS user_email,
  t.*
FROM public.agent_calls AS t
LEFT JOIN auth.users AS u
  ON u.id = CASE
    WHEN t.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN t.user_id::uuid
    ELSE NULL
  END;

CREATE OR REPLACE VIEW public.agent_chat_stores_readable
WITH (security_invoker = true)
AS
SELECT
  u.email AS user_email,
  t.*
FROM public.agent_chat_stores AS t
LEFT JOIN auth.users AS u ON u.id = t.user_id;

CREATE OR REPLACE VIEW public.avatars_readable
WITH (security_invoker = true)
AS
SELECT
  u.email AS user_email,
  t.*
FROM public.avatars AS t
LEFT JOIN auth.users AS u ON u.id = t.user_id;

CREATE OR REPLACE VIEW public.content_plan_items_readable
WITH (security_invoker = true)
AS
SELECT
  u.email AS user_email,
  t.*
FROM public.content_plan_items AS t
LEFT JOIN auth.users AS u ON u.id = t.user_id;

CREATE OR REPLACE VIEW public.user_profiles_readable
WITH (security_invoker = true)
AS
SELECT
  u.email AS user_email,
  t.*
FROM public.user_profiles AS t
LEFT JOIN auth.users AS u ON u.id = t.user_id;

CREATE OR REPLACE VIEW public.postiz_connections_readable
WITH (security_invoker = true)
AS
SELECT
  u.email AS user_email,
  t.*
FROM public.postiz_connections AS t
LEFT JOIN auth.users AS u ON u.id = t.contos_user_id;

REVOKE ALL ON public.agent_calls_readable FROM PUBLIC;
REVOKE ALL ON public.agent_chat_stores_readable FROM PUBLIC;
REVOKE ALL ON public.avatars_readable FROM PUBLIC;
REVOKE ALL ON public.content_plan_items_readable FROM PUBLIC;
REVOKE ALL ON public.user_profiles_readable FROM PUBLIC;
REVOKE ALL ON public.postiz_connections_readable FROM PUBLIC;

REVOKE ALL ON public.agent_calls_readable FROM anon, authenticated;
REVOKE ALL ON public.agent_chat_stores_readable FROM anon, authenticated;
REVOKE ALL ON public.avatars_readable FROM anon, authenticated;
REVOKE ALL ON public.content_plan_items_readable FROM anon, authenticated;
REVOKE ALL ON public.user_profiles_readable FROM anon, authenticated;
REVOKE ALL ON public.postiz_connections_readable FROM anon, authenticated;

GRANT SELECT ON public.agent_calls_readable TO service_role;
GRANT SELECT ON public.agent_chat_stores_readable TO service_role;
GRANT SELECT ON public.avatars_readable TO service_role;
GRANT SELECT ON public.content_plan_items_readable TO service_role;
GRANT SELECT ON public.user_profiles_readable TO service_role;
GRANT SELECT ON public.postiz_connections_readable TO service_role;

COMMENT ON VIEW public.agent_calls_readable IS
  'Admin browse view: auth email first, then agent_calls columns. Not for anon/authenticated API.';
COMMENT ON VIEW public.agent_chat_stores_readable IS
  'Admin browse view: auth email first, then agent_chat_stores columns. Not for anon/authenticated API.';
COMMENT ON VIEW public.avatars_readable IS
  'Admin browse view: auth email first, then avatars columns. Not for anon/authenticated API.';
COMMENT ON VIEW public.content_plan_items_readable IS
  'Admin browse view: auth email first, then content_plan_items columns. Not for anon/authenticated API.';
COMMENT ON VIEW public.user_profiles_readable IS
  'Admin browse view: auth email first, then user_profiles columns. Not for anon/authenticated API.';
COMMENT ON VIEW public.postiz_connections_readable IS
  'Admin browse view: auth email first, then postiz_connections columns. Not for anon/authenticated API.';
