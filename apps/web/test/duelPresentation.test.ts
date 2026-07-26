// Tests for the duel presentation layer's pure parts.
//
// What is worth testing here is narrow and specific: the presentation layer must not
// invent state, must not assume a rig's naming or scale, and must read every number
// it draws out of the core. So these cover the seams where that could silently break —
// bone resolution across two differently-named production rigs, the cover footprint
// agreeing with the prop it is drawn from, clip timing coming from measured authored
// lengths, and the HUD projection tracking a real duel driven through the real reducer.
//
// One family of tests here exists purely to defend a design decision: A DUEL HAS NO
// KNOWN LENGTH. That is easy to state and easy to reintroduce by accident, because
// any array of questions has a `.length` and any `.length` can become "of 6" in a
// kicker. So the supply is tested for answering rounds past the end of the authored
// bank, and the HUD is tested for carrying no total at all.
//
// The renderer itself is verified by looking at it; see the screenshots in the
// handoff. There is no DOM here.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  DUEL_ROUND_CEILING,
  ENGAGEMENT_SECONDS,
  FACE_OFF_TICKS,
  FIELD_DT,
  FIRE_INTERVAL_SECONDS,
  RESUME_COUNTDOWN_SECONDS,
  bossProfileForTier,
  mintVerdict,
  solveInterceptDirection,
  type DuelPhase,
  type DuelQuestionRef,
  type DuelState,
} from "@pa/duel";
import { CLIP_AUTHORED_MS, RUN_SPEED, WALK_SPEED } from "@pa/engine-world";

import {
  DUEL_CLIP_NAMES,
  authoredSecondsFor,
  duelClipTimeScale,
} from "../src/duel/duelClips.js";
import {
  HAND_BONE_CANDIDATES,
  PALM_DROP_M,
  gripQuaternion,
  resolveHandBoneName,
  socketInverseScale,
} from "../src/duel/weaponSocket.js";
import { fitPropToHeight, fittedCover, yardArenaSpec } from "../src/duel/arenaSpec.js";
import { selectActorVisual } from "../src/duel/actorVisual.js";
import {
  DUEL_CONTROLS,
  LATCH_BUFFER_FRAMES,
  createDuelInput,
  duelControls,
  moveVector,
  intentFrom,
} from "../src/duel/duelInput.js";
import {
  NO_INTENT,
  createDuelRuntime,
  hitsToFall,
  interpolatedProjectile,
  reticleReadout,
} from "../src/duel/duelRuntime.js";
import { magazineRowSize } from "../src/duel/RoundHud.js";
import { yardArena } from "../src/duel/arenaSpec.js";
import { m1QuestionBank, M1_ITEM_SOURCE } from "../src/duel/duelItems.js";
import { m1DuelDescriptor } from "../src/duel/m1Duel.js";

// ---- the weapon socket -----------------------------------------------------

test("hand bone resolves on both production rigs' naming conventions", () => {
  // three's GLTFLoader strips the colon from "mixamorig:RightHand".
  const player = ["mixamorigHips", "mixamorigRightForeArm", "mixamorigRightHand", "mixamorigRightHandIndex1"];
  assert.equal(resolveHandBoneName(player), "mixamorigRightHand");

  // Some rigs in the cast carry bare Mixamo names.
  const bare = ["Hips", "RightForeArm", "RightHand", "LeftHand"];
  assert.equal(resolveHandBoneName(bare), "RightHand");

  // Unsanitised, in case a loader ever preserves it.
  assert.equal(resolveHandBoneName(["mixamorig:RightHand"]), "mixamorig:RightHand");
});

test("a finger bone never wins the hand socket", () => {
  const fingersOnly = [
    "mixamorigRightHandIndex1",
    "mixamorigRightHandIndex2",
    "mixamorigRightHandThumb1",
  ];
  assert.equal(resolveHandBoneName(fingersOnly), null);

  const withHand = [...fingersOnly, "mixamorigRightHand"];
  assert.equal(resolveHandBoneName(withHand), "mixamorigRightHand");
});

test("no candidate name is a left hand", () => {
  for (const candidate of HAND_BONE_CANDIDATES) {
    assert.ok(!/left/i.test(candidate), `${candidate} is not a right hand`);
  }
});

test("socket scale undoes whatever units the rig arrived in", () => {
  // The cast is mid-normalisation: the player rig lands near real size and the
  // officer ships at 1/100. Both must produce a socket whose children are metres.
  const playerBoneScale = 0.0091;
  const officerBoneScale = 0.816;
  assert.ok(Math.abs(socketInverseScale(playerBoneScale) * playerBoneScale - 1) < 1e-9);
  assert.ok(Math.abs(socketInverseScale(officerBoneScale) * officerBoneScale - 1) < 1e-9);
  // A degenerate scale must not produce Infinity and lose the weapon to a NaN matrix.
  assert.equal(socketInverseScale(0), 1);
  assert.equal(socketInverseScale(Number.NaN), 1);
});

test("the grip rotation is a rotation, and maps the muzzle along the hand", () => {
  const quaternion = gripQuaternion([0, 0, 0]);
  assert.ok(Math.abs(quaternion.length() - 1) < 1e-9, "unit quaternion");
  // The asset's +X is the muzzle; it must come out along the hand bone's +Y, which
  // runs wrist to knuckles on every rig in the cast.
  const muzzle = { x: 1, y: 0, z: 0 };
  const rotated = applyQuaternion(muzzle, quaternion);
  assert.ok(rotated.y > 0.999, `muzzle along the hand, got ${JSON.stringify(rotated)}`);
});

test("the palm drop is inside the grip, not past the butt", () => {
  // Measured off the asset: the origin sits at the top of the grip and the butt is
  // 0.123m below it, so lifting the weapon by more than that would put the hand
  // under the butt entirely.
  assert.ok(PALM_DROP_M > 0.02 && PALM_DROP_M < 0.123);
});

