from agents.chatbot_agent import _is_greeting


def test_bare_greetings_are_greetings():
    for text in ("hi", "Hello!", "hey there", "good morning", "hi contos", "namaste", "hola!"):
        assert _is_greeting(text), text


def test_questions_that_start_with_a_greeting_are_not():
    for text in (
        "hey what can i do something different from my competitors?",
        "hi, can you give me better insights?",
        "hello what is my brand voice",
        "hey I want to grow on linkedin",
        "hi how do I stand out",
    ):
        assert not _is_greeting(text), text
