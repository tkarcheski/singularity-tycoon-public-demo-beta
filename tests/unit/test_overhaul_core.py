"""Pure-core acceptance tests for the deterministic overhaul simulation."""

import json
from pathlib import Path
import subprocess
import textwrap


ROOT = Path(__file__).resolve().parents[2]


def _run_core(source):
    script = textwrap.dedent(
        f"""
        import {{ createOverhaulGame, OVERHAUL_BALANCE }} from "./src/overhaul/core.js";
        {source}
        """
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def _assert_connected_footprint(cells):
    points = {(cell["x"], cell["y"]) for cell in cells}
    assert len(points) == len(cells)
    pending = [next(iter(points))]
    visited = set()
    while pending:
        point = pending.pop()
        if point in visited:
            continue
        visited.add(point)
        x, y = point
        pending.extend(
            neighbor
            for neighbor in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
            if neighbor in points and neighbor not in visited
        )
    assert visited == points


def test_seeded_starts_are_deterministic_varied_and_viable():
    result = _run_core(
        """
        const requiredStarterKinds = ["floor", "power-link", "cooling-link", "data-link"];
        const requiredInheritedKinds = ["power-source", "cooling-source", "computer", "data-link"];
        const first = createOverhaulGame({seed: "repeatable-seed"}).snapshot();
        const repeat = createOverhaulGame({seed: "repeatable-seed"}).snapshot();
        const starts = [];
        for (let seed = 0; seed < 64; seed++) {
          const game = createOverhaulGame({seed: `viability-${seed}`});
          const start = game.snapshot();
          const final = game.runScenario("computer-path-connected").snapshots.at(-1);
          starts.push({
            kit: start.starterKitId,
            kinds: [...new Set(start.unlocks.map((unlock) => unlock.kind))],
            inheritedKinds: [...new Set(start.structures.filter((item) => item.inherited)
              .map((item) => item.kind))],
            site: start.recovery.siteName,
            repairTargets: start.recovery.targets.map((target) => target.blueprintId),
            broken: start.recovery.targets.filter((target) => target.state === "broken").length,
            startingRaw: start.flops.raw,
            loaded: final.computers.some((computer) =>
              computer.state === "loaded" && computer.rawFlops > 0),
          });
        }
        console.log(JSON.stringify({
          same: JSON.stringify(first.unlocks) === JSON.stringify(repeat.unlocks)
            && JSON.stringify(first.footprint) === JSON.stringify(repeat.footprint)
            && JSON.stringify(first.recovery) === JSON.stringify(repeat.recovery)
            && JSON.stringify(first.structures) === JSON.stringify(repeat.structures),
          geometry: [first.persistence.floor.width, first.persistence.floor.height],
          owned: first.footprint.owned,
          frontier: first.footprint.frontier,
          starts,
          requiredStarterKinds,
          requiredInheritedKinds,
        }));
        """
    )

    assert result["same"] is True
    assert result["geometry"] == [12, 8]
    _assert_connected_footprint(result["owned"])
    assert len({start["kit"] for start in result["starts"]}) > 1
    assert len({start["site"] for start in result["starts"]}) > 1
    assert len({tuple(start["repairTargets"]) for start in result["starts"]}) > 1
    for start in result["starts"]:
        assert set(result["requiredStarterKinds"]).issubset(start["kinds"])
        assert set(result["requiredInheritedKinds"]).issubset(start["inheritedKinds"])
        assert start["broken"] == 2
        assert start["startingRaw"] == 0
        assert start["loaded"] is True
    owned = {(cell["x"], cell["y"]) for cell in result["owned"]}
    for cell in result["frontier"]:
        assert (cell["x"], cell["y"]) not in owned
        assert cell["cost"] > 0
        assert any(
            neighbor in owned
            for neighbor in (
                (cell["x"] + 1, cell["y"]),
                (cell["x"] - 1, cell["y"]),
                (cell["x"], cell["y"] + 1),
                (cell["x"], cell["y"] - 1),
            )
        )


def test_inherited_site_repair_boot_and_research_unlocks_form_a_real_opening_loop():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "recover-me"});
        const events = [];
        game.subscribe((event) => events.push(event));
        const initial = game.snapshot();
        const repairFrames = [];
        for (const target of initial.recovery.targets) {
          const started = game.command({type: "repair-structure", entityId: target.entityId});
          repairFrames.push({started, snapshot: game.snapshot()});
          let elapsed = 0;
          while (game.snapshot().recovery.targets.find((item) => item.entityId === target.entityId).state !== "repaired") {
            game.tick();
            elapsed += 1;
            if (elapsed > 30) throw new Error("recovery crew did not finish");
          }
          repairFrames.push({elapsed, snapshot: game.snapshot()});
        }
        const recovered = game.snapshot();
        game.command({type: "set-routes", routes: {sell: 0, research: 1, train: 0, inference: 0}});
        game.tick(30);
        const researched = game.snapshot();
        console.log(JSON.stringify({initial, repairFrames, recovered, researched, events}));
        """
    )

    initial = result["initial"]
    assert initial["recovery"]["phase"] == "triage"
    assert initial["recovery"]["total"] == 2
    assert initial["recovery"]["repaired"] == 0
    assert initial["computers"][0]["state"] == "off"
    assert {unlock["id"] for unlock in initial["unlocks"]} == {
        "floor_claim", "power_line", "cooling_pipe", "data_cable"
    }

    first_started = result["repairFrames"][0]
    assert first_started["started"]["ok"] is True
    assert first_started["snapshot"]["recovery"]["phase"] == "repairing"
    field_crew = [
        actor for actor in first_started["snapshot"]["actors"]
        if actor["kind"] in {"human", "robot"}
    ]
    assert {actor["state"] for actor in field_crew} == {"moving"}
    assert {actor["assignment"]["kind"] for actor in field_crew} == {"recovery"}
    assert result["recovered"]["recovery"]["phase"] == "online"
    assert result["recovered"]["recovery"]["repaired"] == 2
    assert result["recovered"]["economy"]["cash"] == (
        initial["economy"]["cash"]
        - 2 * 90
        + 240
    )
    assert "recovery-grid" in result["recovered"]["research"]["completedIds"]
    assert {"generator", "cooling_pump"}.issubset(
        {unlock["id"] for unlock in result["recovered"]["unlocks"]}
    )

    researched = result["researched"]
    assert researched["flops"]["raw"] > 0
    assert researched["research"]["points"] >= 80
    assert {node["state"] for node in researched["research"]["nodes"]} == {"complete"}
    assert {
        "generator", "cooling_pump", initial["persistence"]["computerBlueprintId"],
        "power_pole", "data_switch", "fiber_gateway", "ai_controller", "ai_bus",
    }.issubset({unlock["id"] for unlock in researched["unlocks"]})
    event_types = [event["type"] for event in result["events"]]
    assert event_types.count("recovery.repair-started") == 2
    assert event_types.count("recovery.repair-completed") == 2
    assert "recovery.site-online" in event_types
    assert event_types.count("research.node-completed") == 5


def test_blueprint_creates_travel_assembly_and_commissioning_work_for_both_actors():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "visible-workforce"});
        game.runScenario("computer-path-connected");
        const events = [];
        game.subscribe((event) => events.push(event));
        const placed = game.actions.place("generator", 8, 7);
        const staged = game.snapshot();
        const restored = createOverhaulGame({snapshot: staged});
        let restoreGuard = 0;
        while (restored.snapshot().construction.jobs.length) {
          restored.tick();
          if (++restoreGuard > 30) throw new Error("restored construction crew did not finish");
        }
        const restoredCompleted = restored.snapshot();
        const frames = [staged];
        let guard = 0;
        while (game.snapshot().construction.jobs.length) {
          frames.push(game.tick());
          if (++guard > 30) throw new Error("construction crew did not finish");
        }
        const completed = game.snapshot();
        console.log(JSON.stringify({placed, staged, frames, completed, restoredCompleted, events}));
        """
    )

    assert result["placed"]["ok"] is True
    assert result["placed"]["operational"] is False
    entity_id = result["placed"]["entityId"]
    staged_structure = next(
        item for item in result["staged"]["structures"] if item["id"] == entity_id
    )
    assert staged_structure["condition"] == 0
    assert staged_structure["construction"]["phase"] == "traveling"
    staged_crew = [
        actor for actor in result["staged"]["actors"]
        if actor["kind"] in {"human", "robot"}
    ]
    assert {actor["state"] for actor in staged_crew} == {"moving"}
    assert {actor["assignment"]["entityId"] for actor in staged_crew} == {entity_id}

    phases = {
        frame["construction"]["jobs"][0]["phase"]
        for frame in result["frames"]
        if frame["construction"]["jobs"]
    }
    assert {"traveling", "assembling", "commissioning"}.issubset(phases)
    assembly = next(
        frame for frame in result["frames"]
        if frame["construction"]["jobs"]
        and frame["construction"]["jobs"][0]["phase"] == "assembling"
    )
    assembly_crew = {
        actor["kind"]: actor for actor in assembly["actors"]
        if actor["kind"] in {"human", "robot"}
    }
    assert assembly_crew["human"]["state"] == "working"
    assert assembly_crew["robot"]["state"] == "building"
    assert {(actor["x"], actor["y"]) for actor in assembly_crew.values()} == {(8, 7)}

    commissioning = next(
        frame for frame in result["frames"]
        if frame["construction"]["jobs"]
        and frame["construction"]["jobs"][0]["phase"] == "commissioning"
    )
    commissioning_states = {
        actor["kind"]: actor["state"] for actor in commissioning["actors"]
        if actor["kind"] in {"human", "robot"}
    }
    assert commissioning_states == {"human": "inspecting", "robot": "maintaining"}

    final_structure = next(
        item for item in result["completed"]["structures"] if item["id"] == entity_id
    )
    assert final_structure["condition"] == 100
    assert final_structure["construction"]["state"] == "complete"
    assert final_structure["construction"]["progress"] == 1
    assert result["completed"]["construction"]["jobs"] == []
    assert {
        actor["state"] for actor in result["completed"]["actors"]
        if actor["kind"] in {"human", "robot"}
    } == {"idle"}
    restored_structure = next(
        item for item in result["restoredCompleted"]["structures"] if item["id"] == entity_id
    )
    assert restored_structure["condition"] == 100
    assert restored_structure["construction"]["state"] == "complete"
    assert result["restoredCompleted"]["construction"]["jobs"] == []
    event_types = [event["type"] for event in result["events"]]
    assert "human.moved" in event_types
    assert "robot.moved" in event_types
    assert "construction.crew-dispatched" in event_types
    assert "structure.construction-completed" in event_types


