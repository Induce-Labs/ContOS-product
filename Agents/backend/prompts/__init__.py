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
        prompt = PLAYBOOK_SYSTEM_PROMPT
    elif agent_type == "instagram":
        prompt = INSTAGRAM_SYSTEM_PROMPT
    elif agent_type == "linkedin":
        prompt = LINKEDIN_SYSTEM_PROMPT
    elif agent_type == "twitter":
        prompt = TWITTER_SYSTEM_PROMPT
    elif agent_type == "chatbot":
        prompt = (
            CHATBOT_CONTEXT_ON_PROMPT
            if chatbot_context_on
            else CHATBOT_CONTEXT_OFF_PROMPT
        )
    else:
        raise ValueError(f"Unknown agent_type: {agent_type}")

    if multi_avatar and (agent_type != "chatbot" or chatbot_context_on):
        return prompt + "\n\n" + CHATBOT_MULTI_AVATAR_ADDENDUM
    return prompt


__all__ = ["get_system_prompt"]
