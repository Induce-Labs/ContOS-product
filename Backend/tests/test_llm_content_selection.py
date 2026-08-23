from app.services.llm_content_selection import select_content_for_llm


def test_select_content_for_llm_caps_and_truncates() -> None:
    items = [
        {
            "external_id": f"id-{i}",
            "caption": "x" * 2000,
            "transcript": "y" * 1200,
            "likes": i,
            "comments_count": 0,
            "shares": 0,
        }
        for i in range(30)
    ]

    selected = select_content_for_llm(
        items,
        max_items=5,
        caption_max_chars=50,
        transcript_max_chars=40,
    )

    assert len(selected) == 5
    assert selected[0]["external_id"] == "id-29"
    assert len(selected[0]["caption"]) == 51
    assert selected[0]["caption"].endswith("…")
    assert len(selected[0]["transcript"]) == 41
    assert selected[0]["transcript"].endswith("…")
