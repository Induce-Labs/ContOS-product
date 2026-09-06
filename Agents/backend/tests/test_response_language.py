"""Tests for response_language helpers used by agent invoke."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from constants import (  # noqa: E402
    normalize_response_language,
    response_language_instruction,
    response_language_user_reminder,
)


def test_normalize_response_language() -> None:
    assert normalize_response_language("hi") == "hi"
    assert normalize_response_language("EN-US") == "en"
    assert normalize_response_language(None) == "en"


def test_normalize_rejects_unsupported() -> None:
    with pytest.raises(ValueError, match="Unsupported"):
        normalize_response_language("de")


def test_instruction_includes_english() -> None:
    text = response_language_instruction("en")
    assert "English" in text
    assert "(en)" in text
    assert "MUST write your entire reply" in text
    assert "do NOT continue in that language" in text


def test_instruction_requires_target_language() -> None:
    text = response_language_instruction("zh")
    assert "Chinese" in text
    assert "(zh)" in text
    assert "MUST write your entire reply" in text
    assert "HIGHEST PRIORITY" in text


def test_structured_instruction_requires_creative_fields() -> None:
    text = response_language_instruction("hi", structured=True)
    assert "Hindi" in text
    assert "hook" in text
    assert "caption" in text
    assert "cta" in text
    assert "hashtags" in text
    assert "NOT enough to translate reasoning alone" in text
    assert "ZERO code-mixing" in text
    assert "Hinglish" in text
    assert "JSON keys" in text


def test_structured_user_reminder_pins_creative_fields() -> None:
    text = response_language_user_reminder("hi", structured=True)
    assert "Hindi" in text
    assert "hook" in text
    assert "caption" in text
    assert "ZERO" in text
    assert "Hinglish" in text
    assert "caption_formulas" in text


def test_user_reminder_pins_ui_language() -> None:
    text = response_language_user_reminder("zh")
    assert "Chinese" in text
    assert "(zh)" in text
    assert "Reply entirely in Chinese" in text
    assert "ZERO code-mixing" in text
