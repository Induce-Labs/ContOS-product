"""Instagram Agent — Instagram-native content calendar."""

from agents.base_agent import BaseAgent


class InstagramAgent(BaseAgent):
    agent_type = "instagram"
    structured_output = True
