"""Verify live Postiz LinkedIn authorize URL shape (no secrets printed).

Usage (from Backend/, with .env loaded):
  .venv/Scripts/python.exe scripts/verify_postiz_linkedin_auth_url.py

Uses Approach B provision for a disposable avatar_id only to obtain a pos_
token, then GET /social/linkedin via PostizClient (ContOS strips undocumented
prompt=). Does not print tokens or the full URL.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.clients.postiz_client import PostizClient  # noqa: E402
from app.config import Settings  # noqa: E402


def main() -> int:
    settings = Settings()
    client = PostizClient(settings)
    avatar_id = uuid4()
    provisioned = client.provision_avatar(avatar_id)
    token = provisioned["access_token"]
    if not isinstance(token, str) or not token.startswith("pos_"):
        print("FAIL: provision did not return a pos_ token")
        return 1

    url = client.get_linkedin_authorization_url(token)
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    scope = unquote(qs.get("scope", [""])[0])
    prompt_values = qs.get("prompt", [])
    has_prompt_none = "prompt=none" in url.lower() or "none" in prompt_values
    scope_ok = scope.split() == ["openid", "profile", "w_member_social"]

    print(f"host={parsed.netloc}")
    print(f"path={parsed.path}")
    print(f"has_prompt_none={has_prompt_none}")
    print(f"prompt_param={prompt_values[0] if prompt_values else None}")
    print(f"scope={scope!r}")
    print(f"scope_ok={scope_ok}")
    print(f"has_state={'state' in qs and bool(qs['state'][0])}")
    print(f"has_redirect_uri={'redirect_uri' in qs}")

    if has_prompt_none:
        print("FAIL: ContOS-returned authorize URL still contains prompt=none")
        return 2
    if not scope_ok:
        print("FAIL: unexpected LinkedIn scopes")
        return 3
    print(
        "OK: ContOS LinkedIn authorize URL has no prompt=none and expected scopes "
        "(Postiz source should also omit prompt=none after VPS deploy)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
