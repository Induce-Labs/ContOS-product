"""Shared language constants for ContOS Agents translation."""

from __future__ import annotations

SUPPORTED_LANGUAGES = ["en", "hi", "zh", "fr", "es"]

LANGUAGE_DISPLAY_NAMES: dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "zh": "Chinese",
    "fr": "French",
    "es": "Spanish",
}


def normalize_response_language(lang: str | None) -> str:
    """Return a supported language code; default English."""
    code = (lang or "en").strip().lower().split("-")[0]
    if code not in SUPPORTED_LANGUAGES:
        raise ValueError(
            f"Unsupported response_language={lang!r}. "
            f"Allowed: {', '.join(SUPPORTED_LANGUAGES)}."
        )
    return code


def response_language_instruction(lang: str, *, structured: bool = False) -> str:
    """System-prompt addendum so the LLM answers in the user's UI language.

    Always emit an instruction (including English). Mid-thread language switches
    otherwise fail because chat history in another language steers the model.
    """
    code = normalize_response_language(lang)
    name = LANGUAGE_DISPLAY_NAMES[code]
    no_mix = (
        f"- ZERO code-mixing: do not write Hinglish, Chinglish, Spanglish, or any "
        f"blend. Every sentence must be fully in {name}.\n"
        f"- Do not insert English words, phrases, or template labels inside {name} "
        f"prose (e.g. avoid mixing 'trust problem', 'Hook + Reframe + CTA', "
        f"'price sensitivity' into {name} text). Rewrite those ideas in {name}.\n"
        f"- Allowed English-only exceptions: brand names, @handles, URLs, numbers, "
        f"dates, and platform enum tokens (Reel, Carousel, Story, LinkedIn, Instagram).\n"
    )
    if structured:
        return (
            f"\n\nRESPONSE LANGUAGE (HIGHEST PRIORITY — overrides chat history "
            f"AND competitor English source text):\n"
            f"- The ContOS UI language is {name} ({code}).\n"
            f"- Write EVERY user-facing string in {name} only — including hook, caption, "
            f"cta, hashtags, transcript, audio_suggestion, reasoning, analysis, "
            f"top_hooks, caption_formulas, posting_frequency, comparison_summary, "
            f"differentiation_angles, strengths, weaknesses, hooks_and_themes, "
            f"key_signals, and any other prose fields.\n"
            f"- It is NOT enough to translate reasoning alone: hooks, captions, CTAs, "
            f"transcripts, hashtags, top_hooks, AND caption_formulas MUST also be "
            f"fully in {name} (no English formula skeletons).\n"
            f"{no_mix}"
            f"- Competitor intel in CONTEXT is often English — adapt patterns/themes into "
            f"{name}; never paste English post copy into hook/caption/cta.\n"
            f"- Keep JSON keys, enum codes (Reel/Carousel/Story), URLs, @handles, "
            f"dates, and numbers unchanged.\n"
            f"- Prior turns may be in another language — do NOT continue in that language.\n"
            f"- The only foreign-language text allowed is a short quoted competitor line "
            f"inside reasoning, clearly marked as a quote.\n"
        )
    return (
        f"\n\nRESPONSE LANGUAGE (HIGHEST PRIORITY — overrides chat history):\n"
        f"- The ContOS UI language is {name} ({code}).\n"
        f"- You MUST write your entire reply in {name} only.\n"
        f"{no_mix}"
        f"- Prior turns may be in another language — do NOT continue in that language.\n"
        f"- Keep URLs, @handles, brand names, and numbers unchanged.\n"
    )


def response_language_user_reminder(lang: str, *, structured: bool = False) -> str:
    """Short reminder appended to the final user turn (beats history bias)."""
    code = normalize_response_language(lang)
    name = LANGUAGE_DISPLAY_NAMES[code]
    if structured:
        return (
            f"\n\n[ContOS UI language = {name} ({code}). "
            f"ALL creative JSON fields MUST be fully in {name} with ZERO "
            f"English/Hinglish mixing: hook, caption, cta, hashtags, transcript, "
            f"audio_suggestion, reasoning, analysis, top_hooks, caption_formulas, "
            f"posting_frequency, comparison text. "
            f"Write caption_formulas as natural {name} sentences — not English "
            f"templates like 'Hook + Reframe + CTA'. "
            f"Only brand names, @handles, URLs, numbers, and platform enum tokens "
            f"may stay English.]"
        )
    return (
        f"\n\n[ContOS UI language = {name} ({code}). "
        f"Reply entirely in {name} with ZERO code-mixing / Hinglish. "
        f"Do not use the language of earlier turns.]"
    )
