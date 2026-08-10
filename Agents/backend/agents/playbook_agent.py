"""Playbook Agent — Fortune 500 strategy + guardrails."""

from agents.base_agent import BaseAgent


class PlaybookAgent(BaseAgent):
    agent_type = "playbook"
    structured_output = True
