# Supabase `user_email` columns

## Purpose

Every ContOS **user-owned** public table stores a denormalized `user_email` column so the Table Editor shows whose row you are looking at without joining UUIDs by hand.

## How to use

1. Open Supabase → **Table Editor** → **Tables**.
2. Open any user-owned table (for example `avatars`, `agent_calls`, `competitors`).
3. `user_email` is the **first physical column** on each of those tables.

The old `*_readable` views were removed. Do not look under Views for email.

## Tables with `user_email`

| Table | Resolved from |
| --- | --- |
| `avatars` | `user_id` |
| `user_profiles` | `user_id` |
| `agent_calls` | `user_id` (text UUID) |
| `agent_chat_stores` | `user_id` |
| `content_plan_items` | `user_id` |
| `postiz_connections` | `contos_user_id` |
| `competitors` | `avatar_id` → avatar owner |
| `instagram_content_summaries` | `avatar_id` |
| `linkedin_content_summaries` | `avatar_id` |
| `twitter_content_summaries` | `avatar_id` |
| `instagram_scraped_content` | `competitor_id` → avatar owner |
| `linkedin_scraped_content` | `competitor_id` → avatar owner |
| `twitter_scraped_content` | `competitor_id` → avatar owner |

## Tables without `user_email` (global catalogs)

These have no ContOS user owner:

- `playbooks`
- `profiling_questionnaires`
- `marketing_knowledge_chunks`
- `translation_cache`

## How it stays in sync

- Migrations:
  - `supabase/migrations/20261109130000_user_email_columns.sql` — add column, backfill, triggers
  - `supabase/migrations/20261110120000_user_email_first_column.sql` — rebuild tables so `user_email` is column #1
- `BEFORE INSERT OR UPDATE` triggers set `user_email` from `auth.users` (client values are overwritten).
- Changing an avatar’s `user_id` cascades email onto competitors, summaries, and scraped rows for that avatar.
- ContOS app code does not need to write `user_email`.

## Re-backfill after an auth email change

Auth email updates are not hooked (restricted `auth` schema). If a user changes their login email, run:

```sql
UPDATE public.avatars AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.user_profiles AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.agent_calls AS t
SET user_email = public.contos_lookup_user_email(public.contos_parse_user_id_text(t.user_id));

UPDATE public.agent_chat_stores AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.content_plan_items AS t
SET user_email = public.contos_lookup_user_email(t.user_id);

UPDATE public.postiz_connections AS t
SET user_email = public.contos_lookup_user_email(t.contos_user_id);

UPDATE public.competitors AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.instagram_content_summaries AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.linkedin_content_summaries AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.twitter_content_summaries AS t
SET user_email = public.contos_email_from_avatar(t.avatar_id);

UPDATE public.instagram_scraped_content AS t
SET user_email = public.contos_email_from_competitor(t.competitor_id);

UPDATE public.linkedin_scraped_content AS t
SET user_email = public.contos_email_from_competitor(t.competitor_id);

UPDATE public.twitter_scraped_content AS t
SET user_email = public.contos_email_from_competitor(t.competitor_id);
```

## Security

- `user_email` is PII; it follows existing table RLS.
- Triggers always resolve email from `auth.users` so clients cannot spoof another user’s address.

## Known limitations

- Reordering required a table rebuild (Postgres cannot insert a column at position 1 in place).
- `agent_chat_stores_avatar_id_fkey` may be absent if orphan `avatar_id` rows exist; other inbound FKs are restored by the reorder migration.
