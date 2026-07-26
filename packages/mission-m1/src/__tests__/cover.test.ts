import { test } from "node:test";
import assert from "node:assert/strict";

import { CROUCH_HEIGHT, STAND_HEIGHT } from "@pa/engine-world/collision";
import { STEALTH_TUNING, visibility } from "@pa/engine-world/stealth";

import { compileLevel, lightLevelAt } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { AMBIENT_LIGHT } from "../level/opposition.js";
import {
  COVER_MIN_SCREENED_FRACTION,
  COVER_REACH_M,
  coverAgainst,
} from "../cover.js";
import { coveredAtFor } from "../runtime.js";
import { watcherEyeAt } from "../stealth.js";

// Hard cover is the one stealth term that is a level's own geometry rather than
// the engine's tuning: `visibility` owns `coverFactor`, and what M1 owns is where
// there is something to press yourself against. These tests exist because the
// predicate previously fired at NO node in the mission where the player was
// visible — everything either screened nothing at all or screened the chest ray
// too, and a blocked chest ray is already worth zero without any help from cover.

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const patrolById = new Map(level.patrols.map((p) => [p.id, p]));

const TICKS = 2700; // one 45-second cycle
const STEP = 6;

interface Read {
  duty: number;
  coverShare: number;
  meanBare: number;
  meanCovered: number;
  screeningIds: Set<string>;
}

/** What a watcher makes of a node over a whole cycle, with and without cover. */
function readAt(nodeId: string, patrolId: string, capsuleHeight: number): Read {
  const node = nodeById.get(nodeId);
  assert.ok(node, `unknown node ${nodeId}`);
  const patrol = patrolById.get(patrolId);
  assert.ok(patrol, `unknown patrol ${patrolId}`);
  const light = lightLevelAt(level, AMBIENT_LIGHT, node!.pos[0], node!.pos[2]);
  const position = { x: node!.pos[0], y: node!.pos[1], z: node!.pos[2] };
  let samples = 0;
  let seen = 0;
  let coveredWhenSeen = 0;
  let sumBare = 0;
  let sumCovered = 0;
  const screeningIds = new Set<string>();

  for (let tick = 0; tick < TICKS; tick += STEP) {
    samples += 1;
    const eye = { ...watcherEyeAt(patrol!, tick), id: patrol!.id };
    const player = {
      position,
      capsuleHeight,
      exposure: light < 0.15 ? ("PARTIAL" as const) : ("EXPOSED" as const),
      motion:
        capsuleHeight < STAND_HEIGHT
          ? ("CROUCH_MOVE" as const)
          : ("SPRINT" as const),
      covered: false,
      lightLevel: light,
      crowdBlend: 0,
    };
    const bare = visibility(compiled.world, eye, player).visibility;
    if (bare <= 0) continue;
    seen += 1;
    const cover = coverAgainst(compiled.world, eye, {
      pos: position,
      capsuleHeight,
      tick,
    });
    if (cover.covered) {
      coveredWhenSeen += 1;
      for (const id of cover.screeningIds) screeningIds.add(id);
    }
    sumBare += bare;
    sumCovered += visibility(compiled.world, eye, {
      ...player,
      covered: cover.covered,
    }).visibility;
  }

  return {
    duty: seen / samples,
    coverShare: seen > 0 ? coveredWhenSeen / seen : 0,
    meanBare: seen > 0 ? sumBare / seen : 0,
    meanCovered: seen > 0 ? sumCovered / seen : 0,
    screeningIds,
  };
}

test("hard cover fires where the player is actually being read", () => {
  // The load-bearing one. Not "a blocker is nearby" but: over a whole patrol
  // cycle, restricted to the ticks this node is visible AT ALL, cover fires and
  // takes something off the read. A predicate that only fires once visibility is
  // already zero is a predicate that does nothing.
  const paying: Array<[string, string, number]> = [
    ["C_GALLERY_MASONS", "WATCH_OLD_BRICK", STAND_HEIGHT],
    ["C_GALLERY_CORNER", "WATCH_OLD_BRICK", CROUCH_HEIGHT],
    ["C_SCAFF_2", "WATCH_OLD_BRICK", CROUCH_HEIGHT],
    ["D2_OVER_OUT", "SENTRY_ROPEWALK", STAND_HEIGHT],
  ];
  for (const [nodeId, patrolId, height] of paying) {
    const read = readAt(nodeId, patrolId, height);
    assert.ok(
      read.duty > 0.1,
      `${nodeId} is only read for ${(read.duty * 100).toFixed(0)}% of ${patrolId}'s cycle, so cover there buys nothing`,
    );
    assert.ok(
      read.coverShare > 0.5,
      `${nodeId} has nothing to press against: cover fires on ${(read.coverShare * 100).toFixed(0)}% of the ticks it is seen`,
    );
    assert.ok(
      read.meanCovered < read.meanBare * 0.5,
      `${nodeId}: cover has to more than halve the read; ${read.meanBare.toFixed(3)} -> ${read.meanCovered.toFixed(3)}`,
    );
  }
});

