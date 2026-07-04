"""Loans add cash + debt; debt repays from revenue; futures pays an advance."""


def _starter_cluster(place):
    place("2", 2, 2)
    place("4", 3, 3)
    place("5", 2, 3)
    place("5", 2, 4)


def _enable_god(game):
    game.click("#dev-toggle")
    game.click('input[data-god="freeBuild"]')
    game.click('input[data-god="fast"]')


def test_loan_grants_cash_and_sets_debt(game, place):
    _starter_cluster(place)
    cash_before = game.evaluate("window.__state.cash")
    game.click('[data-loan="0"]')
    assert game.evaluate("window.__state.cash") - cash_before >= 999
    # a sim tick may land between the click and this read — the $0.5/s
    # minimum repayment can already have shaved a hair off the debt
    debt = game.evaluate("window.__state.debt")
    assert 1295 <= debt <= 1300


def test_debt_repays_from_revenue_over_time(game, place):
    _starter_cluster(place)
    _enable_god(game)
    game.click('[data-loan="0"]')
    debt0 = game.evaluate("window.__state.debt")
    game.wait_for_timeout(2000)
    assert game.evaluate("window.__state.debt") < debt0


def test_futures_pays_advance_and_records_delivery(game, place, click_cell):
    # Scale up past the futures unlock first
    _starter_cluster(place)
    _enable_god(game)
    game.keyboard.press("2")
    for gx in range(7, 12): click_cell(gx, 0)
    game.keyboard.press("4")
    for gx in range(7, 12): click_cell(gx, 1)
    game.keyboard.press("6")
    for gx in range(7, 12): click_cell(gx, 2)
    game.wait_for_timeout(1300)
    assert game.evaluate("window.__state.totalCompute") >= 50
    cash_before = game.evaluate("window.__state.cash")
    game.click("[data-futures]")
    assert game.evaluate("window.__state.cash") > cash_before + 1000
    assert game.evaluate("window.__state.futures.reduce((a,c) => a + c.owed, 0)") > 0
