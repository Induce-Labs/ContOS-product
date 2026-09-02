-- Multi-step onboarding progress + extended avatar / profiling question types

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_step text NOT NULL DEFAULT 'welcome',
  ADD COLUMN IF NOT EXISTS onboarding_avatar_id uuid REFERENCES public.avatars (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS onboarding_project_type text;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_onboarding_step_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_onboarding_step_check
  CHECK (
    onboarding_step IN ('welcome', 'project_type', 'profiling', 'competitors', 'completed')
  );

UPDATE public.user_profiles
SET onboarding_step = 'completed'
WHERE onboarding_completed_at IS NOT NULL
  AND onboarding_step = 'welcome';

-- Extend avatar type constraint
ALTER TABLE public.avatars
  DROP CONSTRAINT IF EXISTS projects_type_check;

ALTER TABLE public.avatars
  DROP CONSTRAINT IF EXISTS avatars_type_check;

ALTER TABLE public.avatars
  ADD CONSTRAINT avatars_type_check
  CHECK (type IN ('personal_branding', 'business', 'business_1', 'business_2'));

-- Extend profiling_questions type constraint
ALTER TABLE public.profiling_questions
  DROP CONSTRAINT IF EXISTS profiling_questions_type_check;

ALTER TABLE public.profiling_questions
  ADD CONSTRAINT profiling_questions_type_check
  CHECK (type IN ('personal_branding', 'business', 'business_1', 'business_2'));

-- Seed business_1 / business_2 questions from existing business set
INSERT INTO public.profiling_questions (type, question_key, question, display_order, is_active)
SELECT 'business_1', question_key, question, display_order, is_active
FROM public.profiling_questions
WHERE type = 'business'
ON CONFLICT (type, question_key) DO NOTHING;

INSERT INTO public.profiling_questions (type, question_key, question, display_order, is_active)
SELECT 'business_2', question_key, question, display_order, is_active
FROM public.profiling_questions
WHERE type = 'business'
ON CONFLICT (type, question_key) DO NOTHING;
