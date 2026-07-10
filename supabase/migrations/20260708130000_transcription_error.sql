-- Store per-reel transcription failure reason from the Apify transcriber actor

ALTER TABLE public.scraped_content
  ADD COLUMN IF NOT EXISTS transcription_error text;