function applyQuaternion(
  vector: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number } {
  const { x, y, z } = vector;
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

// ---- the arena -------------------------------------------------------------

test("cover collision footprints match the props they are drawn from", () => {
  const spec = yardArenaSpec();
  const drawn = fittedCover();
  assert.equal(spec.cover.length, drawn.length);
  for (const cover of spec.cover) {
    const prop = drawn.find((entry) => entry.id === cover.id);
    assert.ok(prop, `${cover.id} is drawn`);
    // The blocker is exactly the visible prop's box: what you see stops the ball.
    assert.ok(Math.abs(prop.size[0] / 2 - cover.halfX) < 1e-9);
    assert.ok(Math.abs(prop.size[2] / 2 - cover.halfZ) < 1e-9);
    assert.ok(Math.abs(prop.size[1] - cover.topY) < 1e-9);
  }
});

test("fitting a prop to a height keeps its authored aspect ratio", () => {
  const fitted = fitPropToHeight("crate-mound", 1.3);
  assert.ok(Math.abs(fitted.size[1] - 1.3) < 1e-9);
  // Uniform scale: the ratio of every pair of dimensions survives.
  assert.ok(Math.abs(fitted.size[0] / fitted.size[2] - 1.9 / 1.373) < 1e-6);
});

test("the yard has cover that stops an aimed ball and cover that does not", () => {
  const spec = yardArenaSpec();
  // An aimed shot travels at the target's chest, about 1.12m for a standing fighter.
  const chest = 1.12;
  assert.ok(spec.cover.some((cover) => cover.topY > chest), "chest-high cover exists");
  assert.ok(spec.cover.some((cover) => cover.topY < chest), "low cover exists");
});

test("cover is rotationally symmetric, so PvP has no better spawn", () => {
  const spec = yardArenaSpec();
  for (const cover of spec.cover) {
    const mirrored = spec.cover.find(
      (candidate) =>
        Math.abs(candidate.x + cover.x) < 1e-6 && Math.abs(candidate.z + cover.z) < 1e-6,
    );
    assert.ok(mirrored, `${cover.id} has a 180-degree counterpart`);
  }
});

test("nothing visible stands where a fighter can reach it without collision", () => {
  const spec = yardArenaSpec();
  const arena = yardArena();
  // The core clamps movement to the bounds, so dressing outside them is unreachable.
  for (const cover of spec.cover) {
    const inside =
      Math.abs(cover.x) + cover.halfX <= spec.halfExtentX &&
      Math.abs(cover.z) + cover.halfZ <= spec.halfExtentZ;
    assert.ok(inside, `${cover.id} is inside the bounds it blocks`);
    assert.ok(
      arena.world.blockers.some((blocker) => blocker.id === cover.id),
      `${cover.id} has a blocker`,
    );
  }
});

// ---- clip timing -----------------------------------------------------------

test("aimWalk is stride-matched at the engine's own walk speed", () => {
  // The engine measured this clip at exactly WALK_SPEED, so the correction is 1.
  const scale = duelClipTimeScale({
    role: "aimWalk",
    authoredSeconds: 0.833,
    speedMps: WALK_SPEED,
  });
  assert.ok(Math.abs(scale - 1) < 1e-6, `expected 1, got ${scale}`);
});

test("aimRun is corrected away from 1, because its cycle is slower than the run", () => {
  const scale = duelClipTimeScale({
    role: "aimRun",
    authoredSeconds: 0.767,
    speedMps: RUN_SPEED,
  });
  // Authored at 2.55 m/s and driven at 4.6: without this the character skates.
  assert.ok(Math.abs(scale - RUN_SPEED / 2.55) < 1e-6);
  assert.ok(scale > 1.5);
});

test("a back-step plays the forward cycle in reverse", () => {
  const forward = duelClipTimeScale({ role: "aimWalk", authoredSeconds: 0.83, speedMps: WALK_SPEED });
  const backward = duelClipTimeScale({
    role: "aimWalk",
    authoredSeconds: 0.83,
    speedMps: WALK_SPEED,
    backpedalling: true,
  });
  assert.equal(backward, -forward);
});

test("the reload is fitted to the resume countdown it plays under", () => {
  const authored = 3.7;
  const scale = duelClipTimeScale({ role: "reload", authoredSeconds: authored });
  assert.ok(Math.abs(scale - authored / RESUME_COUNTDOWN_SECONDS) < 1e-9);
});

test("authored clip lengths prefer the engine's measurement over the loaded file", () => {
  // The engine measured the roll at 1200ms; a wrong duration passed in must lose.
  assert.equal(authoredSecondsFor("roll", 99), CLIP_AUTHORED_MS[DUEL_CLIP_NAMES.roll]! / 1000);
  // Roles the engine has not measured fall back to the loaded clip's own duration.
  assert.equal(authoredSecondsFor("fire", 2.7), 2.7);
});

// ---- clip selection --------------------------------------------------------

function visualInput(overrides: Partial<Parameters<typeof selectActorVisual>[0]> = {}) {
  return {
    phase: "ENGAGEMENT_LIVE" as DuelPhase,
    faceOffElapsedS: 0,
    tick: 600,
    downed: false,
    crouched: false,
    speedMps: 0,
    travelOffFacing: 0,
    dashing: false,
    lastFireTick: -1,
    lastHitTick: -1,
    ...overrides,
  };
}

test("the face-off stands off, then draws into the aim", () => {
  assert.equal(selectActorVisual(visualInput({ phase: "FACE_OFF", faceOffElapsedS: 1 })).role, "standoff");
  assert.equal(selectActorVisual(visualInput({ phase: "FACE_OFF", faceOffElapsedS: 9 })).role, "draw");
});

test("being down outranks everything, including a shot taken on the same tick", () => {
  const visual = selectActorVisual(
    visualInput({ downed: true, dashing: true, lastFireTick: 600, lastHitTick: 600 }),
  );
  assert.equal(visual.role, "death");
});

test("a landed hit reads before a roll or a shot", () => {
  assert.equal(selectActorVisual(visualInput({ lastHitTick: 599, dashing: true })).role, "hit");
  assert.equal(selectActorVisual(visualInput({ dashing: true, lastFireTick: 599 })).role, "roll");
});

test("the flinch and the recoil both expire, and return to the aim", () => {
  // 0.7s of flinch and 0.9s of recoil at 60Hz.
  assert.equal(selectActorVisual(visualInput({ lastHitTick: 600 - 43 })).role, "aim");
  assert.equal(selectActorVisual(visualInput({ lastFireTick: 600 - 55 })).role, "aim");
});

test("locomotion picks the cycle that matches the driven speed", () => {
  assert.equal(selectActorVisual(visualInput({ speedMps: WALK_SPEED })).role, "aimWalk");
  assert.equal(selectActorVisual(visualInput({ speedMps: RUN_SPEED })).role, "aimRun");
  assert.equal(selectActorVisual(visualInput({ speedMps: 0.1 })).role, "aim");
});

test("a crouch is visible, because a crouch changes what a ball can hit", () => {
  assert.equal(selectActorVisual(visualInput({ crouched: true })).role, "crouchIdle");
  assert.equal(
    selectActorVisual(visualInput({ crouched: true, speedMps: 1 })).role,
    "crouchWalk",
  );
});

test("the reload plays under the bullet grant, which is the beat that loads it", () => {
  assert.equal(selectActorVisual(visualInput({ phase: "BULLETS_GRANTED" })).role, "reload");
});

// ---- input -----------------------------------------------------------------

test("movement is camera-relative and normalised", () => {
  const facingNorth = moveVector({ forward: true, back: false, left: false, right: false }, 0);
  assert.ok(Math.abs(facingNorth.x) < 1e-9);
  assert.ok(Math.abs(facingNorth.z - 1) < 1e-9);

  // Facing +Z with +Y up puts the right hand on -X.
  const strafe = moveVector({ forward: false, back: false, left: false, right: true }, 0);
  assert.ok(Math.abs(strafe.x + 1) < 1e-9);

  const diagonal = moveVector({ forward: true, back: false, left: false, right: true }, 0);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9, "diagonals are not faster");
});

