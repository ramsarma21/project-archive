// The three ability channels the engine now honours, each proved to move the
// behaviour it claims — and the one-difficulty guarantee proved still intact.
//
// A channel that exists and does nothing is worse than a channel that does not
// exist, because a HUD gets wired to it and a designer tunes it. So none of these
// tests inspects a field: each drives the real function and measures the outcome.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTACT_EPS, STAND_HEIGHT } from "../collision.js";
import { FIELD_DT, FIELD_TICK_HZ } from "../fieldSimulation.js";
import {
  GRAVITY,
  MAX_JUMP_LAUNCH_SCALE,
  MIN_JUMP_LAUNCH_SCALE,
  RUNNING_JUMP_VY,
  RUN_SPEED,
  STANDING_JUMP_VY,
  beginRunningJump,
  beginStandingJump,
  jumpLaunchScale,
  stepMotion,
} from "../playerMotion.js";
import {
  MOVEMENT_CAPABILITIES,
  jumpApexM,
  maxGapMetersForDrop,
} from "../parkour/index.js";
import {
  NO_INVOKED_ABILITY,
  STEALTH_TUNING,
  assertInvokedAbilityIsNotAPlayerAttribute,
  createDiversion,
  createStealthFieldState,
  invokedAbilityScale,
  resolveInvokedAbility,
  solveThrow,
  stepDiversion,
  stepStealthField,
  stepWatcherAttention,
  throwFieldDiversion,
  visibility,
  type InvokedAbilityEffect,
  type PlayerStealthRead,
  type WatcherPose,
} from "../stealth/index.js";
import { box, roof, runningNorth, world } from "./parkourHarness.js";

// ---------------------------------------------------------------------------
// CHANNEL 1 — visibilityScale
// ---------------------------------------------------------------------------

const eyeAtOrigin = { position: { x: 0, y: 0, z: 0 }, forwardX: 0, forwardZ: 1 };

function sighted(overrides: Partial<Parameters<typeof visibility>[2]> = {}) {
  return {
    position: { x: 0, y: 0, z: 6 },
    capsuleHeight: STAND_HEIGHT,
    exposure: "EXPOSED" as const,
    motion: "WALK" as const,
    covered: false,
    lightLevel: 1,
    crowdBlend: 0,
    ...overrides,
  };
}

test("the visibility scale is one more factor in the same product", () => {
  const seen = visibility(world(), eyeAtOrigin, sighted());
  const halved = visibility(
    world(),
    eyeAtOrigin,
    sighted({ abilityVisibilityScale: 0.5 }),
  );
  assert.ok(seen.visibility > 0);
  assert.ok(Math.abs(halved.visibility - seen.visibility * 0.5) < 1e-9);
  assert.equal(halved.abilityFactor, 0.5);
  // Every other component is untouched: it multiplies, it does not reinterpret.
  assert.equal(halved.coneFactor, seen.coneFactor);
  assert.equal(halved.exposureFactor, seen.exposureFactor);
  assert.equal(halved.motionFactor, seen.motionFactor);
});

test("a scale of zero is a total break, like a wall or a full crowd blend", () => {
  const gone = visibility(
    world(),
    eyeAtOrigin,
    sighted({ abilityVisibilityScale: 0 }),
  );
  assert.equal(gone.visibility, 0);
  // Still in the cone with a clear line: the ability does not move geometry, it
  // makes the man standing in it unresolvable.
  assert.equal(gone.inCone, true);
  assert.equal(gone.hasLineOfSight, true);
});

test("absent means neutral means exactly the behaviour before this existed", () => {
  const absent = visibility(world(), eyeAtOrigin, sighted());
  const explicitNeutral = visibility(
    world(),
    eyeAtOrigin,
    sighted({ abilityVisibilityScale: 1 }),
  );
  assert.deepEqual(absent, explicitNeutral);
  assert.equal(absent.abilityFactor, 1);
});

