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

Playtest View Should Be Readable
    [Documentation]    Fail the playtest when critical visible copy is clipped or truncated.
    ${failures}=    Evaluate JavaScript    ${None}    () => { const failures = []; const selectors = ['.brand-title','.resource-name','.resource-value','.research-roadmap-head strong','.research-node-copy strong','.quest-copy strong','.quest-copy > span','.quest-action','.recovery-action strong','.recovery-action small','.story-dossier h3','.story-objective strong','.story-last-beat p']; for (const selector of selectors) { for (const [index, element] of [...document.querySelectorAll(selector)].entries()) { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); const name = selector + '[' + index + ']'; const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' '); if (!text) failures.push(name + ': empty text'); if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') failures.push(name + ': not visible'); if (rect.left < -0.5 || rect.top < -0.5 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5) failures.push(name + ': clipped outside viewport'); if (element.scrollWidth > element.clientWidth + 1 && !['auto','scroll'].includes(style.overflowX)) failures.push(name + ': horizontal truncation text="' + text + '"'); if (element.scrollHeight > element.clientHeight + 1 && !['auto','scroll'].includes(style.overflowY)) failures.push(name + ': vertical truncation text="' + text + '"'); } } return failures }
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

Stage Blueprint Work Order
    [Arguments]    ${blueprint_id}    ${x}    ${y}
    [Documentation]    Place a blueprint through real controls and return its queued entity.
    Click    css=[data-blueprint="${blueprint_id}"]
    Click    css=.cell[data-x="${x}"][data-y="${y}"]
    Wait For Elements State    css=.cell[data-x="${x}"][data-y="${y}"] [data-construction-site]    visible    3s
    ${entity_id}=    Evaluate JavaScript    ${None}    ([blueprintId,x,y]) => window.__overhaulAcceptance.snapshot().presentation.structures.find(item => item.blueprintId === blueprintId && item.x === Number(x) && item.y === Number(y))?.id    arg=${{["${blueprint_id}", ${x}, ${y}]}}
    Should Not Be Empty    ${entity_id}
    RETURN    ${entity_id}

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
    Scroll To Element    css=[data-story-dossier]
    Playtest View Should Be Readable
    RETURN    ${snapshot}
