"""Prompt registry."""

from .chatbot import (
    CHATBOT_CONTEXT_OFF_PROMPT,
    CHATBOT_CONTEXT_ON_PROMPT,
    CHATBOT_MULTI_AVATAR_ADDENDUM,
)
from .instagram import INSTAGRAM_SYSTEM_PROMPT
from .linkedin import LINKEDIN_SYSTEM_PROMPT
from .playbook import PLAYBOOK_SYSTEM_PROMPT
from .twitter import TWITTER_SYSTEM_PROMPT


def get_system_prompt(
    agent_type: str,
    chatbot_context_on: bool = False,
    multi_avatar: bool = False,
) -> str:
    if agent_type == "playbook":
        return PLAYBOOK_SYSTEM_PROMPT
    if agent_type == "instagram":
        return INSTAGRAM_SYSTEM_PROMPT
    if agent_type == "linkedin":
        return LINKEDIN_SYSTEM_PROMPT
    if agent_type == "twitter":
        return TWITTER_SYSTEM_PROMPT
    if agent_type == "chatbot":
        base = (
            CHATBOT_CONTEXT_ON_PROMPT
            if chatbot_context_on
            else CHATBOT_CONTEXT_OFF_PROMPT
        )
        if multi_avatar and chatbot_context_on:
            return base + "\n\n" + CHATBOT_MULTI_AVATAR_ADDENDUM
        return base
    raise ValueError(f"Unknown agent_type: {agent_type}")


__all__ = ["get_system_prompt"]