test("PROOF: the visibility channel turns a detection into a clean crossing", () => {
  // The behaviour the channel exists for. A guard staring straight down the
  // player's line, six metres away, in daylight, in the open. Without the ability
  // this is a confirmed sighting; with it the guard never becomes certain.
  const guard: WatcherPose = {
    id: "guard",
    position: { x: 0, y: 0, z: 0 },
    baseYaw: 0,
  };
  const player: PlayerStealthRead = {
    position: { x: 0, y: 0, z: 6 },
    capsuleHeight: STAND_HEIGHT,
    speedMps: 2,
    sprinting: false,
    traversing: false,
    exposure: "EXPOSED",
    covered: false,
    lightLevel: 1,
  };

  const run = (invokedAbility?: InvokedAbilityEffect): number => {
    let state = createStealthFieldState([guard.id]);
    let peak = 0;
    for (let tick = 0; tick < 240; tick += 1) {
      const result = stepStealthField(world(), state, {
        dt: FIELD_DT,
        tick,
        seed: 7,
        watchers: [guard],
        player,
        clusters: [],
        noise: [],
        reflexDisabled: true,
        suspendAccrual: false,
        ...(invokedAbility ? { invokedAbility } : {}),
      });
      state = result.state;
      peak = Math.max(peak, result.suspicion);
    }
    return peak;
  };

  const exposed = run();
  const concealed = run({ visibilityScale: 0, diversionAttentionScale: 1 });
  assert.ok(
    exposed >= STEALTH_TUNING.thresholds.alerted,
    `standing in the open should be a confirmed sighting, peaked at ${exposed.toFixed(2)}`,
  );
  assert.equal(concealed, 0, "a total break accrues nothing at all");

  // And the partial case moves the outcome without erasing it.
  const partial = run({ visibilityScale: 0.35, diversionAttentionScale: 1 });
  assert.ok(partial > 0, "a partial concealment is not immunity");
  assert.ok(partial < exposed, "but it is a real reduction");
});

// ---------------------------------------------------------------------------
// the one-difficulty guarantee, extended rather than weakened
// ---------------------------------------------------------------------------

test("the tuning table still carries no per-player key, and no ability key either", () => {
  // The original guarantee. The ability channel was deliberately NOT put here:
  // a tuning value applies to everybody always, which is the definition of the
  // thing that had to be removed.
  const perPlayer = Object.keys(STEALTH_TUNING).filter((key) =>
    /standing|heat|difficulty|tier|skill|rank|level/i.test(key),
  );
  assert.deepEqual(perPlayer, []);
  const abilityKeys = Object.keys(STEALTH_TUNING).filter((key) =>
    /ability|unlock|loadout/i.test(key),
  );
  assert.deepEqual(
    abilityKeys,
    [],
    "an invoked effect is per-tick state, never a tuning value",
  );
});

test("an invoked effect describes what is happening, not who the player is", () => {
  assert.doesNotThrow(assertInvokedAbilityIsNotAPlayerAttribute);
  assert.deepEqual(Object.keys(NO_INVOKED_ABILITY).sort(), [
    "diversionAttentionScale",
    "visibilityScale",
  ]);
  for (const key of Object.keys(NO_INVOKED_ABILITY)) {
    assert.equal(
      /standing|heat|difficulty|tier|skill|rank|level|profile|player/i.test(key),
      false,
      `${key} names a player attribute`,
    );
  }
});

test("the effect is neutral by default, which a difficulty band never is", () => {
  assert.deepEqual(resolveInvokedAbility(undefined), NO_INVOKED_ABILITY);
  assert.equal(NO_INVOKED_ABILITY.visibilityScale, 1);
  assert.equal(NO_INVOKED_ABILITY.diversionAttentionScale, 1);
});

