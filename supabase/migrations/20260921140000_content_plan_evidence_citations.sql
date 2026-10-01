-- Preserve grounding evidence for generated content-plan items.

ALTER TABLE public.content_plan_items
  ADD COLUMN IF NOT EXISTS evidence_citations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS copy_paste_post text NOT NULL DEFAULT '';