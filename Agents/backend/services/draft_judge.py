"""LLM-as-judge for strategist drafts: verdict, retry context, and the keep-with-disclaimer fallback."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from services.draft_grounding import DRAFT_FIELDS

logger = logging.getLogger(__name__)

JUDGE_MODEL = os.getenv("JUDGE_MODEL", "google/gemini-2.5-flash")
JUDGE_ENABLED = os.getenv("DRAFT_JUDGE_ENABLED", "1") not in {"0", "false", "False"}
PROFILE_KEYS = (
    "name", "business_name", "expertise", "ideal_reader", "target_audience",
    "brand_voice", "goals", "industry", "offerings",
)

JUDGE_SYSTEM = """You are a strict fact-checker of a marketing assistant's draft. Decide if the
draft may be shown to the user.

STEP 1. List every concrete claim the draft makes about THIS brand or user: events, people who
did or said something, numbers, causes and reasons, how something used to be done, results and
outcomes, product or taste properties, offers. Ignore opinions, rhetorical framing, generic
statements about the world, and anything inside **double asterisks**: those are suggestions the
user will confirm or change, so they are not claims. The ONE exception: inside **double
asterisks** it is still a failure to state a statistic or number as a result, an award, a
client, revenue, words quoted from a customer or another person, or a named third party.
STEP 2. For each claim, mark supported=true ONLY if ALLOWED_FACTS says it or directly implies it.
A cause, a person, a scene or a detail that ALLOWED_FACTS never mentions is supported=false, even
if it sounds plausible. Examples of unsupported: "a cafe owner sent us a video", "we tasted it
in a quiet room", "the cooling was trapping acids" (a root cause the user never stated), "we
blamed the baristas", "the cup is bright, not sharp".

FAIL the draft if any claim is unsupported, or if it is off_topic (unrelated or absurd), or
ignored_request (does not do what the latest user message asked), or contradicts_memory (uses
something in rejections). Do NOT fail for tone, style, or rephrasing an allowed fact. A weekly
schedule IS a short list of 2-3 days, each with a full post, so never fail a plan for not
being a "real calendar". Deliberate, explained pushback is not ignored_request: for example offering 5 focused ideas instead of 30,
or a monthly theme outline instead of a full month of posts. First-person opinions and beliefs
("I think...", "we care about...") are not claims. General statements about what an audience
usually wants or feels, or about common industry practice, are opinions, not claims about this
brand. Only flag them if they describe something THIS brand or user did, saw or achieved.

