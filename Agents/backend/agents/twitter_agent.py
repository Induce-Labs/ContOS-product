"""Twitter/X Agent — high-signal tweets and threads."""

from agents.base_agent import BaseAgent


class TwitterAgent(BaseAgent):
    agent_type = "twitter"
    structured_output = True
