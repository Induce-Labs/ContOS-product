"""Smoke-test one agent run without HTTP auth / browser sign-in.

Uses the first avatar row in Supabase (service role) so ownership checks pass.

Usage (from Agents/backend):
  .\\.venv\\Scripts\\python.exe scripts\\smoke_agent_run.py
  .\\.venv\\Scripts\\python.exe scripts\\smoke_agent_run.py chatbot "What is a content calendar?"
  .\\.venv\\Scripts\\python.exe scripts\\smoke_agent_run.py linkedin "Give me 3 LinkedIn post ideas"
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from env_loader import load_agents_env

load_agents_env()


def _pick_avatar() -> tuple[str, str]:
    """Return (user_id, avatar_id) from the first avatars row."""
    from db.supabase_client import get_supabase_client

    client = get_supabase_client()
    if client is None:
        raise RuntimeError(
            "Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
        )
    result = (
        client.table("avatars")
        .select("id, user_id, name")
        .order("created_at")
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise RuntimeError(
            "No avatars rows found. Create an avatar in the ContOS app once, then retry."
        )
    row = rows[0]
    user_id = str(row["user_id"])
    avatar_id = str(row["id"])
    print(f"using avatar name={row.get('name')!r} id={avatar_id}")
    return user_id, avatar_id


def main() -> int:
    agent_type = (sys.argv[1] if len(sys.argv) > 1 else "chatbot").strip().lower()
    user_input = (
        sys.argv[2]
        if len(sys.argv) > 2
        else "In one short sentence, what does ContOS help with?"
    )

    if not os.getenv("OPENROUTER_API_KEY"):
        print("FAIL missing env: OPENROUTER_API_KEY")
        return 1

    try:
        user_id, avatar_id = _pick_avatar()
    except Exception as exc:
        print("FAIL avatar lookup:", exc)
        return 1

    from agents import get_agent

    agent = get_agent(agent_type)
    print(f"running agent_type={agent_type!r} input={user_input!r}")

    final = None
    for evt in agent.run(
        user_id=user_id,
        avatar_id=avatar_id,
        agent_type=agent_type,
        user_input=user_input,
        live_mode=False,
        chatbot_context_on=False,
        stream=True,
    ):
        event = evt.get("event")
        data = evt.get("data") or {}
        if event == "status":
            print("status:", data.get("stage") or data)
        elif event == "token":
            token = data.get("token") or ""
            if token:
                print(token, end="", flush=True)
        elif event == "error":
            print("\nERROR:", data.get("error") or data)
            return 2
        elif event == "complete":
            print()
            final = data.get("output")
            print("complete status:", data.get("status"))

    if final is None:
        print("FAIL: no complete event")
        return 3

    preview = final if isinstance(final, str) else str(final)[:500]
    print("OK output preview:", preview[:400])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
