*** Settings ***
Documentation    Shared keywords for Singularity Tycoon Mini integration tests.
...              The Browser library wraps Playwright, so these keywords drive
...              the same single-page app the pytest unit suite uses.
Library          Browser
Library          OperatingSystem


*** Variables ***
${COLS}          14
${ROWS}          10
${TILE}          56
${INDEX_URL}     file://${EXECDIR}${/}index.html


*** Keywords ***
Open Game
    [Documentation]    Launch a fresh browser context and load the game.
    ...                The screenshot_listener (loaded via --listener) embeds a
    ...                snapshot after every top-level keyword automatically.
    New Browser    chromium    headless=True
    New Context    viewport={'width': 1440, 'height': 900}
    New Page       ${INDEX_URL}
    Sleep          900ms

Reset Save
    [Documentation]    Wipe localStorage and reload — guarantees a clean state.
    Evaluate JavaScript    ${None}    () => localStorage.clear()
    Reload
    Sleep                  800ms

Close Game
    [Documentation]    Tear down the browser. Listener has already snapped the
    ...                final body keyword, so no manual screenshot here.
    Close Browser

Game State
    [Documentation]    Return the live state object as a Python dict.
    ${snap}=    Evaluate JavaScript    ${None}    () => JSON.parse(JSON.stringify(window.__state))
    RETURN      ${snap}

Click Cell
    [Arguments]    ${gx}    ${gy}
    # Read the four geometry numbers separately so we can do arithmetic without
    # wrestling Robot's variable parser over dict access inside Evaluate.
    ${l}=    Evaluate JavaScript    ${None}    () => document.getElementById('game').getBoundingClientRect().left
    ${t}=    Evaluate JavaScript    ${None}    () => document.getElementById('game').getBoundingClientRect().top
    ${w}=    Evaluate JavaScript    ${None}    () => document.getElementById('game').clientWidth
    ${h}=    Evaluate JavaScript    ${None}    () => document.getElementById('game').clientHeight
    ${ox}=   Evaluate    ${l} + (${w} - ${COLS} * ${TILE}) // 2
    ${oy}=   Evaluate    ${t} + (${h} - ${ROWS} * ${TILE}) // 2
    ${px}=   Evaluate    ${ox} + ${gx} * ${TILE} + ${TILE} / 2
    ${py}=   Evaluate    ${oy} + ${gy} * ${TILE} + ${TILE} / 2
    Mouse Button    click    x=${px}    y=${py}

Place Tile
    [Arguments]    ${hotkey}    ${gx}    ${gy}
    Keyboard Key    press    ${hotkey}
    Click Cell      ${gx}    ${gy}
