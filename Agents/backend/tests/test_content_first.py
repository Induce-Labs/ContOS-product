"""Content-first drafts: bold suggestions instead of brackets, competitor-shaped length."""

from agents.base_agent import strip_asterisks
from prompts import get_system_prompt
from services import draft_judge
from services.competitor_style import compute_post_style
from services.draft_grounding import build_allowed_text, strip_unsupported_quotes


def test_prompts_are_content_first_with_bold_suggestions():
    for agent in ("linkedin", "instagram", "twitter"):
        prompt = get_system_prompt(agent)
        assert "CONTENT FIRST" in prompt
        assert "**double asterisks**" in prompt
        assert "NEVER use square brackets in a draft" in prompt
        assert "EXAMPLES ONLY WHEN ASKED" not in prompt
        assert "[placeholder" not in prompt


def test_draft_text_keeps_bold_but_other_fields_lose_asterisks():
    out = strip_asterisks(
        {
            "reply": "Here *you* go",
            "post_ideas": [{"topic": "a *b*", "post_structure": "I **built a CRM agent** once."}],
            "tweet_ideas": [{"full_tweet": "**x** y"}],
            "thread_structures": [{"tweets": ["**t** u"]}],
        }
    )
    assert out["reply"] == "Here you go"
    assert out["post_ideas"][0]["topic"] == "a b"
    assert out["post_ideas"][0]["post_structure"] == "I **built a CRM agent** once."
    assert out["tweet_ideas"][0]["full_tweet"] == "**x** y"
    assert out["thread_structures"][0]["tweets"] == ["**t** u"]


def _post(words, likes=0, extra=""):
    return {"caption": " ".join(["word"] * words) + extra, "likes": likes, "comments_count": 0, "shares": 0}


def test_style_follows_competitor_length_within_bounds():
    style = compute_post_style([_post(220), _post(230), _post(240)], "linkedin")
    assert style["typical_words"] == 230 and style["target_words"] == 230
    assert style["max_words"] == 250
    assert compute_post_style([_post(400), _post(420)], "linkedin")["target_words"] == 250
    assert compute_post_style([_post(20), _post(25)], "linkedin")["target_words"] == 100


def test_style_reads_layout_and_picks_the_top_post():
    spaced = "First line here\n\nSecond line goes here now\n\nThird closing line"
    style = compute_post_style(
        [{"caption": spaced, "likes": 5, "comments_count": 1, "shares": 0},
         {"caption": spaced + " extra words", "likes": 90, "comments_count": 9, "shares": 4}],
        "linkedin",
    )
    assert style["uses_blank_line_spacing"] is True
    assert "extra words" in style["sample_post"]
    assert style["posts_sampled"] == 2


def test_style_is_none_without_usable_posts():
    assert compute_post_style([], "linkedin") is None
    assert compute_post_style([{"caption": "too short"}, {"caption": None}], "linkedin") is None


def test_judge_treats_bold_as_suggestion_but_not_for_invented_results():
    assert "double asterisks" in draft_judge.JUDGE_SYSTEM
    assert "statistic" in draft_judge.JUDGE_SYSTEM and "named third party" in draft_judge.JUDGE_SYSTEM


def test_judge_retry_asks_for_bold_suggestions_not_brackets_or_short_drafts():
    text = draft_judge.build_retry_messages([], "RAW", {"unsupported": ["x"], "reason": "r"})[-1]["content"]
    assert "**bold**" in text and "same length" in text and "square brackets" in text
    assert "SHORT" not in text


def test_invented_quote_becomes_a_bold_suggestion():
    out = {"reply": "r", "post_ideas": [{"post_structure": 'A client said "this was great work overall" to me.'}]}
    assert strip_unsupported_quotes(out, build_allowed_text("hi", [], [])) == 1
    assert "**what a customer actually said**" in out["post_ideas"][0]["post_structure"]


def test_tweet_length_check_ignores_bold_markers_and_covers_threads():
    ok = {"tweet_ideas": [{"full_tweet": "**" + "a" * 200 + "** " + "b" * 70}]}
    assert draft_judge.length_violation("twitter", ok) is None
    long = {"tweet_ideas": [{"full_tweet": "x" * 300}]}
    assert "300 characters" in draft_judge.length_violation("twitter", long)
    thread = {"thread_structures": [{"tweets": ["ok", "y" * 281]}]}
    assert draft_judge.length_violation("twitter", thread) is not None
    assert draft_judge.length_violation("linkedin", long) is None


def test_over_limit_tweet_retry_says_shorten_and_fallback_keeps_it_with_a_note():
    verdict = draft_judge.length_verdict("a tweet is 365 characters; the limit is 280")
    text = draft_judge.build_retry_messages([], "RAW", verdict)[-1]["content"]
    assert "280 characters or fewer" in text and "same length" not in text
    out = {"reply": "Here.", "tweet_ideas": [{"full_tweet": "x" * 300}]}
    assert draft_judge.apply_fallback(out, verdict) == "kept_over_limit"
    assert "Shorten it or post it as a thread" in out["reply"]


def test_unknown_draft_kind_is_cleared():
    from agents.base_agent import extract_json

    data = extract_json('{"agent": "linkedin", "mode": "strategy", "draft_kind": "empty string when there is no draft"}')
    assert data["draft_kind"] == ""
    assert extract_json('{"agent": "linkedin", "draft_kind": "plan"}')["draft_kind"] == "plan"
