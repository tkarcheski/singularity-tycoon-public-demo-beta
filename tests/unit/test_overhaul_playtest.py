"""Executable contract for the first coherent ``overhaul.html`` playtest.

The assertions use a narrow acceptance bridge and semantic DOM attributes.
They intentionally avoid private model mutation, canvas coordinates, tile
names, and presentation-specific copy.
"""

from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

import pytest


ROOT = Path(__file__).resolve().parents[2]
OVERHAUL = ROOT / "overhaul.html"
RUN_SOAK = os.environ.get("RUN_OVERHAUL_SOAK") == "1"
SOAK_SECONDS = int(os.environ.get("OVERHAUL_SOAK_SECONDS", "30"))
VIEWPORTS = (
    pytest.param({"width": 1440, "height": 900}, id="desktop-1440x900"),
    pytest.param({"width": 1100, "height": 700}, id="electron-min-1100x700"),
)
REQUIRED_UNLOCK_KINDS = {
    "floor",
    "power-link",
    "cooling-link",
    "data-link",
}
REQUIRED_INHERITED_KINDS = {"power-source", "cooling-source", "computer", "data-link"}
ACTOR_STATES = {
    "human": {"idle", "moving", "working", "training", "hired", "blocked"},
    "robot": {"idle", "moving", "building", "repairing", "charging", "blocked"},
    "computer": {"off", "booting", "loaded", "working", "throttled", "blocked"},
}
AI_RESOURCE_KINDS = {
    "power": "power-source",
    "cooling": "cooling-source",
    "data": "data-link",
    "compute": "computer",
}

# While the new entrypoint does not exist, executing this file produces a
# precise expected-red inventory instead of accidentally booting index.html.
pytestmark = pytest.mark.xfail(
    not OVERHAUL.exists(),
    reason="overhaul.html has not been implemented",
    strict=True,
)


def _url(base_url, seed="overhaul-first-playtest"):
    return f"{base_url}?seed={seed}"


@pytest.fixture(scope="session")
def overhaul_base_url():
    """Serve ES modules over HTTP so tests cannot fall back to the view mock."""
    with _live_server() as url:
        yield url


@pytest.fixture
def overhaul(page, errors, overhaul_base_url):
    assert OVERHAUL.exists(), f"missing overhaul entrypoint: {OVERHAUL}"
    page.goto(_url(overhaul_base_url))
    page.evaluate("localStorage.clear()")
    page.goto(_url(overhaul_base_url))
    page.wait_for_timeout(400)
    runtime = page.evaluate(
        """() => {
          let snapshotSeed = null, snapshotError = null;
          try {
            if (typeof window.__overhaulAcceptance?.snapshot === 'function') {
              snapshotSeed = window.__overhaulAcceptance.snapshot()?.seed ?? null;
            }
          } catch (error) {
            snapshotError = String(error?.message || error);
          }
          return {
            exists: !!window.__overhaulAcceptance,
            ready: window.__overhaulAcceptance?.ready === true,
            mockMounted: !!window.__overhaulMockGame,
            coreMounted: !!window.__overhaulGame
              && typeof window.__overhaulGame.tick === 'function'
              && typeof window.createOverhaulGame === 'function',
            urlSeed: new URL(location.href).searchParams.get('seed'),
            snapshotSeed,
            snapshotError,
          };
        }"""
    )
    assert runtime["exists"], (
        "overhaul booted without window.__overhaulAcceptance; "
        f"browser errors={errors[-5:]!r}"
    )
    assert runtime["ready"], (
        "window.__overhaulAcceptance exists but ready is not true; "
        f"runtime={runtime!r} browser errors={errors[-5:]!r}"
    )
    assert not runtime["mockMounted"], (
        "overhaul acceptance mounted __overhaulMockGame instead of the real core; "
        f"runtime={runtime!r} browser errors={errors[-5:]!r}"
    )
    assert runtime["coreMounted"], f"real overhaul core/tick surface is absent: {runtime!r}"
    assert runtime["urlSeed"] == "overhaul-first-playtest"
    assert runtime["snapshotSeed"] == runtime["urlSeed"], (
        f"URL seed did not round-trip into core snapshot: {runtime!r}"
    )
    return page


def _bridge(page, method, payload=None):
    return page.evaluate(
        """async ([method, payload]) => {
          const api = window.__overhaulAcceptance;
          if (!api) throw new Error('missing window.__overhaulAcceptance');
          if (typeof api[method] !== 'function') {
            throw new Error(`acceptance bridge missing method: ${method}`);
          }
          return await api[method](payload);
        }""",
        [method, payload],
    )


def _snapshot(page):
    value = _bridge(page, "snapshot")
    assert isinstance(value, dict), f"snapshot must be an object, got {value!r}"
    return value


def _reset(page, seed):
    _bridge(page, "reset", {"seed": seed})
    value = _snapshot(page)
    assert value.get("seed") == seed, (
        f"reset did not retain canonical seed: requested={seed!r} "
        f"snapshot={value.get('seed')!r}"
    )
    return value


def _scenario(page, name):
    result = _bridge(page, "runScenario", name)
    assert isinstance(result, dict), f"scenario {name!r} returned {result!r}, expected object"
    return result


def _unlock_ids(snapshot):
    unlocks = snapshot.get("unlocks")
    assert isinstance(unlocks, list) and unlocks, f"seed {snapshot.get('seed')!r} has no unlocks"
    ids = [item.get("id") for item in unlocks]
    assert all(isinstance(item, str) and item for item in ids), f"invalid unlock IDs: {ids!r}"
    assert len(ids) == len(set(ids)), f"duplicate unlock IDs: {ids!r}"
    return tuple(ids)


def _cells(snapshot, field):
    footprint = snapshot.get("footprint")
    assert isinstance(footprint, dict), f"snapshot missing footprint: {snapshot!r}"
    cells = footprint.get(field)
    assert isinstance(cells, list), f"footprint.{field} must be a list, got {cells!r}"
    for cell in cells:
        assert all(key in cell for key in ("key", "floor", "x", "y")), (
            f"footprint.{field} cell missing key/floor/x/y: {cell!r}"
        )
    return cells


def _cell_signature(snapshot, field="owned"):
    return tuple(cell["key"] for cell in _cells(snapshot, field))


def _assert_connected_owned(snapshot):
    owned = _cells(snapshot, "owned")
    keys = [cell["key"] for cell in owned]
    assert owned, "owned footprint is empty"
    assert len(keys) == len(set(keys)), f"owned footprint contains duplicate keys: {keys!r}"
    by_floor = {}
    for cell in owned:
        by_floor.setdefault(cell["floor"], set()).add((cell["x"], cell["y"]))
    for floor, coordinates in by_floor.items():
        pending = [next(iter(coordinates))]
        visited = set(pending)
        while pending:
            x, y = pending.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in coordinates and neighbor not in visited:
                    visited.add(neighbor)
                    pending.append(neighbor)
        assert visited == coordinates, (
            f"floor {floor} owned footprint is disconnected: "
            f"visited={sorted(visited)!r} owned={sorted(coordinates)!r}"
        )


def _assert_legal_frontier(snapshot):
    owned = _cells(snapshot, "owned")
    frontier = _cells(snapshot, "frontier")
    owned_keys = {cell["key"] for cell in owned}
    frontier_keys = [cell["key"] for cell in frontier]
    assert frontier, "frontier is empty; player has no legal expansion"
    assert len(frontier_keys) == len(set(frontier_keys)), (
        f"frontier contains duplicate keys: {frontier_keys!r}"
    )
    owned_coordinates = {(cell["floor"], cell["x"], cell["y"]) for cell in owned}
    for cell in frontier:
        assert cell["key"] not in owned_keys, f"frontier cell is already owned: {cell!r}"
        assert isinstance(cell.get("cost"), (int, float)) and cell["cost"] >= 0, (
            f"frontier cell has invalid quoted cost: {cell!r}"
        )
        f, x, y = cell["floor"], cell["x"], cell["y"]
        neighbors = {(f, x - 1, y), (f, x + 1, y), (f, x, y - 1), (f, x, y + 1)}
        assert neighbors & owned_coordinates, f"frontier cell is not adjacent to owned floor: {cell!r}"


def _computer(snapshot):
    computers = snapshot.get("computers")
    assert isinstance(computers, list) and computers, "snapshot has no computer telemetry"
    return computers[0]


def _assert_explicit_delivery(snapshot, computer_id):
    networks = snapshot.get("networks")
    assert isinstance(networks, dict), f"snapshot missing networks: {snapshot!r}"
    for kind in ("power", "cooling", "data"):
        network = networks.get(kind)
        assert isinstance(network, dict), f"snapshot missing networks.{kind}"
        paths = network.get("paths")
        assert isinstance(paths, list), f"networks.{kind}.paths must be a list"
        delivered = [
            path for path in paths
            if path.get("target") == computer_id
            and path.get("connected") is True
            and path.get("delivered", 0) > 0
        ]
        assert delivered, f"computer {computer_id!r} has no delivering {kind} path: {paths!r}"
        for path in paths:
            if path.get("connected") is False:
                assert path.get("delivered", 0) == 0, (
                    f"disconnected {kind} path delivered resource: {path!r}"
                )


def _numeric_dom_value(page, selector):
    value = page.locator(selector).get_attribute("data-value")
    assert value is not None, f"{selector} must expose unformatted data-value"
    try:
        return float(value)
    except ValueError as error:
        raise AssertionError(f"{selector} has non-numeric data-value={value!r}") from error


def _atomic_commit_sample(page, include_soak=False):
    """Read simulation, DOM commit, and semantic HUD in one browser task."""
    return page.evaluate(
        """(includeSoak) => {
          const snapshot = window.__overhaulAcceptance.snapshot();
          const numeric = (selector) => Number(document.querySelector(selector)?.dataset.value);
          return {
            snapshot,
            domTick: Number(document.documentElement.dataset.uiTick),
            domFlops: numeric('[data-flops-raw]'),
            domCash: numeric('[data-cash]'),
            soak: includeSoak ? {...window.__overhaulSoak} : null,
          };
        }""",
        include_soak,
    )


