"""The chatbot picks answer length from intent, not from message length."""

from prompts import get_system_prompt


def test_both_chatbot_prompts_carry_the_length_tiers():
    for context_on in (True, False):
        prompt = get_system_prompt("chatbot", chatbot_context_on=context_on)
        for marker in ("QUICK", "STANDARD", "DEEP", "The user's own words win", "Always finish", "Never invent figures"):
            assert marker in prompt
        assert "Be conversational and concise" not in prompt
