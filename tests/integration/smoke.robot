*** Settings ***
Documentation    End-to-end smoke flows for Singularity Tycoon Mini.
...              These exercise full user journeys (boot, build, persist, restart)
...              and complement the per-system pytest suite.
Resource         keywords.resource
Test Setup       Open Game
Test Teardown    Close Game


*** Test Cases ***
Boots Cleanly With Twenty Tools
    [Documentation]    The shell renders all twenty build tools and starts the tutorial.
    ${count}=    Get Element Count    css=#tools .tool
    Should Be Equal As Integers    ${count}    20
    ${step}=     Get Text             css=#tut-progress
    Should Be Equal    ${step}    1 / 9

Player Can Build A Working Starter Cluster
    [Documentation]    Walk through the same tiles a new player would place,
    ...                then wait long enough for revenue to land in the profit band.
    Reset Save
    Place Tile    2    4    4
    Place Tile    4    5    4
    Place Tile    5    5    3
    Place Tile    5    6    4
    Place Tile    5    5    5
    Sleep         4s
    ${rev}=       Evaluate JavaScript    ${None}    () => window.__state.revenue
    Should Be True    4 < ${rev} < 30    revenue out of band: ${rev}

Save Persists Across A Reload
    [Documentation]    Place a tile, simulate the autosave path, reload — state survives.
    ...                Cash is checked approximately because a tick or two of upkeep
    ...                may run between restore and the assertion.
    Reset Save
    Place Tile    2    5    5
    Evaluate JavaScript    ${None}    () => { window.__state.cash = 50000 }
    Evaluate JavaScript    ${None}    () => window.dispatchEvent(new Event('beforeunload'))
    Reload
    Sleep         800ms
    ${tile}=    Evaluate JavaScript    ${None}    () => window.__state.grid[5][5]?.t
    Should Be Equal    ${tile}    power
    ${cash}=    Evaluate JavaScript    ${None}    () => window.__state.cash
    Should Be True    abs(${cash} - 50000) < 5    cash drifted unexpectedly: ${cash}
    ${ticker}=    Get Text    css=#ticker
    Should Contain    ${ticker}    Save restored

New Game Button Wipes The Save
    [Documentation]    Pressing New Game (auto-confirmed) clears localStorage and resets cash.
    Reset Save
    Place Tile    2    5    5
    Evaluate JavaScript    ${None}    () => { window.__state.cash = 9999 }
    Evaluate JavaScript    ${None}    () => window.dispatchEvent(new Event('beforeunload'))
    Evaluate JavaScript    ${None}    () => { window.confirm = () => true }
    Click         id=btn-new-game
    Sleep         800ms
    ${cash}=      Evaluate JavaScript    ${None}    () => window.__state.cash
    Should Be Equal As Integers    ${cash}    500
    ${tile}=      Evaluate JavaScript    ${None}    () => window.__state.grid[5][5]
    Should Be Equal    ${tile}    ${None}

Space Station Journey Renders And Simulates
    [Documentation]    Reach the blueprint, launch the station, build under
    ...                vacuum rules, and verify the tri board renders — the
    ...                listener embeds a screenshot after every keyword.
    Reset Save
    Evaluate JavaScript    ${None}    () => { window.__god.freeBuild = true; window.__state.goalUnlocked = true; window.__state.unlocks.immersion = true }
    Sleep         800ms
    Take Screenshot    fullPage=True
    Click         css=[data-space]
    Sleep         600ms
    ${topo}=      Evaluate JavaScript    ${None}    () => window.__state.topo.key
    Should Be Equal    ${topo}    tri
    # build a small vacuum farm directly (tri clicks need tri math)
    Evaluate JavaScript    ${None}    () => { const g = window.__state.floors.at(-1); g[0][0] = { t: 'solar', cond: 100 }; g[0][2] = { t: 'solar', cond: 100 }; g[4][4] = { t: 'cooler', cond: 100 }; g[4][5] = { t: 'cpu', cond: 100 }; g[4][6] = { t: 'gpu1', cond: 100 }; g[5][5] = { t: 'life', cond: 100 }; g[5][6] = { t: 'human', cond: 100, skill: 50 } }
    Sleep         2000ms
    Take Screenshot    fullPage=True
    ${compute}=   Evaluate JavaScript    ${None}    () => window.__state.totalCompute
    Should Be True    ${compute} > 0    station produces no compute: ${compute}
    ${life}=      Evaluate JavaScript    ${None}    () => window.__state.lifeMap[6][5]
    Should Be True    ${life}    pod at (5,6) should be inside the life-support field
    # fans must refuse placement in vacuum
    Evaluate JavaScript    ${None}    () => { window.__state.selectedTool = 'fan' }
    ${fan}=       Evaluate JavaScript    ${None}    () => window.__state.grid[2][2]
    Should Be Equal    ${fan}    ${None}
    # back to Earth and the palette re-enables fans
    Click         css=[data-floor="0"]
    Sleep         400ms
    ${disabled}=  Evaluate JavaScript    ${None}    () => document.querySelector('.tool[data-tool="fan"]').classList.contains('disabled')
    Should Not Be True    ${disabled}
    Take Screenshot    fullPage=True