def test_overhaul_entrypoint_exposes_semantic_acceptance_surface(overhaul):
    surface = overhaul.evaluate(
        """() => ({
          root: document.querySelectorAll('#overhaul-root').length,
          title: document.title,
          ready: window.__overhaulAcceptance?.ready,
          mockMounted: !!window.__overhaulMockGame,
          coreMounted: !!window.__overhaulGame && typeof window.__overhaulGame.tick === 'function',
          methods: ['reset', 'snapshot', 'command', 'runScenario'].filter(
            name => typeof window.__overhaulAcceptance?.[name] === 'function'
          ),
        })"""
    )
    assert surface["root"] == 1, f"expected one #overhaul-root, got {surface['root']}"
    assert surface["title"].strip(), "overhaul page has an empty document title"
    assert surface["ready"] is True, "acceptance bridge did not declare ready=true"
    assert surface["mockMounted"] is False, "entrypoint silently mounted the presentation mock"
    assert surface["coreMounted"] is True, "entrypoint did not mount the real simulation core"
    assert surface["methods"] == ["reset", "snapshot", "command", "runScenario"], (
        f"incomplete acceptance bridge: {surface['methods']!r}"
    )


def test_seeded_start_is_deterministic_and_randomized(overhaul):
    first = _reset(overhaul, "overhaul-contract-alpha")
    repeat = _reset(overhaul, "overhaul-contract-alpha")
    assert _unlock_ids(first) == _unlock_ids(repeat), "same seed changed starting unlock IDs"
    assert _cell_signature(first) == _cell_signature(repeat), "same seed changed owned footprint"

    starts = [
        _reset(overhaul, seed)
        for seed in (
            "overhaul-contract-alpha", "overhaul-contract-beta", "overhaul-contract-gamma",
            "overhaul-contract-delta", "overhaul-contract-epsilon",
        )
    ]
    variants = {
        (
            start["starterKitId"],
            start["recovery"]["siteName"],
            tuple(target["blueprintId"] for target in start["recovery"]["targets"]),
        )
        for start in starts
    }
    assert len(variants) > 1, f"comparison seeds produced no inherited-site variation: {variants!r}"


@pytest.mark.parametrize(
    "seed",
    ["viable-01", "viable-02", "viable-03", "viable-04", "viable-05"],
)
def test_every_seeded_start_has_a_viable_physical_toolkit(overhaul, seed):
    snapshot = _reset(overhaul, seed)
    kinds = {item.get("kind") for item in snapshot["unlocks"]}
    missing = REQUIRED_UNLOCK_KINDS - kinds
    assert not missing, f"seed {seed!r} is not viable; missing capability kinds: {sorted(missing)!r}"
    inherited_kinds = {item.get("kind") for item in snapshot["structures"] if item["inherited"]}
    inherited_missing = REQUIRED_INHERITED_KINDS - inherited_kinds
    assert not inherited_missing, (
        f"seed {seed!r} inherited no viable datacenter; missing {sorted(inherited_missing)!r}"
    )
    assert snapshot["recovery"]["total"] == 2
    assert snapshot["recovery"]["repaired"] == 0
    seed_text = overhaul.locator("[data-seed]")
    assert seed_text.is_visible(), "run seed is not visible"
    assert snapshot["recovery"]["siteName"] in seed_text.inner_text()
    assert seed in seed_text.get_attribute("title"), f"visible site does not expose seed {seed!r}"


def test_player_recovers_inherited_site_and_research_unlocks_real_construction(overhaul, errors):
    initial = _reset(overhaul, "browser-recovery-contract")
    assert initial["recovery"]["phase"] == "triage"
    assert overhaul.locator('[data-research-node="recovery-grid"]').is_visible()
    assert overhaul.locator('[data-research-node][data-research-state="locked"]').count() >= 4
    assert overhaul.locator('[data-ai-hud]').get_attribute("data-ai-state") == "manual"
    assert "machine assistance" in overhaul.locator('[data-ai-hud]').inner_text().lower()
    assert overhaul.locator("[data-ai-panel]").count() == 0

    for target in initial["recovery"]["targets"]:
        cell = overhaul.locator(f'.cell[data-x="{target["x"]}"][data-y="{target["y"]}"]')
        assert cell.get_attribute("data-tile-activity") == "broken"
        assert cell.get_attribute("data-inherited") == "true"
        cell.click()
        repair = overhaul.locator(f'[data-repair-structure="{target["entityId"]}"]')
        repair.wait_for(state="visible")
        assert "repair inherited" in repair.inner_text().lower()
        repair.click()
        overhaul.wait_for_function(
            """entityId => {
              const snapshot=window.__overhaulAcceptance.snapshot();
              const target=snapshot.recovery.targets.find(item => item.entityId === entityId);
              const cell=document.querySelector(`[data-x="${target.x}"][data-y="${target.y}"]`);
              return snapshot.recovery.activeRepair?.entityId === entityId
                && cell?.dataset.tileActivity === 'repairing';
            }""",
            arg=target["entityId"],
        )
        overhaul.wait_for_function(
            """entityId => {
              const snapshot=window.__overhaulAcceptance.snapshot();
              return snapshot.recovery.targets.find(item => item.entityId === entityId)?.state
                === 'repaired';
            }""",
            arg=target["entityId"],
            timeout=5_000,
        )

    overhaul.wait_for_function(
        """() => {
          const snapshot=window.__overhaulAcceptance.snapshot();
          return snapshot.recovery.phase === 'online' && snapshot.flops.raw > 0
            && document.querySelector('[data-research-node="recovery-grid"]')
              ?.dataset.researchState === 'complete';
        }""",
        timeout=7_000,
    )
    generator = overhaul.locator('[data-blueprint="generator"]')
    assert generator.get_attribute("aria-disabled") == "false"

    research = overhaul.locator('[data-route-preset="ai-train"]')
    research.scroll_into_view_if_needed()
    research.click()
    overhaul.wait_for_function(
        """() => {
          const snapshot=window.__overhaulAcceptance.snapshot();
          return snapshot.research.completedIds.includes('external-markets')
            && document.querySelector('[data-blueprint="fiber_gateway"]')
              ?.getAttribute('aria-disabled') === 'false';
        }""",
        timeout=10_000,
    )
    final = _snapshot(overhaul)
    assert final["research"]["points"] >= 40
    assert "external-markets" in final["research"]["completedIds"]
    assert not errors, f"recovery/research UI emitted browser errors: {errors[-5:]!r}"


def test_owned_footprint_is_connected_and_frontier_is_legal(overhaul):
    snapshot = _reset(overhaul, "footprint-contract")
    _assert_connected_owned(snapshot)
    _assert_legal_frontier(snapshot)


def test_frontier_purchase_is_atomic_and_recomputes_boundary(overhaul):
    before = _reset(overhaul, "frontier-purchase-contract")
    _assert_legal_frontier(before)
    target = before["footprint"]["frontier"][0]
    cash_before = before["economy"]["cash"]
    result = _bridge(
        overhaul,
        "command",
        {"type": "purchase-frontier", "cellKey": target["key"]},
    )
    assert result.get("ok") is True, f"legal frontier purchase was rejected: {result!r}"
    if "cellKey" in result:
        assert result["cellKey"] == target["key"], f"purchase echoed wrong cell: {result!r}"
    if "cost" in result:
        assert result["cost"] == target["cost"], f"purchase echoed wrong cost: {result!r}"
    after = _snapshot(overhaul)
    assert target["key"] in _cell_signature(after), f"purchased cell not owned: {target!r}"
    assert math.isclose(
        after["economy"]["cash"],
        cash_before - target["cost"],
        rel_tol=0,
        abs_tol=1e-6,
    ), (
        f"frontier charge mismatch: before={cash_before} quoted={target['cost']} "
        f"after={after['economy']['cash']}"
    )
    _assert_connected_owned(after)
    _assert_legal_frontier(after)

    stable_cash = after["economy"]["cash"]
    stable_owned = _cell_signature(after)
    rejected = _bridge(
        overhaul,
        "command",
        {"type": "purchase-frontier", "cellKey": "not-a-frontier-cell"},
    )
    assert rejected == {"ok": False, "reason": "not-frontier"}, (
        f"non-frontier rejection lacks exact diagnostic: {rejected!r}"
    )
    unchanged = _snapshot(overhaul)
    assert unchanged["economy"]["cash"] == stable_cash, "rejected purchase changed cash"
    assert _cell_signature(unchanged) == stable_owned, "rejected purchase changed footprint"