test("an intent carries a normalised aim and never a bullet count", () => {
  const intent = intentFrom({
    move: { forward: false, back: false, left: false, right: false },
    cameraYaw: 0,
    sprint: false,
    crouch: false,
    jump: false,
    dodge: false,
    fire: true,
    aimX: 3,
    aimZ: 4,
    abilityId: null,
  });
  assert.ok(Math.abs(Math.hypot(intent.aimX, intent.aimZ) - 1) < 1e-9);
  assert.ok(!Object.keys(intent).some((key) => /ammo|bullet|magazine/i.test(key)));
});

// ---- the runtime -----------------------------------------------------------

function runtimeForTest(questions: readonly DuelQuestionRef[] = m1QuestionBank()) {
  const arena = yardArena();
  return createDuelRuntime({
    duelId: "TEST.DUEL",
    seed: 7,
    world: arena.world,
    placement: arena.placement,
    opponent: { kind: "BOSS", profile: bossProfileForTier(1, "TEST.BOSS") },
    questions,
  });
}

/** Drive whole frames at 60Hz, the way the render loop does. */
function frames(runtime: ReturnType<typeof runtimeForTest>, count: number): void {
  for (let index = 0; index < count; index++) runtime.advance(FIELD_DT);
}

test("the runtime opens on the face-off and reports its countdown in whole seconds", () => {
  const runtime = runtimeForTest();
  assert.equal(runtime.getHud().phase, "FACE_OFF");
  assert.equal(runtime.getHud().secondsRemaining, 10);
  frames(runtime, 60);
  assert.equal(runtime.getHud().secondsRemaining, 9);
});

test("the face-off hands over to a question, and the question stops the clock", () => {
  const runtime = runtimeForTest();
  frames(runtime, FACE_OFF_TICKS + 2);
  const hud = runtime.getHud();
  assert.equal(hud.phase, "QUESTION_PENDING");
  assert.equal(hud.round, 1);
  assert.deepEqual([...hud.awaitingVerdictFrom], ["A"]);
  // Untimed by design, so there is deliberately nothing to count down.
  assert.equal(hud.secondsRemaining, null);
  const tick = runtime.getState().clock.tick;
  frames(runtime, 120);
  assert.equal(runtime.getState().clock.tick, tick, "no duel time is spent answering");
});

test("the magazine a verdict loads is the core's number, whatever the core sets it to", () => {
  for (const [kind, expected] of [
    ["CORRECT", BULLETS_FOR_CORRECT],
    ["WRONG", BULLETS_FOR_WRONG],
  ] as const) {
    const runtime = runtimeForTest();
    frames(runtime, FACE_OFF_TICKS + 2);
    const item = runtime.getHud().item!;
    runtime.commitVerdict(
      "A",
      mintVerdict({
        kind,
        itemId: item.itemId,
        itemVersion: item.itemVersion,
        source: "CLASSIFIER",
      }),
    );
    frames(runtime, 1);
    const hud = runtime.getHud();
    assert.equal(hud.phase, "BULLETS_GRANTED");
    assert.equal(hud.grants?.A.magazine, expected);
    assert.equal(hud.ammo.A, expected);
    assert.equal(hud.lastVerdict?.kind, kind);
  }
});

test("the HUD projection reaches the engagement and counts the round down", () => {
  const runtime = runtimeForTest();
  frames(runtime, FACE_OFF_TICKS + 2);
  const item = runtime.getHud().item!;
  runtime.commitVerdict(
    "A",
    mintVerdict({ kind: "CORRECT", itemId: item.itemId, itemVersion: item.itemVersion, source: "CLASSIFIER" }),
  );
  frames(runtime, 1);
  assert.equal(runtime.getHud().phase, "BULLETS_GRANTED");
  frames(runtime, RESUME_COUNTDOWN_SECONDS * 60 + 2);
  const hud = runtime.getHud();
  assert.equal(hud.phase, "ENGAGEMENT_LIVE");
  assert.ok(hud.secondsRemaining !== null && hud.secondsRemaining <= 20);
});

