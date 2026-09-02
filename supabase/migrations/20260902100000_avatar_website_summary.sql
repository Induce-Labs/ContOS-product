-- Website summary (LLM-generated from Apify Website Content Crawler for chatbot context)

ALTER TABLE public.avatars
  ADD COLUMN IF NOT EXISTS website_summary text,
  ADD COLUMN IF NOT EXISTS website_summary_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS website_summary_url text,
  ADD COLUMN IF NOT EXISTS website_summary_source_hash text,
  ADD COLUMN IF NOT EXISTS website_summary_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS website_summary_error text;

ALTER TABLE public.avatars
  DROP CONSTRAINT IF EXISTS avatars_website_summary_status_check;

ALTER TABLE public.avatars
  ADD CONSTRAINT avatars_website_summary_status_check
  CHECK (website_summary_status IN ('pending', 'generating', 'completed', 'failed', 'skipped'));

-- Extend guard so only service_role may write website summary fields (same as profile_summary*).
CREATE OR REPLACE FUNCTION public.avatars_guard_profile_summary_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.profile_summary := OLD.profile_summary;
    NEW.profile_summary_status := OLD.profile_summary_status;
    NEW.profile_summary_generated_at := OLD.profile_summary_generated_at;
    NEW.profile_summary_error := OLD.profile_summary_error;
    NEW.profile_summary_source_hash := OLD.profile_summary_source_hash;

    NEW.website_summary := OLD.website_summary;
    NEW.website_summary_status := OLD.website_summary_status;
    NEW.website_summary_url := OLD.website_summary_url;
    NEW.website_summary_source_hash := OLD.website_summary_source_hash;
    NEW.website_summary_generated_at := OLD.website_summary_generated_at;
    NEW.website_summary_error := OLD.website_summary_error;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatars_guard_profile_summary_columns ON public.avatars;
CREATE TRIGGER avatars_guard_profile_summary_columns
  BEFORE UPDATE ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.avatars_guard_profile_summary_columns();