def test_frontier_purchase_cost_and_placement_rules_prevent_islands():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "frontier"});
        const before = game.snapshot();
        const target = before.footprint.frontier[0];
        const purchase = game.command({type: "purchase-frontier", cellKey: target.key});
        const after = game.snapshot();
        const rejectedBefore = game.snapshot();
        const rejected = game.command({type: "purchase-frontier", cellKey: "F1:0,0"});
        const rejectedAfter = game.snapshot();
        const unownedPlacement = game.actions.place("generator", 0, 0);
        console.log(JSON.stringify({
          beforeCash: before.economy.cash,
          afterCash: after.economy.cash,
          target,
          purchase,
          owned: after.footprint.owned,
          rejected,
          unchangedCash: rejectedBefore.economy.cash === rejectedAfter.economy.cash,
          unchangedOwned: JSON.stringify(rejectedBefore.footprint.owned)
            === JSON.stringify(rejectedAfter.footprint.owned),
          unownedPlacement,
        }));
        """
    )

    assert result["purchase"]["ok"] is True
    assert result["beforeCash"] - result["afterCash"] == result["target"]["cost"]
    assert result["target"]["key"] in {cell["key"] for cell in result["owned"]}
    _assert_connected_footprint(result["owned"])
    assert result["rejected"] == {"ok": False, "reason": "not-frontier"}
    assert result["unchangedCash"] is True
    assert result["unchangedOwned"] is True
    assert result["unownedPlacement"]["ok"] is False
    assert result["unownedPlacement"]["reason"] == "unowned-cell"


def test_disconnected_infrastructure_delivers_zero_and_keeps_computer_off():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "disconnected"});
        const snapshots = game.runScenario("computer-path-disconnected").snapshots;
        console.log(JSON.stringify({snapshots, final: game.snapshot()}));
        """
    )

    final = result["final"]
    assert result["snapshots"][-1] == final
    assert final["computers"][0]["state"] == "off"
    assert final["computers"][0]["rawFlops"] == 0
    assert final["computers"][0]["powerDelivered"] == 0
    assert final["computers"][0]["coolingDelivered"] == 0
    assert final["computers"][0]["dataConnected"] is False
    assert final["flops"]["raw"] == 0
    for network in final["networks"].values():
        for path in network["paths"]:
            assert path["connected"] is False
            assert path["delivered"] == 0
    computer_actor = next(actor for actor in final["actors"] if actor["kind"] == "computer")
    assert computer_actor["state"] == "off"
    assert (computer_actor["x"], computer_actor["y"]) == (7, 4)
    assert any(structure["kind"] == "computer" for structure in final["structures"])


