"""Prompt registry."""

from .chatbot import CHATBOT_CONTEXT_OFF_PROMPT, CHATBOT_CONTEXT_ON_PROMPT
from .instagram import INSTAGRAM_SYSTEM_PROMPT
from .linkedin import LINKEDIN_SYSTEM_PROMPT
from .playbook import PLAYBOOK_SYSTEM_PROMPT
from .twitter import TWITTER_SYSTEM_PROMPT


def get_system_prompt(agent_type: str, chatbot_context_on: bool = False) -> str:
    if agent_type == "playbook":
        return PLAYBOOK_SYSTEM_PROMPT
    if agent_type == "instagram":
        return INSTAGRAM_SYSTEM_PROMPT
    if agent_type == "linkedin":
        return LINKEDIN_SYSTEM_PROMPT
    if agent_type == "twitter":
        return TWITTER_SYSTEM_PROMPT
    if agent_type == "chatbot":
        return (
            CHATBOT_CONTEXT_ON_PROMPT
            if chatbot_context_on
            else CHATBOT_CONTEXT_OFF_PROMPT
        )
    raise ValueError(f"Unknown agent_type: {agent_type}")


__all__ = ["get_system_prompt"]
