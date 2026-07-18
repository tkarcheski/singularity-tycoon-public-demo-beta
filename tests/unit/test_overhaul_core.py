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
        const required = ["floor", "power-source", "power-link", "cooling-source",
          "cooling-link", "computer", "data-link", "ai-source", "ai-link"];
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
            loaded: final.computers.some((computer) =>
              computer.state === "loaded" && computer.rawFlops > 0),
          });
        }
        console.log(JSON.stringify({
          same: JSON.stringify(first.unlocks) === JSON.stringify(repeat.unlocks)
            && JSON.stringify(first.footprint) === JSON.stringify(repeat.footprint),
          geometry: [first.persistence.floor.width, first.persistence.floor.height],
          owned: first.footprint.owned,
          frontier: first.footprint.frontier,
          starts,
          required,
        }));
        """
    )

    assert result["same"] is True
    assert result["geometry"] == [12, 8]
    _assert_connected_footprint(result["owned"])
    assert len({start["kit"] for start in result["starts"]}) > 1
    for start in result["starts"]:
        assert set(result["required"]).issubset(start["kinds"])
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
        game.runScenario("computer-path-connected");
        game.actions.setRoutes({sell: 0, research: 0, train: 0, inference: 1});
        const states = [];
        for (let index = 0; index < 100; index++) {
          game.tick();
          states.push(game.snapshot().computers[0].state);
        }
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