def test_visible_blueprint_and_owned_cell_click_build_through_real_ui(overhaul, errors):
    _reset(overhaul, "manual-placement-contract")
    _scenario(overhaul, "computer-path-connected")
    before = _snapshot(overhaul)
    assert not errors, f"overhaul emitted errors before manual placement: {errors[-5:]!r}"

    blueprint_id = "generator"
    assert blueprint_id in _unlock_ids(before), (
        f"manual placement seed did not unlock {blueprint_id!r}: {_unlock_ids(before)!r}"
    )
    occupied = {
        (int(item.get("floor", 0)), int(item["x"]), int(item["y"]))
        for item in (*before["structures"], *before["actors"])
    }
    target = next(
        cell for cell in before["footprint"]["owned"]
        if (int(cell.get("uiFloor", 0)), int(cell["x"]), int(cell["y"])) not in occupied
    )
    route_target = next(
        cell for cell in before["footprint"]["owned"]
        if (int(cell.get("uiFloor", 0)), int(cell["x"]), int(cell["y"])) not in occupied
        and (cell["x"], cell["y"]) != (target["x"], target["y"])
    )

    blueprint = overhaul.locator(f'[data-blueprint="{blueprint_id}"]')
    blueprint.scroll_into_view_if_needed()
    assert blueprint.is_visible(), f"{blueprint_id!r} blueprint is not visible"
    assert blueprint.get_attribute("aria-disabled") == "false"
    visible_price = float(blueprint.locator(".state-chip").inner_text().strip().lstrip("$"))
    blueprint.click()
    assert blueprint.get_attribute("aria-pressed") == "true"

    cell = overhaul.locator(f'[data-x="{target["x"]}"][data-y="{target["y"]}"]')
    cell.scroll_into_view_if_needed()
    assert cell.is_visible(), f"legal owned cell is not visible: {target!r}"
    assert cell.get_attribute("data-territory") == "owned"
    cell.click()
    overhaul.wait_for_function(
        """([blueprintId, x, y, count]) => {
          const snapshot = window.__overhaulAcceptance.snapshot();
          const structure = snapshot.structures.find((item) =>
            item.blueprintId === blueprintId && Number(item.x) === x && Number(item.y) === y
          );
          const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
          return snapshot.structures.length === count + 1 && !!structure
            && !!cell?.querySelector('.structure');
        }""",
        arg=[blueprint_id, target["x"], target["y"], len(before["structures"])],
    )
    feedback = overhaul.locator('.command-feedback[data-tone="good"]')
    feedback.wait_for(state="visible")
    assert "blueprint staged" in feedback.inner_text().lower()

    staged = _snapshot(overhaul)
    staged_structure = next(
        item for item in staged["structures"]
        if item["blueprintId"] == blueprint_id
        and item["x"] == target["x"] and item["y"] == target["y"]
    )
    entity_id = staged_structure["id"]
    assert staged_structure["condition"] == 0
    assert staged_structure["construction"]["phase"] == "traveling"
    worksite = cell.locator(f'[data-construction-site="{entity_id}"]')
    assert worksite.count() == 1 and worksite.is_visible()
    moving_crew = overhaul.locator(
        f'[data-assignment-kind="construction"][data-actor-state="moving"]'
    )
    assert moving_crew.count() == 2

    overhaul.wait_for_function(
        """entityId => {
          const snapshot=window.__overhaulAcceptance.snapshot();
          const structure=snapshot.structures.find(item => item.id === entityId);
          const actors=snapshot.actors.filter(item => item.assignment?.entityId === entityId);
          return structure?.construction?.phase === 'assembling'
            && actors.some(item => item.kind === 'human' && item.state === 'working')
            && actors.some(item => item.kind === 'robot' && item.state === 'building');
        }""",
        arg=entity_id,
        timeout=6_000,
    )
    assembly_art = overhaul.evaluate(
        """entityId => {
          const site=document.querySelector(`[data-construction-site="${entityId}"]`);
          const human=document.querySelector('[data-assignment-kind="construction"][data-actor-kind="human"]');
          const robot=document.querySelector('[data-assignment-kind="construction"][data-actor-kind="robot"]');
          return {
            phase:site?.dataset.constructionPhase,
            progress:Number(site?.dataset.constructionProgress),
            crane:getComputedStyle(site?.querySelector('.construction-crane')).animationName,
            humanActivity:human?.dataset.activity,
            humanTool:getComputedStyle(human?.querySelector('.human-arm.right')).animationName,
            robotActivity:robot?.dataset.activity,
            robotTool:getComputedStyle(robot?.querySelector('.robot-arm')).animationName,
          };
        }""",
        entity_id,
    )
    assert assembly_art["phase"] == "assembling"
    assert 0 < assembly_art["progress"] < 1
    assert assembly_art["crane"] == "construction-crane-swing"
    assert assembly_art["humanActivity"] == "assemble"
    assert assembly_art["humanTool"] == "human-assembly-check"
    assert assembly_art["robotActivity"] == "build"
    assert assembly_art["robotTool"] == "assembly-arm"

    overhaul.wait_for_function(
        """entityId => window.__overhaulAcceptance.snapshot().structures
          .find(item => item.id === entityId)?.construction?.phase === 'commissioning'""",
        arg=entity_id,
        timeout=4_000,
    )
    commissioning_art = overhaul.evaluate(
        """() => {
          const human=document.querySelector('[data-assignment-kind="construction"][data-actor-kind="human"]');
          const robot=document.querySelector('[data-assignment-kind="construction"][data-actor-kind="robot"]');
          return {
            humanState:human?.dataset.actorState,
            humanActivity:human?.dataset.activity,
            humanMotion:getComputedStyle(human?.querySelector('.human-head')).animationName,
            robotState:robot?.dataset.actorState,
            robotActivity:robot?.dataset.activity,
            robotMotion:getComputedStyle(robot?.querySelector('.robot-arm')).animationName,
          };
        }"""
    )
    assert commissioning_art == {
        "humanState": "inspecting",
        "humanActivity": "inspect",
        "humanMotion": "human-inspection-look",
        "robotState": "maintaining",
        "robotActivity": "maintain",
        "robotMotion": "maintenance-torque",
    }
    overhaul.wait_for_function(
        """entityId => {
          const snapshot=window.__overhaulAcceptance.snapshot();
          const structure=snapshot.structures.find(item => item.id === entityId);
          return structure?.condition === 100 && structure?.construction?.state === 'complete'
            && !snapshot.construction.jobs.some(item => item.entityId === entityId);
        }""",
        arg=entity_id,
        timeout=4_000,
    )
    assert cell.locator('[data-construction-site]').count() == 0

    # The inspector button remains a keyboard/screen-reader-friendly alternate
    # after direct placement; the player does not need it for the primary flow.
    alternate = overhaul.locator(f'[data-place-selected="{blueprint_id}"]')
    assert alternate.count() == 1
    assert alternate.get_attribute("data-place-x") == str(target["x"])
    assert alternate.get_attribute("data-place-y") == str(target["y"])

    after_facility = _snapshot(overhaul)
    placed = [
        item for item in after_facility["structures"]
        if item["blueprintId"] == blueprint_id
        and item["x"] == target["x"] and item["y"] == target["y"]
    ]
    assert len(placed) == 1, f"direct cell click did not create one structure: {placed!r}"
    assert math.isclose(
        after_facility["economy"]["cash"],
        before["economy"]["cash"] - visible_price,
        rel_tol=0,
        abs_tol=1e-6,
    )
    assert cell.locator(".structure").is_visible(), "placed structure is absent from its DOM cell"

    total_visible_price = visible_price
    utility_blueprints = (
        ("power_line", "power"),
        ("cooling_pipe", "cooling"),
        ("data_cable", "data"),
    )
    for offset, (utility_id, layer) in enumerate(utility_blueprints, start=2):
        utility = overhaul.locator(f'[data-blueprint="{utility_id}"]')
        utility.scroll_into_view_if_needed()
        assert utility.is_visible(), f"{utility_id!r} blueprint is not visible"
        assert utility.get_attribute("aria-disabled") == "false"
        utility_name = utility.locator(".blueprint-name").inner_text().strip()
        total_visible_price += float(
            utility.locator(".state-chip").inner_text().strip().lstrip("$").replace(",", "")
        )
        utility.click()
        assert utility.get_attribute("aria-pressed") == "true"
        cell.click()
        overhaul.wait_for_function(
            """([blueprintId, layer, x, y, count]) => {
              const snapshot = window.__overhaulAcceptance.snapshot();
              const structure = snapshot.structures.find((item) =>
                item.blueprintId === blueprintId && item.layer === layer
                  && Number(item.x) === x && Number(item.y) === y
              );
              const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
              return snapshot.structures.length === count && !!structure
                && cell?.querySelectorAll(`[data-cell-utility="${layer}"]`).length === 1;
            }""",
            arg=[
                utility_id,
                layer,
                target["x"],
                target["y"],
                len(before["structures"]) + offset,
            ],
        )
        overhaul.wait_for_function(
            """name => {
              const feedback = document.querySelector('.command-feedback[data-tone="good"]');
              return feedback?.textContent.includes(name) && feedback.textContent.includes('staged');
            }""",
            arg=utility_name,
        )

    route_only_blueprint = overhaul.locator('[data-blueprint="data_cable"]')
    route_only_blueprint.scroll_into_view_if_needed()
    assert route_only_blueprint.is_visible()
    total_visible_price += float(
        route_only_blueprint.locator(".state-chip").inner_text().strip().lstrip("$").replace(",", "")
    )
    if route_only_blueprint.get_attribute("aria-pressed") != "true":
        route_only_blueprint.click()
    route_cell = overhaul.locator(
        f'[data-x="{route_target["x"]}"][data-y="{route_target["y"]}"]'
    )
    route_cell.scroll_into_view_if_needed()
    assert route_cell.is_visible() and route_cell.get_attribute("data-territory") == "owned"
    route_cell.click()
    overhaul.wait_for_function(
        """([x, y, count]) => {
          const snapshot = window.__overhaulAcceptance.snapshot();
          const structures = snapshot.structures.filter((item) =>
            Number(item.x) === x && Number(item.y) === y
          );
          const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
          return snapshot.structures.length === count
            && structures.length === 1 && structures[0].blueprintId === 'data_cable'
            && cell?.querySelectorAll('[data-cell-utility="data"]').length === 1
            && cell?.querySelectorAll('.structure').length === 0;
        }""",
        arg=[route_target["x"], route_target["y"], len(before["structures"]) + 5],
    )

    after = _snapshot(overhaul)
    stacked = [
        item for item in after["structures"]
        if item["x"] == target["x"] and item["y"] == target["y"]
    ]
    assert len(after["structures"]) == len(before["structures"]) + 5
    assert {item["layer"] for item in stacked} == {"facility", "power", "cooling", "data"}
    assert math.isclose(
        after["economy"]["cash"],
        before["economy"]["cash"] - total_visible_price,
        rel_tol=0,
        abs_tol=1e-6,
    )

    primary = cell.locator(".cell-content > .structure")
    assert primary.count() == 1 and primary.is_visible(), (
        "same-cell utility routes replaced or duplicated the central facility occupant"
    )
    assert "Compact Generator" in cell.get_attribute("aria-label")
    indicators = cell.locator("[data-cell-utility]")
    assert indicators.count() == 3, "stacked cell must expose exactly three utility indicators"
    cell_box = cell.bounding_box()
    assert cell_box, "stacked cell has no rendered geometry"
    for layer in ("power", "cooling", "data"):
        indicator = cell.locator(f'[data-cell-utility="{layer}"]')
        assert indicator.count() == 1 and indicator.is_visible()
        assert indicator.get_attribute("class").split()[0] == "cell-utility"
        box = indicator.bounding_box()
        assert box, f"{layer} utility indicator has no rendered geometry"
        assert min(box["width"], box["height"]) <= min(cell_box["width"], cell_box["height"]) * 0.12, (
            f"{layer} route rendered as a full-tile central icon instead of a thin indicator: {box!r}"
        )
    assert route_cell.locator('[data-cell-utility="data"]').count() == 1
    assert route_cell.locator('[data-cell-utility="data"]').is_visible()
    assert route_cell.locator(".structure").count() == 0, (
        "route-only data cable rendered as a central full-tile structure"
    )
    assert not errors, f"manual placement emitted browser errors: {errors[-5:]!r}"


