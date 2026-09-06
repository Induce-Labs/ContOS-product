"""Tests for Agents chat Redis rate limiting (no live Redis)."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


class FakeRedis:
    """Minimal Redis stand-in that executes admit/release/refresh Lua via Python."""

    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}
        self.ttls: dict[str, int] = {}
        self.expire_calls: list[tuple[str, int]] = []

    def get(self, key: str) -> str | None:
        return self.strings.get(key)

    def incr(self, key: str) -> int:
        value = int(self.strings.get(key, "0")) + 1
        self.strings[key] = str(value)
        return value

    def expire(self, key: str, ttl: int) -> bool:
        self.ttls[key] = int(ttl)
        self.expire_calls.append((key, int(ttl)))
        return True

    def scard(self, key: str) -> int:
        return len(self.sets.get(key, set()))

    def sadd(self, key: str, member: str) -> int:
        bucket = self.sets.setdefault(key, set())
        before = len(bucket)
        bucket.add(member)
        return 0 if len(bucket) == before else 1

    def srem(self, key: str, member: str) -> int:
        bucket = self.sets.get(key)
        if not bucket or member not in bucket:
            return 0
        bucket.remove(member)
        if not bucket:
            self.sets.pop(key, None)
            self.ttls.pop(key, None)
        return 1

    def sismember(self, key: str, member: str) -> int:
        return 1 if member in self.sets.get(key, set()) else 0

    def delete(self, key: str) -> int:
        existed = key in self.strings or key in self.sets
        self.strings.pop(key, None)
        self.sets.pop(key, None)
        self.ttls.pop(key, None)
        return 1 if existed else 0

    def eval(self, script: str, numkeys: int, *args: Any) -> Any:
        from rate_limit import _ADMIT_SCRIPT, _REFRESH_SCRIPT, _RELEASE_SCRIPT

        keys = list(args[:numkeys])
        argv = list(args[numkeys:])

        if script.strip() == _ADMIT_SCRIPT.strip():
            return self._admit(keys, argv)
        if script.strip() == _RELEASE_SCRIPT.strip():
            return self._release(keys, argv)
        if script.strip() == _REFRESH_SCRIPT.strip():
            return self._refresh(keys, argv)
        raise AssertionError("Unknown Lua script in FakeRedis.eval")

    def _admit(self, keys: list[Any], argv: list[Any]) -> list[Any]:
        minute_key, day_key, inflight_key = keys
        max_minute = int(argv[0])
        max_day = int(argv[1])
        max_inflight = int(argv[2])
        token = str(argv[3])
        minute_ttl = int(argv[4])
        day_ttl = int(argv[5])
        inflight_ttl = int(argv[6])
        minute_retry = int(argv[7])
        day_retry = int(argv[8])

        if self.scard(inflight_key) >= max_inflight:
            return ["concurrent"]

        minute_count = int(self.get(minute_key) or 0)
        if minute_count >= max_minute:
            return ["minute", minute_retry]

        day_count = int(self.get(day_key) or 0)
        if day_count >= max_day:
            return ["day", day_retry]

        new_minute = self.incr(minute_key)
        if new_minute == 1:
            self.expire(minute_key, minute_ttl)
        new_day = self.incr(day_key)
        if new_day == 1:
            self.expire(day_key, day_ttl)
        self.sadd(inflight_key, token)
        self.expire(inflight_key, inflight_ttl)
        return ["ok", token]

    def _release(self, keys: list[Any], argv: list[Any]) -> int:
        inflight_key = keys[0]
        token = str(argv[0])
        removed = self.srem(inflight_key, token)
        if removed == 0:
            return 0
        if self.scard(inflight_key) == 0:
            self.delete(inflight_key)
        return 1

    def _refresh(self, keys: list[Any], argv: list[Any]) -> int:
        inflight_key = keys[0]
        token = str(argv[0])
        inflight_ttl = int(argv[1])
        if self.sismember(inflight_key, token) == 1:
            self.expire(inflight_key, inflight_ttl)
            return 1
        return 0


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture
def env_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENTS_RATE_LIMIT_PER_MINUTE", "3")
    monkeypatch.setenv("AGENTS_RATE_LIMIT_PER_DAY", "5")
    monkeypatch.setenv("AGENTS_MAX_INFLIGHT_PER_USER", "1")
    monkeypatch.setenv("AGENTS_INFLIGHT_TTL_SECS", "900")


FIXED_NOW = datetime(2026, 9, 5, 12, 30, 20, tzinfo=timezone.utc)


class TestConfig:
    def test_rejects_non_positive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from rate_limit import RateLimitConfigError, load_rate_limit_config

        monkeypatch.setenv("AGENTS_RATE_LIMIT_PER_MINUTE", "0")
        with pytest.raises(RateLimitConfigError):
            load_rate_limit_config()

    def test_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from rate_limit import load_rate_limit_config

        monkeypatch.delenv("AGENTS_RATE_LIMIT_PER_MINUTE", raising=False)
        monkeypatch.delenv("AGENTS_RATE_LIMIT_PER_DAY", raising=False)
        monkeypatch.delenv("AGENTS_MAX_INFLIGHT_PER_USER", raising=False)
        monkeypatch.delenv("AGENTS_INFLIGHT_TTL_SECS", raising=False)
        cfg = load_rate_limit_config()
        assert cfg["per_minute"] == 15
        assert cfg["per_day"] == 150
        assert cfg["max_inflight"] == 1
        assert cfg["inflight_ttl_secs"] == 900


class TestAdmitMinuteDay:
    def test_minute_n_allowed_n_plus_one_rejected(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request, minute_key, release_inflight

        for _ in range(3):
            result, token = admit_chat_request(
                "user-1", redis_client=fake_redis, now=FIXED_NOW
            )
            assert result.allowed is True
            assert token
            release_inflight("user-1", token, redis_client=fake_redis)

        denied, token = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert token is None
        assert denied.allowed is False
        assert denied.limit_type == "minute"
        assert denied.retry_after_seconds == 40
        assert fake_redis.strings[minute_key("user-1", "global", "202609051230")] == "3"

    def test_day_limit(
        self, fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from rate_limit import admit_chat_request, release_inflight

        monkeypatch.setenv("AGENTS_RATE_LIMIT_PER_MINUTE", "100")
        monkeypatch.setenv("AGENTS_RATE_LIMIT_PER_DAY", "2")
        monkeypatch.setenv("AGENTS_MAX_INFLIGHT_PER_USER", "1")
        monkeypatch.setenv("AGENTS_INFLIGHT_TTL_SECS", "900")

        for _ in range(2):
            result, token = admit_chat_request(
                "user-1", redis_client=fake_redis, now=FIXED_NOW
            )
            assert result.allowed
            assert token
            release_inflight("user-1", token, redis_client=fake_redis)

        denied, _ = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert denied.allowed is False
        assert denied.limit_type == "day"
        assert denied.retry_after_seconds == 11 * 3600 + 29 * 60 + 40


class TestInflight:
    def test_second_concurrent_fails_without_quota_burn(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request, minute_key, release_inflight

        first, token_a = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert first.allowed and token_a
        assert fake_redis.strings[minute_key("user-1", "global", "202609051230")] == "1"

        second, token_b = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert second.allowed is False
        assert second.limit_type == "concurrent"
        assert token_b is None
        assert fake_redis.strings[minute_key("user-1", "global", "202609051230")] == "1"

        release_inflight("user-1", token_a, redis_client=fake_redis)
        third, token_c = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert third.allowed and token_c
        assert fake_redis.strings[minute_key("user-1", "global", "202609051230")] == "2"

    def test_release_missing_and_double_safe(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request, release_inflight

        release_inflight("user-1", "missing-token", redis_client=fake_redis)

        result, token = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert result.allowed and token
        release_inflight("user-1", token, redis_client=fake_redis)
        release_inflight("user-1", token, redis_client=fake_redis)

        again, token2 = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert again.allowed and token2

    def test_token_is_server_generated(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request

        with patch("rate_limit.secrets.token_urlsafe", return_value="server-token-abc"):
            result, token = admit_chat_request(
                "user-1", redis_client=fake_redis, now=FIXED_NOW
            )
        assert result.allowed
        assert token == "server-token-abc"
        assert "server-token-abc" in fake_redis.sets[
            "agents:rl:user-1:global:inflight"
        ]

    def test_clear_inflight_allows_new_admit(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request, clear_inflight

        first, token = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert first.allowed and token
        denied, _ = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert not denied.allowed and denied.limit_type == "concurrent"
        clear_inflight("user-1", redis_client=fake_redis)
        again, token2 = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert again.allowed and token2

    def test_expired_inflight_allows_new_admit(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request, inflight_key

        first, token = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert first.allowed and token
        fake_redis.delete(inflight_key("user-1", "global"))
        second, token2 = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert second.allowed and token2


class TestAtomicity:
    def test_only_max_inflight_admitted(
        self, fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from rate_limit import admit_chat_request, minute_key

        monkeypatch.setenv("AGENTS_RATE_LIMIT_PER_MINUTE", "50")
        monkeypatch.setenv("AGENTS_RATE_LIMIT_PER_DAY", "50")
        monkeypatch.setenv("AGENTS_MAX_INFLIGHT_PER_USER", "2")
        monkeypatch.setenv("AGENTS_INFLIGHT_TTL_SECS", "900")

        allowed = 0
        concurrent = 0
        for _ in range(5):
            result, _token = admit_chat_request(
                "user-1", redis_client=fake_redis, now=FIXED_NOW
            )
            if result.allowed:
                allowed += 1
            elif result.limit_type == "concurrent":
                concurrent += 1

        assert allowed == 2
        assert concurrent == 3
        assert fake_redis.strings[minute_key("user-1", "global", "202609051230")] == "2"


class TestTtlBehavior:
    def test_ttl_set_only_on_first_incr(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import (
            DAY_KEY_TTL_SECS,
            MINUTE_KEY_TTL_SECS,
            admit_chat_request,
            day_key,
            minute_key,
            release_inflight,
        )

        m_key = minute_key("user-1", "global", "202609051230")
        d_key = day_key("user-1", "global", "20260905")

        result1, token1 = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert result1.allowed and token1
        release_inflight("user-1", token1, redis_client=fake_redis)
        first_expire_count = len(
            [c for c in fake_redis.expire_calls if c[0] in {m_key, d_key}]
        )
        assert (m_key, MINUTE_KEY_TTL_SECS) in fake_redis.expire_calls
        assert (d_key, DAY_KEY_TTL_SECS) in fake_redis.expire_calls

        fake_redis.ttls[m_key] = 11
        fake_redis.ttls[d_key] = 22

        result2, token2 = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert result2.allowed and token2
        release_inflight("user-1", token2, redis_client=fake_redis)

        later_counter_expires = [
            c
            for c in fake_redis.expire_calls[first_expire_count:]
            if c[0] in {m_key, d_key}
        ]
        assert later_counter_expires == []
        assert fake_redis.ttls[m_key] == 11
        assert fake_redis.ttls[d_key] == 22


class TestRefresh:
    def test_refresh_requires_membership(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request, refresh_inflight_ttl, release_inflight

        result, token = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert result.allowed and token
        assert refresh_inflight_ttl("user-1", token, redis_client=fake_redis) is True
        release_inflight("user-1", token, redis_client=fake_redis)
        assert refresh_inflight_ttl("user-1", token, redis_client=fake_redis) is False

    def test_refresh_failure_does_not_raise(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import refresh_inflight_ttl

        broken = MagicMock()
        broken.eval.side_effect = ConnectionError("down")
        assert refresh_inflight_ttl("user-1", "tok", redis_client=broken) is False


class TestRedisFailure:
    def test_admit_fail_closed(self, env_limits: None) -> None:
        from rate_limit import admit_chat_request

        broken = MagicMock()
        broken.eval.side_effect = ConnectionError("redis down")
        result, token = admit_chat_request(
            "user-1", redis_client=broken, now=FIXED_NOW
        )
        assert token is None
        assert result.allowed is False
        assert result.limit_type == "redis"
        assert "temporarily unavailable" in result.message.lower()
        assert "redis" not in result.message.lower()

    def test_lua_error_fail_closed(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request

        fake_redis.eval = MagicMock(side_effect=RuntimeError("ERR lua"))  # type: ignore[method-assign]
        result, token = admit_chat_request(
            "user-1", redis_client=fake_redis, now=FIXED_NOW
        )
        assert result.limit_type == "redis"
        assert token is None

    def test_release_failure_does_not_raise(self, env_limits: None) -> None:
        from rate_limit import release_inflight

        broken = MagicMock()
        broken.eval.side_effect = ConnectionError("down")
        release_inflight("user-1", "tok", redis_client=broken)

    def test_http_exception_mapping(self, env_limits: None) -> None:
        from rate_limit import RateLimitResult, rate_limit_http_exception

        minute = rate_limit_http_exception(
            RateLimitResult(False, "minute", 37, "Too many")
        )
        assert minute.status_code == 429
        assert minute.detail["error"] == "rate_limit"
        assert minute.detail["retry_after_seconds"] == 37
        assert minute.headers["Retry-After"] == "37"

        concurrent = rate_limit_http_exception(
            RateLimitResult(False, "concurrent", None, "busy")
        )
        assert concurrent.status_code == 429
        assert concurrent.detail["error"] == "concurrent_limit"
        assert concurrent.headers is None or "Retry-After" not in (
            concurrent.headers or {}
        )

        unavailable = rate_limit_http_exception(
            RateLimitResult(False, "redis", None, "unavailable")
        )
        assert unavailable.status_code == 503
        assert unavailable.detail["error"] == "rate_limit_unavailable"


class TestScopeIsolation:
    def test_different_scopes_do_not_collide(
        self, fake_redis: FakeRedis, env_limits: None
    ) -> None:
        from rate_limit import admit_chat_request

        a, token_a = admit_chat_request(
            "user-1", scope="global", redis_client=fake_redis, now=FIXED_NOW
        )
        b, token_b = admit_chat_request(
            "user-1", scope="linkedin", redis_client=fake_redis, now=FIXED_NOW
        )
        assert a.allowed and b.allowed
        assert token_a and token_b
        assert token_a != token_b
        assert fake_redis.scard("agents:rl:user-1:global:inflight") == 1
        assert fake_redis.scard("agents:rl:user-1:linkedin:inflight") == 1


class TestWindowHelpers:
    def test_retry_after_not_constant_guess(self) -> None:
        from rate_limit import seconds_until_day_end, seconds_until_minute_end

        now = datetime(2026, 1, 1, 0, 0, 5, tzinfo=timezone.utc)
        assert seconds_until_minute_end(now) == 55
        assert seconds_until_day_end(now) == 86395
