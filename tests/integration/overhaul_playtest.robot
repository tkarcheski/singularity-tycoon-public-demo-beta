*** Settings ***
Documentation     Goal-driven local-agent playtest for the inherited datacenter opening.
Resource          overhaul_playtest.resource
Suite Setup       Start Overhaul Playtest Server
Suite Teardown    Stop Overhaul Playtest Server
Test Setup        Open Inherited Datacenter
Test Teardown     Close Inherited Datacenter
Force Tags        playtest    local-ai    screenshots


*** Test Cases ***
Local AI Recovers The Site And Unlocks External Markets
    [Documentation]    A local agent must understand the visible recovery problem,
    ...                repair it through real UI controls, boot compute, route
    ...                research, and reach the external-market capability gate.
    ${decisions}=    Run Local AI Playtest    unlock-external-markets    40
    ${count}=    Get Length    ${decisions}
    Should Be True    4 < ${count} < 40
