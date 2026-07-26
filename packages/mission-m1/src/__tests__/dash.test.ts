import { test } from "node:test";
import assert from "node:assert/strict";

import { DASH_ENVELOPE, MOVEMENT_CAPABILITIES } from "@pa/engine-world/parkour";
import { RUN_SPEED, dashSpeed } from "@pa/engine-world/playerMotion";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { cheapestPath, routeGraph } from "../routeGraph.js";
import { receivingTargetsOf, verifyLevel, verifyLink } from "../traversal.js";
import type { RouteLink } from "../types.js";

// The dash's content, and the promise that it stays content rather than a
// requirement. `DASH_ENVELOPE` is published deliberately OUTSIDE
// `MOVEMENT_CAPABILITIES` so that a level may never need a burst to be
// finishable; these are the assertions that keep M1 on the right side of that.

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const { linkVerdicts } = verifyLevel(level, compiled);
const nodes = new Map(level.nodes.map((n) => [n.id, n]));
const targets = receivingTargetsOf(level);

const dashLinks = level.links.filter((link) => link.kind === "DASH_JUMP");

test("the mission has somewhere to spend a dash", () => {
  assert.ok(
    dashLinks.length >= 1,
    "beginDash is bound to a key and the level never asks for it, which is a system nobody paid for",
  );
});

test("every dash gap is past a running jump and inside a burst", () => {
  for (const verdict of linkVerdicts) {
    if (verdict.kind !== "DASH_JUMP") continue;
    assert.ok(verdict.ok, `${verdict.id}: ${verdict.problems.join("; ")}`);
    assert.ok(verdict.gapM !== null, `${verdict.id} measured no gap`);
    assert.ok(
      verdict.gapM! > MOVEMENT_CAPABILITIES.maxFlatGapM,
      `${verdict.id} is ${verdict.gapM!.toFixed(2)}m, which a running jump clears at ${MOVEMENT_CAPABILITIES.maxFlatGapM.toFixed(2)}m — the dash buys nothing here`,
    );
    assert.ok(
      verdict.gapM! < DASH_ENVELOPE.jumpGapM,
      `${verdict.id} is ${verdict.gapM!.toFixed(2)}m against a ${DASH_ENVELOPE.jumpGapM.toFixed(2)}m burst`,
    );
    assert.equal(verdict.verb, "DASH");
  }
});

test("a dash is never the only way through", () => {
  // The load-bearing one. Delete every burst from the route and the mission is
  // still finishable at both the cautious and the skilled setting — so the dash
  // is a line a confident player finds, never a lock on the objective.
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

test("no dash link sits on the guaranteed path", () => {
  for (const link of dashLinks) {
    assert.notEqual(
      link.line,
      "SAFE",
      `${link.id} is a SAFE link, which makes the burst part of the cautious route`,
    );
  }
});

test("the dash gap pays in seconds and its failure costs nothing", () => {
  // The authored miss. Take the same lip at running speed and the arc falls
  // short onto the bough one tier down — which is exactly where the FAST line
  // was going anyway — so the punishment for trying and missing is the route
  // the player would otherwise have taken, plus one climb.
  const spec = level.links.find((link) => link.id === "E_ELLIOT_LIP->F_CROWN");
  assert.ok(spec, "the authored dash gap has moved or been renamed");

  const asRunningJump: RouteLink = { ...spec!, kind: "JUMP", speedMps: RUN_SPEED };
  const short = verifyLink(compiled, nodes, asRunningJump, targets);
  assert.equal(
    short.landedOn,
    "BOUGH_LOW",
    "a missed dash has to land somewhere the player can carry on from",
  );

  const burst = linkVerdicts.find((verdict) => verdict.id === spec!.id)!;
  assert.equal(burst.landedOn, "BOUGH_CROWN", "the burst lands at the nail height");
  assert.ok(
    dashSpeed(RUN_SPEED) > RUN_SPEED,
    "the burst is a burst",
  );

  // And it is genuinely a saving: the alternative is the same jump plus a climb.
  const climb = linkVerdicts.find((verdict) => verdict.id === "F_LOW->F_CROWN")!;
  assert.ok(
    burst.durationS < short.durationS + climb.durationS,
    "the dash line has to be quicker than the jump-and-climb it replaces",
  );
});
