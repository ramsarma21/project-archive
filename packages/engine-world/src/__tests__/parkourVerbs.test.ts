// The verb ladder. These are the thresholds level design builds against, so a
// change that moves one of them should break a test and force a conversation.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CROUCH_HEIGHT, STAND_HEIGHT } from "../collision.js";
import { RUN_SPEED, WALK_SPEED } from "../playerMotion.js";
import {
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  classifyVerb,
  levelDesignMaxGapM,
  maxGapMetersForDrop,
  planVerb,
  rankVerbs,
  selectVerb,
} from "../parkour/index.js";
import {
  box,
  overhead,
  probeFor,
  roof,
  runningNorth,
  selectContext,
  wall,
  world,
} from "./parkourHarness.js";

test("a low lip is stepped up, not stopped at", () => {
  const collision = world([box("curb", 3, 0.35, 1.2)]);
  const motion = runningNorth(1.4);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "STEP_UP");
});

test("a crate at chest height with clear far ground is vaulted", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "VAULT");
});

test("a wall above the vault ceiling with a standable top is mantled", () => {
  const collision = world([box("ledge", 3, 1.6, 1.4)]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "MANTLE");
});

test("a wall too narrow to stand on is crossed, not mounted", () => {
  const collision = world([box("fence", 3, 1.6, 0.4)]);
  const motion = runningNorth(1.6);
  assert.equal(
    classifyVerb(probeFor(collision, motion), selectContext()),
    "CLIMB_OVER",
  );
});

test("a wall above the mantle ceiling and under the climb ceiling is climbed", () => {
  const collision = world([box("wall", 3, 2.6, 2)]);
  const motion = runningNorth(1.6);
  assert.equal(
    classifyVerb(probeFor(collision, motion), selectContext()),
    "CLIMB_UP",
  );
});

test("a wall above the climb ceiling is BLOCKED, and reports why", () => {
  const collision = world([box("tall", 3, 4.2, 2)]);
  const motion = runningNorth(1.6);
  const probe = probeFor(collision, motion);
  assert.equal(classifyVerb(probe, selectContext()), "BLOCKED");
  const plan = selectVerb(collision, probe, selectContext(), motion.pos);
  assert.match(plan?.reason ?? "", /no verb for 4\.2/);
});

test("a full-height wall is BLOCKED", () => {
  const collision = world([wall("building", 3)]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "BLOCKED");
});

test("the mantle ceiling is exactly the published number", () => {
  const collision = world([
    box("under", 3, MOVEMENT_CAPABILITIES.maxMantleHeightM - 0.01, 1.4),
  ]);
  const over = world([
    box("over", 3, MOVEMENT_CAPABILITIES.maxMantleHeightM + 0.01, 1.4),
  ]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "MANTLE");
  assert.equal(classifyVerb(probeFor(over, motion), selectContext()), "CLIMB_UP");
});

test("the vault ceiling is exactly the published number", () => {
  const under = world([
    box("under", 3, MOVEMENT_CAPABILITIES.maxVaultHeightM - 0.01, 0.8),
  ]);
  const over = world([
    box("over", 3, MOVEMENT_CAPABILITIES.maxVaultHeightM + 0.02, 0.8),
  ]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(under, motion), selectContext()), "VAULT");
  // Just above the vault ceiling the same standable top is mantled instead: the
  // player never stops, the verb changes.
  assert.equal(classifyVerb(probeFor(over, motion), selectContext()), "MANTLE");
});

test("an overhead span at crouch height is slid under at sprint", () => {
  const collision = world([overhead("awning", 3, 1.15, 1.5, 1)]);
  const motion = runningNorth(1.6);
  const probe = probeFor(collision, motion);
  assert.ok(probe.obstacle?.lowSpan, "expected a low span read");
  assert.ok(probe.obstacle!.lowSpan!.headroomM > CROUCH_HEIGHT);
  assert.ok(probe.obstacle!.lowSpan!.headroomM < STAND_HEIGHT);
  assert.equal(classifyVerb(probe, selectContext()), "SLIDE");
});

