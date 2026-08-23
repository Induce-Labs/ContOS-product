"""Sanitize scraped text so JSON/UTF-8 HTTP clients do not fail on lone surrogates."""

from __future__ import annotations

from typing import Any


def sanitize_text(value: str | None) -> str | None:
    """Remove/replace lone UTF-16 surrogates that cannot be encoded as UTF-8."""
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    if not value:
        return value
    # Instagram/Apify occasionally returns broken emoji as lone surrogates.
    return value.encode("utf-8", errors="surrogatepass").decode("utf-8", errors="replace")


def sanitize_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return sanitize_text(str(value))


def sanitize_json_value(value: Any) -> Any:
    """Recursively sanitize strings inside nested JSON-like payloads."""
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        return [sanitize_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_json_value(item) for key, item in value.items()}
    return value


def sanitize_mapping_strings(payload: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    cleaned = dict(payload)
    for key in keys:
        if key in cleaned and isinstance(cleaned[key], str):
            cleaned[key] = sanitize_text(cleaned[key])
    return cleaned