test("two players in identical geometry get identical numbers", () => {
  // The definition of a per-player term is that it does not. The old Standing band
  // gave 0.7x to one player and 1.4x to another in the same doorway; there is no
  // input to this function through which that could be expressed, because the only
  // ability input is the invocation itself.
  const invoked = { abilityVisibilityScale: 0.5 };
  const first = visibility(world(), eyeAtOrigin, sighted(invoked));
  const second = visibility(world(), eyeAtOrigin, sighted(invoked));
  assert.deepEqual(first, second);
  // And with the same effect invoked, the number is the same for anybody.
  assert.equal(first.abilityFactor, second.abilityFactor);
});

test("a nonsensical scale falls back to neutral rather than to an advantage", () => {
  assert.equal(invokedAbilityScale(Number.NaN), 1);
  assert.equal(invokedAbilityScale(Number.POSITIVE_INFINITY), 1);
  assert.equal(invokedAbilityScale(-3), 1);
  assert.equal(invokedAbilityScale(12), 8, "a finite excess is clamped, not zeroed");
  assert.equal(invokedAbilityScale(0), 0);
  assert.equal(
    visibility(world(), eyeAtOrigin, sighted({ abilityVisibilityScale: -5 }))
      .abilityFactor,
    1,
  );
});

// ---------------------------------------------------------------------------
// CHANNEL 2 — diversionAttentionScale
// ---------------------------------------------------------------------------

test("the attention scale widens a thrown object's reach, not its source loudness", () => {
  const solution = solveThrow({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 9 })!;
  const run = (attentionScale: number) => {
    let object = createDiversion("stone", solution, attentionScale);
    const noise = [];
    for (let tick = 0; tick < 300 && !object.atRest; tick += 1) {
      const result = stepDiversion(world(), object, FIELD_DT);
      object = result.object;
      noise.push(...result.noise);
    }
    return noise[0]!;
  };
  const plain = run(1);
  const chimed = run(2.5);
  // Source loudness is documented [0,1] and is left alone; scaling it would clip
  // at 1 and silently cap the ability well below what it was authored at.
  assert.equal(chimed.intensity, plain.intensity);
  assert.ok(chimed.intensity <= 1);
  assert.ok(Math.abs(chimed.radiusM - plain.radiusM * 2.5) < 1e-9);
  assert.equal(chimed.attentionHoldScale, 2.5);
});

test("the scale is captured at the throw and owned by the object thereafter", () => {
  const state = createStealthFieldState(["guard"]);
  const armed = throwFieldDiversion(
    world(),
    state,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 8 },
    STEALTH_TUNING,
    { visibilityScale: 1, diversionAttentionScale: 2.5 },
  );
  assert.equal(armed.thrown, true);
  assert.equal(armed.state.diversions.live[0]?.attentionScale, 2.5);

  const plain = throwFieldDiversion(world(), state, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 8 });
  assert.equal(plain.state.diversions.live[0]?.attentionScale, 1);
});

test("PROOF: the attention channel pulls a guard who could not hear the bottle", () => {
  // A guard fifteen metres from where the object lands. An ordinary throw is
  // inaudible at that distance; a chimed one turns his head.
  const solution = solveThrow({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 })!;
  const guardAt = { x: 0, y: 0, z: 21 };

  const run = (attentionScale: number) => {
    let object = createDiversion("stone", solution, attentionScale);
    let heard = false;
    let alert = {
      id: "guard",
      state: "UNAWARE" as const,
      suspicion: 0,
      stateTicks: 0,
      noContactTicks: 0,
      lastKnown: null,
      attention: null,
      attentionIsDiversion: false,
      attentionTicks: 0,
      yaw: Math.PI,
      firstHand: false,
      callTicks: 0,
      called: false,
      searchYawOffset: 0,
    };
    for (let tick = 0; tick < 300; tick += 1) {
      const stepped = stepDiversion(world(), object, FIELD_DT);
      object = stepped.object;
      alert = stepWatcherAttention(alert, {
        dt: FIELD_DT,
        tick,
        seed: 3,
        position: guardAt,
        baseYaw: Math.PI,
        noise: stepped.noise,
      });
      if (alert.attentionIsDiversion) heard = true;
    }
    return { heard, holdTicks: alert.attentionTicks };
  };

  assert.equal(run(1).heard, false, "an ordinary throw is inaudible at 15m from it");
  const chimed = run(2.5);
  assert.equal(chimed.heard, true, "the chimed throw is not");
});

