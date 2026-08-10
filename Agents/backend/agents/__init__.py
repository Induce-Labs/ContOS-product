"""ContOS agent registry."""

from __future__ import annotations

from agents.base_agent import BaseAgent
from agents.chatbot_agent import ChatbotAgent
from agents.instagram_agent import InstagramAgent
from agents.linkedin_agent import LinkedInAgent
from agents.playbook_agent import PlaybookAgent
from agents.twitter_agent import TwitterAgent

AGENT_REGISTRY: dict[str, type[BaseAgent]] = {
    "playbook": PlaybookAgent,
    "instagram": InstagramAgent,
    "linkedin": LinkedInAgent,
    "twitter": TwitterAgent,
    "chatbot": ChatbotAgent,
}


def get_agent(agent_type: str) -> BaseAgent:
    cls = AGENT_REGISTRY.get(agent_type)
    if cls is None:
        raise ValueError(
            f"Unknown agent_type '{agent_type}'. "
            f"Expected one of: {sorted(AGENT_REGISTRY.keys())}"
        )
    return cls()


__all__ = [
    "AGENT_REGISTRY",
    "get_agent",
    "BaseAgent",
    "PlaybookAgent",
    "InstagramAgent",
    "LinkedInAgent",
    "TwitterAgent",
    "ChatbotAgent",
]
