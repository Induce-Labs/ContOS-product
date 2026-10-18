"""On-demand content translation via OpenRouter with Postgres cache."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from typing import Any

from constants import LANGUAGE_DISPLAY_NAMES, SUPPORTED_LANGUAGES
from db.supabase_client import _require_client

logger = logging.getLogger(__name__)

TRANSLATION_MODEL = os.getenv("TRANSLATION_MODEL", "openai/gpt-4o-mini")
TRANSLATION_MAX_RETRIES = int(os.getenv("TRANSLATION_MAX_RETRIES", "3"))
TRANSLATION_MAX_TEXTS = 40
TRANSLATION_MAX_CHARS_PER_TEXT = 4000
TRANSLATION_MAX_TOTAL_CHARS = 24000
# Smaller LLM batches are more reliable (fewer dropped JSON keys under load).
OPENROUTER_BATCH_SIZE = int(os.getenv("TRANSLATION_OPENROUTER_BATCH_SIZE", "12"))
# One in-flight OpenRouter translation per process. Parallel HTTP chunks were
# failing together (502) when the model was asked for several batches at once.
_openrouter_lock = threading.Lock()


class TranslationError(Exception):
    """Raised when translation generation or cache persistence fails."""


def _normalize_lang(lang: str, *, field: str) -> str:
    code = (lang or "").strip().lower()
    if code not in SUPPORTED_LANGUAGES:
        raise TranslationError(
            f"Unsupported {field}={lang!r}. "
            f"Allowed: {', '.join(SUPPORTED_LANGUAGES)}."
        )
    return code


def source_hash_for(text: str, source_lang: str) -> str:
    payload = f"{source_lang}\0{text}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def validate_batch_limits(texts: list[str]) -> None:
    if len(texts) > TRANSLATION_MAX_TEXTS:
        raise TranslationError(
            f"Too many texts for translation: {len(texts)} "
            f"(max {TRANSLATION_MAX_TEXTS})."
        )
    total = 0
    for index, text in enumerate(texts):
        if not isinstance(text, str):
            raise TranslationError(
                f"texts[{index}] must be a string, got {type(text).__name__}."
            )
        length = len(text)
        if length > TRANSLATION_MAX_CHARS_PER_TEXT:
            raise TranslationError(
                f"texts[{index}] is {length} chars "
                f"(max {TRANSLATION_MAX_CHARS_PER_TEXT})."
            )
        total += length
    if total > TRANSLATION_MAX_TOTAL_CHARS:
        raise TranslationError(
            f"Total text length is {total} chars "
            f"(max {TRANSLATION_MAX_TOTAL_CHARS})."
        )


def _cache_get(
    *,
    source_hash: str,
    source_lang: str,
    target_lang: str,
) -> str | None:
    found = _cache_get_many(
        source_hashes=[source_hash],
        source_lang=source_lang,
        target_lang=target_lang,
    )
    return found.get(source_hash)


def _cache_get_many(
    *,
    source_hashes: list[str],
    source_lang: str,
    target_lang: str,
) -> dict[str, str]:
    """Batch cache lookup; returns map of source_hash → translated_text."""
    unique = list(dict.fromkeys(h for h in source_hashes if h))
    if not unique:
        return {}
    client = _require_client()
    try:
        response = (
            client.table("translation_cache")
            .select("source_hash,translated_text")
            .in_("source_hash", unique)
            .eq("source_lang", source_lang)
            .eq("target_lang", target_lang)
            .execute()
        )
    except Exception as exc:
        raise TranslationError(
            f"translation_cache lookup failed: {exc}"
        ) from exc
    out: dict[str, str] = {}
    for row in response.data or []:
        digest = row.get("source_hash")
        value = row.get("translated_text")
        if isinstance(digest, str) and isinstance(value, str):
            out[digest] = value
    return out


def _cache_put(
    *,
    source_hash: str,
    source_lang: str,
    target_lang: str,
    translated_text: str,
) -> None:
    client = _require_client()
    payload = {
        "source_hash": source_hash,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "translated_text": translated_text,
    }
    try:
        response = (
            client.table("translation_cache")
            .upsert(payload, on_conflict="source_hash,source_lang,target_lang")
            .execute()
        )
    except Exception as exc:
        raise TranslationError(
            f"Failed to persist translation cache: {exc}"
        ) from exc
    if getattr(response, "error", None):
        raise TranslationError(
            f"Failed to persist translation cache: {response.error}"
        )


def _cache_put_many(
    *,
    rows: list[dict[str, str]],
) -> None:
    if not rows:
        return
    client = _require_client()
    try:
        response = (
            client.table("translation_cache")
            .upsert(rows, on_conflict="source_hash,source_lang,target_lang")
            .execute()
        )
    except Exception as exc:
        raise TranslationError(
            f"Failed to persist translation cache batch: {exc}"
        ) from exc
    if getattr(response, "error", None):
        raise TranslationError(
            f"Failed to persist translation cache batch: {response.error}"
        )


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise TranslationError(
                f"Translation model returned non-JSON content: {raw[:500]!r}"
            ) from None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as error:
            raise TranslationError(
                f"Translation model returned invalid JSON: {error}; "
                f"body={raw[:500]!r}"
            ) from error
    if not isinstance(parsed, dict):
        raise TranslationError(
            f"Translation model JSON must be an object, got {type(parsed).__name__}."
        )
    return parsed


def _is_retryable(exc: BaseException) -> bool:
    message = str(exc).lower()
    return (
        "429" in message
        or "timeout" in message
        or "timed out" in message
        or "credit" in message
        or "rate limit" in message
        or "503" in message
        or "502" in message
        or "missing translated string" in message
        or "json" in message
    )


def _call_openrouter_batch(
    *,
    texts_by_key: dict[str, str],
    source_lang: str,
    target_lang: str,
) -> dict[str, str]:
    _openrouter_lock.acquire()
    try:
        return _call_openrouter_batch_locked(
            texts_by_key=texts_by_key,
            source_lang=source_lang,
            target_lang=target_lang,
        )
    finally:
        _openrouter_lock.release()


def _call_openrouter_batch_locked(
    *,
    texts_by_key: dict[str, str],
    source_lang: str,
    target_lang: str,
) -> dict[str, str]:
    source_name = LANGUAGE_DISPLAY_NAMES[source_lang]
    target_name = LANGUAGE_DISPLAY_NAMES[target_lang]
    payload = json.dumps(texts_by_key, ensure_ascii=False)
    system = (
        "You are a professional translator. Translate values in the given JSON object. "
        "Return ONLY a JSON object with the exact same keys. "
        "Preserve URLs, @handles, numbers, markdown punctuation, and {{mustache}} placeholders. "
        "Do not add commentary."
    )
    user = (
        f"Translate each value from {source_name} ({source_lang}) "
        f"to {target_name} ({target_lang}).\n\n"
        f"Input JSON:\n{payload}"
    )
    last_error: BaseException | None = None
    for attempt in range(1, TRANSLATION_MAX_RETRIES + 1):
        try:
            from agents.base_agent import get_llm_client

            client = get_llm_client()
            response = client.chat.completions.create(
                model=TRANSLATION_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.1,
                max_tokens=8000,
            )
            content = response.choices[0].message.content or ""
            parsed = _extract_json_object(content)
            result: dict[str, str] = {}
            missing: list[str] = []
            for key in texts_by_key:
                value = parsed.get(key)
                if not isinstance(value, str):
                    missing.append(key)
                else:
                    result[key] = value
            if missing:
                raise TranslationError(
                    f"Missing translated string for keys {missing!r} "
                    f"(model={TRANSLATION_MODEL}, batch_size={len(texts_by_key)})."
                )
            return result
        except TranslationError as error:
            last_error = error
            if attempt >= TRANSLATION_MAX_RETRIES or not _is_retryable(error):
                raise
            logger.warning(
                "translation LLM attempt failed",
                extra={
                    "attempt": attempt,
                    "model": TRANSLATION_MODEL,
                    "error": str(error),
                    "target_lang": target_lang,
                },
            )
            time.sleep(2 * attempt)
        except Exception as error:
            last_error = error
            if attempt >= TRANSLATION_MAX_RETRIES or not _is_retryable(error):
                raise TranslationError(
                    f"OpenRouter translation failed "
                    f"(model={TRANSLATION_MODEL}): {error}"
                ) from error
            logger.warning(
                "translation LLM attempt failed",
                extra={
                    "attempt": attempt,
                    "model": TRANSLATION_MODEL,
                    "error": str(error),
                    "target_lang": target_lang,
                },
            )
            time.sleep(2 * attempt)

    raise TranslationError(
        f"OpenRouter translation failed after retries "
        f"(model={TRANSLATION_MODEL}): {last_error}"
    )


def translate_content(
    text: str,
    target_lang: str,
    source_lang: str = "en",
) -> str:
    """Translate a single string. Same-language and blank text pass through."""
    source = _normalize_lang(source_lang, field="source_lang")
    target = _normalize_lang(target_lang, field="target_lang")
    if not isinstance(text, str):
        raise TranslationError(f"text must be a string, got {type(text).__name__}.")
    if not text.strip() or source == target:
        return text

    digest = source_hash_for(text, source)
    cached = _cache_get(source_hash=digest, source_lang=source, target_lang=target)
    if cached is not None:
        return cached

    translated_map = _call_openrouter_batch(
        texts_by_key={"1": text},
        source_lang=source,
        target_lang=target,
    )
    translated = translated_map["1"]
    _cache_put(
        source_hash=digest,
        source_lang=source,
        target_lang=target,
        translated_text=translated,
    )
    logger.info(
        "translation cache miss stored",
        extra={
            "source_hash": digest[:12],
            "source_lang": source,
            "target_lang": target,
            "model": TRANSLATION_MODEL,
        },
    )
    return translated


def translate_batch(
    texts: list[str],
    target_lang: str,
    source_lang: str = "en",
) -> list[str]:
    """Translate many strings; cache-first, then OpenRouter in small batches."""
    source = _normalize_lang(source_lang, field="source_lang")
    target = _normalize_lang(target_lang, field="target_lang")
    validate_batch_limits(texts)

    if source == target:
        return list(texts)

    results: list[str | None] = [None] * len(texts)
    digests: list[str | None] = [None] * len(texts)
    pending_indexes: list[int] = []

    for index, text in enumerate(texts):
        if not text.strip():
            results[index] = text
            continue
        digest = source_hash_for(text, source)
        digests[index] = digest
        pending_indexes.append(index)

    cached = _cache_get_many(
        source_hashes=[digests[i] for i in pending_indexes if digests[i]],
        source_lang=source,
        target_lang=target,
    )
    miss_keys: dict[str, str] = {}
    miss_indexes: dict[str, list[int]] = {}
    text_to_key: dict[str, str] = {}

    for index in pending_indexes:
        digest = digests[index]
        text = texts[index]
        if digest and digest in cached:
            results[index] = cached[digest]
            continue
        existing_key = text_to_key.get(text)
        if existing_key is not None:
            miss_indexes.setdefault(existing_key, []).append(index)
            continue
        key = str(len(miss_keys) + 1)
        miss_keys[key] = text
        miss_indexes[key] = [index]
        text_to_key[text] = key

    if miss_keys:
        items = list(miss_keys.items())
        translated_map: dict[str, str] = {}
        for offset in range(0, len(items), OPENROUTER_BATCH_SIZE):
            chunk_items = items[offset : offset + OPENROUTER_BATCH_SIZE]
            chunk = dict(chunk_items)
            partial = _call_openrouter_batch(
                texts_by_key=chunk,
                source_lang=source,
                target_lang=target,
            )
            translated_map.update(partial)

        cache_rows: list[dict[str, str]] = []
        for key, translated in translated_map.items():
            original = miss_keys[key]
            digest = source_hash_for(original, source)
            cache_rows.append(
                {
                    "source_hash": digest,
                    "source_lang": source,
                    "target_lang": target,
                    "translated_text": translated,
                }
            )
            for index in miss_indexes.get(key, []):
                results[index] = translated
        _cache_put_many(rows=cache_rows)

    for index, value in enumerate(results):
        if value is None:
            raise TranslationError(
                f"Internal translation batch gap at index {index}."
            )

    logger.info(
        "translation batch complete",
        extra={
            "count": len(texts),
            "misses": len(miss_keys),
            "source_lang": source,
            "target_lang": target,
            "model": TRANSLATION_MODEL,
        },
    )
    return [value for value in results if value is not None]
