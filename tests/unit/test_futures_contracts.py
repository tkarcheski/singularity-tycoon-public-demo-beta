"""Futures depth (#36): adjustable delivery rate + contract slots (1→3→5)."""


def farm_and_futures(game):
    game.evaluate("window.__god.freeBuild = true")
    game.evaluate("""(() => {
      const g = window.__state.grid;
      g[0][0] = { t: 'power', cond: 100 }; g[0][1] = { t: 'power', cond: 100 };
      g[1][0] = { t: 'power', cond: 100 };
      g[0][2] = { t: 'cooler', cond: 100 }; g[0][3] = { t: 'cooler', cond: 100 };
      g[1][2] = { t: 'cooler', cond: 100 }; g[1][3] = { t: 'cooler', cond: 100 };
      g[4][4] = { t: 'gpu2', cond: 100 }; g[4][5] = { t: 'gpu2', cond: 100 };
      g[4][6] = { t: 'gpu2', cond: 100 };
      window.__state.unlocks.gpu2 = true;
    })()""")
    game.wait_for_timeout(1500)


def test_one_contract_slot_by_default(game):
    farm_and_futures(game)
    game.click("[data-futures]")
    game.wait_for_timeout(300)
    assert game.evaluate("window.__state.futures.length") == 1
    # second sale blocked at base slots
    game.evaluate("(() => { const b = document.querySelector('[data-futures]'); b.disabled = false; b.click(); })()")
    game.wait_for_timeout(300)
    assert game.evaluate("window.__state.futures.length") == 1


def test_contracts_research_expands_to_five(game):
    farm_and_futures(game)
    game.evaluate("window.__state.tech.contracts = 2")
    for i in range(6):  # sixth attempt must be refused at the 5-slot cap
        game.evaluate("(() => { const b = document.querySelector('[data-futures]'); b.disabled = false; b.click(); })()")
        game.wait_for_timeout(200)
    assert game.evaluate("window.__state.futures.length") == 5


def test_delivery_rate_controls_payoff_speed(game):
    farm_and_futures(game)
    game.click("[data-futures]")
    game.wait_for_timeout(300)
    total = game.evaluate("window.__state.futures[0].owed")
    game.evaluate("window.__state.futuresRate = 0.1")
    game.wait_for_timeout(2000)
    slow_paid = total - game.evaluate("window.__state.futures[0]?.owed ?? 0")
    game.evaluate("window.__state.futures[0].owed = " + str(total))
    game.evaluate("window.__state.futuresRate = 1.0")
    game.wait_for_timeout(2000)
    owed_now = game.evaluate("window.__state.futures[0]?.owed ?? 0")
    fast_paid = total - owed_now
    assert fast_paid > slow_paid * 3


def test_delivery_rate_radio_visible_with_open_contract(game):
    farm_and_futures(game)
    assert game.evaluate("document.querySelector('.fin-frate').hidden") is True
    game.click("[data-futures]")
    game.wait_for_timeout(700)
    assert game.evaluate("document.querySelector('.fin-frate').hidden") is False
    game.click('input[name="frate"][value="1"]')
    assert game.evaluate("window.__state.futuresRate") == 1


def test_old_futures_save_migrates_to_contract(game):
    game.evaluate("""(() => {
      window.dispatchEvent(new Event('beforeunload'));
      const snap = JSON.parse(localStorage.getItem('stm-save-v1'));
      delete snap.futures; delete snap.futuresRate;
      snap.futuresOwed = 4321;
      localStorage.setItem('stm-save-v1', JSON.stringify(snap));
      localStorage.setItem = () => {};
    })()""")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.futures.length") == 1
    assert game.evaluate("window.__state.futures[0].owed") == 4321


def test_futures_no_console_errors(game, errors):
    farm_and_futures(game)
    game.click("[data-futures]")
    game.wait_for_timeout(1500)
    assert errors == [], f"errors: {errors[:3]}"
