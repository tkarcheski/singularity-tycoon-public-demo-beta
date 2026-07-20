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