def test_connected_paths_expose_off_booting_loaded_and_semantic_events():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "connected"});
        const events = [];
        game.subscribe((event) => events.push(event));
        const scenario = game.runScenario("computer-path-connected");
        console.log(JSON.stringify({scenario, events, final: game.snapshot()}));
        """
    )

    states = [snapshot["computers"][0]["state"] for snapshot in result["scenario"]["snapshots"]]
    assert states[0] == "off"
    assert "booting" in states
    assert states[-1] == "loaded"
    final = result["final"]
    assert result["scenario"]["snapshots"][-1] == final
    computer = final["computers"][0]
    assert computer["powerDelivered"] > 0
    assert computer["coolingDelivered"] > 0
    assert computer["dataConnected"] is True
    assert computer["rawFlops"] > 0
    assert final["flops"]["raw"] > 0
    assert any(path["connected"] and path["delivered"] > 0
               for path in final["networks"]["power"]["paths"]
               if path["target"] == computer["id"])
    assert any(path["connected"] and path["delivered"] > 0
               for path in final["networks"]["cooling"]["paths"])
    assert any(path["purpose"] == "internal" and path["connected"]
               for path in final["networks"]["data"]["paths"])
    event_types = [event["type"] for event in result["events"]]
    assert "computer.boot-started" in event_types
    assert "computer.loaded" in event_types
    assert all(isinstance(event["tick"], int) for event in result["events"])
    assert final["ticks"]["raw"] == final["ticks"]["completed"]


def test_raw_flops_sales_require_a_connected_floor_one_fiber_path():
    result = _run_core(
        """
        const blockedGame = createOverhaulGame({seed: "fiber-gate"});
        const blockedHistory = blockedGame.runScenario("sell-without-f1-fiber").snapshots;
        const blocked = blockedHistory.at(-1);
        const sellingGame = createOverhaulGame({seed: "fiber-gate"});
        const sellingHistory = sellingGame.runScenario("sell-with-f1-fiber").snapshots;
        const selling = sellingHistory.at(-1);
        console.log(JSON.stringify({blockedHistory, blocked, sellingHistory, selling}));
        """
    )

    blocked = result["blocked"]
    assert blocked["sell"]["requested"] is True
    assert blocked["sell"]["requestedFlops"] > 0
    assert blocked["sell"]["blocked"] is True
    assert blocked["sell"]["reason"] == "missing-f1-fiber"
    assert blocked["sell"]["fiberFloor"] is None
    assert blocked["sell"]["routedFlops"] == 0
    assert blocked["flops"]["sell"] == 0
    assert blocked["progress"]["rawFlopsSold"] == 0
    assert blocked["economy"]["cash"] == result["blockedHistory"][0]["economy"]["cash"]

    selling = result["selling"]
    assert selling["sell"]["requested"] is True
    assert selling["sell"]["blocked"] is False
    assert selling["sell"]["reason"] is None
    assert selling["sell"]["fiberFloor"] == 1
    assert selling["sell"]["routedFlops"] > 0
    assert selling["flops"]["sell"] == selling["sell"]["routedFlops"]
    assert selling["progress"]["rawFlopsSold"] > 0
    assert selling["economy"]["cash"] > result["sellingHistory"][0]["economy"]["cash"]


def test_flops_routes_are_nonnegative_and_exactly_conserved():
    final = _run_core(
        """
        const game = createOverhaulGame({seed: "conservation"});
        game.runScenario("flops-routing");
        console.log(JSON.stringify(game.snapshot()));
        """
    )

    flops = final["flops"]
    buckets = ("sell", "training", "jobs", "reserved", "idle", "loss")
    assert all(flops[bucket] >= 0 for bucket in buckets)
    assert flops["raw"] > 0
    assert flops["raw"] == sum(flops[bucket] for bucket in buckets)
    assert flops["sell"] <= flops["raw"]
    assert flops["reserved"] == final["routeBuckets"]["research"]
    assert flops["jobs"] == final["routeBuckets"]["inference"]
    assert flops["training"] == final["routeBuckets"]["train"]
    assert final["sell"]["routedFlops"] == flops["sell"]


def test_snapshot_roundtrip_and_future_event_trace_are_deterministic():
    result = _run_core(
        """
        const original = createOverhaulGame({seed: "roundtrip"});
        original.runScenario("flops-routing");
        const saved = original.snapshot();
        const restored = createOverhaulGame({snapshot: saved});
        const restoredImmediately = restored.snapshot();
        const originalEvents = [], restoredEvents = [];
        original.subscribe((event) => originalEvents.push(event));
        restored.subscribe((event) => restoredEvents.push(event));
        original.tick(8);
        restored.tick(8);
        console.log(JSON.stringify({
          immediateEqual: JSON.stringify(saved) === JSON.stringify(restoredImmediately),
          futureEqual: JSON.stringify(original.snapshot()) === JSON.stringify(restored.snapshot()),
          eventsEqual: JSON.stringify(originalEvents) === JSON.stringify(restoredEvents),
          originalEvents,
        }));
        """
    )

    assert result["immediateEqual"] is True
    assert result["futureEqual"] is True
    assert result["eventsEqual"] is True
    assert result["originalEvents"]
    assert all(event["tick"] >= 1 for event in result["originalEvents"])


def test_burst_computer_thermal_states_are_real_deterministic_transitions():
    result = _run_core(
        """
        let game = null;
        for (let seed = 0; seed < 100; seed++) {
          const candidate = createOverhaulGame({seed: `thermal-${seed}`});
          if (candidate.snapshot().starterKitId === "burst-start") {
            game = candidate;
            break;
          }
        }
        if (!game) throw new Error("no burst seed found");
        const events = [];
        game.subscribe((event) => events.push(event));
        const scenario = game.runScenario("computer-overload");
        const states = scenario.snapshots.flatMap((snapshot) =>
          snapshot.computers.map((computer) => computer.state));
        console.log(JSON.stringify({states, events, final: game.snapshot()}));
        """
    )

    assert "throttled" in result["states"]
    assert "blocked" in result["states"]
    event_types = [event["type"] for event in result["events"]]
    assert "computer.throttle-started" in event_types
    assert "computer.fault-raised" in event_types
    assert all(
        computer["state"] in {"off", "booting", "loaded", "working", "throttled", "blocked"}
        for computer in result["final"]["computers"]
    )


def test_text_business_loop_has_causal_events_cash_timing_and_real_actor_states():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "text-business"});
        const scenario = game.runScenario("text-business-loop");
        const final = game.snapshot();
        const robotStates = [...new Set(scenario.snapshots.map((snapshot) =>
          snapshot.actors.find((actor) => actor.kind === "robot").state))];
        const hiredHumanId = scenario.events.find((event) => event.type === "human-hired").entityId;
        const humanStates = [...new Set(scenario.snapshots.flatMap((snapshot) =>
          snapshot.actors.filter((actor) => actor.id === hiredHumanId).map((actor) => actor.state)))];
        console.log(JSON.stringify({
          scenario,
          final,
          robotStates,
          humanStates,
          hireCost: OVERHAUL_BALANCE.business.humanHireCost,
          lastMatches: JSON.stringify(scenario.snapshots.at(-1)) === JSON.stringify(final),
        }));
        """
    )

    events = result["scenario"]["events"]
    assert [event["type"] for event in events] == [
        "text-trained",
        "harness-built",
        "agent-created",
        "job-completed",
        "invoice-issued",
        "cash-received",
        "human-hired",
    ]
    text, harness, agent, job, invoice, cash, hire = events
    assert harness["textId"] == text["entityId"]
    assert agent["harnessId"] == harness["entityId"]
    assert job["agentId"] == agent["entityId"]
    assert invoice["jobId"] == job["entityId"]
    assert cash["invoiceId"] == invoice["entityId"]
    assert invoice["amount"] > 0
    assert cash["amount"] == invoice["amount"]
    assert cash["cashAfter"] - cash["cashBefore"] == cash["amount"]
    assert cash["cashBefore"] < result["hireCost"] <= cash["cashAfter"]
    assert hire["humansAfter"] == hire["humansBefore"] + 1
    assert hire["payrollAfter"] > hire["payrollBefore"]
    assert result["final"]["economy"]["cash"] == cash["cashAfter"] - result["hireCost"]
    assert result["final"]["economy"]["humansHired"] == hire["humansAfter"]
    assert result["final"]["economy"]["payroll"] == hire["payrollAfter"]
    assert "building" in result["robotStates"]
    assert result["final"]["actors"][1]["state"] == "idle"
    assert result["humanStates"] == ["hired", "training", "working"]
    assert result["lastMatches"] is True
    assert [event["tick"] for event in events] == sorted(event["tick"] for event in events)


