import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { M1_POST_OBJECTIVE_ID } from "@pa/beat";
import { M1_EFFIGY_RUN, PRECISION } from "@pa/mission-m1";
import { M1_MISSION_ID, m1Instance } from "../src/chapter/m1Mission.js";
import {
  advanceWayfinding,
  createMissionRuntime,
  markRead,
  missionPresentation,
  standingObjective,
} from "../src/mission/traversal.js";
import { testInstance } from "./missionHarness.js";

// ---------------------------------------------------------------------------
// Whether the run says what it is.
//
// A playtester finished the mission and reported that it had no objectives and
// no markers — and it had six objectives, printed continuously, in the corner
// of the screen. That is the failure these tests are written against: not the
// absence of information but its arrangement, and specifically two properties
// that are easy to have and easy to lose again in a refactor.
//
// ONE THING AT A TIME. The surfaces report the first required step still open,
// not the list. A list is a thing to read and nobody reads at a sprint.
//
// ONE ANSWER, TWO SURFACES. The plate drawn in the street and the card in the
// corner both go through `standingObjective`, so they cannot name two different
// places. A marker pointing at the yard while the HUD still asks for the
// handbill would be worse than either surface on its own, and nothing about the
// screen would look broken.
// ---------------------------------------------------------------------------

function m1() {
  return m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1,
    seed: 0xb057,
    Scenery: null,
  });
}

function runtimeAt(pos: { x: number; y: number; z: number }) {
  const instance = m1();
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  runtime.motion = { ...runtime.motion, pos };
  return runtime;
}

function nodePos(id: string) {
  const node = M1_EFFIGY_RUN.nodes.find((candidate) => candidate.id === id)!;
  return { x: node.pos[0], y: node.pos[1], z: node.pos[2] };
}

// ---- one thing at a time --------------------------------------------------

test("the run stands on the first required step that is still open", () => {
  const runtime = createMissionRuntime({ instance: m1(), seed: 0xb057 });

  const opening = standingObjective(runtime);
  assert.ok(opening);
  assert.equal(opening!.objective.id, M1_POST_OBJECTIVE_ID);
  assert.equal(opening!.step, 1);
  assert.equal(opening!.steps, 2);
  assert.equal(opening!.next?.id, "reach-the-yard");

  runtime.satisfied.push(M1_POST_OBJECTIVE_ID);
  const after = standingObjective(runtime);
  assert.equal(after?.objective.id, "reach-the-yard");
  assert.equal(after?.step, 2);
  assert.equal(after?.next, null, "the last step has nothing after it to name");

  runtime.satisfied.push("reach-the-yard");
  assert.equal(
    standingObjective(runtime),
    null,
    "with the route done there is nothing left to ask for, and asking would be a lie",
  );
});

test("optional challenges are counted and never named", () => {
  const runtime = createMissionRuntime({ instance: m1(), seed: 0xb057 });
  const standing = missionPresentation(runtime).standing;
  assert.ok(standing);

  const optional = runtime.instance.objectives.filter((o) => !o.required);
  assert.ok(optional.length > 0, "M1 authors challenges; this test is about them");
  assert.equal(standing!.optionalTotal, optional.length);
  assert.equal(standing!.optionalMet, 0);

  // The whole point: none of their labels reaches the standing read, so the
  // player is told the one thing they have to do rather than five things.
  const said = [standing!.label, standing!.thenLabel ?? ""].join(" ");
  for (const objective of optional) {
    assert.ok(
      !said.includes(objective.label),
      `"${objective.label}" is a challenge and is being printed as an instruction`,
    );
  }

  runtime.satisfied.push(optional[0]!.id);
  assert.equal(missionPresentation(runtime).standing?.optionalMet, 1);
  assert.equal(
    missionPresentation(runtime).standing?.id,
    M1_POST_OBJECTIVE_ID,
    "taking a challenge must not advance the run",
  );
});

// ---- one answer, two surfaces ---------------------------------------------

test("the card in the corner and the plate in the street read the same mark", () => {
  const runtime = runtimeAt(nodePos("B_STREET_MID"));
  const standing = standingObjective(runtime)!;
  assert.deepEqual(
    missionPresentation(runtime).standing?.mark,
    markRead(standing.objective, runtime.motion.pos),
  );
});

// ---- the marks are the level's own points ---------------------------------

test("both required steps are places, and the places are the level's own", () => {
  const required = m1().objectives.filter((objective) => objective.required);
  assert.equal(required.length, 2);

  const post = required[0]!;
  assert.ok(post.mark, "the handbill step has nowhere to point");
  // The beat's own target, not a coordinate anybody typed twice: a mark that
  // restated where the elm is could point at the wrong tree, and the failure
  // would look like a rendering bug.
  assert.deepEqual(
    [post.mark!.pos.x, post.mark!.pos.y, post.mark!.pos.z],
    PRECISION.target,
  );

  const yard = required[1]!;
  assert.ok(yard.mark, "the exfil step has nowhere to point");
  assert.deepEqual(yard.mark!.pos, nodePos("G_GATE"));

  for (const objective of required) {
    assert.ok(
      objective.mark!.title.length > 0 && objective.mark!.detail,
      `${objective.id} has a mark with nothing written on it`,
    );
  }
});

test("the mark measures the route, not the crow", () => {
  const runtime = createMissionRuntime({ instance: m1(), seed: 0xb057 });
  const spawn = runtime.instance.spawn.pos;
  const mark = missionPresentation(runtime).standing!.mark!;

  const line = Math.hypot(mark.pos.x - spawn.x, mark.pos.z - spawn.z);
  assert.equal(mark.viaRoute, true);
  assert.ok(
    mark.rangeM > line * 1.15,
    `the marker reads ${mark.rangeM.toFixed(0)}m and the elm is ${line.toFixed(0)}m away ` +
      "as the crow flies; on a rooftop route those must not be the same number",
  );
});

