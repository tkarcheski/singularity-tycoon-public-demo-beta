*** Settings ***
Documentation    End-to-end smoke flows for Singularity Tycoon Mini.
...              These exercise full user journeys (boot, build, persist, restart)
...              and complement the per-system pytest suite.
Resource         keywords.resource
Test Setup       Open Game
Test Teardown    Close Game


*** Test Cases ***
Boots Cleanly With Twelve Tools
    [Documentation]    The shell renders all twelve build tools and starts the tutorial.
    ${count}=    Get Element Count    css=#tools .tool
    Should Be Equal As Integers    ${count}    12
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