test("PROOF: the attention channel holds a guard's interest longer", () => {
  const noiseAt = (attentionHoldScale?: number) => [
    {
      kind: "DIVERSION_IMPACT" as const,
      x: 4,
      y: 0,
      z: 0,
      intensity: 0.7,
      radiusM: 20,
      ...(attentionHoldScale === undefined ? {} : { attentionHoldScale }),
    },
  ];
  const hold = (attentionHoldScale?: number) => {
    const alert = stepWatcherAttention(
      {
        id: "guard",
        state: "UNAWARE",
        suspicion: 0,
        stateTicks: 0,
        noContactTicks: 0,
        lastKnown: null,
        attention: null,
        attentionIsDiversion: false,
        attentionTicks: 0,
        yaw: 0,
        firstHand: false,
        callTicks: 0,
        called: false,
        searchYawOffset: 0,
      },
      {
        dt: FIELD_DT,
        tick: 0,
        seed: 1,
        position: { x: 0, y: 0, z: 0 },
        baseYaw: 0,
        noise: noiseAt(attentionHoldScale),
      },
    );
    return alert.attentionTicks;
  };
  assert.equal(hold(), STEALTH_TUNING.diversionHoldTicks, "absent is the authored hold");
  assert.equal(hold(1), STEALTH_TUNING.diversionHoldTicks);
  assert.equal(hold(2.5), Math.round(STEALTH_TUNING.diversionHoldTicks * 2.5));
  // 4 seconds of held attention becomes 10, which is the whole payoff.
  assert.equal(STEALTH_TUNING.diversionHoldTicks / FIELD_TICK_HZ, 4);
  assert.equal(hold(2.5) / FIELD_TICK_HZ, 10);
});

// ---------------------------------------------------------------------------
// CHANNEL 3 — jump launch scale
// ---------------------------------------------------------------------------

test("the launch scale may only ever add height", () => {
  // The floor of 1 is the guard against a per-player movement penalty, which is a
  // difficulty band wearing different clothes.
  assert.equal(MIN_JUMP_LAUNCH_SCALE, 1);
  assert.equal(jumpLaunchScale(0.5), 1);
  assert.equal(jumpLaunchScale(0), 1);
  assert.equal(jumpLaunchScale(-2), 1);
  assert.equal(jumpLaunchScale(Number.NaN), 1);
  assert.equal(jumpLaunchScale(1.45), 1.45);
  assert.equal(jumpLaunchScale(99), MAX_JUMP_LAUNCH_SCALE);
});

test("the scale multiplies the launch velocity and nothing else", () => {
  const standing = beginStandingJump(runningNorth(0, 0), 1.45);
  assert.ok(Math.abs(standing.vel.y - STANDING_JUMP_VY * 1.45) < 1e-9);
  assert.equal(standing.vel.x, 0);
  assert.equal(standing.vel.z, 0);

  // Horizontal reach is the move-speed channel's business, so a running jump keeps
  // exactly the speed it arrived with.
  const running = beginRunningJump(runningNorth(0, 3.4), 1.45);
  assert.ok(Math.abs(running.vel.y - RUNNING_JUMP_VY * 1.45) < 1e-9);
  assert.equal(running.vel.z, 3.4);
});

test("omitting the scale is byte-identical to the jump before it existed", () => {
  assert.deepEqual(
    beginStandingJump(runningNorth(0, 0)),
    beginStandingJump(runningNorth(0, 0), 1),
  );
  assert.deepEqual(
    beginRunningJump(runningNorth(0, 2)),
    beginRunningJump(runningNorth(0, 2), 1),
  );
});

