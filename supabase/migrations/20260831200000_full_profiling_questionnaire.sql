-- Full profiling questionnaire catalog + required-aware completeness

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT true;

DELETE FROM public.profiling_questions
WHERE type IN ('personal_branding', 'business', 'business_1', 'business_2');

INSERT INTO public.profiling_questions (type, question_key, question, display_order, is_active, is_required)
VALUES
  ('personal_branding', 'website_url', 'What''s your website URL?', 1, true, false),
  ('personal_branding', 'content_goal', 'What is the primary goal of your content?', 2, true, true),
  ('personal_branding', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true),
  ('personal_branding', 'brand_voice', 'What is your preferred brand voice?', 4, true, true),
  ('personal_branding', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true),
  ('personal_branding', 'top_competitors', 'What are your top 3 competitors?', 6, true, true),
  ('personal_branding', 'pb_01', 'What do people usually get wrong about you at first glance?', 7, true, true),
  ('personal_branding', 'pb_02', 'What label gets attached to you that you privately disagree with?', 8, true, true),
  ('personal_branding', 'pb_03', 'Whose brand do you study the closest?', 9, true, true),
  ('personal_branding', 'pb_04', 'What''s the real reason you''re building this brand?', 10, true, true),
  ('personal_branding', 'pb_05', 'What outcome would make this feel "worth it"?', 11, true, true),
  ('personal_branding', 'pb_06', 'What''s a win you achieved recently but told almost no one about?', 12, true, true),
  ('personal_branding', 'pb_07', 'What''s actually stopped you from posting consistently?', 13, true, true),
  ('personal_branding', 'pb_08', 'What kind of feedback would actually sting?', 14, true, true),
  ('personal_branding', 'pb_09', 'What have you tried before that flopped?', 15, true, true),
  ('personal_branding', 'pb_10', 'What would embarrass you if a competitor saw it?', 16, true, true),
  ('personal_branding', 'pb_11', 'Describe your dream follower in one line.', 17, true, true),
  ('personal_branding', 'pb_12', 'What are they struggling with that they won''t say out loud?', 18, true, true),
  ('personal_branding', 'pb_13', 'What usually turns a follower into a client?', 19, true, true),
  ('personal_branding', 'pb_14', 'What do they think is harder than it actually is?', 20, true, true),
  ('personal_branding', 'pb_15', 'Share one real result or number you''re proud of.', 21, true, true),
  ('personal_branding', 'pb_16', 'What claim would you never make about yourself?', 22, true, true),
  ('personal_branding', 'pb_17', 'What tone feels most "you"?', 23, true, true),
  ('personal_branding', 'pb_18', 'What should someone feel after reading your content?', 24, true, true),
  ('personal_branding', 'pb_19', 'What''s an unpopular opinion you hold in your space?', 25, true, true),
  ('personal_branding', 'pb_20', 'If this brand worked perfectly, what changes first?', 26, true, true),
  ('personal_branding', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false),
  ('business', 'website_url', 'What''s your website URL?', 1, true, false),
  ('business', 'content_goal', 'What is the primary goal of your content?', 2, true, true),
  ('business', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true),
  ('business', 'brand_voice', 'What is your preferred brand voice?', 4, true, true),
  ('business', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true),
  ('business', 'top_competitors', 'What are your top 3 competitors?', 6, true, true),
  ('business', 'biz_01', 'What actually pushes a prospect to start looking for a solution like yours?', 7, true, true),
  ('business', 'biz_02', 'What''s a real signal someone is ready to buy right now?', 8, true, true),
  ('business', 'biz_03', 'What does your ideal customer secretly believe is holding them back?', 9, true, true),
  ('business', 'biz_04', 'What do they blame when a past solution failed?', 10, true, true),
  ('business', 'biz_05', 'What''s the real obstacle, versus what they think it is?', 11, true, true),
  ('business', 'biz_06', 'What would embarrass them if their team or investors found out?', 12, true, true),
  ('business', 'biz_07', 'What''s a 90-day win they''d screenshot and share?', 13, true, true),
  ('business', 'biz_08', 'What stalls a deal after a good first call?', 14, true, true),
  ('business', 'biz_09', 'What objection comes up in almost every sales conversation?', 15, true, true),
  ('business', 'biz_10', 'Who or what do they compare you to before buying?', 16, true, true),
  ('business', 'biz_11', 'Describe your core offer in one line, no adjectives.', 17, true, true),
  ('business', 'biz_12', 'What''s the one result you can prove with a real number?', 18, true, true),
  ('business', 'biz_13', 'What do you deliberately not do or not serve?', 19, true, true),
  ('business', 'biz_14', 'What''s hardest for your team to explain to a new prospect?', 20, true, true),
  ('business', 'biz_15', 'What''s outdated or lazy about how competitors market right now?', 21, true, true),
  ('business', 'biz_16', 'What frustration keeps surfacing on sales calls that your content never addresses?', 22, true, true),
  ('business', 'biz_17', 'Why do customers actually switch from a competitor to you?', 23, true, true),
  ('business', 'biz_18', 'What content have you published that drove real business results?', 24, true, true),
  ('business', 'biz_19', 'What real metric could you cite in content tomorrow with no caveats?', 25, true, true),
  ('business', 'biz_20', 'What claim would you never make publicly?', 26, true, true),
  ('business', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false),
  ('business_1', 'website_url', 'What''s your website URL?', 1, true, false),
  ('business_1', 'content_goal', 'What is the primary goal of your content?', 2, true, true),
  ('business_1', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true),
  ('business_1', 'brand_voice', 'What is your preferred brand voice?', 4, true, true),
  ('business_1', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true),
  ('business_1', 'top_competitors', 'What are your top 3 competitors?', 6, true, true),
  ('business_1', 'biz_01', 'What actually pushes a prospect to start looking for a solution like yours?', 7, true, true),
  ('business_1', 'biz_02', 'What''s a real signal someone is ready to buy right now?', 8, true, true),
  ('business_1', 'biz_03', 'What does your ideal customer secretly believe is holding them back?', 9, true, true),
  ('business_1', 'biz_04', 'What do they blame when a past solution failed?', 10, true, true),
  ('business_1', 'biz_05', 'What''s the real obstacle, versus what they think it is?', 11, true, true),
  ('business_1', 'biz_06', 'What would embarrass them if their team or investors found out?', 12, true, true),
  ('business_1', 'biz_07', 'What''s a 90-day win they''d screenshot and share?', 13, true, true),
  ('business_1', 'biz_08', 'What stalls a deal after a good first call?', 14, true, true),
  ('business_1', 'biz_09', 'What objection comes up in almost every sales conversation?', 15, true, true),
  ('business_1', 'biz_10', 'Who or what do they compare you to before buying?', 16, true, true),
  ('business_1', 'biz_11', 'Describe your core offer in one line, no adjectives.', 17, true, true),
  ('business_1', 'biz_12', 'What''s the one result you can prove with a real number?', 18, true, true),
  ('business_1', 'biz_13', 'What do you deliberately not do or not serve?', 19, true, true),
  ('business_1', 'biz_14', 'What''s hardest for your team to explain to a new prospect?', 20, true, true),
  ('business_1', 'biz_15', 'What''s outdated or lazy about how competitors market right now?', 21, true, true),
  ('business_1', 'biz_16', 'What frustration keeps surfacing on sales calls that your content never addresses?', 22, true, true),
  ('business_1', 'biz_17', 'Why do customers actually switch from a competitor to you?', 23, true, true),
  ('business_1', 'biz_18', 'What content have you published that drove real business results?', 24, true, true),
  ('business_1', 'biz_19', 'What real metric could you cite in content tomorrow with no caveats?', 25, true, true),
  ('business_1', 'biz_20', 'What claim would you never make publicly?', 26, true, true),
  ('business_1', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false),
  ('business_2', 'website_url', 'What''s your website URL?', 1, true, false),
  ('business_2', 'content_goal', 'What is the primary goal of your content?', 2, true, true),
  ('business_2', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true),
  ('business_2', 'brand_voice', 'What is your preferred brand voice?', 4, true, true),
  ('business_2', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true),
  ('business_2', 'top_competitors', 'What are your top 3 competitors?', 6, true, true),
  ('business_2', 'biz_01', 'What actually pushes a prospect to start looking for a solution like yours?', 7, true, true),
  ('business_2', 'biz_02', 'What''s a real signal someone is ready to buy right now?', 8, true, true),
  ('business_2', 'biz_03', 'What does your ideal customer secretly believe is holding them back?', 9, true, true),
  ('business_2', 'biz_04', 'What do they blame when a past solution failed?', 10, true, true),
  ('business_2', 'biz_05', 'What''s the real obstacle, versus what they think it is?', 11, true, true),
  ('business_2', 'biz_06', 'What would embarrass them if their team or investors found out?', 12, true, true),
  ('business_2', 'biz_07', 'What''s a 90-day win they''d screenshot and share?', 13, true, true),
  ('business_2', 'biz_08', 'What stalls a deal after a good first call?', 14, true, true),
  ('business_2', 'biz_09', 'What objection comes up in almost every sales conversation?', 15, true, true),
  ('business_2', 'biz_10', 'Who or what do they compare you to before buying?', 16, true, true),
  ('business_2', 'biz_11', 'Describe your core offer in one line, no adjectives.', 17, true, true),
  ('business_2', 'biz_12', 'What''s the one result you can prove with a real number?', 18, true, true),
  ('business_2', 'biz_13', 'What do you deliberately not do or not serve?', 19, true, true),
  ('business_2', 'biz_14', 'What''s hardest for your team to explain to a new prospect?', 20, true, true),
  ('business_2', 'biz_15', 'What''s outdated or lazy about how competitors market right now?', 21, true, true),
  ('business_2', 'biz_16', 'What frustration keeps surfacing on sales calls that your content never addresses?', 22, true, true),
  ('business_2', 'biz_17', 'Why do customers actually switch from a competitor to you?', 23, true, true),
  ('business_2', 'biz_18', 'What content have you published that drove real business results?', 24, true, true),
  ('business_2', 'biz_19', 'What real metric could you cite in content tomorrow with no caveats?', 25, true, true),
  ('business_2', 'biz_20', 'What claim would you never make publicly?', 26, true, true),
  ('business_2', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false);