test("a slide needs sprint speed; a walk is not a slide", () => {
  const collision = world([overhead("awning", 3, 1.15, 1.5, 1)]);
  const walking = runningNorth(1.6, WALK_SPEED);
  const ranked = rankVerbs(probeFor(collision, walking), selectContext());
  assert.ok(!ranked.includes("SLIDE"), `unexpected slide in ${ranked.join(",")}`);
});

test("crouch held slides at any flow speed", () => {
  const collision = world([overhead("awning", 3, 1.15, 1.5, 1)]);
  const walking = runningNorth(1.6, WALK_SPEED);
  assert.equal(
    classifyVerb(probeFor(collision, walking), selectContext({ crouchHeld: true })),
    "SLIDE",
  );
});

test("nothing is selected below the flow speed floor", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const crawling = runningNorth(1.6, PARKOUR_TUNING.flowMinSpeedMps - 0.1);
  assert.deepEqual(rankVerbs(probeFor(collision, crawling), selectContext()), []);
});

test("nothing is selected while airborne", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const motion = runningNorth(1.6);
  assert.deepEqual(
    rankVerbs(probeFor(collision, motion), selectContext({ grounded: false })),
    [],
  );
});

// ---- gaps and ledges -------------------------------------------------------

/** Two roofs at y=3 separated by `gap`, with the player at the takeoff point. */
function gapCourse(gap: number) {
  const collision = world([
    box("near", 0, 3, 8, { width: 12 }),
    box("far", 4 + gap + 4, 3, 8, { width: 12 }),
  ]);
  // The near lip is at z=4. An edge verb fires on the last grounded tick before
  // the lip, so takeoff sits one setback back from it.
  const takeoffZ = 4 - MOVEMENT_CAPABILITIES.jumpTakeoffSetbackM;
  return { collision, motion: runningNorth(takeoffZ, RUN_SPEED, 3) };
}

test("a gap at the published budget is auto-jumped and lands", () => {
  const { collision, motion } = gapCourse(
    MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM,
  );
  const probe = probeFor(collision, motion);
  assert.ok(probe.edge, "expected a ledge read");
  assert.ok(probe.edge!.gapM !== null, "expected a far lip inside gap probe range");
  assert.equal(classifyVerb(probe, selectContext()), "JUMP_GAP");
  assert.ok(
    planVerb(collision, probe, selectContext(), "JUMP_GAP", motion.pos),
    "a gap at the published budget must plan",
  );
});

test("a gap beyond what the physics can clear does not plan as a jump", () => {
  const { collision, motion } = gapCourse(
    MOVEMENT_CAPABILITIES.maxFlatGapM + 0.5,
  );
  const probe = probeFor(collision, motion);
  assert.equal(
    planVerb(collision, probe, selectContext(), "JUMP_GAP", motion.pos),
    null,
  );
});

test("a gap jump needs speed", () => {
  const collision = world([
    box("near", 0, 3, 8, { width: 12 }),
    box("far", 10, 3, 8, { width: 12 }),
  ]);
  const motion = runningNorth(3, PARKOUR_TUNING.jumpGapMinSpeedMps - 0.5, 3);
  const ranked = rankVerbs(probeFor(collision, motion), selectContext());
  assert.ok(!ranked.includes("JUMP_GAP"), `unexpected jump in ${ranked.join(",")}`);
});

test("a shallow drop is run off, a mid drop is hung, a killing drop brakes", () => {
  const shallow = world([box("ledge", 0, 1.8, 8, { width: 12 })]);
  const mid = world([box("ledge", 0, 3, 8, { width: 12 })]);
  const killing = world([box("ledge", 0, 9, 8, { width: 12 })]);
  assert.equal(
    classifyVerb(probeFor(shallow, runningNorth(3, RUN_SPEED, 1.8)), selectContext()),
    "RUN_OFF",
  );
  assert.equal(
    classifyVerb(probeFor(mid, runningNorth(3, RUN_SPEED, 3)), selectContext()),
    "HANG_DROP",
  );
  assert.equal(
    classifyVerb(probeFor(killing, runningNorth(3, RUN_SPEED, 9)), selectContext()),
    "EDGE_BRAKE",
  );
});

