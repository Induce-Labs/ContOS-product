-- User-chosen X length. premium is 4000 characters; standard is 280. Null means not chosen.

ALTER TABLE public.postiz_connections
  ADD COLUMN IF NOT EXISTS x_account_type text
  CHECK (x_account_type IS NULL OR x_account_type IN ('premium', 'standard'));