def test_explicit_paths_drive_computer_off_boot_loaded_and_real_flops(overhaul):
    disconnected = _scenario(overhaul, "computer-path-disconnected")
    disconnected_history = disconnected.get("snapshots")
    assert isinstance(disconnected_history, list) and disconnected_history, (
        f"disconnected scenario lacks snapshots: {disconnected!r}"
    )
    off = disconnected_history[-1]
    off_computer = _computer(off)
    assert off_computer["state"] == "off", f"unconnected computer is not off: {off_computer!r}"
    assert off_computer["rawFlops"] == 0, f"unconnected computer produced FLOPS: {off_computer!r}"
    assert off_computer["powerDelivered"] == 0
    assert off_computer["coolingDelivered"] == 0
    assert off_computer["dataConnected"] is False

    connected = _scenario(overhaul, "computer-path-connected")
    history = connected.get("snapshots")
    assert isinstance(history, list) and len(history) >= 3, (
        f"connected scenario must expose off/booting/loaded snapshots: {connected!r}"
    )
    states = [_computer(snapshot)["state"] for snapshot in history]
    try:
        boot_index = states.index("booting")
        loaded_index = states.index("loaded", boot_index + 1)
    except ValueError as error:
        raise AssertionError(
            f"computer was off in the disconnected scenario but did not continue booting→loaded: {states!r}"
        ) from error
    assert boot_index < loaded_index

    loaded = history[loaded_index]
    computer = _computer(loaded)
    assert computer["powerDelivered"] > 0
    assert computer["coolingDelivered"] > 0
    assert computer["dataConnected"] is True
    assert computer["rawFlops"] > 0, f"loaded computer has no real FLOPS: {computer!r}"
    _assert_explicit_delivery(loaded, computer["id"])


def test_sell_requires_connected_floor_one_fiber(overhaul):
    blocked_result = _scenario(overhaul, "sell-without-f1-fiber")
    blocked = blocked_result["snapshots"][-1]
    sell = blocked["sell"]
    assert bool(sell["requested"])
    assert sell["blocked"] is True
    assert sell["reason"] == "missing-f1-fiber", f"wrong sell block reason: {sell!r}"
    assert sell["routedFlops"] == 0
    assert blocked["flops"]["sell"] == 0
    status = overhaul.locator("[data-router]")
    assert status.is_visible(), "resource router is not visible"
    guidance = status.inner_text().lower()
    assert "fiber" in guidance and "floor 1" in guidance, (
        f"missing Floor 1 fiber guidance is not visible: {guidance!r}"
    )

    enabled_result = _scenario(overhaul, "sell-with-f1-fiber")
    enabled = enabled_result["snapshots"][-1]
    sell = enabled["sell"]
    assert bool(sell["requested"])
    assert sell["blocked"] is False, f"Floor 1 fiber did not enable Sell: {sell!r}"
    assert sell["fiberFloor"] == 1, f"Sell used fiber from the wrong floor: {sell!r}"
    assert sell["routedFlops"] > 0
    assert enabled["flops"]["sell"] == sell["routedFlops"]


def test_flops_are_conserved_across_routing_destinations(overhaul):
    result = _scenario(overhaul, "flops-routing")
    snapshot = result["snapshots"][-1]
    flops = snapshot["flops"]
    buckets = ("sell", "training", "jobs", "reserved", "idle", "loss")
    for name in ("raw", *buckets):
        assert isinstance(flops.get(name), (int, float)), f"flops.{name} is not numeric: {flops!r}"
        assert flops[name] >= 0, f"flops.{name} is negative: {flops!r}"
    routed_total = sum(flops[name] for name in buckets)
    assert math.isclose(flops["raw"], routed_total, rel_tol=1e-9, abs_tol=1e-6), (
        f"FLOPS conservation failed: raw={flops['raw']} destinations={routed_total} "
        f"breakdown={flops!r}"
    )
    assert flops["sell"] <= flops["raw"]


def test_text_business_loop_has_causal_ledger_and_real_cash_hire_effects(overhaul):
    result = _scenario(overhaul, "text-business-loop")
    events = result.get("events")
    assert isinstance(events, list), f"business scenario lacks events: {result!r}"
    expected_types = [
        "text-trained",
        "harness-built",
        "agent-created",
        "job-completed",
        "invoice-issued",
        "cash-received",
        "human-hired",
    ]
    assert [event.get("type") for event in events] == expected_types
    text, harness, agent, job, invoice, cash, hire = events
    assert harness["textId"] == text["entityId"]
    assert agent["harnessId"] == harness["entityId"]
    assert job["agentId"] == agent["entityId"]
    assert invoice["jobId"] == job["entityId"]
    assert cash["invoiceId"] == invoice["entityId"]
    assert invoice["amount"] > 0 and cash["amount"] == invoice["amount"]
    assert math.isclose(cash["cashAfter"] - cash["cashBefore"], cash["amount"], abs_tol=1e-6)
    assert hire["humansAfter"] == hire["humansBefore"] + 1
    assert hire["payrollAfter"] > hire["payrollBefore"]


def test_manual_venture_controls_advance_business_and_actor_state(overhaul):
    _reset(overhaul, "manual-venture-contract")
    _scenario(overhaul, "sell-with-f1-fiber")
    before = _snapshot(overhaul)
    before_actor_ids = {actor["id"] for actor in before["actors"]}

    def click_ready_action(command_type, timeout=10_000):
        selector = f'[data-business-action="{command_type}"]'
        action = overhaul.locator(selector)
        action.wait_for(state="visible", timeout=timeout)
        overhaul.wait_for_function(
            """selector => {
              const button = document.querySelector(selector);
              return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
            }""",
            arg=selector,
            timeout=timeout,
        )
        action.click()

    overhaul.locator('[data-tab="jobs"]').click()
    overhaul.locator("[data-venture-panel]").wait_for(state="visible")

    train = overhaul.locator('[data-route-preset="train"]')
    train.click()
    overhaul.wait_for_function(
        """() => {
          const routes = window.__overhaulAcceptance.snapshot().routes;
          return routes.train === 0.8 && routes.inference === 0.1
            && document.querySelector('[data-route-preset="train"]')?.getAttribute('aria-pressed') === 'true';
        }"""
    )
    click_ready_action("complete-text-training")
    overhaul.wait_for_function(
        """count => window.__overhaulAcceptance.snapshot().business.textModels.length > count""",
        arg=len(before["business"]["textModels"]),
    )

    click_ready_action("build-harness")
    overhaul.wait_for_function(
        """count => {
          const business = window.__overhaulAcceptance.snapshot().business;
          return !business.pendingHarness && business.harnesses.length > count;
        }""",
        arg=len(before["business"]["harnesses"]),
        timeout=10_000,
    )
    click_ready_action("create-agent")
    overhaul.wait_for_function(
        """count => window.__overhaulAcceptance.snapshot().business.agents.length > count""",
        arg=len(before["business"]["agents"]),
    )

    jobs = overhaul.locator('[data-route-preset="jobs"]')
    jobs.click()
    overhaul.wait_for_function(
        """() => {
          const routes = window.__overhaulAcceptance.snapshot().routes;
          return routes.train === 0 && routes.inference === 0.8
            && document.querySelector('[data-route-preset="jobs"]')?.getAttribute('aria-pressed') === 'true';
        }"""
    )
    click_ready_action("start-job")
    overhaul.wait_for_function(
        """count => window.__overhaulAcceptance.snapshot().business.jobs.length > count""",
        arg=len(before["business"]["jobs"]),
    )
    click_ready_action("receive-invoice", timeout=10_000)
    overhaul.wait_for_function(
        """paid => window.__overhaulAcceptance.snapshot().economy.invoicesPaid > paid""",
        arg=before["economy"]["invoicesPaid"],
    )
    click_ready_action("hire-human")
    overhaul.wait_for_function(
        """hired => window.__overhaulAcceptance.snapshot().economy.humansHired > hired""",
        arg=before["economy"]["humansHired"],
    )

    after = _snapshot(overhaul)
    assert len(after["business"]["textModels"]) == len(before["business"]["textModels"]) + 1
    assert len(after["business"]["harnesses"]) == len(before["business"]["harnesses"]) + 1
    assert len(after["business"]["agents"]) == len(before["business"]["agents"]) + 1
    assert len(after["business"]["jobs"]) == len(before["business"]["jobs"]) + 1
    assert len(after["business"]["invoices"]) == len(before["business"]["invoices"]) + 1
    assert after["business"]["invoices"][-1]["status"] == "paid"
    assert after["economy"]["humansHired"] == before["economy"]["humansHired"] + 1
    assert after["economy"]["payroll"] > before["economy"]["payroll"]

    actor_commit = overhaul.evaluate(
        """beforeIds => {
          const snapshot=window.__overhaulAcceptance.snapshot();
          const actor=snapshot.actors.find(item => !beforeIds.includes(item.id));
          const node=actor ? document.querySelector(`[data-actor-id="${CSS.escape(actor.id)}"]`) : null;
          return {
            actor,
            domState:node?.dataset.actorState || null,
            hook:node?.dataset.animationHook || null,
            visible:!!node?.getClientRects().length && getComputedStyle(node).visibility === 'visible',
          };
        }""",
        list(before_actor_ids),
    )
    hired = actor_commit["actor"]
    assert hired and hired["kind"] == "human"
    assert actor_commit["visible"] is True
    assert actor_commit["domState"] == hired["state"]
    assert actor_commit["hook"] == f'human:{hired["state"]}'


