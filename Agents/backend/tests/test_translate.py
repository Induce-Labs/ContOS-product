"""Tests for on-demand translation service (mocked OpenRouter + cache)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.translate import (  # noqa: E402
    TranslationError,
    source_hash_for,
    translate_batch,
    translate_content,
)


def test_source_hash_stable() -> None:
    assert source_hash_for("hello", "en") == source_hash_for("hello", "en")
    assert source_hash_for("hello", "en") != source_hash_for("hello", "hi")
    assert source_hash_for("hello", "en") != source_hash_for("Hello", "en")


def test_same_lang_passthrough_skips_cache_and_llm() -> None:
    with (
        patch("services.translate._cache_get") as cache_get,
        patch("services.translate._call_openrouter_batch") as llm,
    ):
        assert translate_content("Hello", target_lang="en", source_lang="en") == "Hello"
        cache_get.assert_not_called()
        llm.assert_not_called()


def test_blank_passthrough() -> None:
    assert translate_content("   ", target_lang="hi") == "   "
    assert translate_batch(["", "  "], target_lang="fr") == ["", "  "]


def test_invalid_lang_raises() -> None:
    with pytest.raises(TranslationError, match="Unsupported target_lang"):
        translate_content("Hello", target_lang="de")


def test_cache_hit_skips_openrouter() -> None:
    with (
        patch("services.translate._cache_get", return_value="Hola") as cache_get,
        patch("services.translate._call_openrouter_batch") as llm,
        patch("services.translate._cache_put") as cache_put,
    ):
        result = translate_content("Hello", target_lang="es")
        assert result == "Hola"
        cache_get.assert_called_once()
        llm.assert_not_called()
        cache_put.assert_not_called()


def test_batch_splits_and_reassembles() -> None:
    def fake_llm(*, texts_by_key, source_lang, target_lang):
        assert source_lang == "en"
        assert target_lang == "hi"
        return {key: f"T({value})" for key, value in texts_by_key.items()}

    with (
        patch("services.translate._cache_get", return_value=None),
        patch("services.translate._call_openrouter_batch", side_effect=fake_llm),
        patch("services.translate._cache_put") as cache_put,
    ):
        result = translate_batch(["One", "Two", "One"], target_lang="hi")
        assert result == ["T(One)", "T(Two)", "T(One)"]
        # Duplicate "One" should only be sent once → one put for One + one for Two
        assert cache_put.call_count == 2


def test_batch_uses_cache_for_hits() -> None:
    def cache_get(*, source_hash, source_lang, target_lang):
        # Hash for "cached" will be looked up; return for that text only via side map
        return None

    with (
        patch("services.translate._cache_get", side_effect=[None, "CACHED", None]) as cache_get,
        patch(
            "services.translate._call_openrouter_batch",
            return_value={"1": "NEW-A", "2": "NEW-C"},
        ) as llm,
        patch("services.translate._cache_put"),
    ):
        # First miss, second hit (return CACHED), third miss — but our side_effect
        # is positional per call. Three non-empty texts → 3 cache lookups.
        result = translate_batch(["A", "B", "C"], target_lang="fr")
        assert cache_get.call_count == 3
        assert llm.call_count == 1
        # B was cached as CACHED on second lookup
        assert result[1] == "CACHED"
        assert result[0] == "NEW-A"
        assert result[2] == "NEW-C"


def test_batch_limit_too_many() -> None:
    with pytest.raises(TranslationError, match="Too many texts"):
        translate_batch(["x"] * 41, target_lang="hi")


def test_translate_content_stores_on_miss() -> None:
    with (
        patch("services.translate._cache_get", return_value=None),
        patch(
            "services.translate._call_openrouter_batch",
            return_value={"1": "Bonjour"},
        ),
        patch("services.translate._cache_put") as cache_put,
    ):
        assert translate_content("Hello", target_lang="fr") == "Bonjour"
        cache_put.assert_called_once()
        kwargs = cache_put.call_args.kwargs
        assert kwargs["target_lang"] == "fr"
        assert kwargs["translated_text"] == "Bonjour"