test("a buffered jump overrides the edge brake: the player may always choose", () => {
  const killing = world([box("ledge", 0, 9, 8, { width: 12 })]);
  const ranked = rankVerbs(
    probeFor(killing, runningNorth(3, RUN_SPEED, 9)),
    selectContext({ jumpBuffered: true }),
  );
  assert.ok(!ranked.includes("EDGE_BRAKE"), `unexpected brake in ${ranked.join(",")}`);
});

test("a drop between the roll ceiling and the dive floor is a hard landing, not a wall", () => {
  // The two thresholds abut: nothing falls between them ambiguously.
  assert.equal(
    MOVEMENT_CAPABILITIES.maxRollDropM,
    MOVEMENT_CAPABILITIES.edgeBrakeDropM,
  );
  assert.ok(
    MOVEMENT_CAPABILITIES.leapMinDropM > MOVEMENT_CAPABILITIES.maxRollDropM,
  );
});

// ---- published capability numbers ------------------------------------------

test("the published movement envelope matches the physics it is derived from", () => {
  assert.equal(MOVEMENT_CAPABILITIES.sprintSpeedMps, RUN_SPEED);
  assert.equal(MOVEMENT_CAPABILITIES.jumpApexM, 5.2 ** 2 / (2 * 10.8));
  // These are the numbers level design budgets against. Each is derived, so a
  // physics change moves them and breaks this test rather than silently making
  // authored geometry impossible.
  assert.equal(MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM, 3.3);
  assert.equal(MOVEMENT_CAPABILITIES.levelDesignMaxGapAt1mDropM, 4.1);
  assert.equal(MOVEMENT_CAPABILITIES.levelDesignMaxGapAt2mDropM, 4.7);
  assert.equal(MOVEMENT_CAPABILITIES.levelDesignMaxGapAt4mDropM, 5.6);
  assert.equal(MOVEMENT_CAPABILITIES.maxMantleHeightM, 1.9);
  assert.equal(MOVEMENT_CAPABILITIES.maxVaultHeightM, 1.15);
  assert.equal(MOVEMENT_CAPABILITIES.maxClimbHeightM, 3.2);
  // Height buys airtime, so a downhill gap is longer.
  assert.ok(maxGapMetersForDrop(2) > maxGapMetersForDrop(0));
  assert.equal(
    MOVEMENT_CAPABILITIES.levelDesignMaxGapAt1mDropM,
    levelDesignMaxGapM(1),
  );
  // The authoring budget always leaves headroom over the physical limit.
  assert.ok(
    MOVEMENT_CAPABILITIES.maxFlatGapM >
      MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM,
  );
});

test("every verb has a duration, a noise level and a clip", () => {
  const verbs = Object.keys(PARKOUR_TUNING.durationsMs) as Array<
    keyof typeof PARKOUR_TUNING.durationsMs
  >;
  for (const verb of verbs) {
    assert.equal(
      typeof PARKOUR_TUNING.verbNoise[verb],
      "number",
      `${verb} has no noise level`,
    );
  }
});

test("standing on a roof above a full-height building does not read as a wall", () => {
  // The repo's convention pairs an infinite-height building blocker with an
  // authored roof platform. From up on the roof the building's own footprint
  // spans the player's body, so without the self-intrusion exclusion every
  // rooftop reads as a wall directly ahead and no roof route is traversable.
  const collision = world(
    [wall("shopfront", 0, 8, 12)],
    [roof("shop-roof", -4, 4, 4)],
  );
  const motion = runningNorth(3, RUN_SPEED, 4);
  const probe = probeFor(collision, motion);
  assert.equal(probe.obstacle, null, "the building underfoot is not an obstacle");
  assert.ok(probe.edge, "expected the roof edge to read as a ledge");
  assert.ok(probe.edge!.dropM > 3.5, `drop was ${probe.edge!.dropM}`);
  assert.equal(
    classifyVerb(probe, selectContext()),
    "RUN_OFF",
    "a 4m drop is inside the roll ceiling, so it is run off",
  );
});
