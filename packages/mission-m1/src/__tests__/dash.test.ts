import { test } from "node:test";
import assert from "node:assert/strict";

import { DASH_ENVELOPE, MOVEMENT_CAPABILITIES } from "@pa/engine-world/parkour";
import { RUN_SPEED, dashSpeed } from "@pa/engine-world/playerMotion";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { cheapestPath, routeGraph } from "../routeGraph.js";
import { verifyLevel } from "../traversal.js";

// M1 collapsed to a single guided SAFE route. The crossing FAST/EXPERT branches
// retired, and every DASH_JUMP in the mission sat on one of them, so the route
// now authors none. The dash CAPABILITY stays first-class in the engine — a real
// clip is baked for it and `DASH_ENVELOPE` is published deliberately OUTSIDE
// `MOVEMENT_CAPABILITIES` so no level may ever NEED a burst to be finishable — it
// simply is not a move the guaranteed route asks for. These keep both facts true.

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const { linkVerdicts } = verifyLevel(level, compiled);

const dashLinks = level.links.filter((link) => link.kind === "DASH_JUMP");

test("the single guided route authors no dash", () => {
  // The DASH_JUMP links were all EXPERT crossing-line shortcuts; collapsing to one
  // SAFE route retires them. A dash on the guaranteed route would be a burst the
  // cautious line depends on, which is exactly what a single SAFE route rules out.
  assert.equal(
    dashLinks.length,
    0,
    `the route authors ${dashLinks.length} dash link(s); the single SAFE route asks for none`,
  );
});

test("the dash stays first-class in the engine, outside the finishable envelope", () => {
  // Plain DASH is still a real capability, reaching past what a running jump
  // clears — it is published outside MOVEMENT_CAPABILITIES so a level may use it
  // but never require it.
  assert.ok(dashSpeed(RUN_SPEED) > RUN_SPEED, "the burst is a burst");
  assert.ok(
    DASH_ENVELOPE.jumpGapM > MOVEMENT_CAPABILITIES.maxFlatGapM,
    "the dash envelope reaches past the gap a running jump already clears",
  );
});

test("a player who never dashes still finishes at every setting", () => {
  // The load-bearing one. Delete every burst from the route and the mission is
  // still finishable at the cautious and the skilled setting — so the dash could
  // only ever have been a line a confident player finds, never a lock on the
  // objective. It is trivially true now that the route authors none, and it stays
  // a guard against a future dash being made load-bearing.
  const withoutDash = {
    ...level,
    links: level.links.filter((link) => link.kind !== "DASH_JUMP"),
  };
  const graph = routeGraph(
    withoutDash,
    linkVerdicts.filter((verdict) => verdict.kind !== "DASH_JUMP"),
  );
  for (const allow of [
    ["SAFE"],
    ["SAFE", "FAST"],
    ["SAFE", "FAST", "EXPERT"],
  ] as Array<Array<"SAFE" | "FAST" | "EXPERT">>) {
    const toPost = cheapestPath(graph, level.startNode, level.postNode, allow);
    const toArena = cheapestPath(graph, level.postNode, level.arenaNode, allow);
    assert.ok(
      toPost && toArena,
      `a player who never dashes cannot finish on ${allow.join("+")}`,
    );
  }
});
