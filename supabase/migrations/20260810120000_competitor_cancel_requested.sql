-- Allow users to stop an in-flight scrape; pipeline checks this between phases.
ALTER TABLE public.competitors
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.competitors.cancel_requested IS
  'When true, the scrape pipeline skips remaining phases and summarizes whatever content is already stored.';