test("PROOF: the launch channel puts the player on a sill base movement cannot reach", () => {
  // The section 18.2 case. A 1.5m crate under a 4.0m sill: base movement peaks at
  // 1.5 + 1.25 = 2.75m and falls short; a 1.45x launch peaks at 1.5 + 2.63 = 4.13m
  // and catches it. Measured through stepMotion, so the arc is the integrator's.
  const collision = world([
    box("crate", 2, 1.5, 2),
    box("sill", 6, 4, 2),
  ]);
  const apexFrom = (launchScale: number): number => {
    let motion = beginStandingJump(
      { ...runningNorth(2, 0, 1.5), phase: "GROUNDED" },
      launchScale,
    );
    let peak = motion.pos.y;
    for (let tick = 0; tick < 240; tick += 1) {
      motion = stepMotion(collision, motion, {
        dt: FIELD_DT,
        targetVelX: 0,
        targetVelZ: 0,
        reducedMotion: false,
      }).state;
      peak = Math.max(peak, motion.pos.y);
      if (motion.grounded && tick > 4) break;
    }
    return peak;
  };

  const base = apexFrom(1);
  const boosted = apexFrom(1.45);
  assert.ok(base < 3, `base movement peaked at ${base.toFixed(2)}m, expected under 3m`);
  assert.ok(
    boosted > 4,
    `a 1.45x launch peaked at ${boosted.toFixed(2)}m, expected over the 4m sill`,
  );
  // And it is the square law, not a linear one: the integrator did the arc.
  assert.ok(Math.abs(boosted - base - (jumpApexM(STANDING_JUMP_VY * 1.45) - jumpApexM(STANDING_JUMP_VY))) < 0.05);
});

// ---------------------------------------------------------------------------
// the envelope, still one place
// ---------------------------------------------------------------------------

test("the Level 0 envelope is unchanged by any of this", () => {
  // MOVEMENT_CAPABILITIES is level design's guarantee and must not move because an
  // ability exists. The new parameters all default to the engine's own numbers.
  assert.equal(MOVEMENT_CAPABILITIES.sprintSpeedMps, RUN_SPEED);
  assert.equal(MOVEMENT_CAPABILITIES.jumpVelocityMps, RUNNING_JUMP_VY);
  assert.equal(MOVEMENT_CAPABILITIES.jumpApexM, jumpApexM());
  assert.equal(MOVEMENT_CAPABILITIES.maxFlatGapM, maxGapMetersForDrop(0));
  assert.equal(maxGapMetersForDrop(0), maxGapMetersForDrop(0, RUN_SPEED, RUNNING_JUMP_VY));
});

test("the envelope answers questions about boosted movement too", () => {
  // So that a layer raising the speed or the launch asks the authoritative function
  // instead of reimplementing the ballistics.
  const base = maxGapMetersForDrop(0);
  const faster = maxGapMetersForDrop(0, RUN_SPEED * 1.7);

  // A GAP DOES NOT SCALE WITH SPEED. It scales BETTER than speed, and the reason is
  // the two constant deductions: the takeoff setback and the capsule radius come off
  // once, and they are a much larger fraction of a 3.7m gap than of a 6.7m one. A
  // ratio computed outside the engine would have reported 1.70x and been wrong by
  // half a metre — which is the whole argument for asking this function.
  const ratio = faster / base;
  assert.ok(ratio > 1.7, `1.7x speed gave ${ratio.toFixed(3)}x the gap, not less`);
  assert.ok(ratio < 1.9, `and it must not run away: ${ratio.toFixed(3)}x`);

  const higher = maxGapMetersForDrop(0, RUN_SPEED, RUNNING_JUMP_VY * 1.45);
  assert.ok(higher > base, "a higher launch buys airtime, so it buys distance");
});

test("gravity, the clock and the capsule are still the engine's alone", () => {
  // Nothing added here brought a second copy of a core value.
  assert.equal(GRAVITY, 10.8);
  assert.equal(FIELD_TICK_HZ, 60);
  assert.ok(CONTACT_EPS > 0);
  assert.equal(roof("r", 0, 1, 1).id, "r");
});
