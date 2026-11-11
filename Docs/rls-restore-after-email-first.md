# RLS restore after `user_email` column rewrite

## Purpose

Fix production onboarding failure: **Failed to start competitor research.**

## Root cause

Migration `user_email_first_column` rewrote tables so `user_email` is physical column #1. After the rewrite, several tables kept **RLS enabled** but lost all policies (`competitors` had **0** policies). Authenticated Supabase inserts from the browser were denied; the UI mapped that to the generic start-research error. No competitor rows were created for the new avatar.

## Fix

Migration `20261111003000_restore_rls_after_email_first.sql` restores own-row policies for:

- `competitors`
- Instagram / LinkedIn / X scraped content + content summaries
- `content_plan_items`

`postiz_connections` intentionally stays with RLS and no browser policies (service role only).

## Verify

- `pg_policies` shows 4 policies on `competitors`
- Retry **Research Competitors** on `/onboarding/competitors`

## Known limitations

- Does not repair the rebuild helper that dropped policies; future table rewrites must re-copy policies or re-apply this restore pattern.