def test_ai_is_an_explicit_fourth_network_with_opt_in_and_migration_defaults():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "ai-schema"});
        const final = game.runScenario("ai-opted-out-manual").snapshots.at(-1);
        const physical = final.networks.ai.paths.filter((path) => path.connected);
        const targets = final.structures.filter((item) =>
          Object.values(item.baseMetrics).some((value) => value > 0));
        const legacy = structuredClone(final.persistence);
        delete legacy.ai;
        delete legacy.networks.ai;
        for (const row of legacy.floor.cells) for (const cell of row) {
          delete cell.layers.ai;
          for (const structure of Object.values(cell.layers).filter(Boolean)) {
            delete structure.aiEnabled;
            delete structure.aiConnected;
            delete structure.aiFault;
          }
        }
        const migrated = createOverhaulGame({snapshot: legacy}).snapshot();
        console.log(JSON.stringify({
          cadence: OVERHAUL_BALANCE.ai.faultCheckIntervalTicks,
          controller: final.structures.find((item) => item.blueprintId === "ai_controller"),
          buses: final.structures.filter((item) => item.blueprintId === "ai_bus"),
          physical,
          targets,
          ai: final.ai,
          migratedAi: migrated.ai,
          migratedPaths: migrated.networks.ai.paths,
          migratedLayerKeys: migrated.persistence.floor.cells.flat()
            .every((cell) => Object.hasOwn(cell.layers, "ai")),
          migratedStructures: migrated.structures,
        }));
        """
    )

    assert result["cadence"] == 20
    assert result["controller"]["kind"] == "ai-source"
    assert result["buses"] and all(
        item["kind"] == "ai-link" and item["layer"] == "ai"
        for item in result["buses"]
    )
    assert result["physical"]
    assert all(path["enabled"] is False and path["delivered"] == 0
               and path["status"] == "disabled" and len(path["cells"]) >= 2
               for path in result["physical"])
    assert all(item["aiEnabled"] is False and item["aiConnected"] is False
               and item["aiEfficiencyMultiplier"] == 1
               and item["baseMetrics"] == item["effectiveMetrics"]
               for item in result["targets"])
    assert result["ai"]["enabledCount"] == result["ai"]["connectedCount"] == 0
    assert result["ai"]["activeFaults"] == []
    assert result["migratedLayerKeys"] is True
    assert result["migratedPaths"] == []
    assert result["migratedAi"]["level"] == 0
    assert result["migratedAi"]["faultCheckIntervalTicks"] == 20
    assert all(item["aiEnabled"] is False and item["aiConnected"] is False
               and item["aiFault"] is None for item in result["migratedStructures"])


def test_ai_effective_resources_training_seeded_fault_and_robot_repair_are_truthful():
    result = _run_core(
        """
        const baseline = createOverhaulGame({seed: "ai-seeded-fault-contract"})
          .runScenario("ai-opted-out-manual").snapshots.at(-1);
        const game = createOverhaulGame({seed: "ai-seeded-fault-contract"});
        const events = [];
        game.subscribe((event) => events.push(event));
        const history = game.runScenario("ai-risk-reward").snapshots;
        const faultIndex = history.findIndex((snapshot) => snapshot.ai.activeFaults.length);
        const faulted = history[faultIndex];
        const fault = faulted.ai.activeFaults[0];
        const firstHealthy = history.find((snapshot) => snapshot.ai.connectedCount >= 4
          && !snapshot.ai.activeFaults.length && snapshot.flops.raw > 0);
        const final = history.at(-1);
        const capacity = (snapshot, resource) => snapshot.networks[resource].paths
          .filter((path) => path.connected).reduce((sum, path) => sum + path.capacity, 0);
        const ids = ["generator", "power_line", "cooling_pump", "cooling_pipe",
          "data_switch", final.persistence.computerBlueprintId, "fiber_gateway"];
        const gains = Object.fromEntries(ids.map((blueprintId) => {
          const item = firstHealthy.structures.find((structure) =>
            structure.blueprintId === blueprintId && structure.aiConnected);
          return [blueprintId, item && Object.keys(item.baseMetrics).some((key) =>
            item.effectiveMetrics[key] > item.baseMetrics[key])];
        }));
        const repairCounts = history.flatMap((snapshot) => snapshot.ai.activeFaults
          .filter((item) => item.faultId === fault.faultId)
          .map((item) => item.repairRemaining));
        const recovered = history.slice(faultIndex + 1).find((snapshot) =>
          !snapshot.ai.activeFaults.some((item) => item.faultId === fault.faultId));
        const conserved = history.every((snapshot) => {
          const f = snapshot.flops;
          return Math.abs(f.raw - (f.sell + f.training + f.jobs + f.reserved
            + f.idle + f.loss)) < 1e-6;
        });
        console.log(JSON.stringify({
          baselineRaw: baseline.flops.raw,
          connectedRaw: firstHealthy.flops.raw,
          baselineCapacities: Object.fromEntries(["power", "cooling", "data"]
            .map((key) => [key, capacity(baseline, key)])),
          connectedCapacities: Object.fromEntries(["power", "cooling", "data"]
            .map((key) => [key, capacity(firstHealthy, key)])),
          gains,
          beforeAi: firstHealthy.ai,
          finalAi: final.ai,
          fault,
          faultTarget: faulted.structures.find((item) => item.id === fault.entityId),
          repairCounts,
          recoveredTarget: recovered.structures.find((item) => item.id === fault.entityId),
          robotStates: [...new Set(history.map((snapshot) =>
            snapshot.actors.find((actor) => actor.kind === "robot").state))],
          finalRobotState: final.actors.find((actor) => actor.kind === "robot").state,
          eventTypes: events.map((event) => event.type),
          conserved,
        }));
        """
    )

    assert result["connectedRaw"] > result["baselineRaw"] > 0
    for resource in ("power", "cooling", "data"):
        assert result["connectedCapacities"][resource] > result["baselineCapacities"][resource]
    assert all(result["gains"].values())
    assert result["fault"]["kind"] == "ai-mistake"
    assert 0 < result["fault"]["raisedTick"] <= 24
    assert result["faultTarget"]["aiEnabled"] is True
    assert result["faultTarget"]["aiConnected"] is True
    assert result["faultTarget"]["aiFault"] == result["fault"]["faultId"]
    assert result["repairCounts"][0] > result["repairCounts"][-1]
    assert result["recoveredTarget"]["aiFault"] is None
    assert result["recoveredTarget"]["aiConnected"] is True
    assert "repairing" in result["robotStates"] and result["finalRobotState"] == "idle"
    assert "ai.fault-raised" in result["eventTypes"]
    assert "ai.repair-progressed" in result["eventTypes"]
    assert "ai.fault-cleared" in result["eventTypes"]
    assert result["finalAi"]["level"] > result["beforeAi"]["level"]
    assert result["finalAi"]["bonusPercent"] > result["beforeAi"]["bonusPercent"]
    assert result["finalAi"]["mistakeChance"] < result["beforeAi"]["mistakeChance"]
    assert result["conserved"] is True


def test_ai_fault_snapshot_roundtrip_and_continuation_are_deterministic():
    result = _run_core(
        """
        const history = createOverhaulGame({seed: "ai-seeded-fault-contract"})
          .runScenario("ai-risk-reward").snapshots;
        const checkpoint = history.find((snapshot) => snapshot.ai.activeFaults.length);
        const first = createOverhaulGame({snapshot: checkpoint});
        const second = createOverhaulGame({snapshot: checkpoint});
        const immediateFirst = first.snapshot();
        const immediateSecond = second.snapshot();
        const firstEvents = [], secondEvents = [];
        first.subscribe((event) => firstEvents.push(event));
        second.subscribe((event) => secondEvents.push(event));
        first.tick(8);
        second.tick(8);
        console.log(JSON.stringify({
          immediateEqual: JSON.stringify(checkpoint) === JSON.stringify(immediateFirst)
            && JSON.stringify(immediateFirst) === JSON.stringify(immediateSecond),
          futureEqual: JSON.stringify(first.snapshot()) === JSON.stringify(second.snapshot()),
          eventsEqual: JSON.stringify(firstEvents) === JSON.stringify(secondEvents),
          hadFault: checkpoint.ai.activeFaults.length > 0,
          repaired: first.snapshot().ai.activeFaults.length === 0,
        }));
        """
    )

    assert result == {
        "immediateEqual": True,
        "futureEqual": True,
        "eventsEqual": True,
        "hadFault": True,
        "repaired": True,
    }


def test_network_telemetry_is_authoritative_shared_and_numerically_consistent():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "network-telemetry"});
        game.runScenario("sell-with-f1-fiber");
        const final = game.snapshot();
        const summaries = Object.fromEntries(Object.entries(final.networks).map(([layer, network]) => {
          const paths = network.paths;
          const telemetry = network.telemetry;
          const directionalDelivered = layer === "data"
            ? Math.max(...["internal", "external"].map((purpose) => paths
              .filter((path) => path.purpose === purpose)
              .reduce((sum, path) => sum + path.delivered, 0)))
            : paths.reduce((sum, path) => sum + path.delivered, 0);
          return [layer, {
            telemetry,
            directionalDelivered,
            ratedPathCapacity: paths.reduce((sum, path) => sum + path.capacity, 0),
            paths,
          }];
        }));
        console.log(JSON.stringify({summaries, utilities: final.utilities}));
        """
    )

    for layer, summary in result["summaries"].items():
        telemetry = summary["telemetry"]
        assert telemetry["capacity"] >= telemetry["delivered"] >= 0
        assert telemetry["headroom"] == telemetry["capacity"] - telemetry["delivered"]
        expected = telemetry["delivered"] / telemetry["capacity"] if telemetry["capacity"] else 0
        assert abs(telemetry["utilization"] - expected) < 1e-9
        assert telemetry["utilizationPercent"] == telemetry["utilization"] * 100
        assert telemetry["statusText"]
        assert telemetry["segments"] == result["utilities"]["byLayer"][layer]["segments"]
        assert telemetry["maintenancePerTick"] == result["utilities"]["byLayer"][layer][
            "maintenanceFlopsPerTick"
        ]
        for path in summary["paths"]:
            assert path["headroom"] >= 0
            assert 0 <= path["utilization"] <= 1
            assert path["utilizationPercent"] == path["utilization"] * 100
            assert path["statusText"]
            assert path["firstBottleneck"]["reason"]
            assert isinstance(path["cells"], list)
            assert path["redundancy"]["alternatePathCount"] >= 0
    assert result["summaries"]["power"]["ratedPathCapacity"] > result["summaries"]["power"][
        "telemetry"
    ]["capacity"]
    assert result["summaries"]["power"]["telemetry"]["delivered"] == result["summaries"][
        "power"
    ]["directionalDelivered"]
    assert result["summaries"]["data"]["telemetry"]["delivered"] == result["summaries"][
        "data"
    ]["directionalDelivered"]


