"""Smoke tests covering the freshly loaded game shell."""


def test_loads_with_twenty_tools(game):
    assert game.eval_on_selector_all("#tools .tool", "els => els.length") == 20


def test_palette_shows_layer_headers(game):
    headers = game.eval_on_selector_all("#tools .tool-layer", "els => els.map(e => e.textContent)")
    assert [h.split("L")[-1] for h in headers[:3]] == ["1 · Physical", "2 · Compute", "7 · People & Ops"]
    assert "Tools" in headers[3]


def test_tutorial_starts_at_step_one(game):
    assert game.eval_on_selector("#tut-progress", "el => el.textContent") == "1 / 9"


def test_no_blocking_audio_prompt(game):
    assert game.evaluate("!document.getElementById('audio-prompt')") is True


def test_boot_produces_no_console_errors(game, errors):
    assert errors == [], f"unexpected boot errors: {errors[:3]}"
