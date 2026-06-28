"""Smoke tests covering the freshly loaded game shell."""


def test_loads_with_twelve_tools(game):
    assert game.eval_on_selector_all("#tools .tool", "els => els.length") == 12


def test_tutorial_starts_at_step_one(game):
    assert game.eval_on_selector("#tut-progress", "el => el.textContent") == "1 / 9"


def test_no_blocking_audio_prompt(game):
    assert game.evaluate("!document.getElementById('audio-prompt')") is True


def test_boot_produces_no_console_errors(game, errors):
    assert errors == [], f"unexpected boot errors: {errors[:3]}"