def test_placement_preview_is_pure_and_topology_activates_only_after_commissioning():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "placement-preview"});
        game.runScenario("computer-path-connected");
        game.actions.place("generator", 8, 7);
        while (game.snapshot().construction.jobs.length) game.tick();
        const before = game.snapshot();
        const preview = game.actions.previewPlacement("power_line", 8, 7);
        const afterPreview = game.snapshot();
        const placed = game.actions.place("power_line", 8, 7);
        const afterPlace = game.snapshot();
        while (game.snapshot().construction.jobs.length) game.tick();
        const afterCommission = game.snapshot();
        const removed = game.actions.remove(8, 7, "power");
        const afterRemove = game.snapshot();
        console.log(JSON.stringify({
          pure: JSON.stringify(before) === JSON.stringify(afterPreview),
          preview,
          placed,
          removed,
          capacityAfterPlace: afterPlace.networks.power.telemetry.capacity,
          capacityAfterCommission: afterCommission.networks.power.telemetry.capacity,
          capacityAfterRemove: afterRemove.networks.power.telemetry.capacity,
          burdenAfterPlace: afterPlace.utilities.requiredFlopsPerTick,
          burdenAfterCommission: afterCommission.utilities.requiredFlopsPerTick,
          burdenAfterRemove: afterRemove.utilities.requiredFlopsPerTick,
        }));
        """
    )

    assert result["pure"] is True
    assert result["preview"]["ok"] is True
    assert result["preview"]["preview"] is True
    assert result["preview"]["networkRole"] == "branch"
    assert result["preview"]["recurringBurdenFlops"] > 0
    power_delta = result["preview"]["networkDeltas"]["power"]
    assert power_delta["capacityDelta"] == 16
    assert abs(
        power_delta["maintenanceDelta"] - result["preview"]["recurringBurdenFlops"]
    ) < 1e-9
    assert result["placed"]["ok"] is result["removed"]["ok"] is True
    assert result["placed"]["operational"] is False
    assert result["capacityAfterPlace"] == power_delta["before"]["capacity"]
    assert result["capacityAfterCommission"] == power_delta["after"]["capacity"]
    assert result["capacityAfterRemove"] == power_delta["before"]["capacity"]
    assert result["capacityAfterCommission"] - result["capacityAfterRemove"] == 16
    assert result["burdenAfterPlace"] == result["burdenAfterRemove"]
    assert result["burdenAfterCommission"] > result["burdenAfterRemove"]


def test_power_trunk_raises_the_connected_grid_above_the_16_mw_branch_rating():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "power-trunk-regression"});
        game.runScenario("computer-path-connected");
        game.actions.remove(3, 4, "power");
        game.actions.place("power_line", 3, 4);
        while (game.snapshot().construction.jobs.length) game.tick();
        const before = game.snapshot();
        const preview = game.actions.previewPlacement("power_pole", 5, 5);
        const placed = game.actions.place("power_pole", 5, 5);
        while (game.snapshot().construction.jobs.length) game.tick();
        const after = game.snapshot();
        console.log(JSON.stringify({
          preview,
          placed,
          before: before.networks.power.telemetry,
          after: after.networks.power.telemetry,
        }));
        """
    )

    assert result["placed"]["ok"] is True
    assert result["before"]["capacity"] == 16
    assert result["preview"]["networkRole"] == "trunk"
    assert result["preview"]["networkDeltas"]["power"]["capacityDelta"] == 8
    assert result["after"]["capacity"] == 24
    assert result["after"]["capacity"] > result["before"]["capacity"]