test("the reflex balcony has a third answer, and it is a graded one", () => {
  // Before the masons' stack the beat had exactly two answers, the hood and the
  // corner, and both are complete breaks. Pressing in behind something is the
  // in-between state `covered` exists to name, so the west end of the balcony
  // must produce three distinct outcomes rather than two.
  const standing = readAt("C_GALLERY_MASONS", "WATCH_OLD_BRICK", STAND_HEIGHT);
  const crouched = readAt("C_GALLERY_MASONS", "WATCH_OLD_BRICK", CROUCH_HEIGHT);

  assert.ok(standing.duty > 0.4, "the west balcony is the most-watched node on the route");
  assert.ok(
    standing.coverShare > 0.9,
    "a body at the stack is behind the stack for the whole of his sweep",
  );
  assert.ok(
    Math.abs(standing.meanCovered / standing.meanBare - STEALTH_TUNING.coverFactor) < 0.02,
    "standing behind it is worth exactly the engine's own coverFactor, not a level's private number",
  );
  assert.equal(
    crouched.duty,
    0,
    "and crouching behind the same stack is a complete break, so stance and cover are two axes rather than one",
  );
  assert.ok(
    standing.screeningIds.has("TOWNHOUSE_MASONS_W"),
    "the cover doing the work has to be the cover the section is authored around",
  );
});

test("cover is never the thing reporting a break the field already found", () => {
  // The hood returns zero visibility on its own. If cover fired there it would be
  // claiming credit for an occlusion `visibility` had already resolved, and the
  // level would read as though hard cover were doing work it is not.
  for (const [nodeId, patrolId] of [
    ["C_GALLERY_HOOD", "WATCH_OLD_BRICK"],
    ["B2_ARCADE_CASKS", "SENTRY_ARCADE"],
  ] as Array<[string, string]>) {
    const node = nodeById.get(nodeId)!;
    const height = node.tags.includes("crouch") ? CROUCH_HEIGHT : STAND_HEIGHT;
    const read = readAt(nodeId, patrolId, height);
    assert.equal(
      read.duty,
      0,
      `${nodeId} is a complete break, so there is nothing for cover to reduce`,
    );
  }
});

test("a cone that cannot see you does not get to call you exposed", () => {
  // `coverAt` hands the field one boolean for every watcher, so it has to choose
  // a cone. A watcher out of range, facing away, or behind a wall has already
  // resolved to zero; letting the nearest such cone answer would report EXPOSED
  // on behalf of somebody with their back turned.
  const patrol = patrolById.get("SENTRY_ARCADE")!;
  const behindHim = nodeById.get("B2_ARCADE_S")!;
  const result = coverAgainst(compiled.world, { ...watcherEyeAt(patrol, 0), id: patrol.id }, {
    pos: { x: behindHim.pos[0], y: behindHim.pos[1], z: behindHim.pos[2] },
    capsuleHeight: STAND_HEIGHT,
    tick: 0,
  });
  assert.equal(result.resolving, false, "the arcade sentry faces north and this is south of him");
  assert.equal(result.covered, false);
});

test("every screen doing the work is within arm's reach of the body using it", () => {
  // The reach is what separates cover from standing in the far shadow of a
  // building, and it is the movement layer's own obstacle probe rather than a
  // number invented here — the cart you can vault is the cart you can hide
  // behind.
  assert.equal(COVER_REACH_M, 2.2);
  assert.ok(
    COVER_MIN_SCREENED_FRACTION > 0.25 && COVER_MIN_SCREENED_FRACTION < 0.75,
    "at a quarter cover fires everywhere and makes light and crowd decorative; at three quarters it only fires once the read is already zero",
  );
  for (const [nodeId, patrolId, height] of [
    ["C_GALLERY_MASONS", "WATCH_OLD_BRICK", STAND_HEIGHT],
    ["D2_OVER_OUT", "SENTRY_ROPEWALK", STAND_HEIGHT],
  ] as Array<[string, string, number]>) {
    const node = nodeById.get(nodeId)!;
    for (const id of readAt(nodeId, patrolId, height).screeningIds) {
      const mass = compiled.massById.get(id);
      assert.ok(mass, `${id} screens ${nodeId} but is not an authored mass`);
      const dx = Math.max(mass!.rect.minX - node.pos[0], 0, node.pos[0] - mass!.rect.maxX);
      const dz = Math.max(mass!.rect.minZ - node.pos[2], 0, node.pos[2] - mass!.rect.maxZ);
      assert.ok(
        Math.hypot(dx, dz) <= COVER_REACH_M,
        `${id} is ${Math.hypot(dx, dz).toFixed(2)}m from ${nodeId}`,
      );
    }
  }
});

test("the port binding is a pure function of a player read", () => {
  // The shape the container hands in is `MissionPlayerRead`, which carries a
  // position, the LIVE capsule height and the tick. Anything else — and in
  // particular the seed the patrol phase comes from — has to be closed over
  // here, because the port never passes it.
  const coveredAt = coveredAtFor(1234, compiled);
  const gallery = nodeById.get("C_GALLERY_W")!;
  const read = {
    pos: { x: gallery.pos[0], y: gallery.pos[1], z: gallery.pos[2] },
    capsuleHeight: STAND_HEIGHT,
    tick: 0,
  };
  const first = coveredAt(read);
  assert.equal(typeof first, "boolean");
  assert.equal(coveredAt(read), first, "the same read on the same tick is the same answer");
  assert.equal(
    coveredAtFor(1234, compiled)(read),
    first,
    "and a second binding on the same seed agrees, so a replay sees the same cover",
  );
});