test("the whole duel resolves and the projection never invents a phase", () => {
  const runtime = runtimeForTest();
  const seen = new Set<DuelPhase>();
  const legal: readonly DuelPhase[] = [
    "FACE_OFF",
    "QUESTION_PENDING",
    "VERDICT_COMMITTED",
    "BULLETS_GRANTED",
    "ENGAGEMENT_LIVE",
    "LINE_OF_SIGHT_BREAK",
    "ROUND_RESOLVED",
    "DUEL_RESOLVED",
  ];
  // A passive player cannot end the duel, so the horizon has to cover the core's own
  // structural backstop rather than a round count this layer imagines. One round is
  // the engagement plus the resume countdown plus the break; the face-off is once.
  const secondsPerRound = ENGAGEMENT_SECONDS + RESUME_COUNTDOWN_SECONDS + 3;
  const horizon = 60 * (FACE_OFF_TICKS / 60 + DUEL_ROUND_CEILING * secondsPerRound + 60);
  for (let frame = 0; frame < horizon; frame++) {
    const hud = runtime.getHud();
    seen.add(hud.phase);
    assert.ok(legal.includes(hud.phase));
    if (hud.phase === "DUEL_RESOLVED") break;
    if (hud.phase === "QUESTION_PENDING" && hud.item) {
      runtime.commitVerdict(
        "A",
        mintVerdict({
          kind: "WRONG",
          itemId: hud.item.itemId,
          itemVersion: hud.item.itemVersion,
          source: "CLASSIFIER",
        }),
      );
    }
    runtime.advance(FIELD_DT);
  }
  const hud = runtime.getHud();
  assert.equal(hud.phase, "DUEL_RESOLVED");
  assert.ok(hud.outcome);
  assert.ok(seen.has("ENGAGEMENT_LIVE"));
  assert.ok(seen.has("LINE_OF_SIGHT_BREAK"), "the boss breaks line of sight each round");
});

test("the runtime only ever publishes numbers the core produced", () => {
  const runtime = runtimeForTest();
  frames(runtime, FACE_OFF_TICKS + 2);
  const item = runtime.getHud().item!;
  runtime.commitVerdict(
    "A",
    mintVerdict({ kind: "CORRECT", itemId: item.itemId, itemVersion: item.itemVersion, source: "CLASSIFIER" }),
  );
  frames(runtime, 60 * 5);
  const state = runtime.getState();
  const hud = runtime.getHud();
  assert.equal(hud.health.A, state.combat.fighters.A.health);
  assert.equal(hud.health.B, state.combat.fighters.B.health);
  assert.equal(hud.ammo.A, state.combat.fighters.A.ammo);
  assert.equal(hud.maxHealth.B, state.params.B.maxHealth);
});

test("poses interpolate between fixed steps and never past them", () => {
  const runtime = runtimeForTest();
  // A partial frame banks time in the core's accumulator without stepping.
  runtime.advance(FIELD_DT * 0.5);
  const poses = runtime.getPoses();
  assert.ok(poses.alpha >= 0 && poses.alpha <= 1);
});

test("a ball's between-step position is reconstructed backwards from its velocity", () => {
  const projectile = {
    id: 1,
    shooter: "A" as const,
    x: 4,
    y: 1.1,
    z: 2,
    vx: 22,
    vz: 0,
    damage: 20,
    expiresAtTick: 500,
  };
  const head = interpolatedProjectile(projectile, 1);
  assert.ok(Math.abs(head.x - 4) < 1e-9, "alpha 1 is the authoritative position");
  const tail = interpolatedProjectile(projectile, 0);
  assert.ok(Math.abs(tail.x - (4 - 22 * FIELD_DT)) < 1e-9, "alpha 0 is the previous step");
});

// ---- the duel has no known length ------------------------------------------

test("the descriptor hands over a bank and cannot express a duel length", () => {
  const descriptor = m1DuelDescriptor() as unknown as Record<string, unknown>;
  for (const key of Object.keys(descriptor)) {
    assert.ok(
      !/^(rounds|roundCeiling|totalRounds|roundCount|maxRounds)$/i.test(key),
      `a descriptor must not carry ${key}`,
    );
  }
  assert.ok(Array.isArray(descriptor["questionBank"]), "the items arrive as a bank");
});

test("every item the core can draw resolves to a question a player can read", () => {
  // The core draws from the bank in its own seeded order and recycles it when a duel
  // outlasts it, so "round N has readable content" is exactly "every bank entry
  // resolves" — there is no round-indexed list here to check instead.
  const bank = m1QuestionBank();
  assert.ok(bank.length > 0, "a duel needs something to ask");
  for (const ref of bank) {
    const content = M1_ITEM_SOURCE.get(ref);
    assert.ok(content, `${ref.itemId} resolves`);
    assert.ok(content.prompt.length > 12);
    assert.ok(content.conceptLabel.length > 0);
  }
});

test("a duel outlasting its bank still gets a question, and it is marked as a repeat", () => {
  // Drive far enough past the bank's depth that recycling has to happen, and check
  // the HUD both keeps asking and keeps disclosing.
  //
  // A SHALLOW BANK ON PURPOSE, and not to save frames. This used to run on the
  // shipped bank, which was six items deep — so it passed by accident: a duel that
  // ends on health reaches a seventh round easily and an eighteenth almost never.
  // Widening `m1QuestionBank` to all eighteen authored items broke it, which was
  // the test telling the truth about itself. Recycling is a property of the core's
  // draw and has nothing to do with how much content M1 happens to have authored,
  // so the depth is now the test's rather than the content's.
  const bank = m1QuestionBank().slice(0, 2);
  const runtime = runtimeForTest(bank);
  const bankDepth = bank.length;
  let asked = 0;
  let sawRecycled = false;
  for (let frame = 0; frame < 60 * 60 * 12 && asked <= bankDepth + 2; frame++) {
    const hud = runtime.getHud();
    if (hud.phase === "DUEL_RESOLVED") break;
    if (hud.phase === "QUESTION_PENDING" && hud.item) {
      asked++;
      assert.ok(M1_ITEM_SOURCE.get(hud.item), `round ${hud.round} has readable content`);
      assert.ok(hud.itemAppearance >= 1, "an asked item has an appearance ordinal");
      if (hud.round > bankDepth) {
        assert.ok(hud.itemRecycled, `round ${hud.round} is past the bank and must say so`);
        sawRecycled = true;
      }
      runtime.commitVerdict(
        "A",
        mintVerdict({
          kind: "WRONG",
          itemId: hud.item.itemId,
          itemVersion: hud.item.itemVersion,
          source: "CLASSIFIER",
        }),
      );
    }
    runtime.advance(FIELD_DT);
  }
  assert.ok(asked > bankDepth, `the duel ran past its ${bankDepth}-item bank`);
  assert.ok(sawRecycled, "the repeat was disclosed rather than hidden");
});

