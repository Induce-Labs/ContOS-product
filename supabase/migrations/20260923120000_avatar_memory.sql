-- Per-avatar persistent memory for the ContOS strategist agents.

CREATE TABLE IF NOT EXISTS public.avatar_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  avatar_id uuid NOT NULL REFERENCES public.avatars (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'positioning', 'goal', 'voice', 'story', 'thesis', 'rejection', 'note'
  )),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  source text NOT NULL DEFAULT 'inferred'
    CHECK (source IN ('user', 'scraped', 'inferred')),
  platform text CHECK (platform IN ('instagram', 'linkedin', 'twitter')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS avatar_memory_avatar_idx
  ON public.avatar_memory (avatar_id, status, kind, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS avatar_memory_unique_active_idx
  ON public.avatar_memory (avatar_id, kind, lower(content))
  WHERE status = 'active';

ALTER TABLE public.avatar_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avatar_memory_select_own ON public.avatar_memory;
DROP POLICY IF EXISTS avatar_memory_insert_own ON public.avatar_memory;
DROP POLICY IF EXISTS avatar_memory_update_own ON public.avatar_memory;
DROP POLICY IF EXISTS avatar_memory_delete_own ON public.avatar_memory;

CREATE POLICY avatar_memory_select_own ON public.avatar_memory
  FOR SELECT USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = avatar_memory.avatar_id AND a.user_id = auth.uid()
  ));

CREATE POLICY avatar_memory_insert_own ON public.avatar_memory
  FOR INSERT WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = avatar_memory.avatar_id AND a.user_id = auth.uid()
  ));

CREATE POLICY avatar_memory_update_own ON public.avatar_memory
  FOR UPDATE USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = avatar_memory.avatar_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = avatar_memory.avatar_id AND a.user_id = auth.uid()
  ));

CREATE POLICY avatar_memory_delete_own ON public.avatar_memory
  FOR DELETE USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = avatar_memory.avatar_id AND a.user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.avatar_memory_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatar_memory_set_updated_at ON public.avatar_memory;
CREATE TRIGGER avatar_memory_set_updated_at
  BEFORE UPDATE ON public.avatar_memory
  FOR EACH ROW
  EXECUTE FUNCTION public.avatar_memory_set_updated_at();