CREATE OR REPLACE FUNCTION public.avatars_compute_profiling_completeness()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  total_required integer;
  answered_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.profiling_data IS NOT DISTINCT FROM OLD.profiling_data THEN
    IF NEW.profiling_completeness IS DISTINCT FROM OLD.profiling_completeness THEN
      NEW.profiling_completeness := OLD.profiling_completeness;
    END IF;
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO total_required
  FROM public.profiling_questions
  WHERE type = NEW.type
    AND is_active = true
    AND is_required = true;

  SELECT COUNT(*) INTO answered_count
  FROM public.profiling_questions pq
  WHERE pq.type = NEW.type
    AND pq.is_active = true
    AND pq.is_required = true
    AND NEW.profiling_data ? pq.question_key
    AND (
      (
        jsonb_typeof(NEW.profiling_data -> pq.question_key) = 'string'
        AND char_length(trim(NEW.profiling_data ->> pq.question_key)) > 0
      )
      OR (
        jsonb_typeof(NEW.profiling_data -> pq.question_key) = 'object'
        AND char_length(trim(COALESCE(NEW.profiling_data -> pq.question_key ->> 'answer', ''))) > 0
      )
    );

  NEW.profiling_completeness := CASE
    WHEN total_required = 0 THEN 0
    ELSE round((answered_count::numeric / total_required::numeric) * 100, 2)
  END;

  RETURN NEW;
END;
$$;

-- Recompute completeness for existing avatars against the new catalog
UPDATE public.avatars
SET profiling_data = profiling_data;