test("the HUD carries no round total, in any form", () => {
  const runtime = runtimeForTest();
  frames(runtime, FACE_OFF_TICKS + 2);
  const hud = runtime.getHud() as unknown as Record<string, unknown>;
  // A total is the one number this HUD must not have: with it, some kicker will
  // eventually render "of 6" and promise the player an ending that does not exist.
  for (const key of Object.keys(hud)) {
    assert.ok(
      !/^(rounds|totalRounds|roundCount|maxRounds)$/i.test(key),
      `DuelHud must not expose ${key}`,
    );
  }
  assert.ok(!("rounds" in (runtime as unknown as Record<string, unknown>)));
});

// ---- the bullet economy, as drawn ------------------------------------------

// WHAT THIS USED TO ASSERT, AND WHY IT WAS THE WRONG WAY ROUND.
//
// It required `magazineRowSize(CORRECT, WRONG) * 2 === CORRECT` — "a correct answer is
// exactly two rows of a wrong one" — which is only satisfiable while the correct grant
// is EXACTLY twice the wrong one. A row layout was therefore pinning the bullet
// economy, and it held 7/14 in place after the balance work had measured what that
// costs: 47% of a wrong-answer round with nothing happening and a ball in hand only
// 34% of it, because 7 balls fill 35% of a 20-ball round against a correct answer's
// 70%. The struggling student got the emptiest version of the boss fight.
//
// THE ECONOMY IS BACK AT 7/14, AND THAT IS EXACTLY WHY THIS MUST NOT BE RE-PINNED. The
// pair currently satisfies the old assertion by coincidence, so restoring it would look
// harmless and would silently hand the layout a veto over balance again — which is the
// trap that took a measured pacing defect two retunes to escape. The ratio being 2 is a
// fact about today's economy, not a property of this widget.
//
// So these assert the two things the widget is actually for, and neither one mentions a
// ratio. The magazine has to READ — countable rows, no orphan stub that looks like a
// bug — and a player has to be able to tell the two grants apart WITHOUT COUNTING PIPS,
// which is a difference in row count rather than a difference in arithmetic. Every pair
// that satisfies both is a legal economy, and the balance owner picks from them.
//
// The shipped 7 and 14 lay out as one row of seven against two. The 9/14 pair that
// briefly shipped laid out as 5+4 against 5+5+4, and both were looked at rendered, at
// full and part-spent, against the alternatives — rows of 7 gives 9 a two-pip orphan
// that reads as a rendering fault, and rows of 9 gives 14 a nine-wide bar nobody
// counts. Look again if the pair moves: this file can say the layout is legible, and
// cannot say it is handsome.

/** The pips in each row, in order, exactly as the grid wraps them. */
function magazineRows(capacity: number, width: number): number[] {
  const rows: number[] = [];
  for (let left = capacity; left > 0; left -= width) rows.push(Math.min(width, left));
  return rows;
}

test("both grants lay out on one grid, so the magazine is a comparison", () => {
  // The load-bearing property. Two grants drawn at different row widths are two
  // unrelated shapes, and the whole point of pips over a numeral is that a player
  // reads the difference between them at a glance while moving.
  const width = magazineRowSize(BULLETS_FOR_WRONG);
  assert.equal(
    magazineRowSize(BULLETS_FOR_CORRECT),
    width,
    "a wrong answer and a correct one must wrap at the same width",
  );
  // And the width the component actually uses is that one: `Magazine` passes only
  // the socket count and lets the unit default to the economy.
  assert.equal(magazineRowSize(BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG), width);
});

test("the magazine reads: countable rows, and no orphan that looks like a fault", () => {
  const width = magazineRowSize(BULLETS_FOR_WRONG);
  assert.ok(width >= 4 && width <= 8, `a row of ${width} is a column or a bar, not a row`);
  for (const grant of [BULLETS_FOR_WRONG, BULLETS_FOR_CORRECT]) {
    const rows = magazineRows(grant, width);
    const last = rows[rows.length - 1]!;
    assert.ok(
      last * 2 >= width,
      `${grant} balls wrap to ${rows.join("+")}: a last row of ${last} under a full ` +
        `row of ${width} reads as a magazine that failed to draw, not as ${grant} balls`,
    );
  }
});

test("a player can tell the grants apart without counting pips", () => {
  // This is what "two rows of one" was really asserting, stated as the thing it
  // wanted rather than as the arithmetic that happened to deliver it. A correct
  // answer has to be a taller block, not merely a longer number.
  const width = magazineRowSize(BULLETS_FOR_WRONG);
  const wrong = magazineRows(BULLETS_FOR_WRONG, width);
  const correct = magazineRows(BULLETS_FOR_CORRECT, width);
  assert.ok(
    correct.length > wrong.length,
    `${BULLETS_FOR_CORRECT} balls wrap to ${correct.length} rows and ` +
      `${BULLETS_FOR_WRONG} to ${wrong.length}. Knowing the answer has to be visible ` +
      "as a bigger magazine, and a row count is what is visible at a glance",
  );
  assert.ok(BULLETS_FOR_CORRECT > BULLETS_FOR_WRONG, "knowledge is worth more balls");
});

test("the magazine layout survives the economy being retuned again", () => {
  // The old 3/1 pair: a single row, not three rows of one.
  assert.equal(magazineRowSize(3, 1), 3);
  assert.equal(magazineRowSize(8, 1), 8);
  // A grant with an unhelpful unit still gets a countable row rather than a smear.
  for (const capacity of [9, 11, 12, 20, 31]) {
    const width = magazineRowSize(capacity, 1);
    assert.ok(width >= 5 && width <= 8, `${capacity} wraps at ${width}`);
  }
  // Both pairs the economy has shipped lay out the way they were drawn, so moving
  // between them moves the HUD with them and needs no work here.
  assert.equal(magazineRowSize(7, 7), 7);
  assert.equal(magazineRowSize(14, 7), 7);
  assert.equal(magazineRowSize(9, 9), 5);
  assert.equal(magazineRowSize(14, 9), 5);
});

