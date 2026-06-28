"""Worker Pods learn from adjacent GPUs and from smarter peers; never break."""


def _starter_cluster(place):
    place("2", 2, 2)
    place("4", 3, 3)
    place("5", 2, 3)
    place("5", 2, 4)


def _enable_god(game):
    game.click("#dev-toggle")
    game.click('input[data-god="freeBuild"]')
    game.click('input[data-god="fast"]')


def test_humans_learn_near_working_gpus(game, place):
    _starter_cluster(place)
    _enable_god(game)
    place("9", 3, 2)
    game.wait_for_timeout(2600)
    assert game.evaluate("window.__state.grid[2][3].skill") > 0


def test_humans_learn_from_smarter_peers(game, place, click_cell):
    _enable_god(game)
    place("9", 12, 9)
    game.evaluate("window.__state.grid[9][12].skill = 0")
    place("9", 11, 9)
    game.evaluate("window.__state.grid[9][11].skill = 90")
    game.wait_for_timeout(2600)
    assert game.evaluate("window.__state.grid[9][12].skill") > 0


def test_human_pods_never_break(game, place):
    _starter_cluster(place)
    _enable_god(game)
    place("9", 3, 2)
    game.wait_for_timeout(1500)
    assert game.evaluate("window.__state.grid[2][3].cond") == 100
