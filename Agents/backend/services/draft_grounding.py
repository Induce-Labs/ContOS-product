"""Deterministic guard: quoted speech in drafts/memory must come from the user's own words."""

from __future__ import annotations

import re
from typing import Any

QUOTE_PATTERN = re.compile(r'["“]([^"”]{12,})["”]')
PLACEHOLDER = "**what a customer actually said**"
DRAFT_FIELDS = {
    "post_ideas": ("post_structure", "hook"),
    "tweet_ideas": ("full_tweet", "hook"),
    "content_calendar": ("copy_paste_post", "caption", "hook"),
}

# Session-meta / ephemeral phrasing on normalized memory content.
_SESSION_META_PATTERN = re.compile(
    r"(?:^|\s)(?:"
    r"user asked|user acknowledged|user needs|user is currently|"
    r"user wants|user is reviewing|user requested|this turn|"
    r"conversation summary|session summary|agent recommended|"
    r"i recommend|i suggested|recommended that"
    r")(?:\s|$)"
)
_EPHEMERAL_REQUEST_PATTERN = re.compile(
    r"^(?:tell me|write|create|draft|make me|help me|can you|could you|please "
    r"(?:write|create|draft|make|tell|analyze|review))\b"
)
# One-off / session-scoped preference phrasing (normalized, punctuation stripped).
_ONE_OFF_SCOPE_PATTERN = re.compile(
    r"(?:^|\s)(?:"
    r"just for this|for this post|for this tweet|for this thread|for this turn|"
    r"for this reply|this time only|one time|onetime|only once|for once|"
    r"for today only|for tomorrow only"
    r")(?:\s|$)"
)
_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "that",
        "with",
        "this",
        "from",
        "your",
        "you",
        "are",
        "was",
        "were",
        "have",
        "has",
        "had",
        "will",
        "would",
        "should",
        "could",
        "about",
        "into",
        "their",
        "them",
        "they",
        "our",
        "ours",
        "what",
        "when",
        "where",
        "which",
        "while",
        "than",
        "then",
        "also",
        "just",
        "like",
        "very",
        "more",
        "some",
        "any",
        "all",
        "not",
        "but",
        "use",
        "using",
        "used",
    }
)
_USER_EVIDENCE_RATIO = 0.5
_INFERRED_EVIDENCE_RATIO = 0.6
_MIN_EVIDENCE_HITS = 2


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", text.lower())).strip()


def build_allowed_text(
    user_input: str,
    chat_history: list[dict[str, str]] | None,
    memory: list[dict[str, Any]] | None,
) -> str:
    parts = [user_input or ""]
    for turn in chat_history or []:
        if turn.get("role") == "user":
            parts.append(str(turn.get("content") or ""))
    for item in memory or []:
        if item.get("source") == "user":
            parts.append(str(item.get("content") or ""))
    return _norm(" ".join(parts))


def has_unsupported_quote(text: str, allowed_norm: str) -> bool:
    return any(_norm(m) not in allowed_norm for m in QUOTE_PATTERN.findall(text or ""))


def _strip(text: str, allowed_norm: str) -> tuple[str, int]:
    removed = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal removed
        if _norm(match.group(1)) in allowed_norm:
            return match.group(0)
        removed += 1
        return PLACEHOLDER

    return QUOTE_PATTERN.sub(repl, text or ""), removed


def strip_unsupported_quotes(output: dict[str, Any], allowed_norm: str) -> int:
    """Replace quotes the user never gave with a bold suggestion; returns how many were replaced."""
    total = 0
    for key, fields in DRAFT_FIELDS.items():
        for item in output.get(key) or []:
            if not isinstance(item, dict):
                continue
            for field in fields:
                if isinstance(item.get(field), str):
                    item[field], n = _strip(item[field], allowed_norm)
                    total += n
    for thread in output.get("thread_structures") or []:
        if isinstance(thread, dict) and isinstance(thread.get("tweets"), list):
            fixed = []
            for tweet in thread["tweets"]:
                text, n = _strip(str(tweet), allowed_norm)
                total += n
                fixed.append(text)
            thread["tweets"] = fixed
    if total:
        note = (
            " I replaced a customer quote I could not source from your messages with a "
            "bold suggestion; put in their real words if you have them."
        )
        output["reply"] = (str(output.get("reply") or "").rstrip() + note).strip()
    return total


def filter_memory_updates(updates: Any, allowed_norm: str) -> list[dict[str, Any]]:
    """Keep only durable, user-evidenced memory items; drop quotes the user never said.

    ``allowed_norm`` must come from ``build_allowed_text`` (user turns + user-sourced
    memory only). Assistant replies are never treated as evidence.
    """
    if not isinstance(updates, list):
        return []
    kept: list[dict[str, Any]] = []
    for item in updates:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or "")
        if has_unsupported_quote(content, allowed_norm):
            continue
        if not is_durable_memory_candidate(item, allowed_norm):
            continue
        kept.append(item)
    return kept


def is_durable_memory_candidate(item: dict[str, Any], allowed_norm: str) -> bool:
    """Return whether one proposed memory may be written to Supermemory."""
    kind = str(item.get("kind") or "").strip().lower()
    source = str(item.get("source") or "inferred").strip().lower()
    content = str(item.get("content") or "").strip()
    if not content or not kind:
        return False

    # Inferred notes are the main false-positive class (session observations).
    if source == "inferred" and kind == "note":
        return False

    if is_temporary_memory_content(content):
        return False

    if source == "user":
        return has_user_evidence(content, allowed_norm, min_ratio=_USER_EVIDENCE_RATIO)

    if source == "inferred":
        return has_user_evidence(
            content, allowed_norm, min_ratio=_INFERRED_EVIDENCE_RATIO
        )

    # Unknown sources are treated as inferred by save_memory_updates; require evidence.
    return has_user_evidence(content, allowed_norm, min_ratio=_INFERRED_EVIDENCE_RATIO)


def is_temporary_memory_content(content: str) -> bool:
    """True for session-meta phrasing, one-off requests, or question-shaped content."""
    raw = (content or "").strip()
    if not raw:
        return True
    if "?" in raw:
        return True
    normalized = _norm(raw)
    if not normalized:
        return True
    if _SESSION_META_PATTERN.search(f" {normalized} "):
        return True
    if _EPHEMERAL_REQUEST_PATTERN.match(normalized):
        return True
    if _ONE_OFF_SCOPE_PATTERN.search(f" {normalized} "):
        return True
    return False


def has_user_evidence(
    content: str,
    allowed_norm: str,
    *,
    min_ratio: float,
) -> bool:
    """Require significant lexical support from user-derived ``allowed_norm``.

    Uses the same normalization as quote grounding. Ambiguous content fails closed.
    """
    evidence = (allowed_norm or "").strip()
    if not evidence:
        return False
    tokens = _significant_tokens(content)
    if len(tokens) < _MIN_EVIDENCE_HITS:
        return False
    allowed_tokens = set(evidence.split())
    hits = sum(1 for token in tokens if _token_supported(token, evidence, allowed_tokens))
    if hits < _MIN_EVIDENCE_HITS:
        return False
    return (hits / len(tokens)) >= min_ratio


def _significant_tokens(content: str) -> list[str]:
    return [
        token
        for token in _norm(content).split()
        if len(token) >= 3 and token not in _STOPWORDS
    ]


def _token_supported(token: str, allowed_norm: str, allowed_tokens: set[str]) -> bool:
    if token in allowed_tokens:
        return True
    # Allow light morphological overlap (vague / vaguely) without a stemmer.
    if len(token) >= 4 and token in allowed_norm:
        return True
    return False