test("EVERY PLAUSIBLE ECONOMY LAYS OUT, which is what unpinned the ratio", () => {
  // The general claim the old assertion made unnecessary and therefore untested: the
  // HUD renders whatever the economy is. Balance is free to move the pair as long as
  // the result is legible, so the legibility has to hold across the range rather
  // than at one lucky pair — otherwise the next retune rediscovers this whole trap.
  const spendable = 20; // MAX_SPENDABLE_SHOTS_PER_ROUND: no grant above this is real
  for (let wrong = 1; wrong <= spendable; wrong++) {
    for (let correct = wrong + 1; correct <= spendable; correct++) {
      const width = magazineRowSize(correct, wrong);
      assert.ok(width >= 1 && width <= 8, `${correct}/${wrong} wraps at ${width}`);
      // A grant that fits on one line is drawn on one line, and two single lines are
      // already a comparison. The shared grid only has to hold once BOTH grants wrap,
      // which is the case the shipped economy is in and the only one where a mismatched
      // width would produce two unrelated shapes.
      if (correct <= 8) {
        assert.equal(width, correct, `${correct} balls fit on one row and must use it`);
        continue;
      }
      assert.ok(width >= 4, `${correct}/${wrong} wraps at a ${width}-wide column`);
      if (wrong > 8) {
        assert.equal(
          magazineRowSize(wrong, wrong),
          width,
          `${correct}/${wrong} wraps the two grants at different widths`,
        );
      } else {
        assert.equal(magazineRowSize(wrong, wrong), wrong, `${wrong} balls are one row`);
      }
    }
  }
});

// ---- convergence without a clock -------------------------------------------

test("hits-to-fall is the health divided by the shot that lands on it", () => {
  assert.equal(hitsToFall(100, 20), 5);
  assert.equal(hitsToFall(41, 20), 3, "a partial hit still needs a whole ball");
  assert.equal(hitsToFall(0, 20), 0);
  // A zero-damage fighter must not produce Infinity in a HUD string.
  assert.equal(hitsToFall(100, 0), 0);
});

test("the HUD reports hits-to-fall against the other side's authored damage", () => {
  const runtime = runtimeForTest();
  frames(runtime, FACE_OFF_TICKS + 2);
  const state = runtime.getState();
  const hud = runtime.getHud();
  assert.equal(hud.hitsToFall.B, hitsToFall(hud.health.B, state.params.A.shotDamage));
  assert.equal(hud.hitsToFall.A, hitsToFall(hud.health.A, state.params.B.shotDamage));
});

test("hits-to-fall only ever falls, so the duel visibly converges", () => {
  const runtime = runtimeForTest();
  let previous = runtime.getHud().hitsToFall;
  for (let frame = 0; frame < 60 * 400; frame++) {
    const hud = runtime.getHud();
    assert.ok(hud.hitsToFall.A <= previous.A, "the player's remaining hits never grow");
    assert.ok(hud.hitsToFall.B <= previous.B, "the boss's remaining hits never grow");
    previous = hud.hitsToFall;
    if (hud.phase === "DUEL_RESOLVED") break;
    if (hud.phase === "QUESTION_PENDING" && hud.item) {
      runtime.commitVerdict(
        "A",
        mintVerdict({
          kind: "CORRECT",
          itemId: hud.item.itemId,
          itemVersion: hud.item.itemVersion,
          source: "CLASSIFIER",
        }),
      );
    }
    runtime.advance(FIELD_DT);
  }
});

test("the round exchange is the round's opening health minus the current health", () => {
  const runtime = runtimeForTest();
  let checked = 0;
  for (let frame = 0; frame < 60 * 400; frame++) {
    const hud = runtime.getHud();
    if (hud.phase === "DUEL_RESOLVED") break;
    if (hud.phase === "QUESTION_PENDING" && hud.item) {
      runtime.commitVerdict(
        "A",
        mintVerdict({
          kind: "CORRECT",
          itemId: hud.item.itemId,
          itemVersion: hud.item.itemVersion,
          source: "CLASSIFIER",
        }),
      );
    }
    runtime.advance(FIELD_DT);
    const after = runtime.getHud();
    assert.equal(after.roundExchange.A, Math.max(0, after.roundOpeningHealth.A - after.health.A));
    assert.equal(after.roundExchange.B, Math.max(0, after.roundOpeningHealth.B - after.health.B));
    if (after.phase === "LINE_OF_SIGHT_BREAK") checked++;
  }
  assert.ok(checked > 0, "the break beat, where this gets read out, was reached");
});

test("the exchange is readable AT the break, not one round behind it", () => {
  // The core resolves a round after the line-of-sight break, so a ledger anchored on
  // the round summary would show the previous round's damage on this round's panel.
  const runtime = runtimeForTest();
  let sawBreakWithDamage = false;
  for (let frame = 0; frame < 60 * 400 && !sawBreakWithDamage; frame++) {
    const hud = runtime.getHud();
    if (hud.phase === "DUEL_RESOLVED") break;
    if (hud.phase === "QUESTION_PENDING" && hud.item) {
      runtime.commitVerdict(
        "A",
        mintVerdict({
          kind: "CORRECT",
          itemId: hud.item.itemId,
          itemVersion: hud.item.itemVersion,
          source: "CLASSIFIER",
        }),
      );
    }
    runtime.advance(FIELD_DT);
    const after = runtime.getHud();
    if (after.phase !== "LINE_OF_SIGHT_BREAK") continue;
    // Whatever the boss managed this round is on the panel the moment it opens.
    if (after.roundExchange.A > 0) {
      assert.equal(after.roundExchange.A, after.roundOpeningHealth.A - after.health.A);
      sawBreakWithDamage = true;
    }
  }
  assert.ok(sawBreakWithDamage, "a round in which damage landed reached its own break");
});

