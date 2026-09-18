-- Persist UI language preference for post-signup interstitial + cross-device hydrate.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS preferred_language text;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_preferred_language_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_preferred_language_check
  CHECK (
    preferred_language IS NULL
    OR preferred_language IN ('en', 'hi', 'zh', 'fr', 'es')
  );

COMMENT ON COLUMN public.user_profiles.preferred_language IS
  'UI locale chosen after sign-up (en|hi|zh|fr|es). NULL until first language interstitial.';