test("the mark points at the next place on the route, not through the wall", () => {
  // The plate names the elm and prints the distance to the elm. WHERE IT LANDS
  // is the next place on the way, and that is a deliberate reversal of what this
  // file used to assert. The old contract — point at the objective, say how far
  // up it is, refuse to say anything about how — was measured in play and it
  // does not survive Dock Square: the elm is on the far side of a twelve-metre
  // Town House, the way up is a scaffold eight metres off the bearing, and a
  // marker aimed straight at the tree aims the player at a wall. Three
  // playthroughs ended with "there's genuinely just no path for getting to the
  // tree". Naming the goal and pointing at the next hold answers both questions
  // instead of one.
  // A LATER attempt, so guidance uses every authored line. Attempt one is
  // handed SAFE-only, and the west crossing of Dock Square is a FAST/EXPERT
  // point with no SAFE egress toward the post — from there a first-timer is
  // correctly NOT pointed through the square, which is a separate property
  // pinned in the wayfinding suite. This test is about the general mechanism:
  // when a route exists, the mark lands on the next place along it.
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 2,
    seed: 0xb057,
    Scenery: null,
  });
  const inTheSquare = createMissionRuntime({ instance, seed: 0xb057 });
  inTheSquare.motion = { ...inTheSquare.motion, pos: nodePos("C_SQUARE_W") };
  // The waypoint is committed by the runtime step, not by reading the mark, so
  // advance it once from here — as the fixed step does — before the surfaces
  // read it. This is the same call `stepMissionRuntime` makes every tick.
  advanceWayfinding(inTheSquare);
  const mark = missionPresentation(inTheSquare).standing!.mark!;
  const elm = PRECISION.target;

  assert.ok(
    Math.hypot(mark.pos.x - elm[0], mark.pos.z - elm[2]) > 20,
    "from Dock Square the mark must be a nearby hold, not the tree itself",
  );
  assert.ok(
    Math.hypot(
      mark.pos.x - inTheSquare.motion.pos.x,
      mark.pos.z - inTheSquare.motion.pos.z,
    ) < 12,
    "and it must be somewhere the player can actually run to from here",
  );
  assert.ok(
    mark.rangeM > 60,
    `the distance printed is still the distance to the elm; got ${mark.rangeM.toFixed(0)}m`,
  );
  assert.ok(
    mark.detail?.startsWith("by way of"),
    `the plate has to say the place is a staging post, not the goal; got "${mark.detail}"`,
  );
});

test("the rise is about the place the mark is on", () => {
  // Half the question on a roof is "how far up", and the answer is only useful
  // about somewhere the player is going next. Standing on the scaffold's foot,
  // the next hold is above; on the steeple gallery, the tree is below.
  const scaffoldRuntime = runtimeAt(nodePos("C_SCAFF_FOOT"));
  advanceWayfinding(scaffoldRuntime);
  const scaffold = missionPresentation(scaffoldRuntime).standing!;
  assert.ok(
    scaffold.mark!.riseM > 1,
    `the way on from the scaffold foot is up; got ${scaffold.mark!.riseM.toFixed(1)}m`,
  );

  const steepleRuntime = runtimeAt(nodePos("E_GALLERY"));
  advanceWayfinding(steepleRuntime);
  const steeple = missionPresentation(steepleRuntime).standing!;
  assert.ok(
    steeple.mark!.riseM < 0,
    "off the steeple gallery the work is below, and a marker that cannot say so " +
      "is a marker that sends the player up",
  );
});

test("a level whose objective is a condition draws no mark at all", () => {
  // Not every objective is a destination. "Never be seen" has no place, and the
  // container must draw nothing rather than invent somewhere to point.
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [
        {
          id: "stay-unseen",
          label: "Never be read",
          required: true,
          satisfiedBy: () => false,
        },
      ],
    }),
    seed: 1,
  });
  const standing = missionPresentation(runtime).standing;
  assert.equal(standing?.label, "Never be read");
  assert.equal(standing?.mark, null);
});

// ---- where the mark is drawn ----------------------------------------------

test("the mark is drawn in the world and driven by the live camera", () => {
  // Asserted against the source because this suite has no DOM and no renderer,
  // and both properties are structural rather than numeric. The mark has to be
  // mounted INSIDE the mission's canvas — a direction pasted on the glass is a
  // HUD sticker, and the whole point of extending the visor was that its
  // annotation sits in the street. And it must take its orientation from the
  // camera it is handed each frame rather than holding one, because the camera
  // work is being rewritten underneath it.
  const stage = readFileSync(
    new URL("../src/mission/MissionStage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(stage, /<VisorRunMark\b/, "the mark must be mounted in the canvas");
  assert.match(
    stage,
    /standingObjective\(/,
    "and must take its objective from the one definition of the standing step",
  );

  const mark = readFileSync(
    new URL("../src/visor/VisorRunMark.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    mark,
    /useFrame\(\(\{\s*camera/,
    "the mark reads the live camera rather than keeping an orientation of its own",
  );
  // The restraint, asserted. The route graph is read for a distance and the
  // distance is a scalar; the moment this file learns how to draw a polyline it
  // has started solving the roofline the mission exists to make you read.
  assert.ok(
    !/HoloPath|cheapestPath|routeGraph|createWayfinder/.test(mark),
    "the standing mark must not draw a route",
  );
});
