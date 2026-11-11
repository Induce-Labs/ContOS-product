-- Restore RLS policies dropped when contos_rebuild_table_user_email_first
-- rewrote tables. RLS stayed enabled with zero policies, so authenticated
-- inserts (e.g. competitors from onboarding) failed with a generic client error.

-- competitors
DROP POLICY IF EXISTS competitors_select_own ON public.competitors;
DROP POLICY IF EXISTS competitors_insert_own ON public.competitors;
DROP POLICY IF EXISTS competitors_update_own ON public.competitors;
DROP POLICY IF EXISTS competitors_delete_own ON public.competitors;

CREATE POLICY competitors_select_own ON public.competitors
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_insert_own ON public.competitors
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_update_own ON public.competitors
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY competitors_delete_own ON public.competitors
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = competitors.avatar_id AND a.user_id = auth.uid()
    )
  );

-- instagram_scraped_content
DROP POLICY IF EXISTS instagram_scraped_content_select_own ON public.instagram_scraped_content;
DROP POLICY IF EXISTS instagram_scraped_content_insert_own ON public.instagram_scraped_content;
DROP POLICY IF EXISTS instagram_scraped_content_update_own ON public.instagram_scraped_content;
DROP POLICY IF EXISTS instagram_scraped_content_delete_own ON public.instagram_scraped_content;

CREATE POLICY instagram_scraped_content_select_own ON public.instagram_scraped_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_scraped_content_insert_own ON public.instagram_scraped_content
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_scraped_content_update_own ON public.instagram_scraped_content
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_scraped_content_delete_own ON public.instagram_scraped_content
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = instagram_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

-- instagram_content_summaries
DROP POLICY IF EXISTS instagram_content_summaries_select_own ON public.instagram_content_summaries;
DROP POLICY IF EXISTS instagram_content_summaries_insert_own ON public.instagram_content_summaries;
DROP POLICY IF EXISTS instagram_content_summaries_update_own ON public.instagram_content_summaries;
DROP POLICY IF EXISTS instagram_content_summaries_delete_own ON public.instagram_content_summaries;

CREATE POLICY instagram_content_summaries_select_own ON public.instagram_content_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_content_summaries_insert_own ON public.instagram_content_summaries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_content_summaries_update_own ON public.instagram_content_summaries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY instagram_content_summaries_delete_own ON public.instagram_content_summaries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = instagram_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

-- linkedin_scraped_content
DROP POLICY IF EXISTS linkedin_scraped_content_select_own ON public.linkedin_scraped_content;
DROP POLICY IF EXISTS linkedin_scraped_content_insert_own ON public.linkedin_scraped_content;
DROP POLICY IF EXISTS linkedin_scraped_content_update_own ON public.linkedin_scraped_content;
DROP POLICY IF EXISTS linkedin_scraped_content_delete_own ON public.linkedin_scraped_content;

CREATE POLICY linkedin_scraped_content_select_own ON public.linkedin_scraped_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_scraped_content_insert_own ON public.linkedin_scraped_content
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_scraped_content_update_own ON public.linkedin_scraped_content
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_scraped_content_delete_own ON public.linkedin_scraped_content
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = linkedin_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

-- linkedin_content_summaries
DROP POLICY IF EXISTS linkedin_content_summaries_select_own ON public.linkedin_content_summaries;
DROP POLICY IF EXISTS linkedin_content_summaries_insert_own ON public.linkedin_content_summaries;
DROP POLICY IF EXISTS linkedin_content_summaries_update_own ON public.linkedin_content_summaries;
DROP POLICY IF EXISTS linkedin_content_summaries_delete_own ON public.linkedin_content_summaries;

CREATE POLICY linkedin_content_summaries_select_own ON public.linkedin_content_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_content_summaries_insert_own ON public.linkedin_content_summaries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_content_summaries_update_own ON public.linkedin_content_summaries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY linkedin_content_summaries_delete_own ON public.linkedin_content_summaries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = linkedin_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

-- twitter_scraped_content
DROP POLICY IF EXISTS twitter_scraped_content_select_own ON public.twitter_scraped_content;
DROP POLICY IF EXISTS twitter_scraped_content_insert_own ON public.twitter_scraped_content;
DROP POLICY IF EXISTS twitter_scraped_content_update_own ON public.twitter_scraped_content;
DROP POLICY IF EXISTS twitter_scraped_content_delete_own ON public.twitter_scraped_content;

CREATE POLICY twitter_scraped_content_select_own ON public.twitter_scraped_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = twitter_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY twitter_scraped_content_insert_own ON public.twitter_scraped_content
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = twitter_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY twitter_scraped_content_update_own ON public.twitter_scraped_content
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = twitter_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = twitter_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY twitter_scraped_content_delete_own ON public.twitter_scraped_content
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.competitors c
      INNER JOIN public.avatars a ON a.id = c.avatar_id
      WHERE c.id = twitter_scraped_content.competitor_id
        AND a.user_id = auth.uid()
    )
  );

-- twitter_content_summaries
DROP POLICY IF EXISTS twitter_content_summaries_select_own ON public.twitter_content_summaries;
DROP POLICY IF EXISTS twitter_content_summaries_insert_own ON public.twitter_content_summaries;
DROP POLICY IF EXISTS twitter_content_summaries_update_own ON public.twitter_content_summaries;
DROP POLICY IF EXISTS twitter_content_summaries_delete_own ON public.twitter_content_summaries;

CREATE POLICY twitter_content_summaries_select_own ON public.twitter_content_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = twitter_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY twitter_content_summaries_insert_own ON public.twitter_content_summaries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = twitter_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY twitter_content_summaries_update_own ON public.twitter_content_summaries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = twitter_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = twitter_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY twitter_content_summaries_delete_own ON public.twitter_content_summaries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = twitter_content_summaries.avatar_id AND a.user_id = auth.uid()
    )
  );

-- content_plan_items
DROP POLICY IF EXISTS content_plan_items_select_own ON public.content_plan_items;
DROP POLICY IF EXISTS content_plan_items_insert_own ON public.content_plan_items;
DROP POLICY IF EXISTS content_plan_items_update_own ON public.content_plan_items;
DROP POLICY IF EXISTS content_plan_items_delete_own ON public.content_plan_items;

CREATE POLICY content_plan_items_select_own ON public.content_plan_items
  FOR SELECT USING (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY content_plan_items_insert_own ON public.content_plan_items
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY content_plan_items_update_own ON public.content_plan_items
  FOR UPDATE USING (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY content_plan_items_delete_own ON public.content_plan_items
  FOR DELETE USING (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.avatars a
      WHERE a.id = content_plan_items.avatar_id AND a.user_id = auth.uid()
    )
  );