test("the ledger opens on full health, so round one's damage is visible too", () => {
  const runtime = runtimeForTest();
  const hud = runtime.getHud();
  assert.equal(hud.roundOpeningHealth.A, hud.maxHealth.A);
  assert.equal(hud.roundOpeningHealth.B, hud.maxHealth.B);
  assert.deepEqual(hud.roundExchange, { A: 0, B: 0 }, "nothing exchanged before round one");
});

// ---- the reticle shows where the ball goes ----------------------------------

test("the reticle follows the pointer when the assist has nothing to correct", () => {
  const runtime = runtimeForTest();
  const state = runtime.getState();
  const player = state.combat.fighters.A.motion.pos;
  // Well off the officer's bearing: outside the assist cone, so the mark is the ray.
  const at = { x: player.x + 8, z: player.z - 6 };
  const readout = reticleReadout(state, at.x, at.z);
  assert.equal(readout.snapped, false);
  assert.ok(Math.abs(readout.x - at.x) < 1e-6);
  assert.ok(Math.abs(readout.z - at.z) < 1e-6);
});

/** The same state with the officer crossing laterally at a chosen speed. */
function withOpponentCrossing(state: DuelState, speedMps: number): DuelState {
  const target = state.combat.fighters.B;
  return {
    ...state,
    combat: {
      ...state.combat,
      fighters: {
        ...state.combat.fighters,
        B: { ...target, motion: { ...target.motion, vel: { x: speedMps, y: 0, z: 0 } } },
      },
    },
  } as DuelState;
}

test("the reticle leads a moving target, because the ball will", () => {
  const runtime = runtimeForTest();
  const state = withOpponentCrossing(runtime.getState(), 2);
  const shooter = state.combat.fighters.A;
  const target = state.combat.fighters.B;

  const readout = reticleReadout(state, target.motion.pos.x, target.motion.pos.z);
  assert.equal(readout.snapped, true, "aiming at the body snaps to the lead");
  assert.ok(readout.x > target.motion.pos.x, "the mark leads his travel");

  // It is exactly the core's own solution, not an approximation of it.
  const solution = solveInterceptDirection(shooter.motion.pos, target.motion.pos, {
    x: 2,
    z: 0,
  })!;
  const reach = Math.hypot(
    target.motion.pos.x - shooter.motion.pos.x,
    target.motion.pos.z - shooter.motion.pos.z,
  );
  assert.ok(Math.abs(readout.x - (shooter.motion.pos.x + solution.x * reach)) < 1e-9);
  assert.ok(Math.abs(readout.z - (shooter.motion.pos.z + solution.z * reach)) < 1e-9);
});

test("the assist is forgiveness and not a lock, and the reticle says which", () => {
  // At this range the cone is about 6.5 degrees. A target crossing fast enough to
  // need a bigger lead than that gets no correction at all — and the reticle must
  // then sit under the cursor, because that really is where the ball will go.
  const runtime = runtimeForTest();
  const fast = withOpponentCrossing(runtime.getState(), 6);
  const target = fast.combat.fighters.B;
  const readout = reticleReadout(fast, target.motion.pos.x, target.motion.pos.z);
  assert.equal(readout.snapped, false, "too much lead needed: the shot is the player's");
  assert.ok(Math.abs(readout.x - target.motion.pos.x) < 1e-6);
});

test("the reticle reports the reload, which is the only refusal signal there is", () => {
  const runtime = armedRuntime();
  const before = reticleReadout(runtime.getState(), 0, 6);
  assert.equal(before.reloaded, 1, "a round opens with the first ball ready");
  assert.equal(before.hasAmmo, true);

  const aimed = {
    ...NO_INTENT,
    fire: true,
    aimZ: 1,
  };
  runtime.advance(FIELD_DT, { A: aimed });
  const justFired = reticleReadout(runtime.getState(), 0, 6);
  assert.ok(justFired.reloaded < 0.2, `reloading right after a shot, got ${justFired.reloaded}`);

  // Halfway through the interval it is visibly halfway back.
  frames(runtime, Math.round((FIRE_INTERVAL_SECONDS * 60) / 2));
  const midway = reticleReadout(runtime.getState(), 0, 6);
  assert.ok(midway.reloaded > 0.4 && midway.reloaded < 0.65, `got ${midway.reloaded}`);

  frames(runtime, Math.round(FIRE_INTERVAL_SECONDS * 60));
  assert.equal(reticleReadout(runtime.getState(), 0, 6).reloaded, 1, "ready again");
});

test("an empty magazine reads as empty and not as reloading", () => {
  const runtime = armedRuntime();
  // Spend the magazine, then confirm the reticle says "no ball" rather than
  // implying that waiting will produce one.
  for (let round = 0; round < 30; round++) {
    runtime.advance(FIELD_DT, { A: { ...NO_INTENT, fire: true, aimZ: 1 } });
    frames(runtime, Math.round(FIRE_INTERVAL_SECONDS * 60) + 2);
    if (runtime.getHud().ammo.A === 0) break;
  }
  const readout = reticleReadout(runtime.getState(), 0, 6);
  assert.equal(readout.hasAmmo, false);
});

// ---- input survives a display faster than the simulation --------------------
//
// The bug these cover is invisible to every other kind of test: the core steps at a
// fixed 60Hz and a 120Hz display renders twice per step, so about half of all frames
// advance no tick. A latch cleared per frame therefore discards about half of all
// clicks, silently, with no error and no failed assertion anywhere. So these drive
// the REAL input controller through a REAL frame loop at a real 120Hz cadence and
// count shots against presses.

