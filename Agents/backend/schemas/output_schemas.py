"""Pydantic / JSON schemas for agent structured outputs."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class PlaybookOutput(BaseModel):
    agent: Literal["playbook"] = "playbook"
    strategy_frameworks: list[Any] = Field(default_factory=list)
    guardrails: list[Any] = Field(default_factory=list)
    recommendations: list[Any] = Field(default_factory=list)
    audit_result: Literal["PASSED", "FAILED", "N/A"] = "N/A"
    broken_rules: list[Any] = Field(default_factory=list)
    reasoning: str = ""


class StrategistEnvelope(BaseModel):
    mode: str = "chat"
    reply: str = ""
    thesis: str = ""
    next_question: str = ""
    ideas: list[dict[str, Any]] = Field(default_factory=list)
    facts_used: list[str] = Field(default_factory=list)
    draft_kind: str = ""
    disclaimer: str = ""
    unverified_claims: list[str] = Field(default_factory=list)
    memory_updates: list[dict[str, Any]] = Field(default_factory=list)


class InstagramCalendarItem(BaseModel):
    content_plan_item_id: str = ""
    day: int = 0
    date: str = ""
    content_type: str = ""
    hook: str = ""
    caption: str = ""
    copy_paste_post: str = ""
    hashtags: list[str] = Field(default_factory=list)
    cta: str = ""
    audio_suggestion: str = ""
    transcript: str = ""
    video_prompt: str = ""
    strategy_reasoning: str = ""
    performance_goal: str = ""
    evidence_citations: list[str] = Field(default_factory=list)
    reasoning: str = ""


class CompetitorCompareCard(BaseModel):
    competitor_handle: str = ""
    platform: str = "instagram"
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    hooks_and_themes: list[str] = Field(default_factory=list)
    key_signals: list[str] = Field(default_factory=list)


class InstagramOutput(StrategistEnvelope):
    agent: Literal["instagram"] = "instagram"
    platform: Literal["instagram"] = "instagram"
    response_type: Literal[
        "content_calendar", "competitor_comparison", "analysis"
    ] = "content_calendar"
    presentation_mode: Literal["copy_only", "detailed"] = "copy_only"
    content_calendar: list[InstagramCalendarItem] = Field(default_factory=list)
    top_hooks: list[str] = Field(default_factory=list)
    caption_formulas: list[str] = Field(default_factory=list)
    posting_frequency: str = ""
    competitor_comparison: list[CompetitorCompareCard] = Field(default_factory=list)
    comparison_summary: str = ""
    differentiation_angles: list[str] = Field(default_factory=list)
    analysis: str = ""
    content_plan_item_ids: list[str] = Field(default_factory=list)
    recommended_option: str = ""
    alternative_options: list[str] = Field(default_factory=list)


class LinkedInPostIdea(BaseModel):
    topic: str = ""
    hook: str = ""
    post_structure: str = ""
    content_type: str = "text"
    cta: str = ""
    transcript: str = ""
    reasoning: str = ""


class LinkedInOutput(StrategistEnvelope):
    agent: Literal["linkedin"] = "linkedin"
    platform: Literal["linkedin"] = "linkedin"
    post_ideas: list[LinkedInPostIdea] = Field(default_factory=list)
    thought_leadership_themes: list[str] = Field(default_factory=list)
    hook_formulas: list[str] = Field(default_factory=list)
    posting_frequency: str = ""
    content_mix: dict[str, str] = Field(default_factory=dict)


class TweetIdea(BaseModel):
    hook: str = ""
    full_tweet: str = ""
    type: str = "single"
    reasoning: str = ""


class ThreadStructure(BaseModel):
    topic: str
    tweets: list[str] = Field(default_factory=list)


class TwitterOutput(StrategistEnvelope):
    agent: Literal["twitter"] = "twitter"
    platform: Literal["twitter"] = "twitter"
    tweet_ideas: list[TweetIdea] = Field(default_factory=list)
    thread_structures: list[ThreadStructure] = Field(default_factory=list)
    hook_formulas: list[str] = Field(default_factory=list)
    posting_frequency: str = ""
    engagement_tactics: list[str] = Field(default_factory=list)


AGENT_JSON_SCHEMAS: dict[str, dict[str, Any]] = {
    "playbook": PlaybookOutput.model_json_schema(),
    "instagram": InstagramOutput.model_json_schema(),
    "linkedin": LinkedInOutput.model_json_schema(),
    "twitter": TwitterOutput.model_json_schema(),
}

OUTPUT_MODELS = {
    "playbook": PlaybookOutput,
    "instagram": InstagramOutput,
    "linkedin": LinkedInOutput,
    "twitter": TwitterOutput,
}
