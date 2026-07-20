*** Settings ***
Documentation     Reusable, decision-driven Robot playtest for the overhaul.
...               Every move records its observation, reason, and a named screenshot.
Library           Browser
Library           Process
Library           OperatingSystem
Library           Collections
Library           libraries/LocalPlaytestAgent.py


*** Variables ***
${PLAYTEST_PORT}         8876
${PLAYTEST_BASE_URL}     http://127.0.0.1:${PLAYTEST_PORT}


*** Keywords ***
Start Overhaul Playtest Server
    [Documentation]    Start the same threaded no-cache server used for human playtests.
    Create Directory    ${OUTPUT DIR}
    ${python}=    Evaluate    sys.executable    modules=sys
    Start Process
    ...    ${python}
    ...    ${EXECDIR}${/}tools${/}serve.py
    ...    ${PLAYTEST_PORT}
    ...    cwd=${EXECDIR}
    ...    alias=overhaul-playtest-server
    ...    stdout=${OUTPUT DIR}${/}overhaul-playtest-server.log
    ...    stderr=STDOUT
    Sleep    500ms
    Process Should Be Running    overhaul-playtest-server

Stop Overhaul Playtest Server
    [Documentation]    Stop only the server process owned by this Robot suite.
    Terminate Process    overhaul-playtest-server    kill=True

Open Inherited Datacenter
    [Arguments]    ${seed}=ROBOT-RECOVERY-17
    [Documentation]    Open a deterministic recovery seed through the live HTTP app.
    New Browser    chromium    headless=True
    New Context    viewport={'width': 1440, 'height': 900}
    New Page       ${PLAYTEST_BASE_URL}/overhaul.html?seed=${seed}
    Wait For Elements State    css=[data-overhaul-root][data-recovery-phase]    visible    5s
    Wait Until Keyword Succeeds    5s    100ms    Overhaul UI Commit Should Be Atomic
    Capture Playtest Checkpoint    000-opened-seed

Close Inherited Datacenter
    Close Browser

Committed Overhaul Snapshot
    [Documentation]    Read only a fully committed simulation/UI pair.
    ${snapshot}=    Evaluate JavaScript    ${None}    () => { const snapshot = window.__overhaulAcceptance.snapshot().presentation; const uiTick = Number(document.documentElement.dataset.uiTick); if (snapshot.ticks.raw !== snapshot.ticks.completed || snapshot.ticks.completed !== uiTick) throw new Error('non-atomic playtest observation: raw=' + snapshot.ticks.raw + ' completed=' + snapshot.ticks.completed + ' ui=' + uiTick); return JSON.parse(JSON.stringify(snapshot)) }
    RETURN    ${snapshot}

Overhaul UI Commit Should Be Atomic
    ${snapshot}=    Committed Overhaul Snapshot
    Should Be Equal As Integers    ${snapshot}[ticks][raw]    ${snapshot}[ticks][completed]

Capture Playtest Checkpoint
    [Arguments]    ${name}
    [Documentation]    Save a standalone PNG and embed it in Robot's HTML report.
    ${path}=    Take Screenshot    filename=ai-playtest-${name}    fullPage=True    log_screenshot=True
    Log    Playtest screenshot: ${path}
    RETURN    ${path}

Scroll Committed Element Into View
    [Arguments]    ${selector}
    [Documentation]    Retry across one atomic DOM commit, but fail sustained UI churn.
    Wait Until Keyword Succeeds    3s    100ms    Scroll To Element    ${selector}
    Overhaul UI Commit Should Be Atomic

