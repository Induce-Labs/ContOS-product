from app.services.text_sanitize import sanitize_json_value, sanitize_optional_str, sanitize_text


def test_sanitize_text_replaces_lone_surrogates():
    broken = "hello \ud83d world"  # lone high surrogate
    cleaned = sanitize_text(broken)
    assert cleaned is not None
    assert "\ud83d" not in cleaned
    cleaned.encode("utf-8")  # must not raise


def test_sanitize_json_value_nested():
    payload = {"caption": "hi \udc00", "nested": [{"text": "x\ud800y"}]}
    cleaned = sanitize_json_value(payload)
    assert "\udc00" not in cleaned["caption"]
    assert "\ud800" not in cleaned["nested"][0]["text"]
    import json

    json.dumps(cleaned).encode("utf-8")


def test_sanitize_optional_str_none():
    assert sanitize_optional_str(None) is None
