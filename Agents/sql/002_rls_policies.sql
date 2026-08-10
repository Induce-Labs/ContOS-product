-- ContOS Agents — RLS policies for agent tables
-- Run after 001_agent_tables.sql
--
-- Your backend currently uses a publishable/anon-style key, which is subject to RLS.
-- Prefer setting SUPABASE_SERVICE_ROLE_KEY to the project **secret / service_role** key
-- (Settings → API), which bypasses RLS. Until then, these policies allow the agent API
-- to read/write. Tighten before production.

ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_calls ENABLE ROW LEVEL SECURITY;

-- Playbooks: public read + insert (embeddings store + similarity search)
DROP POLICY IF EXISTS playbooks_select_all ON playbooks;
DROP POLICY IF EXISTS playbooks_insert_all ON playbooks;
CREATE POLICY playbooks_select_all ON playbooks FOR SELECT USING (true);
CREATE POLICY playbooks_insert_all ON playbooks FOR INSERT WITH CHECK (true);

-- Profiles: read/insert for agent fetch + seeding
DROP POLICY IF EXISTS profiles_select_all ON profiles;
DROP POLICY IF EXISTS profiles_insert_all ON profiles;
CREATE POLICY profiles_select_all ON profiles FOR SELECT USING (true);
CREATE POLICY profiles_insert_all ON profiles FOR INSERT WITH CHECK (true);

-- Agent call logs
DROP POLICY IF EXISTS agent_calls_select_all ON agent_calls;
DROP POLICY IF EXISTS agent_calls_insert_all ON agent_calls;
CREATE POLICY agent_calls_select_all ON agent_calls FOR SELECT USING (true);
CREATE POLICY agent_calls_insert_all ON agent_calls FOR INSERT WITH CHECK (true);

-- Allow RPC match_playbooks for anon/authenticated (embedding search)
GRANT EXECUTE ON FUNCTION match_playbooks(vector, int, text) TO anon, authenticated, service_role;
