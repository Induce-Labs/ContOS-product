"""Live Instagram strategy invoke + display formatting check (no HTTP auth)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent.parent
sys.path.insert(0, str(BACKEND))

from env_loader import load_agents_env

load_agents_env()

# Minimal display helpers (mirror Frontend/src/lib/agentOutputDisplay.ts)
def format_sections(output: dict) -> str:
    lines: list[str] = []
    if output.get("analysis"):
        lines.append("## Strategy\n" + str(output["analysis"]))
    if output.get("comparison_summary"):
        lines.append("## Comparison summary\n" + str(output["comparison_summary"]))
    for card in output.get("competitor_comparison") or []:
        handle = card.get("competitor_handle") or "Competitor"
        bits = []
        for s in card.get("strengths") or []:
            bits.append(f"- Strength: {s}")
        for s in card.get("weaknesses") or []:
            bits.append(f"- Weakness: {s}")
        if bits:
            lines.append(f"## {handle}\n" + "\n".join(bits))
    if output.get("top_hooks"):
        lines.append(
            "## Top hooks\n" + "\n".join(f"- {h}" for h in output["top_hooks"])
        )
    if output.get("caption_formulas"):
        lines.append(
            "## Caption formulas\n"
            + "\n".join(f"- {h}" for h in output["caption_formulas"])
        )
    if output.get("posting_frequency"):
        lines.append("## Posting cadence\n" + str(output["posting_frequency"]))
    if output.get("differentiation_angles"):
        lines.append(
            "## How to differentiate\n"
            + "\n".join(f"- {h}" for h in output["differentiation_angles"])
        )
    return "\n\n".join(lines)


def main() -> int:
    missing = [
        k
        for k in ("OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
        if not os.getenv(k)
    ]
    print(
        "config:",
        {
            "openrouter": bool(os.getenv("OPENROUTER_API_KEY")),
            "supabase_url": bool(os.getenv("SUPABASE_URL")),
            "supabase_key": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
            "model": os.getenv("LLM_MODEL", "moonshotai/kimi-k2.6"),
        },
    )
    if missing:
        print("FAIL missing env:", ", ".join(missing))
        print(
            "Put keys in ContOS-product/.env or Agents/backend/.env "
            "(OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)."
        )
        return 1

    from agents.instagram_agent import InstagramAgent

    user_input = (
        "give me the strategy i can use for my poetry page, "
        "what content gets the most likes?"
    )
    agent = InstagramAgent()
    final = None
    print("invoking Instagram agent…")
    for evt in agent.run(
        user_id="00000000-0000-0000-0000-000000000001",
        project_id="00000000-0000-0000-0000-000000000002",
        agent_type="instagram",
        user_input=user_input,
        live_mode=False,
        chatbot_context_on=False,
        stream=True,
    ):
        event = evt.get("event")
        data = evt.get("data") or {}
        if event == "status":
            print("status:", data.get("stage") or data)
        elif event == "error":
            print("ERROR:", data.get("error") or data)
            return 2
        elif event == "complete":
            final = data.get("output")
            print("complete status:", data.get("status"))

    if not isinstance(final, dict):
        print("FAIL: expected dict output, got", type(final))
        return 3

    # Never print full JSON to stdout in summary — assert readable formatting
    text = format_sections(final)
    assert final.get("response_type") in {
        "analysis",
        "competitor_comparison",
        "content_calendar",
    }, final.get("response_type")
    assert text.strip(), "formatted text empty"
    assert not text.strip().startswith("{"), "still looks like raw JSON dump"
    assert '"response_type"' not in text, "schema keys leaked into display text"

    print("OK response_type=", final.get("response_type"))
    print("OK has analysis=", bool(final.get("analysis")))
    print("OK top_hooks=", len(final.get("top_hooks") or []))
    print("OK caption_formulas=", len(final.get("caption_formulas") or []))
    print("OK posting_frequency=", bool(final.get("posting_frequency")))
    print("--- readable preview ---")
    print(text[:1200])
    print("...")
    # Write artifact for inspection without dumping secrets
    out = BACKEND / "scripts" / "_last_instagram_strategy.json"
    out.write_text(json.dumps(final, indent=2, default=str)[:20000], encoding="utf-8")
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
