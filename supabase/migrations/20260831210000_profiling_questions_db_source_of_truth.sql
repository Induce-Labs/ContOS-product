-- Move full profiling question metadata into profiling_questions (DB source of truth)

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS input_kind text NOT NULL DEFAULT 'text';

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS options jsonb;

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS allow_other boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS placeholder text;

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS section_label text;

ALTER TABLE public.profiling_questions
  ADD COLUMN IF NOT EXISTS competitor_max integer;

ALTER TABLE public.profiling_questions
  DROP CONSTRAINT IF EXISTS profiling_questions_input_kind_check;

ALTER TABLE public.profiling_questions
  ADD CONSTRAINT profiling_questions_input_kind_check
  CHECK (input_kind IN ('text', 'textarea', 'url', 'single_select', 'competitor_names'));

DELETE FROM public.profiling_questions
WHERE type IN ('personal_branding', 'business', 'business_1', 'business_2');

INSERT INTO public.profiling_questions (
  type,
  question_key,
  question,
  display_order,
  is_active,
  is_required,
  input_kind,
  options,
  allow_other,
  placeholder,
  section_label,
  competitor_max
)
VALUES
  ('personal_branding', 'website_url', 'What''s your website URL?', 1, true, false, 'url', NULL, false, 'https://example.com', 'STEP 01 — FOUNDATIONS', NULL),
  ('personal_branding', 'content_goal', 'What is the primary goal of your content?', 2, true, true, 'single_select', '["Thought Leadership & Authority Building","Lead Generation & Conversions","Community Engagement & Social Growth","Direct Sales & Product Promotion"]'::jsonb, false, NULL, 'STEP 02 — GOALS', NULL),
  ('personal_branding', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true, 'single_select', '["C-Level Executives (CEO, CTO, CMO)","Technical Professionals (Engineers, Developers)","Sales & Marketing Teams (SDRs, Growth Leads)","Small Business Owners/Founders"]'::jsonb, false, NULL, 'STEP 03 — AUDIENCE', NULL),
  ('personal_branding', 'brand_voice', 'What is your preferred brand voice?', 4, true, true, 'single_select', '["Professional & Authoritative","Conversational & Casual","Provocative & Bold","Highly Technical & Data-Driven"]'::jsonb, false, NULL, 'STEP 04 — VOICE', NULL),
  ('personal_branding', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true, 'single_select', '["Specific Tech Stack/Tools (e.g., AI Agents, HubSpot)","Fundraising & Market Movements","Recruitment & Hiring Patterns","Competitor Content & Engagement"]'::jsonb, false, NULL, 'STEP 05 — TRENDS', NULL),
  ('personal_branding', 'top_competitors', 'What are your top 3 competitors?', 6, true, true, 'competitor_names', NULL, false, 'Competitor name', 'STEP 06 — COMPETITORS', 3),
  ('personal_branding', 'pb_01', 'What do people usually get wrong about you at first glance?', 7, true, true, 'single_select', '["Think I''m arrogant — I''m just direct","Think I''m chill — I''m actually intense","Think I have it all figured out","Think I''m new — I''ve been doing this for years","Other — describe in your own words"]'::jsonb, true, NULL, 'IDENTITY', NULL),
  ('personal_branding', 'pb_02', 'What label gets attached to you that you privately disagree with?', 8, true, true, 'single_select', '["\"Overnight success\"","\"Just a student founder\"","\"Copy of [bigger creator]\"","\"Lucky, not skilled\"","Other — describe in your own words"]'::jsonb, true, NULL, 'IDENTITY', NULL),
  ('personal_branding', 'pb_03', 'Whose brand do you study the closest?', 9, true, true, 'single_select', '["Varun Mayya","Greg Isenberg","Sirio Berati","Someone else — name them"]'::jsonb, true, NULL, 'IDENTITY', NULL),
  ('personal_branding', 'pb_04', 'What''s the real reason you''re building this brand?', 10, true, true, 'single_select', '["To prove something to myself","To build wealth and freedom","To help people skip my mistakes","To build a name bigger than my company","Other — describe in your own words"]'::jsonb, true, NULL, 'MOTIVATION', NULL),
  ('personal_branding', 'pb_05', 'What outcome would make this feel "worth it"?', 11, true, true, 'single_select', '["Recognition in my industry","Financial freedom","Inbound clients without selling","A legacy beyond the company","Other — describe in your own words"]'::jsonb, true, NULL, 'MOTIVATION', NULL),
  ('personal_branding', 'pb_06', 'What''s a win you achieved recently but told almost no one about?', 12, true, true, 'textarea', NULL, false, 'Describe the win…', 'MOTIVATION', NULL),
  ('personal_branding', 'pb_07', 'What''s actually stopped you from posting consistently?', 13, true, true, 'single_select', '["Don''t know what to say","Fear of judgment","No time or system","Fear it just won''t work","Other — describe in your own words"]'::jsonb, true, NULL, 'BLOCKERS', NULL),
  ('personal_branding', 'pb_08', 'What kind of feedback would actually sting?', 14, true, true, 'single_select', '["Being called fake","Being called inexperienced","Being ignored completely","Being compared to someone bigger","Other — describe in your own words"]'::jsonb, true, NULL, 'BLOCKERS', NULL),
  ('personal_branding', 'pb_09', 'What have you tried before that flopped?', 15, true, true, 'single_select', '["Generic motivational posts","Copying a \"guru\" style","Posting with no strategy","Never really tried consistently","Other — describe in your own words"]'::jsonb, true, NULL, 'BLOCKERS', NULL),
  ('personal_branding', 'pb_10', 'What would embarrass you if a competitor saw it?', 16, true, true, 'single_select', '["Low engagement","Inconsistent brand","Unfinished projects","Nothing — I''m past that","Other — describe in your own words"]'::jsonb, true, NULL, 'BLOCKERS', NULL),
  ('personal_branding', 'pb_11', 'Describe your dream follower in one line.', 17, true, true, 'text', NULL, false, 'My dream follower is…', 'AUDIENCE', NULL),
  ('personal_branding', 'pb_12', 'What are they struggling with that they won''t say out loud?', 18, true, true, 'single_select', '["Imposter syndrome","Fear of starting","Financial pressure","Isolation, no real network","Other — describe in your own words"]'::jsonb, true, NULL, 'AUDIENCE', NULL),
  ('personal_branding', 'pb_13', 'What usually turns a follower into a client?', 19, true, true, 'single_select', '["A DM after a post","A comment thread","A call or consult","They just buy, no conversation","Other — describe in your own words"]'::jsonb, true, NULL, 'AUDIENCE', NULL),
  ('personal_branding', 'pb_14', 'What do they think is harder than it actually is?', 20, true, true, 'single_select', '["Starting / getting visible","Raising money","Building a team","Building an audience","Other — describe in your own words"]'::jsonb, true, NULL, 'AUDIENCE', NULL),
  ('personal_branding', 'pb_15', 'Share one real result or number you''re proud of.', 21, true, true, 'textarea', NULL, false, 'e.g. 3× pipeline in 90 days…', 'PROOF & VOICE', NULL),
  ('personal_branding', 'pb_16', 'What claim would you never make about yourself?', 22, true, true, 'single_select', '["\"Overnight success\"","\"Never failed\"","\"Self-made, no help\"","\"Expert\" in something unproven","Other — describe in your own words"]'::jsonb, true, NULL, 'PROOF & VOICE', NULL),
  ('personal_branding', 'pb_17', 'What tone feels most "you"?', 23, true, true, 'single_select', '["Direct and blunt","Warm and conversational","Sharp and witty","Calm and measured"]'::jsonb, false, NULL, 'PROOF & VOICE', NULL),
  ('personal_branding', 'pb_18', 'What should someone feel after reading your content?', 24, true, true, 'single_select', '["Inspired","Understood","Challenged","Educated"]'::jsonb, false, NULL, 'PROOF & VOICE', NULL),
  ('personal_branding', 'pb_19', 'What''s an unpopular opinion you hold in your space?', 25, true, true, 'textarea', NULL, false, 'My unpopular opinion is…', 'PROOF & VOICE', NULL),
  ('personal_branding', 'pb_20', 'If this brand worked perfectly, what changes first?', 26, true, true, 'single_select', '["My income","My reputation","My opportunities","My confidence","Other — describe in your own words"]'::jsonb, true, NULL, 'PROOF & VOICE', NULL),
  ('personal_branding', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false, 'textarea', NULL, false, 'Optional — share anything we should know…', 'ANYTHING ELSE', NULL),
  ('business', 'website_url', 'What''s your website URL?', 1, true, false, 'url', NULL, false, 'https://example.com', 'STEP 01 — FOUNDATIONS', NULL),
  ('business', 'content_goal', 'What is the primary goal of your content?', 2, true, true, 'single_select', '["Thought Leadership & Authority Building","Lead Generation & Conversions","Community Engagement & Social Growth","Direct Sales & Product Promotion"]'::jsonb, false, NULL, 'STEP 02 — GOALS', NULL),
  ('business', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true, 'single_select', '["C-Level Executives (CEO, CTO, CMO)","Technical Professionals (Engineers, Developers)","Sales & Marketing Teams (SDRs, Growth Leads)","Small Business Owners/Founders"]'::jsonb, false, NULL, 'STEP 03 — AUDIENCE', NULL),
  ('business', 'brand_voice', 'What is your preferred brand voice?', 4, true, true, 'single_select', '["Professional & Authoritative","Conversational & Casual","Provocative & Bold","Highly Technical & Data-Driven"]'::jsonb, false, NULL, 'STEP 04 — VOICE', NULL),
  ('business', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true, 'single_select', '["Specific Tech Stack/Tools (e.g., AI Agents, HubSpot)","Fundraising & Market Movements","Recruitment & Hiring Patterns","Competitor Content & Engagement"]'::jsonb, false, NULL, 'STEP 05 — TRENDS', NULL),
  ('business', 'top_competitors', 'What are your top 3 competitors?', 6, true, true, 'competitor_names', NULL, false, 'Competitor name', 'STEP 06 — COMPETITORS', 3),
  ('business', 'biz_01', 'What actually pushes a prospect to start looking for a solution like yours?', 7, true, true, 'single_select', '["A failed attempt with someone else","A deadline or pressure event (funding, launch, board meeting)","A recommendation from a peer","Content that called out their exact problem","Other — describe in your own words"]'::jsonb, true, NULL, 'BUYING TRIGGER', NULL),
  ('business', 'biz_02', 'What''s a real signal someone is ready to buy right now?', 8, true, true, 'single_select', '["Recent funding announcement","New hire or leadership change","Engaging with a competitor''s content","Posting publicly about the exact problem","Other — describe in your own words"]'::jsonb, true, NULL, 'BUYING TRIGGER', NULL),
  ('business', 'biz_03', 'What does your ideal customer secretly believe is holding them back?', 9, true, true, 'single_select', '["\"We don''t have the budget\"","\"We''re too early for this\"","\"We tried this and it didn''t work\"","\"Our team can''t execute it\"","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business', 'biz_04', 'What do they blame when a past solution failed?', 10, true, true, 'single_select', '["The vendor or agency","Their own team","Bad timing","The tool or software","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business', 'biz_05', 'What''s the real obstacle, versus what they think it is?', 11, true, true, 'single_select', '["It''s strategy, not budget","It''s execution, not ideas","It''s positioning, not product","It''s trust, not price","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business', 'biz_06', 'What would embarrass them if their team or investors found out?', 12, true, true, 'single_select', '["No real growth system","Wasted ad spend","Inconsistent brand presence","Falling behind competitors","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business', 'biz_07', 'What''s a 90-day win they''d screenshot and share?', 13, true, true, 'single_select', '["A set number of qualified leads","A funding round closed","A high-performing piece of content","A signed client or deal","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business', 'biz_08', 'What stalls a deal after a good first call?', 14, true, true, 'single_select', '["Budget approval","Internal buy-in","Comparing other options","They go cold with no reason given","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business', 'biz_09', 'What objection comes up in almost every sales conversation?', 15, true, true, 'single_select', '["\"We can do this in-house\"","\"It''s too expensive\"","\"We need to see more proof\"","\"We''re just not ready yet\"","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business', 'biz_10', 'Who or what do they compare you to before buying?', 16, true, true, 'single_select', '["A cheaper freelancer","A bigger agency","Doing it themselves","Doing nothing at all","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business', 'biz_11', 'Describe your core offer in one line, no adjectives.', 17, true, true, 'text', NULL, false, 'We help X do Y…', 'OFFER', NULL),
  ('business', 'biz_12', 'What''s the one result you can prove with a real number?', 18, true, true, 'textarea', NULL, false, 'e.g. 40% more qualified demos…', 'OFFER', NULL),
  ('business', 'biz_13', 'What do you deliberately not do or not serve?', 19, true, true, 'single_select', '["Small businesses or early-stage startups","Enterprise or large orgs","A specific industry","Certain deliverables (ads, SEO, etc.)","Other — describe in your own words"]'::jsonb, true, NULL, 'OFFER', NULL),
  ('business', 'biz_14', 'What''s hardest for your team to explain to a new prospect?', 20, true, true, 'single_select', '["Pricing or structure","The process or timeline","What makes you different","The tech or AI behind it","Other — describe in your own words"]'::jsonb, true, NULL, 'OFFER', NULL),
  ('business', 'biz_15', 'What''s outdated or lazy about how competitors market right now?', 21, true, true, 'single_select', '["Generic, templated content","Overpromising results","No real case studies","Copy-paste strategy across clients","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business', 'biz_16', 'What frustration keeps surfacing on sales calls that your content never addresses?', 22, true, true, 'single_select', '["Confusion about the process","Doubt in the results","Price sensitivity","Lack of trust in AI or automation","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business', 'biz_17', 'Why do customers actually switch from a competitor to you?', 23, true, true, 'single_select', '["Better results","Better communication","Better price","Better speed or turnaround","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business', 'biz_18', 'What content have you published that drove real business results?', 24, true, true, 'single_select', '["A case study post","A founder story post","A hot take or opinion post","A behind-the-scenes post","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business', 'biz_19', 'What real metric could you cite in content tomorrow with no caveats?', 25, true, true, 'textarea', NULL, false, 'e.g. Closed $X in pipeline from LinkedIn…', 'PROOF & RISK', NULL),
  ('business', 'biz_20', 'What claim would you never make publicly?', 26, true, true, 'single_select', '["\"Guaranteed results\"","\"#1 in the industry\"","\"Overnight growth\"","\"Works for every business\"","Other — describe in your own words"]'::jsonb, true, NULL, 'PROOF & RISK', NULL),
  ('business', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false, 'textarea', NULL, false, 'Optional — share anything we should know…', 'ANYTHING ELSE', NULL),
  ('business_1', 'website_url', 'What''s your website URL?', 1, true, false, 'url', NULL, false, 'https://example.com', 'STEP 01 — FOUNDATIONS', NULL),
  ('business_1', 'content_goal', 'What is the primary goal of your content?', 2, true, true, 'single_select', '["Thought Leadership & Authority Building","Lead Generation & Conversions","Community Engagement & Social Growth","Direct Sales & Product Promotion"]'::jsonb, false, NULL, 'STEP 02 — GOALS', NULL),
  ('business_1', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true, 'single_select', '["C-Level Executives (CEO, CTO, CMO)","Technical Professionals (Engineers, Developers)","Sales & Marketing Teams (SDRs, Growth Leads)","Small Business Owners/Founders"]'::jsonb, false, NULL, 'STEP 03 — AUDIENCE', NULL),
  ('business_1', 'brand_voice', 'What is your preferred brand voice?', 4, true, true, 'single_select', '["Professional & Authoritative","Conversational & Casual","Provocative & Bold","Highly Technical & Data-Driven"]'::jsonb, false, NULL, 'STEP 04 — VOICE', NULL),
  ('business_1', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true, 'single_select', '["Specific Tech Stack/Tools (e.g., AI Agents, HubSpot)","Fundraising & Market Movements","Recruitment & Hiring Patterns","Competitor Content & Engagement"]'::jsonb, false, NULL, 'STEP 05 — TRENDS', NULL),
  ('business_1', 'top_competitors', 'What are your top 3 competitors?', 6, true, true, 'competitor_names', NULL, false, 'Competitor name', 'STEP 06 — COMPETITORS', 3),
  ('business_1', 'biz_01', 'What actually pushes a prospect to start looking for a solution like yours?', 7, true, true, 'single_select', '["A failed attempt with someone else","A deadline or pressure event (funding, launch, board meeting)","A recommendation from a peer","Content that called out their exact problem","Other — describe in your own words"]'::jsonb, true, NULL, 'BUYING TRIGGER', NULL),
  ('business_1', 'biz_02', 'What''s a real signal someone is ready to buy right now?', 8, true, true, 'single_select', '["Recent funding announcement","New hire or leadership change","Engaging with a competitor''s content","Posting publicly about the exact problem","Other — describe in your own words"]'::jsonb, true, NULL, 'BUYING TRIGGER', NULL),
  ('business_1', 'biz_03', 'What does your ideal customer secretly believe is holding them back?', 9, true, true, 'single_select', '["\"We don''t have the budget\"","\"We''re too early for this\"","\"We tried this and it didn''t work\"","\"Our team can''t execute it\"","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_1', 'biz_04', 'What do they blame when a past solution failed?', 10, true, true, 'single_select', '["The vendor or agency","Their own team","Bad timing","The tool or software","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_1', 'biz_05', 'What''s the real obstacle, versus what they think it is?', 11, true, true, 'single_select', '["It''s strategy, not budget","It''s execution, not ideas","It''s positioning, not product","It''s trust, not price","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_1', 'biz_06', 'What would embarrass them if their team or investors found out?', 12, true, true, 'single_select', '["No real growth system","Wasted ad spend","Inconsistent brand presence","Falling behind competitors","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_1', 'biz_07', 'What''s a 90-day win they''d screenshot and share?', 13, true, true, 'single_select', '["A set number of qualified leads","A funding round closed","A high-performing piece of content","A signed client or deal","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_1', 'biz_08', 'What stalls a deal after a good first call?', 14, true, true, 'single_select', '["Budget approval","Internal buy-in","Comparing other options","They go cold with no reason given","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business_1', 'biz_09', 'What objection comes up in almost every sales conversation?', 15, true, true, 'single_select', '["\"We can do this in-house\"","\"It''s too expensive\"","\"We need to see more proof\"","\"We''re just not ready yet\"","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business_1', 'biz_10', 'Who or what do they compare you to before buying?', 16, true, true, 'single_select', '["A cheaper freelancer","A bigger agency","Doing it themselves","Doing nothing at all","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business_1', 'biz_11', 'Describe your core offer in one line, no adjectives.', 17, true, true, 'text', NULL, false, 'We help X do Y…', 'OFFER', NULL),
  ('business_1', 'biz_12', 'What''s the one result you can prove with a real number?', 18, true, true, 'textarea', NULL, false, 'e.g. 40% more qualified demos…', 'OFFER', NULL),
  ('business_1', 'biz_13', 'What do you deliberately not do or not serve?', 19, true, true, 'single_select', '["Small businesses or early-stage startups","Enterprise or large orgs","A specific industry","Certain deliverables (ads, SEO, etc.)","Other — describe in your own words"]'::jsonb, true, NULL, 'OFFER', NULL),
  ('business_1', 'biz_14', 'What''s hardest for your team to explain to a new prospect?', 20, true, true, 'single_select', '["Pricing or structure","The process or timeline","What makes you different","The tech or AI behind it","Other — describe in your own words"]'::jsonb, true, NULL, 'OFFER', NULL),
  ('business_1', 'biz_15', 'What''s outdated or lazy about how competitors market right now?', 21, true, true, 'single_select', '["Generic, templated content","Overpromising results","No real case studies","Copy-paste strategy across clients","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_1', 'biz_16', 'What frustration keeps surfacing on sales calls that your content never addresses?', 22, true, true, 'single_select', '["Confusion about the process","Doubt in the results","Price sensitivity","Lack of trust in AI or automation","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_1', 'biz_17', 'Why do customers actually switch from a competitor to you?', 23, true, true, 'single_select', '["Better results","Better communication","Better price","Better speed or turnaround","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_1', 'biz_18', 'What content have you published that drove real business results?', 24, true, true, 'single_select', '["A case study post","A founder story post","A hot take or opinion post","A behind-the-scenes post","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_1', 'biz_19', 'What real metric could you cite in content tomorrow with no caveats?', 25, true, true, 'textarea', NULL, false, 'e.g. Closed $X in pipeline from LinkedIn…', 'PROOF & RISK', NULL),
  ('business_1', 'biz_20', 'What claim would you never make publicly?', 26, true, true, 'single_select', '["\"Guaranteed results\"","\"#1 in the industry\"","\"Overnight growth\"","\"Works for every business\"","Other — describe in your own words"]'::jsonb, true, NULL, 'PROOF & RISK', NULL),
  ('business_1', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false, 'textarea', NULL, false, 'Optional — share anything we should know…', 'ANYTHING ELSE', NULL),
  ('business_2', 'website_url', 'What''s your website URL?', 1, true, false, 'url', NULL, false, 'https://example.com', 'STEP 01 — FOUNDATIONS', NULL),
  ('business_2', 'content_goal', 'What is the primary goal of your content?', 2, true, true, 'single_select', '["Thought Leadership & Authority Building","Lead Generation & Conversions","Community Engagement & Social Growth","Direct Sales & Product Promotion"]'::jsonb, false, NULL, 'STEP 02 — GOALS', NULL),
  ('business_2', 'ideal_reader', 'Who is your ideal reader or viewer?', 3, true, true, 'single_select', '["C-Level Executives (CEO, CTO, CMO)","Technical Professionals (Engineers, Developers)","Sales & Marketing Teams (SDRs, Growth Leads)","Small Business Owners/Founders"]'::jsonb, false, NULL, 'STEP 03 — AUDIENCE', NULL),
  ('business_2', 'brand_voice', 'What is your preferred brand voice?', 4, true, true, 'single_select', '["Professional & Authoritative","Conversational & Casual","Provocative & Bold","Highly Technical & Data-Driven"]'::jsonb, false, NULL, 'STEP 04 — VOICE', NULL),
  ('business_2', 'trends_keywords', 'Which industry trends or keywords should we track?', 5, true, true, 'single_select', '["Specific Tech Stack/Tools (e.g., AI Agents, HubSpot)","Fundraising & Market Movements","Recruitment & Hiring Patterns","Competitor Content & Engagement"]'::jsonb, false, NULL, 'STEP 05 — TRENDS', NULL),
  ('business_2', 'top_competitors', 'What are your top 3 competitors?', 6, true, true, 'competitor_names', NULL, false, 'Competitor name', 'STEP 06 — COMPETITORS', 3),
  ('business_2', 'biz_01', 'What actually pushes a prospect to start looking for a solution like yours?', 7, true, true, 'single_select', '["A failed attempt with someone else","A deadline or pressure event (funding, launch, board meeting)","A recommendation from a peer","Content that called out their exact problem","Other — describe in your own words"]'::jsonb, true, NULL, 'BUYING TRIGGER', NULL),
  ('business_2', 'biz_02', 'What''s a real signal someone is ready to buy right now?', 8, true, true, 'single_select', '["Recent funding announcement","New hire or leadership change","Engaging with a competitor''s content","Posting publicly about the exact problem","Other — describe in your own words"]'::jsonb, true, NULL, 'BUYING TRIGGER', NULL),
  ('business_2', 'biz_03', 'What does your ideal customer secretly believe is holding them back?', 9, true, true, 'single_select', '["\"We don''t have the budget\"","\"We''re too early for this\"","\"We tried this and it didn''t work\"","\"Our team can''t execute it\"","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_2', 'biz_04', 'What do they blame when a past solution failed?', 10, true, true, 'single_select', '["The vendor or agency","Their own team","Bad timing","The tool or software","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_2', 'biz_05', 'What''s the real obstacle, versus what they think it is?', 11, true, true, 'single_select', '["It''s strategy, not budget","It''s execution, not ideas","It''s positioning, not product","It''s trust, not price","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_2', 'biz_06', 'What would embarrass them if their team or investors found out?', 12, true, true, 'single_select', '["No real growth system","Wasted ad spend","Inconsistent brand presence","Falling behind competitors","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_2', 'biz_07', 'What''s a 90-day win they''d screenshot and share?', 13, true, true, 'single_select', '["A set number of qualified leads","A funding round closed","A high-performing piece of content","A signed client or deal","Other — describe in your own words"]'::jsonb, true, NULL, 'CUSTOMER PSYCHOLOGY', NULL),
  ('business_2', 'biz_08', 'What stalls a deal after a good first call?', 14, true, true, 'single_select', '["Budget approval","Internal buy-in","Comparing other options","They go cold with no reason given","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business_2', 'biz_09', 'What objection comes up in almost every sales conversation?', 15, true, true, 'single_select', '["\"We can do this in-house\"","\"It''s too expensive\"","\"We need to see more proof\"","\"We''re just not ready yet\"","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business_2', 'biz_10', 'Who or what do they compare you to before buying?', 16, true, true, 'single_select', '["A cheaper freelancer","A bigger agency","Doing it themselves","Doing nothing at all","Other — describe in your own words"]'::jsonb, true, NULL, 'SALES FRICTION', NULL),
  ('business_2', 'biz_11', 'Describe your core offer in one line, no adjectives.', 17, true, true, 'text', NULL, false, 'We help X do Y…', 'OFFER', NULL),
  ('business_2', 'biz_12', 'What''s the one result you can prove with a real number?', 18, true, true, 'textarea', NULL, false, 'e.g. 40% more qualified demos…', 'OFFER', NULL),
  ('business_2', 'biz_13', 'What do you deliberately not do or not serve?', 19, true, true, 'single_select', '["Small businesses or early-stage startups","Enterprise or large orgs","A specific industry","Certain deliverables (ads, SEO, etc.)","Other — describe in your own words"]'::jsonb, true, NULL, 'OFFER', NULL),
  ('business_2', 'biz_14', 'What''s hardest for your team to explain to a new prospect?', 20, true, true, 'single_select', '["Pricing or structure","The process or timeline","What makes you different","The tech or AI behind it","Other — describe in your own words"]'::jsonb, true, NULL, 'OFFER', NULL),
  ('business_2', 'biz_15', 'What''s outdated or lazy about how competitors market right now?', 21, true, true, 'single_select', '["Generic, templated content","Overpromising results","No real case studies","Copy-paste strategy across clients","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_2', 'biz_16', 'What frustration keeps surfacing on sales calls that your content never addresses?', 22, true, true, 'single_select', '["Confusion about the process","Doubt in the results","Price sensitivity","Lack of trust in AI or automation","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_2', 'biz_17', 'Why do customers actually switch from a competitor to you?', 23, true, true, 'single_select', '["Better results","Better communication","Better price","Better speed or turnaround","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_2', 'biz_18', 'What content have you published that drove real business results?', 24, true, true, 'single_select', '["A case study post","A founder story post","A hot take or opinion post","A behind-the-scenes post","Other — describe in your own words"]'::jsonb, true, NULL, 'MARKET POSITION', NULL),
  ('business_2', 'biz_19', 'What real metric could you cite in content tomorrow with no caveats?', 25, true, true, 'textarea', NULL, false, 'e.g. Closed $X in pipeline from LinkedIn…', 'PROOF & RISK', NULL),
  ('business_2', 'biz_20', 'What claim would you never make publicly?', 26, true, true, 'single_select', '["\"Guaranteed results\"","\"#1 in the industry\"","\"Overnight growth\"","\"Works for every business\"","Other — describe in your own words"]'::jsonb, true, NULL, 'PROOF & RISK', NULL),
  ('business_2', 'anything_else', 'Is there anything else you''d like us to know that we may have missed?', 27, true, false, 'textarea', NULL, false, 'Optional — share anything we should know…', 'ANYTHING ELSE', NULL);

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

UPDATE public.avatars
SET profiling_data = profiling_data;