/** Minimal DOM for the controller's listeners. Node has EventTarget built in. */
function withFakeWindow<T>(body: (fire: () => void, dodge: () => void) => T): T {
  const fake = new EventTarget();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fake;
  try {
    return body(
      () => fake.dispatchEvent(Object.assign(new Event("mousedown"), { button: 0 })),
      () => fake.dispatchEvent(Object.assign(new Event("mousedown"), { button: 2 })),
    );
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

/** Advance to a live engagement with a full magazine. */
function armedRuntime() {
  const runtime = runtimeForTest();
  frames(runtime, FACE_OFF_TICKS + 2);
  const item = runtime.getHud().item!;
  runtime.commitVerdict(
    "A",
    mintVerdict({
      kind: "CORRECT",
      itemId: item.itemId,
      itemVersion: item.itemVersion,
      source: "CLASSIFIER",
    }),
  );
  frames(runtime, RESUME_COUNTDOWN_SECONDS * 60 + 4);
  assert.equal(runtime.getHud().phase, "ENGAGEMENT_LIVE");
  assert.ok(runtime.getHud().ammo.A > 0);
  return runtime;
}

const HZ_120 = 1 / 120;
/**
 * Frames between test presses, spaced past the core's reload so that a ball which
 * fails to appear is a LOST INPUT and never a legitimate refusal. Derived rather
 * than typed, because the reload moved from 0.55s to 1.0s during this work and a
 * hardcoded gap would have quietly started measuring the cooldown instead.
 */
const FRAMES_PER_PRESS = Math.ceil(FIRE_INTERVAL_SECONDS * 120) + 30;

test("a 120Hz display really does leave half its frames without a tick", () => {
  // The premise, measured rather than assumed. If this ever stops being true the
  // two tests below stop proving anything.
  const runtime = armedRuntime();
  let tickless = 0;
  for (let frame = 0; frame < 120; frame++) {
    if (runtime.advance(HZ_120) === 0) tickless += 1;
  }
  assert.ok(tickless > 40, `expected many tickless frames, saw ${tickless}`);
});

test("every click fires a ball when the display runs at twice the tick rate", () => {
  withFakeWindow((clickFire) => {
    const runtime = armedRuntime();
    const input = createDuelInput();
    const detach = input.attach();
    try {
      const before = runtime.getHud().ammo.A;
      let presses = 0;
      for (let frame = 0; frame < FRAMES_PER_PRESS * 8; frame++) {
        if (frame % FRAMES_PER_PRESS === 0) {
          clickFire();
          presses += 1;
        }
        const intent = input.peekIntent();
        const ticks = runtime.advance(HZ_120, { A: intent });
        input.settle(ticks);
      }
      const fired = runtime
        .getEvents()
        .filter((event) => event.type === "SHOT_FIRED" && event.side === "A").length;
      assert.equal(fired, presses, `${presses} clicks must fire ${presses} balls`);
      assert.equal(runtime.getHud().ammo.A, before - presses);
    } finally {
      detach();
    }
  });
});

test("the old read-and-clear really did drop them, so the fix is load-bearing", () => {
  withFakeWindow((clickFire) => {
    const runtime = armedRuntime();
    const input = createDuelInput();
    const detach = input.attach();
    try {
      let presses = 0;
      for (let frame = 0; frame < FRAMES_PER_PRESS * 8; frame++) {
        if (frame % FRAMES_PER_PRESS === 0) {
          clickFire();
          presses += 1;
        }
        // The deprecated path: read and clear in one call, regardless of ticks.
        runtime.advance(HZ_120, { A: input.takeIntent() });
      }
      const fired = runtime
        .getEvents()
        .filter((event) => event.type === "SHOT_FIRED" && event.side === "A").length;
      assert.ok(
        fired < presses,
        `the per-frame clear should lose presses; fired ${fired} of ${presses}`,
      );
    } finally {
      detach();
    }
  });
});

test("a held latch never spends two balls, however many ticks one frame buys", () => {
  withFakeWindow((clickFire) => {
    const runtime = armedRuntime();
    const input = createDuelInput();
    const detach = input.attach();
    try {
      const before = runtime.getHud().ammo.A;
      clickFire();
      // A quarter-second frame is fifteen ticks at once — a stall, or a slow
      // software renderer. The press must still cost exactly one ball.
      const ticks = runtime.advance(0.25, { A: input.peekIntent() });
      input.settle(ticks);
      assert.ok(ticks > 1, `expected a multi-tick frame, got ${ticks}`);
      assert.equal(runtime.getHud().ammo.A, before - 1, "one press, one ball");
    } finally {
      detach();
    }
  });
});

test("a press is dropped rather than banked across a stopped clock", () => {
  withFakeWindow((clickFire) => {
    const input = createDuelInput();
    const detach = input.attach();
    try {
      clickFire();
      assert.equal(input.pending().fire, true);
      // QUESTION_PENDING advances nothing. A click there must not be saved up and
      // fired seconds later at whatever the pointer happens to be on.
      for (let frame = 0; frame < LATCH_BUFFER_FRAMES; frame++) input.settle(0);
      assert.equal(input.pending().fire, false, "the buffer expired the press");
    } finally {
      detach();
    }
  });
});

test("suspending input for a question discards anything already latched", () => {
  withFakeWindow((clickFire, clickDodge) => {
    const input = createDuelInput();
    const detach = input.attach();
    try {
      clickFire();
      clickDodge();
      assert.equal(input.pending().fire, true);
      input.setEnabled(false);
      assert.deepEqual(input.pending(), { fire: false, dodge: false, ability: null });
    } finally {
      detach();
    }
  });
});

// ---- abilities are on hold -------------------------------------------------

test("no ability key is advertised to a player who holds no ability", () => {
  const none = duelControls(0);
  assert.ok(!none.some((control) => /abilit/i.test(control.action)));
  assert.deepEqual(none, DUEL_CONTROLS);
  // The seam still exists: one loadout entry and the key appears, with no ability
  // named anywhere in this layer.
  assert.ok(duelControls(1).some((control) => /abilit/i.test(control.action)));
});

// ---- content seam ----------------------------------------------------------

test("the item source carries no rubric or acceptable answers", () => {
  const content = M1_ITEM_SOURCE.get(m1QuestionBank()[0]!)!;
  const keys = Object.keys(content);
  for (const forbidden of ["accept", "reject", "rubric", "answer", "verdict", "bullets"]) {
    assert.ok(
      !keys.some((key) => key.toLowerCase().includes(forbidden)),
      `the client must not hold ${forbidden}`,
    );
  }
});