Return JSON only:
{"claims": [{"claim": "exact snippet copied from the draft", "supported": true|false}],
 "verdict": "pass" | "fail", "off_topic": bool, "ignored_request": bool,
 "contradicts_memory": bool, "reason": "one sentence"}"""


def _draft_texts(output: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for key, fields in DRAFT_FIELDS.items():
        for item in output.get(key) or []:
            if isinstance(item, dict):
                for field in fields:
                    if isinstance(item.get(field), str) and item[field].strip():
                        texts.append(item[field].strip())
                        break
    for thread in output.get("thread_structures") or []:
        if isinstance(thread, dict):
            texts.extend(str(t) for t in thread.get("tweets") or [])
    return texts


def is_judged(output: Any) -> bool:
    return (
        JUDGE_ENABLED
        and isinstance(output, dict)
        and output.get("mode") != "chat"
        and bool(_draft_texts(output))
    )


def _profiling_answers(data: Any) -> list[str]:
    if not isinstance(data, dict):
        return []
    answers = []
    for item in data.values():
        if isinstance(item, dict) and str(item.get("answer") or "").strip():
            answers.append(f"{item.get('question', '')} {item['answer']}".strip())
    return answers[:30]


def build_facts(
    user_input: str,
    chat_history: list[dict[str, str]] | None,
    memory: list[dict[str, Any]] | None,
    profile: dict[str, Any] | None,
) -> dict[str, Any]:
    said = [str(t.get("content") or "") for t in (chat_history or []) if t.get("role") == "user"]
    said.append(user_input or "")
    return {
        "user_statements": [s for s in said if s.strip()],
        "memory_user_facts": [
            str(m.get("content")) for m in memory or [] if m.get("source") == "user" and m.get("kind") != "rejection"
        ],
        "rejections": [str(m.get("content")) for m in memory or [] if m.get("kind") == "rejection"],
        "brand_profile": {k: (profile or {}).get(k) for k in PROFILE_KEYS if (profile or {}).get(k)},
        "profile_summary": str((profile or {}).get("profile_summary") or "")[:3000],
        "profiling_answers": _profiling_answers((profile or {}).get("profiling_data")),
    }


def judge_output(
    client: Any, user_input: str, output: dict[str, Any], facts: dict[str, Any]
) -> dict[str, Any]:
    """Return a normalized verdict; fails open (pass) on any judge error."""
    payload = {
        "latest_user_message": user_input,
        "mode": output.get("mode"),
        "ALLOWED_FACTS": facts,
        "assistant_reply": output.get("reply"),
        "draft": _draft_texts(output),
    }
    messages = [
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": json.dumps(payload, default=str)},
    ]
    last_error: Exception | None = None
    for model in dict.fromkeys([JUDGE_MODEL, os.getenv("LLM_MODEL", "moonshotai/kimi-k2.6")]):
        try:
            kwargs: dict[str, Any] = {
                "model": model, "messages": messages, "temperature": 0,
                "max_tokens": 1200, "response_format": {"type": "json_object"},
            }
            if "kimi" in model:
                kwargs["extra_body"] = {"reasoning": {"effort": "none", "exclude": True}}
            response = client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content or ""
            data = json.loads(re.search(r"\{[\s\S]*\}", raw).group(0))
            unsupported = [
                str(c.get("claim")).strip()
                for c in data.get("claims") or []
                if isinstance(c, dict) and c.get("supported") is False and str(c.get("claim") or "").strip()
            ] + [str(x) for x in data.get("unsupported_claims") or [] if str(x).strip()]
            verdict = {
                "pass": str(data.get("verdict")).lower() == "pass" and not unsupported,
                "off_topic": bool(data.get("off_topic")),
                "ignored_request": bool(data.get("ignored_request")),
                "contradicts_memory": bool(data.get("contradicts_memory")),
                "unsupported": unsupported,
                "reason": str(data.get("reason") or "").strip(),
                "judge_model": model,
            }
            if not verdict["pass"] and not (
                verdict["off_topic"] or verdict["ignored_request"]
                or verdict["contradicts_memory"] or unsupported
            ):
                verdict["pass"] = True
            return verdict
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if "402" in str(exc) or "credits" in str(exc).lower():
                break
    logger.warning("draft judge failed open: %s", last_error)
    return {"pass": True, "error": str(last_error)[:200], "unsupported": [], "reason": ""}


def build_retry_messages(
    messages: list[dict[str, Any]], rejected_raw: str, verdict: dict[str, Any]
) -> list[dict[str, Any]]:
    problems: list[str] = []
    if verdict.get("off_topic"):
        problems.append("it was unrelated or absurd for what the user asked")
    if verdict.get("ignored_request"):
        problems.append("it did not do what the user's latest message asked")
    if verdict.get("contradicts_memory"):
        problems.append("it used something the user previously rejected")
    if verdict.get("unsupported"):
        problems.append(
            "it stated details the user never gave: "
            + "; ".join(f'"{s[:140]}"' for s in verdict["unsupported"][:6])
        )
    feedback = (
        "REVIEW: your previous answer was rejected because "
        + (" and ".join(problems) or verdict.get("reason") or "it was not grounded")
        + f". Reviewer note: {verdict.get('reason') or 'n/a'}\n"
        "The user NEVER saw the rejected answer: do not mention it, apologize, or say you "
        "overreached or removed anything. Regenerate the FULL JSON with a different approach for the "
        "draft only: keep the same mode, ideas, thesis and next_question unless they were the problem. "
        + ("Shorten every tweet to 280 characters or fewer, counting bold text, keeping the same idea; "
           "if it needs more room, write a thread where each tweet fits. "
           if verdict.get("length") else
           "Still deliver the draft the user asked for, at the same length and layout as before. ")
        +
        "Keep every fact the user gave. Do not use square brackets. Wrap each detail the user did not "
        "give in a **bold** suggestion that fits their profile; if a statement cannot be written as a "
        "short bold suggestion, write it as an opinion or belief in the user's voice instead. "
        "Never use statistics, results, awards, clients, revenue, quoted speech or named third "
        "parties, even in bold. Do not reuse the rejected "
        "sentences and do not add any backstory, cause, person, quote or result the user never stated."
    )
    return [
        *messages,
        {"role": "assistant", "content": rejected_raw},
        {"role": "user", "content": feedback},
    ]


def apply_fallback(output: dict[str, Any], verdict: dict[str, Any]) -> str:
    """Make a twice-rejected draft safe: placeholders for unsupported text, or drop the draft."""
    if verdict.get("off_topic") or verdict.get("contradicts_memory"):
        for key in DRAFT_FIELDS:
            output[key] = []
        output["thread_structures"] = []
        output["mode"] = "strategy"
        output["thesis"] = ""
        output["reply"] = (
            "I could not write a draft I trust for that yet. "
            "Tell me a little more about what actually happened and I will build it from that."
        )
        return "draft_dropped"
    if verdict.get("length"):
        output["reply"] = (
            str(output.get("reply") or "").rstrip()
            + f" Note: {verdict.get('reason')}. Shorten it or post it as a thread."
        ).strip()
        return "kept_over_limit"
    output["unverified_claims"] = list(verdict.get("unsupported") or [])[:8]
    return "kept_with_disclaimer"


DRAFT_DISCLAIMER = (
    "AI-generated draft. Details you did not give us may be inaccurate or invented, and we cannot "
    "fully control what the model writes. Check every detail before you post."
)


TWEET_LIMIT = 280


def length_violation(agent_type: str, output: Any) -> str | None:
    """A tweet longer than X allows (bold markers do not count); None when everything fits."""
    if agent_type != "twitter" or not isinstance(output, dict):
        return None
    texts = [
        str(item.get("full_tweet") or "")
        for item in output.get("tweet_ideas") or []
        if isinstance(item, dict)
    ]
    for thread in output.get("thread_structures") or []:
        if isinstance(thread, dict):
            texts += [str(t) for t in thread.get("tweets") or []]
    longest = max((len(t.replace("**", "")) for t in texts), default=0)
    if longest > TWEET_LIMIT:
        return f"a tweet is {longest} characters; the limit is {TWEET_LIMIT}"
    return None


def length_verdict(reason: str) -> dict[str, Any]:
    return {
        "pass": False, "off_topic": False, "ignored_request": False, "contradicts_memory": False,
        "unsupported": [], "reason": reason, "length": True,
    }


def has_draft(output: Any) -> bool:
    return isinstance(output, dict) and bool(_draft_texts(output))


EXPLICIT_DRAFT_REQUEST = re.compile(
    r"\b(create|write|draft|make|generate|give me)\b.{0,40}\b(post|tweet|caption|thread)\b",
    re.IGNORECASE,
)


def expects_draft(user_input: str, agent_type: str, output: Any) -> bool:
    """Instagram/X users who explicitly ask for a post/tweet must get a draft, not a strategy chat."""
    return (
        JUDGE_ENABLED
        and agent_type in {"instagram", "twitter"}
        and isinstance(output, dict)
        and not _draft_texts(output)
        and bool(EXPLICIT_DRAFT_REQUEST.search(user_input or ""))
    )


MISSING_DRAFT_VERDICT = {
    "pass": False, "off_topic": False, "ignored_request": True, "contradicts_memory": False,
    "unsupported": [], "reason": "the user explicitly asked for a post or tweet but no draft was returned",
}