def test_human_robot_computer_states_match_animation_hooks(overhaul):
    _reset(overhaul, "actor-semantics-contract")
    result = _scenario(overhaul, "computer-path-connected")
    snapshot = result["snapshots"][-1]
    actors = snapshot.get("actors")
    assert isinstance(actors, list), f"snapshot actors must be a list: {actors!r}"
    by_kind = {kind: [actor for actor in actors if actor.get("kind") == kind] for kind in ACTOR_STATES}
    assert all(by_kind.values()), f"first playtest must expose human, robot, computer: {by_kind!r}"
    for kind, kind_actors in by_kind.items():
        for actor in kind_actors:
            state = actor.get("state")
            assert state in ACTOR_STATES[kind], f"invalid {kind} state {state!r}: {actor!r}"
            dom = overhaul.locator(f'[data-actor-id="{actor["id"]}"]')
            assert dom.count() == 1, f"actor {actor['id']!r} has {dom.count()} DOM nodes"
            assert dom.is_visible(), f"actor {actor['id']!r} is not visible"
            assert dom.get_attribute("data-actor-kind") == kind
            assert dom.get_attribute("data-actor-state") == state
            assert dom.get_attribute("data-animation-hook") == f"{kind}:{state}"


def test_raw_completed_and_dom_ticks_commit_together(overhaul):
    before = _snapshot(overhaul)
    raw_before = before["ticks"]["raw"]
    completed_before = before["ticks"]["completed"]
    overhaul.wait_for_function(
        """async ([raw, completed]) => {
          const snapshot = await window.__overhaulAcceptance.snapshot();
          const dom = Number(document.documentElement.dataset.uiTick);
          return snapshot.ticks.raw > raw && snapshot.ticks.completed > completed
            && snapshot.ticks.raw === snapshot.ticks.completed
            && snapshot.ticks.completed === dom;
        }""",
        arg=[raw_before, completed_before],
        timeout=5_000,
    )
    committed = _atomic_commit_sample(overhaul)
    after = committed["snapshot"]
    assert after["ticks"]["raw"] == after["ticks"]["completed"] == committed["domTick"], (
        f"overhaul UI commit stalled: raw={after['ticks']['raw']} "
        f"completed={after['ticks']['completed']} dom={committed['domTick']}"
    )
    assert math.isclose(committed["domFlops"], after["flops"]["raw"], abs_tol=1e-6)
    assert math.isclose(committed["domCash"], after["economy"]["cash"], abs_tol=1e-6)


TEXT_AUDIT_JS = r"""
(selectors) => {
  const failures = [];
  const tolerance = 1.25;
  const rect = (r) => ({
    left: +r.left.toFixed(1), top: +r.top.toFixed(1),
    right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
    width: +r.width.toFixed(1), height: +r.height.toFixed(1),
  });
  for (const selector of selectors) {
    const nodes = [...document.querySelectorAll(selector)];
    if (!nodes.length) {
      failures.push({selector, reason: 'selector matched no elements'});
      continue;
    }
    for (const node of nodes) {
      if (node.closest('.left-scroll, .right-scroll')) {
        node.scrollIntoView({block: 'nearest', inline: 'nearest'});
      }
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const reasons = [];
      if (!text) reasons.push('empty player-facing text');
      if (node.hidden || style.display === 'none' || style.visibility !== 'visible' || +style.opacity === 0) {
        reasons.push('not visibly rendered');
      }
      if (!node.getClientRects().length || box.width <= 0 || box.height <= 0) reasons.push('no client rectangle');
      if (box.left < -tolerance || box.top < -tolerance
          || box.right > innerWidth + tolerance || box.bottom > innerHeight + tolerance) {
        reasons.push(`outside viewport ${innerWidth}x${innerHeight}`);
      }
      if (node.scrollWidth > node.clientWidth + tolerance) reasons.push(`horizontal clipping ${node.scrollWidth}>${node.clientWidth}`);
      if (node.scrollHeight > node.clientHeight + tolerance) reasons.push(`vertical clipping ${node.scrollHeight}>${node.clientHeight}`);
      if (reasons.length) failures.push({selector, text, reasons, rect: rect(box)});
    }
  }
  return failures;
}
"""


@pytest.mark.parametrize("viewport", VIEWPORTS)
def test_critical_player_text_is_visible_and_unclipped(overhaul, viewport):
    overhaul.set_viewport_size(viewport)
    overhaul.wait_for_timeout(200)
    selectors = [
        ".brand-title",
        "[data-seed]",
        "[data-cash]",
        "[data-flops-raw]",
        "[data-floor-status]",
        "[data-world-grid]",
        "[data-router]",
        "[data-quest]",
        "[data-quest] .quest-copy",
        "[data-quest] .quest-action",
        "[data-research-roadmap] .research-node-copy strong",
        "[data-blueprints] .blueprint",
        "[data-blueprints] .blueprint-name",
        "[data-blueprints] .blueprint > .state-chip",
        "[data-heartbeat]",
    ]
    failures = overhaul.evaluate(TEXT_AUDIT_JS, selectors)
    assert not failures, (
        f"unreadable overhaul text at {viewport['width']}x{viewport['height']}:\n"
        + json.dumps(failures, indent=2, sort_keys=True)
    )


COLLISION_AUDIT_JS = r"""
() => {
  const nodes = [...document.querySelectorAll('[data-ui-region]')].filter((node) => {
    const style = getComputedStyle(node);
    return !node.hidden && style.display !== 'none' && style.visibility === 'visible'
      && node.getClientRects().length;
  });
  const rect = (node) => node.getBoundingClientRect();
  const label = (node) => node.getAttribute('data-ui-region') || node.id || node.tagName.toLowerCase();
  const overlaps = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.hasAttribute('data-allow-overlap') || b.hasAttribute('data-allow-overlap')) continue;
      const ar = rect(a), br = rect(b);
      const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (width > 1 && height > 1) {
        overlaps.push({a: label(a), b: label(b), width: +width.toFixed(1), height: +height.toFixed(1)});
      }
    }
  }
  return {count: nodes.length, overlaps};
}
"""


@pytest.mark.parametrize("viewport", VIEWPORTS)
def test_major_ui_regions_do_not_collide(overhaul, viewport):
    overhaul.set_viewport_size(viewport)
    overhaul.wait_for_timeout(200)
    audit = overhaul.evaluate(COLLISION_AUDIT_JS)
    assert audit["count"] >= 4, (
        f"expected at least four semantic [data-ui-region] panels, got {audit['count']}"
    )
    assert not audit["overlaps"], (
        f"overhaul UI collisions at {viewport['width']}x{viewport['height']}: "
        f"{json.dumps(audit['overlaps'], sort_keys=True)}"
    )


def test_reduced_motion_preserves_actor_semantics_without_animation(overhaul):
    overhaul.emulate_media(reduced_motion="reduce")
    overhaul.reload()
    overhaul.wait_for_function("() => window.__overhaulAcceptance?.ready === true", timeout=5_000)
    _scenario(overhaul, "computer-path-connected")
    audit = overhaul.evaluate(
        """() => {
          const milliseconds = (value) => Math.max(...value.split(',').map((part) => {
            const item = part.trim();
            return item.endsWith('ms') ? parseFloat(item) : parseFloat(item) * 1000;
          }));
          return [...document.querySelectorAll('[data-actor-id]')].map((node) => {
            const style = getComputedStyle(node);
            return {
              id: node.dataset.actorId,
              kind: node.dataset.actorKind,
              state: node.dataset.actorState,
              hook: node.dataset.animationHook,
              visible: node.getClientRects().length > 0 && style.visibility === 'visible',
              animationMs: milliseconds(style.animationDuration),
              transitionMs: milliseconds(style.transitionDuration),
            };
          });
        }"""
    )
    assert len(audit) >= 3, f"reduced-motion page lost semantic actors: {audit!r}"
    for actor in audit:
        assert actor["visible"], f"reduced motion hid actor: {actor!r}"
        assert actor["hook"] == f"{actor['kind']}:{actor['state']}"
        assert actor["animationMs"] <= 0.01, f"reduced motion retained animation: {actor!r}"
        assert actor["transitionMs"] <= 0.01, f"reduced motion retained transition: {actor!r}"

    overhaul.locator('[data-network-focus="power"]').click()
    motion = overhaul.locator(
        '[data-network-path="power"][data-flowing="true"], '
        '[data-cell-utility="power"][data-resource-emphasis="active"]'
    ).evaluate_all(
        """nodes => nodes.map(node => ({
          animation:getComputedStyle(node).animationName,
          duration:getComputedStyle(node).animationDuration,
          transition:getComputedStyle(node).transitionDuration,
        }))"""
    )
    assert motion, "reduced-motion audit found no focused utility semantics"
    assert all(item["animation"] == "none" for item in motion), motion
    assert all(item["duration"] in ("0s", "0ms") for item in motion), motion
    assert all(item["transition"] in ("0s", "0ms") for item in motion), motion


def test_overhaul_boot_and_committed_ticks_emit_no_browser_errors(overhaul, errors):
    overhaul.wait_for_timeout(1_200)
    _snapshot(overhaul)
    assert not errors, f"overhaul browser errors: {errors[-5:]!r}"


def _ai_history(result, scenario):
    snapshots = result.get("snapshots")
    assert isinstance(snapshots, list) and snapshots, f"{scenario} lacks snapshots: {result!r}"
    for index, snapshot in enumerate(snapshots):
        ai = snapshot.get("ai")
        assert isinstance(ai, dict), f"{scenario} snapshot {index} lacks ai object"
        for key in (
            "modelId", "state", "level", "xp", "nextLevelXp", "bonusPercent",
            "efficiencyMultiplier", "mistakeChance", "enabledCount", "connectedCount",
            "activeFaults", "totalFaults", "lastFaultTick",
        ):
            assert key in ai, f"{scenario} snapshot {index} lacks ai.{key}: {ai!r}"
        assert isinstance(ai["activeFaults"], list)
        paths = snapshot.get("networks", {}).get("ai", {}).get("paths")
        assert isinstance(paths, list), f"{scenario} snapshot {index} lacks networks.ai.paths"
    return snapshots


