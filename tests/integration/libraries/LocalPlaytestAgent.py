"""Small, deterministic decision engine for Robot Framework playtests.

This is intentionally an observable local agent rather than a timer soak.  It
receives only the public committed snapshot, chooses one player-sized goal at a
time, and returns a reason that Robot records beside a named screenshot.  The
policy can later be replaced by a local model without changing the Robot
keyword or its evidence format.
"""


class LocalPlaytestAgent:
    ROBOT_LIBRARY_SCOPE = "SUITE"

    def choose_playtest_move(self, snapshot, goal="unlock-external-markets"):
        recovery = snapshot.get("recovery") or {}
        research = snapshot.get("research") or {}
        routes = snapshot.get("routes") or {}
        flops = snapshot.get("flops") or {}

        if self.playtest_goal_is_met(snapshot, goal):
            return {"kind": "done", "reason": f"Goal {goal} is visibly complete."}

        active = recovery.get("activeRepair")
        if active:
            return {
                "kind": "wait",
                "reason": (
                    f"Repair crew is working on {active['entityId']}; "
                    f"{active['ticksRemaining']} committed ticks remain."
                ),
            }

        broken = next(
            (target for target in recovery.get("targets", [])
             if target.get("state") == "broken"),
            None,
        )
        if broken:
            return {
                "kind": "repair",
                "entityId": broken["entityId"],
                "x": broken["x"],
                "y": broken["y"],
                "reason": (
                    f"{broken['label']} is a critical inherited fault; "
                    "repairing it is the shortest path to productive compute."
                ),
            }

        if recovery.get("phase") != "online":
            return {
                "kind": "wait",
                "reason": "No repair button is available yet, but the recovery contract is not online.",
            }

        if float(flops.get("raw") or 0) <= 0:
            return {
                "kind": "wait",
                "reason": "Critical plant is restored; wait for the inherited rack to finish booting.",
            }

        next_node = research.get("next")
        if next_node and float(routes.get("research") or 0) < 0.999:
            return {
                "kind": "route-research",
                "nodeId": next_node["id"],
                "reason": (
                    f"{next_node['name']} is the next capability gate; route the recovered "
                    f"FLOPS to Research ({research.get('points', 0):.1f}/{next_node['threshold']})."
                ),
            }

        if next_node:
            return {
                "kind": "wait",
                "nodeId": next_node["id"],
                "reason": (
                    f"Research routing is active; wait for {next_node['name']} "
                    f"({research.get('points', 0):.1f}/{next_node['threshold']})."
                ),
            }

        return {
            "kind": "done",
            "reason": "The inherited site is online and every current research node is complete.",
        }

    def playtest_goal_is_met(self, snapshot, goal="unlock-external-markets"):
        recovery = snapshot.get("recovery") or {}
        research = snapshot.get("research") or {}
        completed = set(research.get("completedIds") or [])
        raw = float((snapshot.get("flops") or {}).get("raw") or 0)
        if goal == "recover-site":
            return recovery.get("phase") == "online" and raw > 0
        if goal == "unlock-external-markets":
            return "external-markets" in completed
        if goal == "complete-opening-research":
            nodes = research.get("nodes") or []
            return bool(nodes) and all(node.get("state") == "complete" for node in nodes)
        raise AssertionError(f"Unknown local playtest goal: {goal}")