Playtest View Should Be Readable
    [Documentation]    Fail the playtest when critical visible copy is clipped or truncated.
    Evaluate JavaScript    ${None}    () => { const rail=document.querySelector('.left-scroll'); if (rail) rail.scrollTop=0; }
    ${failures}=    Evaluate JavaScript    ${None}    () => { const failures = []; const selectors = ['.brand-title','.resource-name','.resource-value','.resource-detail','.research-roadmap-head strong','.research-node-copy strong','.quest-copy strong','.quest-copy > span','.quest-action','.recovery-action strong','.recovery-action small','.story-dossier h3','.story-objective strong','.story-last-beat p']; for (const selector of selectors) { for (const [index, element] of [...document.querySelectorAll(selector)].entries()) { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); const name = selector + '[' + index + ']'; const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' '); if (!text) failures.push(name + ': empty text'); if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') failures.push(name + ': not visible'); if (rect.left < -0.5 || rect.top < -0.5 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5) failures.push(name + ': clipped outside viewport'); if (element.scrollWidth > element.clientWidth + 1 && !['auto','scroll'].includes(style.overflowX)) failures.push(name + ': horizontal truncation text="' + text + '"'); if (element.scrollHeight > element.clientHeight + 1 && !['auto','scroll'].includes(style.overflowY)) failures.push(name + ': vertical truncation text="' + text + '"'); } } return failures }
    Should Be Empty    ${failures}    Playtest visibility failures: ${failures}

Execute Local Playtest Move
    [Arguments]    ${decision}
    IF    $decision["kind"] == "repair"
        Click    css=.cell[data-x="${decision}[x]"][data-y="${decision}[y]"]
        Wait For Elements State    css=[data-repair-structure="${decision}[entityId]"]    visible    2s
        Click    css=[data-repair-structure="${decision}[entityId]"]
        Wait Until Keyword Succeeds    2s    100ms    Overhaul UI Commit Should Be Atomic
    ELSE IF    $decision["kind"] == "route-research"
        Click    css=[data-route-preset="ai-train"]
        Wait Until Keyword Succeeds    2s    100ms    Overhaul UI Commit Should Be Atomic
    ELSE IF    $decision["kind"] == "retrofit-compute"
        Wait For Elements State    css=[data-quest-action="locate-retrofit"]    visible    2s
        Click    css=[data-quest-action="locate-retrofit"]
        Wait For Elements State    css=[data-upgrade-compute="${decision}[entityId]"]    visible    2s
        Click    css=[data-upgrade-compute="${decision}[entityId]"]
        Wait Until Keyword Succeeds    2s    100ms    Overhaul UI Commit Should Be Atomic
    ELSE IF    $decision["kind"] == "wait"
        Sleep    550ms
        Overhaul UI Commit Should Be Atomic
    END

Run Local AI Playtest
    [Arguments]    ${goal}=unlock-external-markets    ${max_steps}=40
    [Documentation]    Observe, decide, click, and capture—not a time-based soak.
    ${decisions}=    Create List
    FOR    ${step}    IN RANGE    ${max_steps}
        ${snapshot}=    Committed Overhaul Snapshot
        ${decision}=    Choose Playtest Move    ${snapshot}    ${goal}
        Append To List    ${decisions}    ${decision}
        Log    AI PLAYTEST step ${step}: ${decision}[kind] — ${decision}[reason]    INFO
        Playtest View Should Be Readable
        Capture Playtest Checkpoint    ${step}-${decision}[kind]
        IF    $decision["kind"] == "done"    BREAK
        Execute Local Playtest Move    ${decision}
    END
    ${final}=    Committed Overhaul Snapshot
    ${met}=    Playtest Goal Is Met    ${final}    ${goal}
    Should Be True    ${met}    Local AI did not reach ${goal}; decisions=${decisions}
    Playtest View Should Be Readable
    Capture Playtest Checkpoint    999-goal-met
    RETURN    ${decisions}

Starter Compute Should Be Unlocked
    [Documentation]    Prove the first gate, research state, and visible blueprint agree.
    ${snapshot}=    Committed Overhaul Snapshot
    ${starter}=    Evaluate    next(item for item in $snapshot["unlocks"] if item["kind"] == "computer")
    Should Be Equal As Integers    ${snapshot}[opening][completed]    1
    Should Be Equal    ${snapshot}[opening][current][id]    expand-utilities
    Should Contain    ${snapshot}[research][completedIds]    rack-standard
    Click    css=[data-layer="compute"]
    Wait For Elements State    css=[data-blueprint="${starter}[id]"]    visible    2s
    ${disabled}=    Get Attribute    css=[data-blueprint="${starter}[id]"]    aria-disabled
    Should Be Equal    ${disabled}    false
    Capture Playtest Checkpoint    125-starter-compute-unlocked

Stage Blueprint Work Order
    [Arguments]    ${blueprint_id}    ${x}    ${y}
    [Documentation]    Place a blueprint through real controls and return its queued entity.
    ${pressed}=    Get Attribute    css=[data-blueprint="${blueprint_id}"]    aria-pressed
    IF    "${pressed}" != "true"    Click    css=[data-blueprint="${blueprint_id}"]
    Click    css=.cell[data-x="${x}"][data-y="${y}"]
    Wait For Elements State    css=.cell[data-x="${x}"][data-y="${y}"] [data-construction-site]    visible    3s
    ${entity_id}=    Evaluate JavaScript    ${None}    ([blueprintId,x,y]) => window.__overhaulAcceptance.snapshot().presentation.structures.find(item => item.blueprintId === blueprintId && item.x === Number(x) && item.y === Number(y))?.id    arg=${{["${blueprint_id}", ${x}, ${y}]}}
    Should Not Be Empty    ${entity_id}
    RETURN    ${entity_id}

First Revenue Should Be Live
    [Arguments]    ${cash_before}
    [Documentation]    Prove the committed simulation, cash HUD, and router agree on revenue.
    ${state}=    Evaluate JavaScript    ${None}    ([cashBefore]) => { const snapshot=window.__overhaulAcceptance.snapshot().presentation; const hud=document.querySelector('[data-cash]'); const router=document.querySelector('[data-revenue-state]'); return { cash:Number(snapshot.economy.cash), cashBefore:Number(cashBefore), sold:Number(snapshot.progress.rawFlopsSold), routed:Number(snapshot.sell.routedFlops), income:Number(snapshot.sell.incomePerTick || 0), blocked:snapshot.sell.blocked, fiberFloor:snapshot.sell.fiberFloor, hudCash:Number(hud?.dataset.value || 0), hudIncome:Number(hud?.dataset.incomePerTick || 0), revenueState:router?.dataset.revenueState || null, uiTick:Number(document.documentElement.dataset.uiTick), completed:Number(snapshot.ticks.completed) } }    arg=${{[${cash_before}]}}
    Should Be True    ${state}[cash] > ${state}[cashBefore]
    Should Be True    ${state}[sold] > 0
    Should Be True    ${state}[routed] > 0
    Should Be True    ${state}[income] > 0
    Should Be Equal    ${state}[blocked]    ${False}
    Should Be Equal As Integers    ${state}[fiberFloor]    1
    Should Be Equal As Numbers    ${state}[hudCash]    ${state}[cash]    precision=5
    Should Be Equal As Numbers    ${state}[hudIncome]    ${state}[income]    precision=5
    Should Be Equal    ${state}[revenueState]    revenue-live
    Should Be Equal As Integers    ${state}[uiTick]    ${state}[completed]

Revenue Guidance Should Be Readable
    Scroll Committed Element Into View    css=[data-revenue-state]
    ${failures}=    Evaluate JavaScript    ${None}    () => { const failures=[]; for (const element of document.querySelectorAll('.revenue-status strong,.revenue-status span')) { const style=getComputedStyle(element); const rect=element.getBoundingClientRect(); const text=(element.textContent || '').trim(); if (!text) failures.push('empty revenue guidance'); if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') failures.push('hidden revenue guidance: ' + text); if (rect.left < -0.5 || rect.top < -0.5 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5) failures.push('clipped revenue guidance: ' + text); if (element.scrollWidth > element.clientWidth + 1) failures.push('truncated revenue guidance: ' + text); } return failures }
    Should Be Empty    ${failures}    Revenue guidance visibility failures: ${failures}

Reach First Revenue From A Fresh Save
    [Arguments]    ${seed}
    [Documentation]    Play the real opening through repair, research, fiber, and first sale.
    Complete First Two Opening Checkpoints
    ${decisions}=    Run Local AI Playtest    unlock-external-markets    40
    ${fiber_id}=    Stage Blueprint Work Order    fiber_gateway    3    7
    Wait Until Keyword Succeeds    6s    100ms    Construction Phase Should Be    ${fiber_id}    complete
    ${before}=    Committed Overhaul Snapshot
    Click    css=[data-route-preset="sell"]
    Wait Until Keyword Succeeds    8s    100ms    First Revenue Should Be Live    ${before}[economy][cash]
    Playtest View Should Be Readable
    Revenue Guidance Should Be Readable
    Capture Playtest Checkpoint    150-first-revenue-${seed}

Retrofit Inherited Compute Through The Inspector
    [Documentation]    Complete checkpoint one with the real selected-rack action.
    ${before}=    Committed Overhaul Snapshot
    ${target}=    Evaluate    next(item for item in $before["structures"] if item["kind"] == "computer")
    ${target_id}=    Set Variable    ${target}[id]
    Click    css=.cell[data-x="${target}[x]"][data-y="${target}[y]"]
    Wait For Elements State    css=[data-upgrade-compute="${target}[id]"]    visible    3s
    Click    css=[data-upgrade-compute="${target}[id]"]
    Wait Until Keyword Succeeds    3s    100ms    Construction Phase Should Be    ${target}[id]    assembling
    Capture Playtest Checkpoint    120-compute-retrofit-active
    Wait Until Keyword Succeeds    8s    100ms    Construction Phase Should Be    ${target}[id]    complete
    ${after}=    Committed Overhaul Snapshot
    ${upgraded}=    Evaluate    [item for item in $after["structures"] if item["id"] == "${target_id}"][0]
    Should Be Equal As Integers    ${upgraded}[computeUpgradeLevel]    1
    Should Be Equal As Numbers    ${upgraded}[outputMultiplier]    1.5
    Should Be Equal As Integers    ${after}[opening][completed]    1
    Should Be Equal    ${after}[opening][current][id]    expand-utilities
    Capture Playtest Checkpoint    121-compute-retrofit-complete
    RETURN    ${target}[id]

Opening Utility Capacities Should Be Expanded
    ${snapshot}=    Committed Overhaul Snapshot
    Should Be True    ${snapshot}[networks][power][telemetry][capacity] > 24
    Should Be True    ${snapshot}[networks][cooling][telemetry][capacity] > 12
    Should Be Equal As Integers    ${snapshot}[opening][completed]    2
    Should Be Equal    ${snapshot}[opening][current][id]    research-capability

Opening Research Checkpoint Should Be Complete
    ${snapshot}=    Committed Overhaul Snapshot
    Should Be Equal As Integers    ${snapshot}[opening][completed]    3
    Should Be Equal    ${snapshot}[opening][current][id]    expand-first-floor

Complete First Two Opening Checkpoints
    [Documentation]    Recover, retrofit, and visibly grow both utility capacities.
    ${decisions}=    Run Local AI Playtest    recover-site    30
    Retrofit Inherited Compute Through The Inspector
    ${generator}=    Stage Blueprint Work Order    generator    4    4
    Construction Phase Should Be    ${generator}    traveling
    Capture Playtest Checkpoint    130-generator-crew-traveling
    Wait Until Keyword Succeeds    5s    100ms    Construction Phase Should Be    ${generator}    complete
    ${power}=    Stage Blueprint Work Order    power_line    5    5
    Wait Until Keyword Succeeds    6s    100ms    Construction Phase Should Be    ${power}    complete
    ${pump}=    Stage Blueprint Work Order    cooling_pump    5    5
    Wait Until Keyword Succeeds    6s    100ms    Construction Phase Should Be    ${pump}    complete
    Wait Until Keyword Succeeds    5s    100ms    Opening Utility Capacities Should Be Expanded
    Capture Playtest Checkpoint    131-power-and-cooling-expanded
    RETURN    ${decisions}

Expand Floor One By Twelve Tiles
    [Documentation]    Buy exactly twelve connected frontier tiles through the visible UI.
    ${before}=    Committed Overhaul Snapshot
    FOR    ${index}    IN RANGE    12
        ${snapshot}=    Committed Overhaul Snapshot
        ${target}=    Evaluate    min($snapshot["footprint"]["frontier"], key=lambda item: item["cost"])
        Purchase Frontier Tile    ${target}[x]    ${target}[y]
    END
    ${after}=    Committed Overhaul Snapshot
    Should Be Equal As Integers    ${{len($after["footprint"]["owned"]) - len($before["footprint"]["owned"])}}    12
    Should Be True    ${after}[economy][cash] >= 0
    Should Be Equal As Integers    ${after}[opening][completed]    4
    Should Be Equal    ${after}[opening][current][id]    unlock-second-floor
    Capture Playtest Checkpoint    140-twelve-floor-one-tiles-claimed

Construction Phase Should Be
    [Arguments]    ${entity_id}    ${phase}
    ${state}=    Evaluate JavaScript    ${None}    ([entityId,phase]) => { const snapshot=window.__overhaulAcceptance.snapshot().presentation; const structure=snapshot.structures.find(item => item.id === entityId); const crew=snapshot.actors.filter(item => item.assignment?.entityId === entityId); const expected=phase === 'traveling' ? ['moving','moving'] : phase === 'assembling' ? ['building','working'] : phase === 'commissioning' ? ['inspecting','maintaining'] : []; return { phase:structure?.construction?.phase, condition:structure?.condition, crewStates:crew.map(item => item.state).sort(), expected:expected.sort(), sitePhase:document.querySelector(`[data-construction-site="${entityId}"]`)?.dataset.constructionPhase || null, uiTick:Number(document.documentElement.dataset.uiTick), completed:snapshot.ticks.completed } }    arg=${{["${entity_id}", "${phase}"]}}
    Should Be Equal    ${state}[phase]    ${phase}
    Should Be Equal    ${state}[crewStates]    ${state}[expected]
    Should Be Equal As Integers    ${state}[uiTick]    ${state}[completed]
    IF    "${phase}" == "complete"
        Should Be Equal As Integers    ${state}[condition]    100
        Should Be Equal    ${state}[sitePhase]    ${None}
    ELSE
        Should Be Equal    ${state}[sitePhase]    ${phase}
    END

Purchase Frontier Tile
    [Arguments]    ${x}    ${y}
    [Documentation]    Purchase a specific visible frontier tile through the inspector.
    Click    css=.cell[data-x="${x}"][data-y="${y}"]
    Wait For Elements State    css=[data-purchase-frontier]    visible    2s
    Click    css=[data-purchase-frontier]
    Wait Until Keyword Succeeds    3s    100ms    Tile Should Be Owned    ${x}    ${y}

Tile Should Be Owned
    [Arguments]    ${x}    ${y}
    ${territory}=    Get Attribute    css=.cell[data-x="${x}"][data-y="${y}"]    data-territory
    Should Be Equal    ${territory}    owned

Cooling Expansion Snapshot
    [Arguments]    ${x}    ${y}
    ${state}=    Evaluate JavaScript    ${None}    ([x,y]) => { const snapshot=window.__overhaulAcceptance.snapshot().presentation; const computer=snapshot.computers.find(item => item.x === Number(x) && item.y === Number(y)); const path=computer ? snapshot.networks.cooling.paths.find(item => item.target === computer.id) : null; const pipe=snapshot.structures.find(item => item.blueprintId === 'cooling_pipe' && item.x === Number(x) && item.y === Number(y)); const telemetry=snapshot.networks.cooling.telemetry; return { computerId:computer?.id || null, computerState:computer?.state || null, coolingDelivered:Number(computer?.coolingDelivered || 0), rawFlops:Number(computer?.rawFlops || 0), pipeId:pipe?.id || null, pipeCondition:Number(pipe?.condition || 0), pathConnected:path?.connected === true, pathCells:path?.cells || [], segments:Number(snapshot.utilities.byLayer.cooling.segments || 0), delivered:Number(telemetry.delivered || 0), capacity:Number(telemetry.capacity || 0), uiTick:Number(document.documentElement.dataset.uiTick), completed:Number(snapshot.ticks.completed) } }    arg=${{[${x}, ${y}]}}
    RETURN    ${state}

Expanded Starter Node Should Be Cooled
    [Arguments]    ${x}    ${y}
    ${state}=    Cooling Expansion Snapshot    ${x}    ${y}
    Should Not Be Empty    ${state}[pipeId]
    Should Be Equal As Integers    ${state}[pipeCondition]    100
    Should Not Be Empty    ${state}[computerId]
    Should Be True    ${state}[pathConnected]
    Should Be True    ${state}[coolingDelivered] > 0
    Should Be True    ${state}[rawFlops] > 0
    Should Be Equal As Integers    ${state}[uiTick]    ${state}[completed]

Cooling Extension Preview Should Be Connected
    ${connected}=    Get Attribute    css=[data-placement-preview][data-preview-blueprint="cooling_pipe"]    data-preview-network-connected
    ${isolated}=    Get Attribute    css=[data-placement-preview][data-preview-blueprint="cooling_pipe"]    data-preview-isolated
    ${copy}=    Get Text    css=[data-placement-preview][data-preview-blueprint="cooling_pipe"]
    Should Be Equal    ${connected}    true
    Should Be Equal    ${isolated}    false
    Should Contain    ${copy}    Extends live cooling reach

Complete Ten Turn Campaign
    [Documentation]    Exercise every persistent campaign gate and reveal the final dossier.
    ${turn_samples}=    Evaluate JavaScript    ${None}    () => window.__overhaulAcceptance.runScenario('story-campaign').snapshots.length
    Should Be True    ${turn_samples} >= 10
    Wait Until Keyword Succeeds    5s    100ms    Overhaul UI Commit Should Be Atomic
    ${snapshot}=    Committed Overhaul Snapshot
    Should Be Equal    ${snapshot}[story][state]    complete
    Should Be Equal As Integers    ${snapshot}[story][completed]    10
    Click    css=[data-tab="jobs"]
    Wait For Elements State    css=[data-story-dossier][data-story-state="complete"]    visible    3s
    Scroll Committed Element Into View    css=[data-story-dossier]
    Playtest View Should Be Readable
    RETURN    ${snapshot}
