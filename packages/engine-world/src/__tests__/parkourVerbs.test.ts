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
  probeAhead,
  rankVerbs,
  selectVerb,
} from "../parkour/index.js";
import {
  ascent,
  box,
  overhead,
  probeFor,
  roof,
  runningNorth,
  selectContext,
  wall,
  world,
} from "./parkourHarness.js";

test("a lip the mover walks up is not offered a verb, and one above it is", () => {
  // The two have to be one decision or the player gets both answers. A kerb the
  // integrator absorbs unnoticed was also ranking a scripted step, and the verb
  // won because the reader runs first — a 750ms vault over a 10cm kerb. Below
  // the free step height the geometry is ground; above it, it is an obstacle.
  const motion = runningNorth(1.4);
  const walked = world([box("curb", 3, PARKOUR_TUNING.freeStepUpM - 0.05, 1.2)]);
  assert.equal(classifyVerb(probeFor(walked, motion), selectContext()), "NONE");

  const stepped = world([box("curb", 3, PARKOUR_TUNING.freeStepUpM + 0.05, 1.2)]);
  assert.equal(classifyVerb(probeFor(stepped, motion), selectContext()), "STEP_UP");
});

test("a crate at chest height with clear far ground is vaulted", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "VAULT");
});

test("a wall above the vault ceiling with a standable top is climbed", () => {
  // The old MANTLE band folded into CLIMB_UP; a standable ledge in the 1.15-1.9m
  // band is a CLIMB_UP now, same authored motion the mantle always drove.
  const collision = world([box("ledge", 3, 1.6, 1.4)]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "CLIMB_UP");
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

test("the folded climb band spans the old mantle ceiling continuously", () => {
  // MANTLE folded into CLIMB_UP, so the old mantle/climb boundary no longer
  // switches verbs: a standable top on either side of it is a CLIMB_UP.
  const collision = world([
    box("under", 3, MOVEMENT_CAPABILITIES.maxMantleHeightM - 0.01, 1.4),
  ]);
  const over = world([
    box("over", 3, MOVEMENT_CAPABILITIES.maxMantleHeightM + 0.01, 1.4),
  ]);
  const motion = runningNorth(1.6);
  assert.equal(classifyVerb(probeFor(collision, motion), selectContext()), "CLIMB_UP");
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
  // Just above the vault ceiling the same standable top is a CLIMB_UP (the old
  // mantle band): the player never stops, the authored motion is the same.
  assert.equal(classifyVerb(probeFor(over, motion), selectContext()), "CLIMB_UP");
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

test("a safe run-off with a coplanar obstacle a stride beyond is descended, not gap-jumped", () => {
  // The rope-capstan case, distilled. The body is on a bale top 1.1m over the
  // floor (a run-off), and a coil a stride north stands at 1.05m — a hair BELOW
  // the bale. The edge reader skips the safe floor straight down (a void it is
  // not) and reports the coil as the far side of a gap, and unguarded the ladder
  // ranked JUMP_GAP above the run-off and launched the body up onto the coil.
  // A gap jump crosses a void; a safe descent onto an obstacle beyond is not one.
  const collision = world([
    box("bale", 1, 1.1, 2, { width: 12 }),
    box("coil", 3.4, 1.05, 1.2, { width: 12 }),
  ]);
  const motion = runningNorth(1.5, RUN_SPEED, 1.1);
  const probe = probeFor(collision, motion);
  assert.ok(probe.edge, "expected a ledge read off the bale");
  assert.ok(probe.edge!.far !== null, "expected the coil to read as a far gap target");
  assert.ok(
    probe.edge!.verticalDropM <= PARKOUR_TUNING.runOffMaxDropM,
    `the drop straight down should be a safe run-off, was ${probe.edge!.verticalDropM.toFixed(2)}m`,
  );
  const ranked = rankVerbs(probe, selectContext());
  assert.ok(
    !ranked.includes("JUMP_GAP"),
    `JUMP_GAP was offered onto a coplanar obstacle over a safe descent: ${ranked.join(",")}`,
  );
  assert.equal(
    classifyVerb(probe, selectContext()),
    "RUN_OFF",
    "the body should simply run off the ledge, not launch across it",
  );
});

test("a genuine gap over a void beyond a safe-looking near drop is still gap-jumped", () => {
  // The negative: the SAME layout raised so the drop straight down is a fall, not
  // a run-off. Now there IS a void to cross and the far ledge is the way over it,
  // so the guard must not fire — JUMP_GAP is still the read.
  const collision = world([
    box("near", 1, 3.0, 2, { width: 12 }),
    box("far", 3.4, 2.95, 1.2, { width: 12 }),
  ]);
  const motion = runningNorth(1.5, RUN_SPEED, 3.0);
  const probe = probeFor(collision, motion);
  assert.ok(probe.edge?.far, "expected a far lip inside gap range");
  assert.ok(
    probe.edge!.verticalDropM > PARKOUR_TUNING.runOffMaxDropM,
    "the drop straight down should be a fall, not a safe run-off",
  );
  const ranked = rankVerbs(probe, selectContext());
  assert.ok(
    ranked.includes("JUMP_GAP"),
    `a real gap over a void was not offered a jump: ${ranked.join(",")}`,
  );
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

// ---------------------------------------------------------------------------
// Four things the ladder used to get wrong, all of them reported by a player as
// the same sentence — "the physics isn't consistent". Each one is a specific
// mechanism and each one is asserted here so it cannot come back quietly.
// ---------------------------------------------------------------------------

test("a deck with no solid mass under it is still something to climb", () => {
  // A `deck` compiles to a platform: a support surface with no vertical span.
  // The obstacle reader marched point samples asking which BLOCKERS they were
  // inside, so a scaffold staging read as empty air — and in M1 that was the
  // whole guaranteed ascent of the Town House and every bough of the objective.
  const collision = world([], [roof("staging", 2, 9, 2.9)]);
  const motion = runningNorth(0, RUN_SPEED);
  const probe = probeFor(collision, motion);
  assert.ok(probe.obstacle, "the staging must read as an obstacle");
  assert.equal(probe.obstacle!.id, "staging");
  assert.ok(
    Math.abs(probe.obstacle!.heightM - 2.9) < 0.01,
    `height was ${probe.obstacle!.heightM}`,
  );
  assert.equal(classifyVerb(probe, selectContext()), "CLIMB_UP");
});

test("a deck overhead is climbed onto from its lip, and not from its middle", () => {
  // Two stagings with the same footprint: from the lower one the upper one is
  // over the player's head with no edge to walk at, which is how M1 authors the
  // second lift of its scaffold, the clock ledge and three tiers of the elm.
  //
  // Nothing distinguishes that from standing under a market awning EXCEPT how
  // far the boards run on behind you. At the lip they stop within an arm's
  // reach and a body can get a hand over them; six metres in they do not, and
  // offering a climb there is the "it pulls you up through the boards" the
  // owner reported. So the reader marches backwards, and the two cases here
  // differ only in where the player is standing.
  const collision = world(
    [],
    [roof("lower", -6, 6, 2.9), roof("upper", -6, 6, 5.6)],
  );

  const atLip = probeFor(collision, runningNorth(-5.8, RUN_SPEED, 2.9));
  assert.ok(atLip.obstacle, "at the lip the staging overhead must read");
  assert.equal(atLip.obstacle!.id, "upper");
  assert.equal(classifyVerb(atLip, selectContext()), "CLIMB_UP");

  const underMiddle = probeFor(collision, runningNorth(0, RUN_SPEED, 2.9));
  assert.equal(
    underMiddle.obstacle,
    null,
    "six metres under the middle of a floor there is nothing to get a hand over",
  );
});

test("an authored climb volume grants the ascent inference cannot find", () => {
  // The other half, and the reason the bound above is shippable. M1's clock
  // ledge and cornice are pure vertical ascents whose standing point is 3.5m
  // and 5.7m inside its own deck: no reading of "you are at a lip" reaches
  // them, because they are not at one. The level declares those, and a body
  // standing in a declared volume skips the reachability bound.
  const decks = [roof("lower", -6, 6, 2.9), roof("upper", -6, 6, 5.6)];
  const declared = world([], decks, [ascent("upper", -2, 2, 2.9)]);
  const motion = runningNorth(0, RUN_SPEED, 2.9);
  const probe = probeFor(declared, motion);
  assert.ok(probe.obstacle, "inside the volume the ascent must be offered");
  assert.equal(probe.obstacle!.id, "upper");
  assert.equal(classifyVerb(probe, selectContext()), "CLIMB_UP");

  // And it grants exactly its own footprint: a stride outside it, nothing.
  assert.equal(
    probeFor(declared, runningNorth(3, RUN_SPEED, 2.9)).obstacle,
    null,
    "a volume must not authorise the whole deck it points at",
  );
  // ...its own storey: the same spot one lift down is a different climb.
  assert.equal(
    probeFor(
      world([], [roof("upper", -6, 6, 2.7)], [ascent("upper", -2, 2, 2.9)]),
      runningNorth(0, RUN_SPEED, 0),
    ).obstacle,
    null,
    "a volume must not authorise a body standing outside its feet band",
  );
  // ...and its own destination.
  assert.equal(
    probeFor(
      world([], decks, [ascent("somewhere-else", -2, 2, 2.9)]),
      motion,
    ).obstacle,
    null,
    "a volume must not authorise a rise onto a surface it does not name",
  );
});

test("a body pressed against a climbable face is still offered the climb", () => {
  // The flow floor switched the reader off below 0.9 m/s, and walking into
  // something is exactly what takes the speed away — so the read stopped at the
  // moment the player was asking for it and stayed stopped while they held the
  // key. The only way over anything was to reverse and run at it again.
  const collision = world([box("ledge", 1, 1.6, 1.4)]);
  const resting = { ...runningNorth(0, 0), pos: { x: 0, y: 0, z: 0 } };
  const probe = probeAhead(collision, {
    pos: resting.pos,
    velX: 0,
    velZ: 0,
    yaw: 0,
    intentX: 0,
    intentZ: 1,
  });
  assert.equal(
    classifyVerb(probe, selectContext({ pushing: true })),
    "CLIMB_UP",
    "holding forward at the face must keep offering the verb",
  );
  assert.equal(
    classifyVerb(probe, selectContext({ pushing: false })),
    "NONE",
    "and a player who is not pushing must not be yanked over anything",
  );
});

test("at a standstill the read follows the input, not the stale heading", () => {
  // `stepGrounded` only turns the body while it is moving, so a player who has
  // stopped at a corner and then pushed a different way was still read along the
  // direction they arrived from.
  const collision = world([box("ledge", -1.1, 1.6, 1.4)]);
  const probe = probeAhead(collision, {
    pos: { x: 0, y: 0, z: 0 },
    velX: 0,
    velZ: 0,
    // Facing north; the ledge is south.
    yaw: 0,
    intentX: 0,
    intentZ: -1,
  });
  assert.ok(probe.obstacle, "the ledge behind the body's heading must be read");
  assert.equal(probe.obstacle!.id, "ledge");
});
