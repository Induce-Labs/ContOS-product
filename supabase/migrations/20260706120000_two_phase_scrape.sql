-- Two-phase scrape pipeline: post_url, transcription_status, transcribing step

-- scraped_content: link + per-row transcription tracking
ALTER TABLE public.scraped_content
  ADD COLUMN IF NOT EXISTS post_url text,
  ADD COLUMN IF NOT EXISTS transcription_status text NOT NULL DEFAULT 'not_applicable';

ALTER TABLE public.scraped_content
  DROP CONSTRAINT IF EXISTS scraped_content_transcription_status_check;

ALTER TABLE public.scraped_content
  ADD CONSTRAINT scraped_content_transcription_status_check
  CHECK (
    transcription_status IN (
      'pending',
      'in_progress',
      'completed',
      'failed',
      'not_applicable'
    )
  );

-- Backfill post_url and transcription_status from existing rows
UPDATE public.scraped_content
SET
  post_url = COALESCE(
    post_url,
    raw_payload->>'url',
    raw_payload->>'postUrl',
    raw_payload->>'inputUrl'
  ),
  transcription_status = CASE
    WHEN transcription_status IS DISTINCT FROM 'not_applicable'
      AND transcription_status IS NOT NULL
      THEN transcription_status
    WHEN transcript IS NOT NULL AND btrim(transcript) <> '' THEN 'completed'
    WHEN content_type = 'reel' THEN 'pending'
    ELSE 'not_applicable'
  END
WHERE post_url IS NULL
   OR transcription_status = 'not_applicable';

-- competitors: add transcribing pipeline step
ALTER TABLE public.competitors
  DROP CONSTRAINT IF EXISTS competitors_pipeline_step_check;

ALTER TABLE public.competitors
  ADD CONSTRAINT competitors_pipeline_step_check
  CHECK (
    pipeline_step IN (
      'queued',
      'scraping',
      'transcribing',
      'analyzing',
      'done',
      'failed'
    )
  );