def _ai_structures(snapshot, *, kind=None):
    structures = snapshot.get("structures")
    assert isinstance(structures, list)
    selected = structures if kind is None else [item for item in structures if item.get("kind") == kind]
    for structure in selected:
        for field in (
            "aiEnabled", "aiConnected", "aiEfficiencyMultiplier", "aiFault",
            "baseMetrics", "effectiveMetrics",
        ):
            assert field in structure, f"structure {structure.get('id')!r} lacks {field}: {structure!r}"
    return selected


def _network_capacity(snapshot, resource):
    paths = snapshot["networks"][resource]["paths"]
    return sum(float(path.get("capacity", 0)) for path in paths if path.get("connected"))


def _assert_flops_conserved(snapshot):
    flops = snapshot["flops"]
    buckets = ("sell", "training", "jobs", "reserved", "idle", "loss")
    assert all(isinstance(flops.get(key), (int, float)) and flops[key] >= 0 for key in ("raw", *buckets))
    assert math.isclose(
        flops["raw"],
        sum(flops[key] for key in buckets),
        rel_tol=1e-9,
        abs_tol=1e-6,
    ), f"AI network violated FLOPS conservation: {flops!r}"


def test_ai_network_requires_explicit_controller_bus_path_and_per_structure_opt_in(overhaul):
    _reset(overhaul, "ai-fourth-network-contract")
    opted_out = _ai_history(_scenario(overhaul, "ai-opted-out-manual"), "ai-opted-out-manual")[-1]
    controllers = [item for item in opted_out["structures"] if item["blueprintId"] == "ai_controller"]
    buses = [item for item in opted_out["structures"] if item["blueprintId"] == "ai_bus"]
    assert len(controllers) == 1 and controllers[0]["kind"] == "ai-source"
    assert buses and all(item["kind"] == "ai-link" and item["layer"] == "ai" for item in buses)
    paths = opted_out["networks"]["ai"]["paths"]
    physical = [
        path for path in paths
        if path["source"] == controllers[0]["id"] and path["capacity"] > 0 and len(path["cells"]) >= 2
    ]
    assert physical, f"explicit controller/bus topology has no physical path: {paths!r}"
    for path in physical:
        assert path["enabled"] is False and path["connected"] is True
        assert path["status"] == "disabled" and path["delivered"] == 0
    targets = [item for item in _ai_structures(opted_out) if item["kind"] in AI_RESOURCE_KINDS.values()]
    assert len(targets) >= 4
    assert all(not item["aiEnabled"] and not item["aiConnected"] for item in targets)
    assert all(item["aiEfficiencyMultiplier"] == 1 for item in targets)
    assert all(item["baseMetrics"] == item["effectiveMetrics"] and item["aiFault"] is None for item in targets)
    assert opted_out["ai"]["enabledCount"] == opted_out["ai"]["connectedCount"] == 0
    assert opted_out["ai"]["activeFaults"] == [] and opted_out["ai"]["totalFaults"] == 0

    _reset(overhaul, "ai-fourth-network-contract")
    risk = _ai_history(_scenario(overhaul, "ai-risk-reward"), "ai-risk-reward")
    disconnected = next(
        snapshot for snapshot in risk
        if snapshot["ai"]["enabledCount"] > 0 and snapshot["ai"]["connectedCount"] == 0
    )
    disconnected_targets = [item for item in _ai_structures(disconnected) if item["aiEnabled"]]
    assert disconnected_targets
    assert all(not item["aiConnected"] and item["aiEfficiencyMultiplier"] == 1 for item in disconnected_targets)
    assert all(item["baseMetrics"] == item["effectiveMetrics"] and item["aiFault"] is None for item in disconnected_targets)
    assert disconnected["ai"]["activeFaults"] == []

    connected = next(snapshot for snapshot in risk if snapshot["ai"]["connectedCount"] >= 4)
    assert connected["ai"]["enabledCount"] >= connected["ai"]["connectedCount"] >= 4
    assert any(
        path["connected"] and path["enabled"] and path["delivered"] > 0
        for path in connected["networks"]["ai"]["paths"]
    )


def test_connected_ai_efficiency_is_truthful_for_every_resource_and_conserves_flops(overhaul):
    _reset(overhaul, "ai-efficiency-contract")
    baseline = _ai_history(
        _scenario(overhaul, "ai-opted-out-manual"), "ai-opted-out-manual"
    )[-1]
    _reset(overhaul, "ai-efficiency-contract")
    risk = _ai_history(_scenario(overhaul, "ai-risk-reward"), "ai-risk-reward")
    connected = next(
        snapshot for snapshot in risk
        if snapshot["ai"]["connectedCount"] >= 4
        and not snapshot["ai"]["activeFaults"]
        and snapshot["flops"]["raw"] > 0
    )
    assert connected["ai"]["bonusPercent"] > 0
    assert connected["ai"]["efficiencyMultiplier"] > 1
    for resource, kind in AI_RESOURCE_KINDS.items():
        structures = [
            item for item in _ai_structures(connected, kind=kind)
            if item["aiEnabled"] and item["aiConnected"]
        ]
        assert structures, f"connected AI scenario has no opted-in {resource} structure"
        for structure in structures:
            assert math.isclose(
                structure["aiEfficiencyMultiplier"],
                connected["ai"]["efficiencyMultiplier"],
                rel_tol=1e-9,
            )
            shared = set(structure["baseMetrics"]) & set(structure["effectiveMetrics"])
            gains = [
                structure["effectiveMetrics"][key] - structure["baseMetrics"][key]
                for key in shared
                if isinstance(structure["baseMetrics"][key], (int, float))
            ]
            assert gains and any(gain > 0 for gain in gains), (
                f"{resource} reports an AI multiplier without an effective gain: {structure!r}"
            )

    # Data improves the real path bottleneck; power/cooling source gains are
    # exposed through their effective generation metrics because downstream
    # link capacity and fixed demand may legitimately cap delivered amounts.
    assert _network_capacity(connected, "data") > _network_capacity(baseline, "data"), (
        "AI data metric gain did not reach real network capacity"
    )
    assert connected["flops"]["raw"] > baseline["flops"]["raw"]
    for snapshot in risk:
        _assert_flops_conserved(snapshot)


def test_seeded_ai_fault_repairs_and_training_strictly_improves_risk_reward(overhaul):
    seed = "ai-seeded-fault-contract"
    _reset(overhaul, seed)
    first = _ai_history(_scenario(overhaul, "ai-risk-reward"), "ai-risk-reward")
    _reset(overhaul, seed)
    repeat = _ai_history(_scenario(overhaul, "ai-risk-reward"), "ai-risk-reward")

    def first_fault(history):
        snapshot = next(item for item in history if item["ai"]["activeFaults"])
        fault = snapshot["ai"]["activeFaults"][0]
        assert set(("faultId", "entityId", "kind", "raisedTick", "repairRemaining")) <= set(fault)
        return snapshot, fault

    faulted, fault = first_fault(first)
    _, repeated_fault = first_fault(repeat)
    signature = lambda item: (item["faultId"], item["entityId"], item["kind"], item["raisedTick"])
    assert signature(fault) == signature(repeated_fault)
    assert fault["kind"] == "ai-mistake" and 0 < fault["raisedTick"] <= 24
    target = next(item for item in _ai_structures(faulted) if item["id"] == fault["entityId"])
    assert target["aiEnabled"] and target["aiConnected"] and target["aiFault"]

    repair_counts = [
        active["repairRemaining"]
        for snapshot in first
        for active in snapshot["ai"]["activeFaults"]
        if active["faultId"] == fault["faultId"]
    ]
    assert repair_counts and repair_counts[-1] < repair_counts[0]
    recovered = next(
        snapshot for snapshot in first[first.index(faulted) + 1:]
        if not any(item["faultId"] == fault["faultId"] for item in snapshot["ai"]["activeFaults"])
        and next(item for item in snapshot["structures"] if item["id"] == fault["entityId"])["aiFault"] is None
    )
    recovered_target = next(item for item in recovered["structures"] if item["id"] == fault["entityId"])
    assert recovered_target["aiConnected"] and recovered_target["aiEfficiencyMultiplier"] > 1

    before_training = next(
        snapshot for snapshot in first
        if snapshot["ai"]["connectedCount"] >= 4 and not snapshot["ai"]["activeFaults"]
    )
    after_training = first[-1]
    assert after_training["ai"]["level"] > before_training["ai"]["level"]
    assert after_training["ai"]["bonusPercent"] > before_training["ai"]["bonusPercent"]
    assert after_training["ai"]["efficiencyMultiplier"] > before_training["ai"]["efficiencyMultiplier"]
    assert after_training["ai"]["mistakeChance"] < before_training["ai"]["mistakeChance"]
    assert after_training["ai"]["xp"] >= 0
    assert after_training["ai"]["nextLevelXp"] > 0


def test_ai_snapshot_roundtrip_and_continuation_are_deterministic(overhaul):
    _reset(overhaul, "ai-roundtrip-contract")
    checkpoint = _ai_history(_scenario(overhaul, "ai-risk-reward"), "ai-risk-reward")[-1]
    roundtrip = overhaul.evaluate(
        """checkpoint => {
          const first = window.createOverhaulGame({snapshot: checkpoint});
          const second = window.createOverhaulGame({snapshot: checkpoint});
          return {
            restoredFirst: first.snapshot(),
            restoredSecond: second.snapshot(),
            nextFirst: first.tick(),
            nextSecond: second.tick(),
          };
        }""",
        checkpoint,
    )
    assert roundtrip["restoredFirst"] == checkpoint
    assert roundtrip["restoredSecond"] == checkpoint
    assert roundtrip["nextFirst"] == roundtrip["nextSecond"]
    _assert_flops_conserved(roundtrip["nextFirst"])


