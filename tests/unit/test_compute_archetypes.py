"""v0.7 compute archetypes: CPU orchestration throttle, the Train allocation lane
(Model Efficiency), and the new tile unlock gates."""


def _powered_pair(place):
    """A power plant + coolant loop and two clustered GPUs (no CPU yet)."""
    place("2", 2, 2)   # power
    place("4", 3, 3)   # cooler
    place("5", 2, 3)   # gpu1
    place("5", 2, 4)   # gpu1


def test_unfed_gpus_throttle_then_cpu_restores_output(game, place):
    _powered_pair(place)
    game.wait_for_timeout(1200)
    throttled = game.evaluate("window.__state.totalCompute")
    # Drop in a CPU to feed the accelerators; output should jump back up.
    place("c", 3, 2)
    game.wait_for_timeout(1200)
    fed = game.evaluate("window.__state.totalCompute")
    assert throttled > 0
    assert fed > throttled * 1.5, f"CPU feeding should lift output: {throttled:.1f}->{fed:.1f}"


def test_train_allocation_raises_model_efficiency(game, place):
    _powered_pair(place)
    place("c", 3, 2)   # feed them so there's real output to train with
    game.evaluate(
        "const r = document.querySelector('input[data-alloc=\"train\"]');"
        "r.value = 80; r.dispatchEvent(new Event('input'))"
    )
    game.wait_for_timeout(1600)
    assert game.evaluate("window.__state.alloc.train") > 0
    assert game.evaluate("window.__state.modelEff") > 1.0


def test_apu_starts_locked_and_unlocks_with_cash(game):
    assert game.evaluate("!window.__state.unlocks.apu") is True
    game.evaluate("window.__state.cash = 1000")
    game.click('.tool[data-tool="apu"]')
    assert game.evaluate("window.__state.unlocks.apu") is True


def test_quantum_requires_cryo_cooling_research(game):
    # Plenty of RP but no cooling research -> Quantum stays locked on the tech gate.
    game.evaluate("window.__state.rp = 1000; window.__state.cash = 100000")
    game.click('.tool[data-tool="quantum"]')
    assert game.evaluate("!window.__state.unlocks.quantum") is True
    # Max out cooling research, then the unlock goes through.
    game.evaluate("window.__state.tech.cooling = window.__research.cooling.tiers.length - 1")
    game.click('.tool[data-tool="quantum"]')
    assert game.evaluate("window.__state.unlocks.quantum") is True


def test_cpu_is_a_core_starter_tile(game):
    # CPU must be buildable from minute zero (it's mandatory for GPUs).
    assert game.evaluate("!!document.querySelector('.tool[data-tool=\"cpu\"]')") is True
    locked = game.evaluate("document.querySelector('.tool[data-tool=\"cpu\"]').classList.contains('locked')")
    assert locked is False
