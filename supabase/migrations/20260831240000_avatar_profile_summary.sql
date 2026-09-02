-- Avatar profile summary (LLM-generated from profiling_data for chatbot context)

ALTER TABLE public.avatars
  ADD COLUMN IF NOT EXISTS profile_summary text,
  ADD COLUMN IF NOT EXISTS profile_summary_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS profile_summary_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_summary_error text,
  ADD COLUMN IF NOT EXISTS profile_summary_source_hash text;

ALTER TABLE public.avatars
  DROP CONSTRAINT IF EXISTS avatars_profile_summary_status_check;

ALTER TABLE public.avatars
  ADD CONSTRAINT avatars_profile_summary_status_check
  CHECK (profile_summary_status IN ('pending', 'generating', 'completed', 'failed'));

-- Only service_role (Agents backend) may write summary fields; clients keep their own updates.
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS avatars_guard_profile_summary_columns ON public.avatars;
CREATE TRIGGER avatars_guard_profile_summary_columns
  BEFORE UPDATE ON public.avatars
  FOR EACH ROW
  EXECUTE FUNCTION public.avatars_guard_profile_summary_columns();