def test_network_paths_use_clean_default_and_contextual_flow(overhaul, errors):
    _scenario(overhaul, "computer-path-connected")
    connected_snapshot = _snapshot(overhaul)

    groups = overhaul.locator("[data-network-group]")
    assert groups.count() >= 3, "connected scenario did not expose semantic route groups"
    assert overhaul.locator('[data-connections][data-network-mode="clean"]').count() == 1
    group_states = overhaul.evaluate(
        """() => [...document.querySelectorAll('[data-network-group]')].map(node => ({
          disclosure:node.dataset.disclosure,
          opacity:+getComputedStyle(node).opacity,
          visibility:getComputedStyle(node).visibility,
        }))"""
    )
    for group in group_states:
        assert group["disclosure"] == "idle"
        assert group["opacity"] == 0 and group["visibility"] == "hidden", (
            f"clean floor leaked a full connection path: {group!r}"
        )

    traces = overhaul.locator("[data-cell-utility]")
    assert traces.count() >= 3
    trace_states = overhaul.evaluate(
        """() => [...document.querySelectorAll('[data-cell-utility]')].map(node => ({
          layer:node.dataset.cellUtility,
          emphasis:node.dataset.resourceEmphasis,
          overlayVisible:node.dataset.overlayVisible,
          opacity:+getComputedStyle(node).opacity,
          visibility:getComputedStyle(node).visibility,
          rects:node.getClientRects().length,
        }))"""
    )
    for trace in trace_states:
        assert trace["rects"] and trace["visibility"] == "visible", (
            f"clean floor removed its thin utility trace: {trace!r}"
        )
        assert trace["emphasis"] == "idle"
        assert 0 < trace["opacity"] < 0.6, f"idle utility trace is not subtle: {trace!r}"

    power_focus = overhaul.locator('[data-network-focus="power"]')
    power_focus.click()
    assert power_focus.get_attribute("aria-pressed") == "true"
    assert overhaul.locator('[data-connections][data-network-mode="power"]').count() == 1
    active = overhaul.locator('[data-network-group="power"][data-disclosure="active"]')
    assert active.count() >= 1
    assert active.first.is_visible()
    assert overhaul.locator(
        '[data-network-group]:not([data-network-group="power"])[data-disclosure="active"]'
    ).count() == 0
    assert overhaul.locator(
        '[data-cell-utility="power"][data-resource-emphasis="active"]'
    ).count() >= 1
    assert overhaul.locator(
        '[data-cell-utility]:not([data-cell-utility="power"])[data-resource-emphasis="dim"]'
    ).count() >= 1

    flowing = overhaul.locator('[data-network-path="power"][data-flowing="true"]')
    assert flowing.count() >= 1, "delivering focused power route is not marked as flowing"
    assert flowing.first.evaluate("node => getComputedStyle(node).animationName") != "none"

    power_focus.click()
    assert power_focus.get_attribute("aria-pressed") == "false"
    assert overhaul.locator('[data-connections][data-network-mode="clean"]').count() == 1
    assert overhaul.locator('[data-network-group][data-disclosure="active"]').count() == 0

    actor_ids = {actor["id"] for actor in connected_snapshot["actors"]}
    endpoint_id = next(
        path["target"]
        for network in connected_snapshot["networks"].values()
        for path in network["paths"]
        if path.get("connected") and path.get("target") in actor_ids
    )
    endpoint = overhaul.locator(f'[data-focus-actor="{endpoint_id}"]')
    endpoint.scroll_into_view_if_needed()
    endpoint.click()
    assert overhaul.locator('[data-connections][data-network-mode="endpoint"]').count() == 1
    endpoint_paths = overhaul.locator(
        f'[data-network-group][data-path-id*="{endpoint_id}"][data-disclosure="active"]'
    )
    assert endpoint_paths.count() >= 3, "selected compute endpoint did not reveal its utility paths"
    assert overhaul.locator('[data-network-inspector][data-network-mode="selected endpoint"]').count() == 1
    assert not errors, f"progressive network disclosure emitted browser errors: {errors[-5:]!r}"


def test_network_inspector_reports_exact_capacity_headroom_and_bottleneck(overhaul, errors):
    overhaul.set_viewport_size({"width": 1100, "height": 700})
    _scenario(overhaul, "computer-path-connected")
    snapshot = _snapshot(overhaul)
    overhaul.locator('[data-network-focus="power"]').click()

    inspector = overhaul.locator('[data-network-inspector][data-network-mode="power edit"]')
    inspector.scroll_into_view_if_needed()
    assert inspector.is_visible(), "power edit telemetry is not visible at 1100x700"
    panel_text = " ".join(inspector.inner_text().split()).lower()
    for phrase in ("capacity", "delivered", "utilization", "headroom", "first bottleneck"):
        assert phrase in panel_text, f"connection inspector omits {phrase!r}: {panel_text!r}"

    expected_paths = {path["id"]: path for path in snapshot["networks"]["power"]["paths"]}
    rows = inspector.locator('[data-route-telemetry][data-route-resource="power"]')
    assert rows.count() == len(expected_paths) and rows.count() > 0
    for index in range(rows.count()):
        row = rows.nth(index)
        path = expected_paths[row.get_attribute("data-route-id")]
        capacity = float(path.get("capacity", 0))
        delivered = float(path.get("delivered", 0))
        expected_headroom = float(path.get("headroom", max(0, capacity - delivered)))
        expected_utilization = float(
            path.get(
                "utilizationPercent",
                float(path.get("utilization", delivered / capacity if capacity else 0)) * 100,
            )
        )
        for attribute, expected in (
            ("data-route-capacity", capacity),
            ("data-route-delivered", delivered),
            ("data-route-utilization", expected_utilization),
            ("data-route-headroom", expected_headroom),
        ):
            assert math.isclose(float(row.get_attribute(attribute)), expected, abs_tol=1e-6), (
                f"{path['id']} rendered stale {attribute}"
            )
        assert row.get_attribute("data-route-bottleneck"), (
            f"{path['id']} has no readable first-bottleneck result"
        )

    clipping = inspector.evaluate(
        """root => [...root.querySelectorAll('*')].filter(node => {
          if (node.children.length || !node.textContent?.trim()) return false;
          node.scrollIntoView({block:'nearest',inline:'nearest'});
          const rect=node.getBoundingClientRect(), style=getComputedStyle(node);
          return rect.left < 0 || rect.right > innerWidth
            || (node.scrollWidth > node.clientWidth + 1 && style.overflowX !== 'visible')
            || (node.scrollHeight > node.clientHeight + 1 && style.overflowY !== 'visible');
        }).map(node => node.textContent.trim())"""
    )
    assert not clipping, f"connection telemetry text is clipped at 1100x700: {clipping!r}"

    before = _atomic_commit_sample(overhaul)
    overhaul.wait_for_function(
        """tick => {
          const snapshot=window.__overhaulAcceptance.snapshot();
          return snapshot.ticks.completed > tick
            && snapshot.ticks.raw === snapshot.ticks.completed
            && Number(document.documentElement.dataset.uiTick) === snapshot.ticks.completed
            && document.querySelector('[data-network-inspector][data-network-mode="power edit"]');
        }""",
        arg=before["snapshot"]["ticks"]["completed"],
    )
    assert not errors, f"network telemetry/liveness emitted browser errors: {errors[-5:]!r}"


def test_utility_placement_preview_is_visible_truthful_and_pure(overhaul, errors):
    _reset(overhaul, "utility-preview-browser-contract")
    before = _snapshot(overhaul)

    power_line = overhaul.locator('[data-blueprint="power_line"]')
    power_line.click()
    preview = overhaul.locator(
        '[data-placement-preview][data-preview-blueprint="power_line"]'
    )
    assert preview.count() == 1 and preview.is_visible()
    assert preview.get_attribute("data-preview-role") == "branch"
    assert math.isclose(
        float(preview.get_attribute("data-preview-maintenance")), 0.025, abs_tol=1e-9
    )
    copy = " ".join(preview.inner_text().split()).lower()
    for phrase in ("before you build", "branch role", "recurring flops/tick"):
        assert phrase in copy, f"placement preview omits {phrase!r}: {copy!r}"
    delta = preview.locator('[data-preview-resource="power"]')
    assert delta.count() == 1
    delta_copy = " ".join(delta.inner_text().split()).lower()
    assert "capacity" in delta_copy and "flops/tick" in delta_copy

    after = _snapshot(overhaul)
    assert after["economy"]["cash"] == before["economy"]["cash"]
    assert after["structures"] == before["structures"]
    assert after["utilities"]["requiredFlopsPerTick"] == before["utilities"]["requiredFlopsPerTick"]
    assert not errors, f"pure placement preview emitted browser errors: {errors[-5:]!r}"


def test_real_overload_fault_and_repair_snapshots_drive_local_tile_vfx(overhaul, errors):
    _reset(overhaul, "thermal-0")
    overload_history = _scenario(overhaul, "computer-overload")["snapshots"]
    throttled = next(
        snapshot for snapshot in overload_history
        if any(computer["state"] == "throttled" for computer in snapshot["computers"])
    )
    shutdown = next(
        snapshot for snapshot in overload_history
        if any(computer.get("fault") == "thermal-shutdown" for computer in snapshot["computers"])
    )

    _reset(overhaul, "ai-seeded-fault-contract")
    ai_history = _ai_history(_scenario(overhaul, "ai-risk-reward"), "ai-risk-reward")
    repairing = next(
        snapshot for snapshot in ai_history
        if any(actor["kind"] == "robot" and actor["state"] == "repairing"
               for actor in snapshot["actors"])
    )

    visual = overhaul.evaluate(
        """([throttled, shutdown, repairing]) => {
          const view=window.__overhaulView;
          const inspect = (snapshot, activity) => {
            view.render(snapshot);
            const cell=document.querySelector(`[data-tile-activity="${activity}"]`);
            if (!cell) return null;
            const content=cell.querySelector('.cell-content');
            return {
              activity:cell.dataset.tileActivity,
              fault:cell.dataset.tileFault || null,
              before:getComputedStyle(content,'::before').animationName,
              after:getComputedStyle(content,'::after').animationName,
            };
          };
          const result={
            overload:inspect(throttled,'overloaded'),
            broken:inspect(shutdown,'broken'),
            repair:inspect(repairing,'repairing'),
          };
          view.render(window.__overhaulGame.snapshot());
          return result;
        }""",
        [throttled, shutdown, repairing],
    )
    assert visual["overload"] and visual["overload"]["before"] == "tile-heat-stress"
    assert visual["broken"] and visual["broken"]["fault"] == "true"
    assert visual["broken"]["before"] == "tile-smoke-rise"
    assert visual["broken"]["after"] == "tile-fault-sparks"
    assert visual["repair"] and visual["repair"]["after"] == "tile-repair-sparks"
    assert not errors, f"state-driven tile VFX emitted browser errors: {errors[-5:]!r}"


