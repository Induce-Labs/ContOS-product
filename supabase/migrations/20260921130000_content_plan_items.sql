-- Persistent Instagram content plans and post-level performance feedback.

CREATE TABLE IF NOT EXISTS public.content_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  avatar_id uuid NOT NULL REFERENCES public.avatars (id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'linkedin', 'twitter')),
  day integer NOT NULL CHECK (day > 0),
  scheduled_date date,
  content_type text NOT NULL DEFAULT '',
  hook text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}',
  cta text NOT NULL DEFAULT '',
  audio_suggestion text NOT NULL DEFAULT '',
  transcript text NOT NULL DEFAULT '',
  video_prompt text NOT NULL DEFAULT '',
  strategy_reasoning text NOT NULL DEFAULT '',
  performance_goal text NOT NULL DEFAULT '',
  reasoning text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'published', 'archived')),
  external_post_id text,
  performance_metrics jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(performance_metrics) = 'object'),
  performance_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_plan_items_avatar_idx
  ON public.content_plan_items (avatar_id, platform, day);

CREATE INDEX IF NOT EXISTS content_plan_items_performance_idx
  ON public.content_plan_items (avatar_id, performance_updated_at DESC);

ALTER TABLE public.content_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_plan_items_select_own ON public.content_plan_items;
DROP POLICY IF EXISTS content_plan_items_insert_own ON public.content_plan_items;
DROP POLICY IF EXISTS content_plan_items_update_own ON public.content_plan_items;
DROP POLICY IF EXISTS content_plan_items_delete_own ON public.content_plan_items;

CREATE POLICY content_plan_items_select_own ON public.content_plan_items
  FOR SELECT USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
  ));

CREATE POLICY content_plan_items_insert_own ON public.content_plan_items
  FOR INSERT WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
  ));

CREATE POLICY content_plan_items_update_own ON public.content_plan_items
  FOR UPDATE USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
  ));

CREATE POLICY content_plan_items_delete_own ON public.content_plan_items
  FOR DELETE USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.avatars a
    WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.content_plan_items_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_plan_items_set_updated_at ON public.content_plan_items;
CREATE TRIGGER content_plan_items_set_updated_at
  BEFORE UPDATE ON public.content_plan_items
  FOR EACH ROW
  EXECUTE FUNCTION public.content_plan_items_set_updated_at();
