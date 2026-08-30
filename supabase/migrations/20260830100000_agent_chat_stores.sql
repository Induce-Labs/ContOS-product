-- Agent chat stores — one JSONB blob per (user, avatar) to minimize row/index overhead.
-- Caps enforced in the client (max 30 sessions, 80 messages each).

CREATE TABLE IF NOT EXISTS public.agent_chat_stores (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  avatar_id uuid NOT NULL REFERENCES public.avatars (id) ON DELETE CASCADE,
  store jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, avatar_id),
  CONSTRAINT agent_chat_stores_store_is_object CHECK (jsonb_typeof(store) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_agent_chat_stores_avatar_id
  ON public.agent_chat_stores (avatar_id);

CREATE INDEX IF NOT EXISTS idx_agent_chat_stores_updated_at
  ON public.agent_chat_stores (updated_at DESC);

ALTER TABLE public.agent_chat_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_chat_stores_select_own ON public.agent_chat_stores;
DROP POLICY IF EXISTS agent_chat_stores_insert_own ON public.agent_chat_stores;
DROP POLICY IF EXISTS agent_chat_stores_update_own ON public.agent_chat_stores;
DROP POLICY IF EXISTS agent_chat_stores_delete_own ON public.agent_chat_stores;

CREATE POLICY agent_chat_stores_select_own ON public.agent_chat_stores
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY agent_chat_stores_insert_own ON public.agent_chat_stores
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY agent_chat_stores_update_own ON public.agent_chat_stores
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY agent_chat_stores_delete_own ON public.agent_chat_stores
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = avatar_id AND a.user_id = auth.uid()
    )
  );
