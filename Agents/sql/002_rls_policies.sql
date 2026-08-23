-- ContOS Agents — RLS policies for agent tables
-- Run after 001_agent_tables.sql

ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS playbooks_select_all ON playbooks;
DROP POLICY IF EXISTS playbooks_insert_all ON playbooks;
CREATE POLICY playbooks_select_all ON playbooks FOR SELECT USING (true);
CREATE POLICY playbooks_insert_all ON playbooks FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS agent_calls_select_all ON agent_calls;
DROP POLICY IF EXISTS agent_calls_insert_all ON agent_calls;
CREATE POLICY agent_calls_select_all ON agent_calls FOR SELECT USING (true);
CREATE POLICY agent_calls_insert_all ON agent_calls FOR INSERT WITH CHECK (true);

GRANT EXECUTE ON FUNCTION match_playbooks(vector, int, text) TO anon, authenticated, service_role;
