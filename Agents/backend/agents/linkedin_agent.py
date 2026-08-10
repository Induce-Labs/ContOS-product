"""LinkedIn Agent — professional LinkedIn content."""

from agents.base_agent import BaseAgent


class LinkedInAgent(BaseAgent):
    agent_type = "linkedin"
    structured_output = True
