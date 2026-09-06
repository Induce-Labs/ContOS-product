#!/usr/bin/env python3
"""One-off: translate Frontend/public/locales/en/common.json into hi/zh/fr/es via OpenRouter.

Usage (from repo root):
  python scripts/translate_ui_strings.py

Requires OPENROUTER_API_KEY in environment, Backend/.env, or repo .env.
Optional: TRANSLATION_MODEL (default openai/gpt-4o-mini).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import httpx
except ImportError as error:
    raise SystemExit(
        "httpx is required. Install with: pip install httpx"
    ) from error

try:
    from dotenv import dotenv_values, load_dotenv
except ImportError:
    dotenv_values = None  # type: ignore[assignment]
    load_dotenv = None  # type: ignore[assignment]

REPO_ROOT = Path(__file__).resolve().parents[1]
EN_PATH = REPO_ROOT / "Frontend" / "public" / "locales" / "en" / "common.json"
TARGET_LANGS = ("hi", "zh", "fr", "es")
LANG_NAMES = {
    "hi": "Hindi",
    "zh": "Chinese (Simplified)",
    "fr": "French",
    "es": "Spanish",
}
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def load_env() -> None:
    if load_dotenv is None:
        return
    load_dotenv(REPO_ROOT / ".env", override=False)
    load_dotenv(REPO_ROOT / "Backend" / ".env", override=False)
    agents_env = REPO_ROOT / "Agents" / "backend" / ".env"
    if agents_env.is_file() and dotenv_values is not None:
        for key, value in dotenv_values(agents_env).items():
            if key and value is not None and str(value).strip() != "":
                os.environ[key] = str(value)


def assert_same_keys(source: object, translated: object, path: str = "") -> None:
    if type(source) is not type(translated):
        raise RuntimeError(
            f"Type mismatch at {path or '/'}: "
            f"{type(source).__name__} vs {type(translated).__name__}"
        )
    if isinstance(source, dict):
        assert isinstance(translated, dict)
        source_keys = set(source)
        translated_keys = set(translated)
        missing = source_keys - translated_keys
        extra = translated_keys - source_keys
        if missing or extra:
            raise RuntimeError(
                f"Key mismatch at {path or '/'}: missing={sorted(missing)} extra={sorted(extra)}"
            )
        for key, value in source.items():
            assert_same_keys(value, translated[key], f"{path}.{key}" if path else key)
    elif isinstance(source, list):
        assert isinstance(translated, list)
        if len(source) != len(translated):
            raise RuntimeError(
                f"List length mismatch at {path or '/'}: "
                f"{len(source)} vs {len(translated)}"
            )
        for index, (left, right) in enumerate(zip(source, translated)):
            assert_same_keys(left, right, f"{path}[{index}]")


def extract_json_object(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise RuntimeError(
                f"Model returned non-JSON content: {raw[:800]!r}"
            ) from error
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError as nested:
            raise RuntimeError(
                f"Model returned invalid JSON: {nested}; body={raw[:800]!r}"
            ) from nested
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Expected JSON object, got {type(parsed).__name__}")
    return parsed


def translate_catalog(en: dict, target_lang: str, api_key: str, model: str) -> dict:
    target_name = LANG_NAMES[target_lang]
    system = (
        "You are a professional UI localization translator. "
        "Translate JSON string values from English to the target language. "
        "Keep the exact same JSON structure and keys. "
        "Preserve {{mustache}} interpolation tokens, HTML entities, and punctuation. "
        "Return ONLY valid JSON."
    )
    user = (
        f"Translate all string values to {target_name} ({target_lang}).\n\n"
        f"{json.dumps(en, ensure_ascii=False, indent=2)}"
    )
    with httpx.Client(timeout=180.0) as client:
        response = client.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
        )
    if response.status_code >= 400:
        raise RuntimeError(
            f"OpenRouter HTTP {response.status_code} for {target_lang}: "
            f"{response.text[:1000]}"
        )
    payload = response.json()
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError(
            f"Unexpected OpenRouter response for {target_lang}: {payload!r}"
        ) from error
    if not isinstance(content, str):
        raise RuntimeError(f"Empty translation content for {target_lang}")
    translated = extract_json_object(content)
    assert_same_keys(en, translated)
    return translated


def main() -> int:
    load_env()
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print(
            "OPENROUTER_API_KEY is not set. Add it to Backend/.env or the environment.",
            file=sys.stderr,
        )
        return 1
    model = os.getenv("TRANSLATION_MODEL", "openai/gpt-4o-mini").strip()
    if not EN_PATH.is_file():
        print(f"Missing English catalog: {EN_PATH}", file=sys.stderr)
        return 1

    en = json.loads(EN_PATH.read_text(encoding="utf-8"))
    if not isinstance(en, dict):
        print("en/common.json must be a JSON object", file=sys.stderr)
        return 1

    for lang in TARGET_LANGS:
        print(f"Translating -> {lang} ({LANG_NAMES[lang]}) with {model}...")
        translated = translate_catalog(en, lang, api_key=api_key, model=model)
        out_path = (
            REPO_ROOT / "Frontend" / "public" / "locales" / lang / "common.json"
        )
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(translated, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {out_path}")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