def test_ai_semantic_path_left_trace_text_liveness_and_errors(overhaul, errors):
    overhaul.set_viewport_size({"width": 1100, "height": 700})
    _reset(overhaul, "ai-browser-contract")
    snapshots = _ai_history(_scenario(overhaul, "ai-risk-reward"), "ai-risk-reward")
    final = snapshots[-1]

    # Full animated paths use progressive disclosure: the clean floor keeps
    # only its thin tile traces until the player focuses a resource.
    ai_focus = overhaul.locator('[data-network-focus="ai"]')
    ai_focus.click()
    assert ai_focus.get_attribute("aria-pressed") == "true"

    for blueprint_id in ("ai_controller", "ai_bus"):
        blueprint = overhaul.locator(f'[data-blueprint="{blueprint_id}"]')
        blueprint.scroll_into_view_if_needed()
        assert blueprint.is_visible(), f"{blueprint_id} is not visible at 1100x700"

    # The live game commits every 500 ms, so sample model + DOM in one browser
    # task. Holding path data across a commit would compare different ticks.
    connected_paths = overhaul.evaluate(
        """() => window.__overhaulAcceptance.snapshot().networks.ai.paths
          .filter(path => path.connected)
          .map(path => {
            const node = document.querySelector(`[data-ai-path-id="${CSS.escape(path.id)}"]`);
            if (!node) return {id:path.id, missing:true};
              const style = getComputedStyle(node);
              const group = node.closest('[data-network-group]');
              const groupStyle = group ? getComputedStyle(group) : style;
              return {
                id: path.id,
                status: path.status,
                domStatus: node.dataset.aiPathState,
                disclosure: group?.dataset.disclosure,
                length: node.getTotalLength(),
                stroke: style.stroke,
                pathOpacity: parseFloat(style.opacity || '0'),
                opacity: parseFloat(groupStyle.opacity || '0'),
                visibility: groupStyle.visibility,
              };
          })"""
    )
    assert connected_paths
    for visual in connected_paths:
        assert not visual.get("missing"), visual
        assert visual["domStatus"] == visual["status"]
        assert visual["disclosure"] == "active"
        assert visual["length"] > 0
        assert visual["opacity"] > 0 and visual["visibility"] == "visible", visual
        assert visual["pathOpacity"] > 0
        assert visual["stroke"] not in ("none", "transparent", "rgba(0, 0, 0, 0)")

    traces = overhaul.locator('[data-cell-utility="ai"]')
    assert traces.count() >= 1
    trace_geometry = traces.evaluate_all(
        """nodes => nodes.map(node => {
          const cell=node.closest('[role="gridcell"]');
          const style=getComputedStyle(node), trace=node.getBoundingClientRect();
          const tile=cell?.getBoundingClientRect();
          return {
            layer:node.dataset.routeLayer,
            visible:style.visibility === 'visible' && +style.opacity > 0,
            trace:{x:trace.x,y:trace.y,width:trace.width,height:trace.height},
            cell:tile ? {x:tile.x,y:tile.y,width:tile.width,height:tile.height} : null,
          };
        })"""
    )
    for item in trace_geometry:
        assert item["visible"] and item["layer"] == "ai" and item["cell"]
        trace_box, cell_box = item["trace"], item["cell"]
        assert trace_box["width"] <= cell_box["width"] * 0.12
        assert trace_box["height"] >= cell_box["height"] * 0.45
        assert trace_box["x"] - cell_box["x"] <= cell_box["width"] * 0.15, (
            f"AI trace is not a thin left-edge route: trace={trace_box!r} cell={cell_box!r}"
        )

    # The panel's values legitimately refresh every committed tick. Scroll and
    # resolve the current node atomically so the audit never holds a stale
    # ElementHandle across that replacement boundary.
    overhaul.evaluate(
        """() => document.querySelector('[data-ai-panel]')
          ?.scrollIntoView({block: 'nearest', inline: 'nearest'})"""
    )
    panel = overhaul.locator("[data-ai-panel]")
    assert panel.is_visible(), "AI network panel is not visible at 1100x700"
    panel_text = " ".join(panel.inner_text().split()).lower()
    for phrase in (
        "ai network", "training level", "efficiency bonus", "mistake chance",
        "opt in", "fault", "repair",
    ):
        assert phrase in panel_text, f"AI panel omits full text {phrase!r}: {panel_text!r}"
    assert panel.get_attribute("data-ai-state")
    hud = overhaul.locator("[data-ai-hud]")
    assert hud.count() == 1 and hud.is_visible()
    visible = overhaul.evaluate(
        """() => {
          const snapshot=window.__overhaulAcceptance.snapshot();
          const hud=document.querySelector('[data-ai-hud]');
          return {
            snapshot,
            hud:{quality:+hud.dataset.aiQuality,bonus:+hud.dataset.aiBonus,risk:+hud.dataset.aiRisk},
            targets:[...document.querySelectorAll('[data-ai-target]')].map(node => ({
              id:node.dataset.aiTarget,
              enabled:node.dataset.aiEnabled,
              connected:node.dataset.aiConnected,
              toggles:node.querySelectorAll('[data-ai-toggle]').length,
            })),
          };
        }"""
    )
    visible_state = visible["snapshot"]
    assert visible["hud"]["quality"] == visible_state["ai"]["level"]
    assert math.isclose(
        visible["hud"]["bonus"],
        visible_state["ai"]["bonusPercent"],
        abs_tol=1e-6,
    )
    assert math.isclose(
        visible["hud"]["risk"],
        visible_state["ai"]["mistakeChance"],
        abs_tol=1e-6,
    )
    assert visible["targets"]
    for target in visible["targets"]:
        structure = next(item for item in visible_state["structures"] if item["id"] == target["id"])
        assert target["enabled"] == str(structure["aiEnabled"]).lower()
        assert target["connected"] == str(structure["aiConnected"]).lower()
        assert target["toggles"] == 1
    clipping = panel.evaluate(
        """root => [...root.querySelectorAll('*')].filter(node => {
          const text = node.textContent?.trim();
          if (!text || node.children.length) return false;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight
            || (node.scrollWidth > node.clientWidth + 1 && style.overflowX !== 'visible')
            || (node.scrollHeight > node.clientHeight + 1 && style.overflowY !== 'visible');
        }).map(node => ({text: node.textContent.trim(), rect: node.getBoundingClientRect().toJSON()}))"""
    )
    assert not clipping, f"AI text is clipped at 1100x700: {clipping!r}"

    before = _atomic_commit_sample(overhaul)
    overhaul.wait_for_function(
        """tick => {
          const snapshot = window.__overhaulAcceptance.snapshot();
          return snapshot.ticks.completed > tick
            && snapshot.ticks.raw === snapshot.ticks.completed
            && Number(document.documentElement.dataset.uiTick) === snapshot.ticks.completed;
        }""",
        arg=before["snapshot"]["ticks"]["completed"],
    )
    assert not errors, f"AI browser contract emitted errors: {errors[-5:]!r}"


@contextmanager
def _live_server():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "serve.py"), str(port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}/overhaul.html"
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                with urlopen(url, timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)
        yield url
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


@pytest.mark.skipif(not RUN_SOAK, reason="set RUN_OVERHAUL_SOAK=1 for the 30-second overhaul soak")
def test_overhaul_30_second_live_server_soak_shape(page, errors):
    assert SOAK_SECONDS >= 1, f"OVERHAUL_SOAK_SECONDS must be positive, got {SOAK_SECONDS}"
    with _live_server() as url:
        page.goto(_url(url, "overhaul-soak"))
        page.wait_for_function("() => window.__overhaulAcceptance?.ready === true", timeout=5_000)
        page.evaluate(
            """() => {
              const beat = window.__overhaulSoak = {
                frames: 0, intervals: 0, maxFrameGap: 0, lastFrameAt: performance.now(),
              };
              const frame = (now) => {
                beat.maxFrameGap = Math.max(beat.maxFrameGap, now - beat.lastFrameAt);
                beat.lastFrameAt = now;
                beat.frames++;
                requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
              setInterval(() => beat.intervals++, 250);
            }"""
        )
        _scenario(page, "computer-path-connected")
        started = time.monotonic()
        deadline = started + SOAK_SECONDS
        initial = _snapshot(page)
        samples = 0
        while time.monotonic() < deadline:
            # Sample faster than the one-second contract so browser/runner
            # scheduling overhead cannot consume the final required sample.
            page.wait_for_timeout(min(750, max(100, int((deadline - time.monotonic()) * 1000))))
            committed = _atomic_commit_sample(page, include_soak=True)
            snapshot = committed["snapshot"]
            beat = committed["soak"]
            assert snapshot["ticks"]["raw"] == snapshot["ticks"]["completed"] == committed["domTick"], (
                f"soak UI commit mismatch at sample {samples}: snapshot={snapshot['ticks']!r} "
                f"dom={committed['domTick']}"
            )
            assert beat["frames"] > 0 and beat["intervals"] > 0, f"soak heartbeat stopped: {beat!r}"
            assert beat["maxFrameGap"] < 3_000, f"soak frame gap exceeded 3s: {beat!r}"
            assert math.isclose(committed["domFlops"], snapshot["flops"]["raw"], abs_tol=1e-6)
            assert math.isclose(committed["domCash"], snapshot["economy"]["cash"], abs_tol=1e-6)
            assert not errors, f"browser errors during soak sample {samples}: {errors[-5:]!r}"
            safe_action = page.locator("[data-overhaul-safe-action]:visible").first
            if safe_action.count() and samples % 5 == 0:
                safe_action.click()
            samples += 1
        final = _snapshot(page)
        assert samples >= max(1, SOAK_SECONDS - 1), f"too few soak samples: {samples}"
        assert final["ticks"]["completed"] > initial["ticks"]["completed"], (
            f"completed tick did not advance during {SOAK_SECONDS}s soak: "
            f"initial={initial['ticks']!r} final={final['ticks']!r}"
        )
