"""One-shot: repair UTF-8-as-Windows-1252 mojibake in locale JSON catalogs."""

from __future__ import annotations

import json
from pathlib import Path

MARKERS = (
    "Ã",
    "Â",
    "â€",
    "â†",
    "â€™",
    "â€œ",
    "ðŸ",
    "à¤",
    "à¥",
)


def looks_mojibake(s: str) -> bool:
    if not s:
        return False
    if any(m in s for m in MARKERS):
        return True
    if "\ufffd" in s or "\x8d" in s or "\x8f" in s:
        return True
    return False


def fix_mojibake(s: str) -> str:
    if not looks_mojibake(s):
        return s

    def to_bytes(text: str) -> bytes | None:
        try:
            return text.encode("cp1252")
        except UnicodeEncodeError:
            try:
                return text.encode("latin-1")
            except UnicodeEncodeError:
                parts: list[bytes] = []
                for ch in text:
                    try:
                        parts.append(ch.encode("cp1252"))
                    except UnicodeEncodeError:
                        try:
                            parts.append(ch.encode("latin-1"))
                        except UnicodeEncodeError:
                            return None
                return b"".join(parts)

    raw = to_bytes(s)
    if raw is None:
        return s
    try:
        fixed = raw.decode("utf-8")
    except UnicodeDecodeError:
        return s

    # Hindi / some catalogs were double-encoded
    if looks_mojibake(fixed):
        raw2 = to_bytes(fixed)
        if raw2 is not None:
            try:
                fixed2 = raw2.decode("utf-8")
                if not looks_mojibake(fixed2) or fixed2.count("Ã") < fixed.count("Ã"):
                    return fixed2
            except UnicodeDecodeError:
                pass
    return fixed


def walk_fix(obj: object) -> tuple[object, int]:
    if isinstance(obj, dict):
        changed = 0
        out: dict[str, object] = {}
        for key, value in obj.items():
            next_value, count = walk_fix(value)
            changed += count
            out[key] = next_value
        return out, changed
    if isinstance(obj, list):
        changed = 0
        out_list: list[object] = []
        for value in obj:
            next_value, count = walk_fix(value)
            changed += count
            out_list.append(next_value)
        return out_list, changed
    if isinstance(obj, str):
        fixed = fix_mojibake(obj)
        return (fixed, 1) if fixed != obj else (obj, 0)
    return obj, 0


def main() -> None:
    base = Path(__file__).resolve().parents[1] / "public" / "locales"
    langs = ("fr", "es", "hi")
    lines: list[str] = []
    for lang in langs:
        path = base / lang / "common.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        fixed, changed = walk_fix(data)
        path.write_text(
            json.dumps(fixed, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        assert isinstance(fixed, dict)
        profiling = fixed.get("profiling") or {}
        welcome = (fixed.get("onboarding") or {}).get("welcome") or {}
        lines.append(
            f"{lang}: changed={changed} "
            f"pressEnter={profiling.get('pressEnter')!r} "
            f"back={profiling.get('back')!r} "
            f"welcome={welcome.get('title')!r}"
        )
    report = Path(__file__).resolve().parents[1] / "node_modules" / ".tmp" / "locale-fix-report.txt"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {report}")
    for line in lines:
        print(line.encode("ascii", "backslashreplace").decode())


if __name__ == "__main__":
    main()