def test_checkpoint_one_requires_a_real_compute_retrofit_and_increases_output():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "compute-retrofit-checkpoint"});
        game.runScenario("computer-path-connected");
        const before = game.snapshot();
        const target = before.structures.find(item => item.kind === "computer");
        const queued = game.command({type: "upgrade-compute", entityId: target.id});
        const during = game.snapshot();
        while (game.snapshot().construction.jobs.length) game.tick();
        for (let step = 0; step < 4; step++) game.tick();
        const after = game.snapshot();
        const upgraded = after.structures.find(item => item.id === target.id);
        const computer = after.computers.find(item => item.id === target.id);
        console.log(JSON.stringify({
          queued,
          beforeCash: before.economy.cash,
          afterCash: after.economy.cash,
          beforeOutput: before.computers.find(item => item.id === target.id).rawFlops,
          duringCondition: during.structures.find(item => item.id === target.id).condition,
          duringJob: during.construction.jobs.find(item => item.entityId === target.id),
          upgraded,
          computer,
          beforeOpening: before.opening,
          afterOpening: after.opening,
        }));
        """
    )

    assert result["beforeOpening"]["current"]["id"] == "recover-and-retrofit"
    assert result["beforeOpening"]["current"]["current"] == 1
    assert result["queued"]["ok"] is True
    assert result["duringCondition"] == 0
    assert result["duringJob"]["kind"] == "compute-upgrade"
    assert result["afterCash"] == result["beforeCash"] - 180
    assert result["upgraded"]["computeUpgradeLevel"] == 1
    assert result["upgraded"]["outputMultiplier"] == 1.5
    assert result["computer"]["upgradeLevel"] == 1
    assert result["computer"]["rawFlops"] > result["beforeOutput"]
    assert result["afterOpening"]["completed"] == 1
    assert result["afterOpening"]["current"]["id"] == "expand-utilities"


def test_early_compute_research_counts_after_utility_expansion_without_deadlock():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "early-compute-research-order"});
        game.runScenario("computer-path-connected");
        const target = game.snapshot().structures.find(item => item.kind === "computer");
        game.command({type: "upgrade-compute", entityId: target.id});
        while (game.snapshot().construction.jobs.length) game.tick();
        while (game.snapshot().flops.raw <= 0) game.tick();
        game.command({type: "set-routes", routes: {
          sell: 0, research: 1, train: 0, inference: 0,
        }});
        while (!game.snapshot().research.completedIds.includes("rack-standard")) game.tick();
        const beforeUtilities = game.snapshot();

        game.actions.place("generator", 4, 4);
        while (game.snapshot().construction.jobs.length) game.tick();
        game.actions.place("power_line", 5, 5);
        while (game.snapshot().construction.jobs.length) game.tick();
        game.actions.place("cooling_pump", 5, 5);
        while (game.snapshot().construction.jobs.length) game.tick();
        const afterUtilities = game.snapshot();
        console.log(JSON.stringify({beforeUtilities, afterUtilities}));
        """
    )

    assert "rack-standard" in result["beforeUtilities"]["research"]["completedIds"]
    assert result["beforeUtilities"]["opening"]["completed"] == 1
    assert result["beforeUtilities"]["opening"]["current"]["id"] == "expand-utilities"
    assert result["afterUtilities"]["networks"]["power"]["telemetry"]["capacity"] > 24
    assert result["afterUtilities"]["networks"]["cooling"]["telemetry"]["capacity"] > 12
    assert result["afterUtilities"]["opening"]["completed"] == 3
    assert result["afterUtilities"]["opening"]["current"]["id"] == "expand-first-floor"


