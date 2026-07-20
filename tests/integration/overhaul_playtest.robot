*** Settings ***
Documentation     Goal-driven local-agent playtest for the inherited datacenter opening.
Resource          overhaul_playtest.resource
Suite Setup       Start Overhaul Playtest Server
Suite Teardown    Stop Overhaul Playtest Server
Test Setup        Open Inherited Datacenter
Test Teardown     Close Inherited Datacenter
Force Tags        playtest    local-ai    screenshots


*** Test Cases ***
Local AI Recovers The Site Unlocks Research And Supervises Final Assembly
    [Documentation]    A local agent must understand the visible recovery problem,
    ...                repair it through real UI controls, boot compute, route
    ...                research, and reach the external-market capability gate.
    ${decisions}=    Run Local AI Playtest    unlock-external-markets    40
    ${count}=    Get Length    ${decisions}
    Should Be True    4 < ${count} < 40
    ${entity_id}=    Stage Blueprint Work Order    generator    8    7
    Construction Phase Should Be    ${entity_id}    traveling
    Capture Playtest Checkpoint    100-crew-traveling
    Wait Until Keyword Succeeds    5s    50ms    Construction Phase Should Be    ${entity_id}    assembling
    Capture Playtest Checkpoint    101-crew-assembling
    Wait Until Keyword Succeeds    3s    50ms    Construction Phase Should Be    ${entity_id}    commissioning
    Capture Playtest Checkpoint    102-crew-commissioning
    Wait Until Keyword Succeeds    3s    50ms    Construction Phase Should Be    ${entity_id}    complete
    Capture Playtest Checkpoint    103-structure-online

Ten Turn Campaign Reaches The Human And AI Feedback Loop
    [Documentation]    The campaign must carry the inherited-site opening through
    ...                expansion, markets, model, harness, agent, contract, cash,
    ...                and the final shared-control story beat.
    ${snapshot}=    Complete Ten Turn Campaign
    Should Be Equal    ${snapshot}[story][lastBeat][id]    shared-control
    Should Contain    ${snapshot}[story][lastBeat][copy]    WHO OWNS THE NEXT FLOOR
    Capture Playtest Checkpoint    200-ten-turn-campaign-complete

Cooling Can Expand Into The First Frontier Compute Tile
    [Setup]    Open Inherited Datacenter    ROBOT-COOLING-EXPANSION
    [Documentation]    Recover the opening, buy one adjacent tile, commission stacked
    ...                utility routes and compute, then prove the new node receives
    ...                cooling through the expanded network using real UI controls.
    ${decisions}=    Run Local AI Playtest    unlock-external-markets    40
    ${before}=    Cooling Expansion Snapshot    7    3
    Click    css=[data-blueprint="cooling_pipe"]
    Purchase Frontier Tile    7    3
    Cooling Extension Preview Should Be Connected
    Capture Playtest Checkpoint    299-connected-cooling-preview
    ${cooling_id}=    Stage Blueprint Work Order    cooling_pipe    7    3
    Wait Until Keyword Succeeds    6s    100ms    Construction Phase Should Be    ${cooling_id}    complete
    ${after_pipe}=    Cooling Expansion Snapshot    7    3
    Should Be Equal As Integers    ${after_pipe}[segments]    ${{${before}[segments] + 1}}
    Capture Playtest Checkpoint    300-cooling-frontier-commissioned
    ${power_id}=    Stage Blueprint Work Order    power_line    7    3
    Wait Until Keyword Succeeds    6s    100ms    Construction Phase Should Be    ${power_id}    complete
    ${data_id}=    Stage Blueprint Work Order    data_cable    7    3
    Wait Until Keyword Succeeds    6s    100ms    Construction Phase Should Be    ${data_id}    complete
    ${compute_id}=    Stage Blueprint Work Order    computer_lean    7    3
    Wait Until Keyword Succeeds    6s    100ms    Construction Phase Should Be    ${compute_id}    complete
    Wait Until Keyword Succeeds    8s    100ms    Expanded Starter Node Should Be Cooled    7    3
    Click    css=[data-network-focus="cooling"]
    Scroll To Element    css=.research-roadmap-head
    Playtest View Should Be Readable
    Capture Playtest Checkpoint    301-expanded-node-cooled