def test_cooling_preview_distinguishes_live_reach_from_supply_and_isolated_pipe():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "cooling-expansion-preview"});
        game.runScenario("computer-path-connected");
        const before = game.snapshot();
        game.command({type: "purchase-frontier", cellKey: "F1:7,3"});
        game.command({type: "purchase-frontier", cellKey: "F1:3,3"});
        const claimed = game.snapshot();
        const connected = game.actions.previewPlacement("cooling_pipe", 7, 3);
        const isolated = game.actions.previewPlacement("cooling_pipe", 3, 3);
        const after = game.snapshot();
        console.log(JSON.stringify({
          connected,
          isolated,
          previewPure: JSON.stringify(claimed) === JSON.stringify(after),
          ownedDelta: claimed.footprint.owned.length - before.footprint.owned.length,
        }));
        """
    )

    assert result["previewPure"] is True
    assert result["ownedDelta"] == 2
    connected = result["connected"]
    assert connected["ok"] is True
    assert connected["networkDeltas"]["cooling"]["capacityDelta"] == 0
    assert connected["networkExtension"] == {
        "layer": "cooling",
        "connectedNeighbors": 1,
        "reachableCells": 7,
        "connectedToNetwork": True,
        "connectedToSource": True,
        "live": True,
        "isolated": False,
        "routeCapacity": 24,
        "supplyCapacity": 12,
    }
    isolated = result["isolated"]["networkExtension"]
    assert isolated["connectedNeighbors"] == 0
    assert isolated["reachableCells"] == 1
    assert isolated["connectedToNetwork"] is False
    assert isolated["connectedToSource"] is False
    assert isolated["live"] is False
    assert isolated["isolated"] is True
    assert isolated["supplyCapacity"] == 12


def test_sparse_loop_and_carpet_shapes_have_visible_cost_and_real_redundancy_tradeoffs():
    result = _run_core(
        """
        const sparse = createOverhaulGame({seed: "network-shapes"});
        sparse.runScenario("computer-path-connected");
        sparse.tick();
        const sparseSnapshot = sparse.snapshot();

        const carpet = createOverhaulGame({seed: "network-shapes"});
        carpet.runScenario("computer-path-connected");
        const occupied = new Set(carpet.snapshot().structures
          .filter((item) => item.layer === "power").map((item) => `${item.x},${item.y}`));
        for (const cell of carpet.snapshot().footprint.owned) {
          if (!occupied.has(`${cell.x},${cell.y}`)) carpet.actions.place("power_line", cell.x, cell.y);
        }
        let carpetGuard = 0;
        while (carpet.snapshot().construction.jobs.length) {
          carpet.tick();
          if (++carpetGuard > 500) throw new Error("carpet construction did not finish");
        }
        carpet.tick();
        const carpetSnapshot = carpet.snapshot();

        const loop = createOverhaulGame({seed: "network-shapes"});
        loop.runScenario("computer-path-connected");
        const beforeLoop = loop.snapshot();
        for (const [x, y] of [[5, 6], [5, 5], [6, 5], [7, 5]]) {
          loop.actions.place("data_cable", x, y);
        }
        let loopGuard = 0;
        while (loop.snapshot().construction.jobs.length) {
          loop.tick();
          if (++loopGuard > 100) throw new Error("loop construction did not finish");
        }
        const withLoop = loop.snapshot();
        loop.actions.remove(4, 5, "data");
        const afterSingleLinkLoss = loop.snapshot();
        const internal = (snapshot) => snapshot.networks.data.paths
          .find((path) => path.purpose === "internal");
        console.log(JSON.stringify({
          sparse: sparseSnapshot.utilities,
          sparseLoss: sparseSnapshot.flops.loss,
          carpet: carpetSnapshot.utilities,
          carpetLoss: carpetSnapshot.flops.loss,
          beforeLoop: internal(beforeLoop),
          withLoop: internal(withLoop),
          afterSingleLinkLoss: internal(afterSingleLinkLoss),
          beforeLoopBurden: beforeLoop.utilities.requiredFlopsPerTick,
          loopBurden: withLoop.utilities.requiredFlopsPerTick,
        }));
        """
    )

    assert result["carpet"]["segments"] > result["sparse"]["segments"]
    assert result["carpet"]["requiredFlopsPerTick"] > result["sparse"]["requiredFlopsPerTick"]
    assert result["carpetLoss"] > result["sparseLoss"]
    assert result["beforeLoop"]["redundancy"]["singleLinkFaultTolerant"] is False
    assert result["withLoop"]["redundancy"]["singleLinkFaultTolerant"] is True
    assert result["withLoop"]["redundancy"]["reliabilityPercent"] > result["beforeLoop"][
        "redundancy"
    ]["reliabilityPercent"]
    assert result["loopBurden"] > result["beforeLoopBurden"]
    assert result["afterSingleLinkLoss"]["connected"] is True


def test_ten_turn_campaign_requires_the_real_recovery_business_and_ai_loops():
    result = _run_core(
        """
        const game = createOverhaulGame({seed: "ten-turn-story"});
        const events = [];
        game.subscribe((event) => events.push(event));
        const initial = game.snapshot();
        const campaign = game.runScenario("story-campaign");
        const final = game.snapshot();
        const restored = createOverhaulGame({snapshot: final.persistence}).snapshot();
        const seenTurns = [...new Set(campaign.snapshots
          .map((item) => item.story.current?.number).filter(Boolean))];
        console.log(JSON.stringify({
          initial: initial.story,
          final: final.story,
          restored: restored.story,
          seenTurns,
          completionEvents: events.filter((event) => event.type === "story.turn-completed"),
          mechanics: {
            claimed: final.footprint.owned.length - initial.footprint.owned.length,
            builds: final.construction.completed,
            sold: final.progress.rawFlopsSold,
            models: final.business.textModels.length,
            harnesses: final.business.harnesses.length,
            agents: final.business.agents.length,
            completedJobs: final.business.jobs.filter((item) => item.status === "completed").length,
            invoicesPaid: final.economy.invoicesPaid,
            workingHumans: final.actors.filter((item) => item.kind === "human"
              && item.role === "text-operator" && item.state === "working").length,
            aiConnected: final.structures.filter((item) => item.aiConnected).length,
            machineAssistance: final.research.completedIds.includes("machine-assistance"),
          },
        }));
        """
    )

    assert result["initial"]["current"]["number"] == 1
    assert result["initial"]["completed"] == 0
    assert result["seenTurns"] == list(range(1, 11))
    assert result["final"]["state"] == "complete"
    assert result["final"]["completed"] == result["final"]["total"] == 10
    assert result["final"]["current"] is None
    assert len(result["final"]["turns"]) == 10
    assert all(turn["state"] == "complete" for turn in result["final"]["turns"])
    assert result["final"]["lastBeat"]["id"] == "shared-control"
    assert "WHO OWNS THE NEXT FLOOR" in result["final"]["lastBeat"]["copy"]
    assert result["restored"] == result["final"]

    completion_events = result["completionEvents"]
    assert [event["number"] for event in completion_events] == list(range(1, 11))
    assert [event["completed"] for event in completion_events] == list(range(1, 11))
    assert completion_events[-1]["nextTurnId"] is None

    mechanics = result["mechanics"]
    assert mechanics["claimed"] >= 1
    assert mechanics["builds"] >= 1
    assert mechanics["sold"] > 0
    assert mechanics["models"] >= 1
    assert mechanics["harnesses"] >= 1
    assert mechanics["agents"] >= 1
    assert mechanics["completedJobs"] >= 1
    assert mechanics["invoicesPaid"] >= 1
    assert mechanics["workingHumans"] >= 1
    assert mechanics["aiConnected"] >= 1
    assert mechanics["machineAssistance"] is True
