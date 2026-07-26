// Every world channel, driven end to end through the real engine.
//
// The claim being tested is not "the number is present in a record". It is "an
// authored Boston ability, resolved into a loadout, invoked through the duel's own
// ledger, changes what engine-world does". A channel that survives that is live; a
// channel that does not is the dead-system failure this file exists to catch.
//
// So nothing here inspects an effect. Each test invokes a real ability and then
// measures a watcher's suspicion, a guard's facing, a jump apex or a recovery in
// ticks — and compares it against the same run with nothing invoked.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_STAGGER_MS,
  MIN_STAGGER_RECOVERY_SCALE,
  createGroundedState,
  isStaggered,
  resolveContact,
  stepMotion,
  type MotionState,
} from "@pa/engine-world";
import {
  STEALTH_TUNING,
  createStealthFieldState,
  stepStealthField,
  throwFieldDiversion,
  type PlayerStealthRead,
  type WatcherPose,
} from "@pa/engine-world/stealth";
import { FIELD_DT } from "@pa/engine-world/fieldSimulation";
import { beginStandingJump } from "@pa/engine-world/playerMotion";

import { missionInvocationContext } from "../ability.js";
import {
  HOLD_FAST,
  KITE_STEP,
  LONGCOAT_HUSH,
  LONG_STRIDE,
  OUT_OF_TIME,
  WARD_CHIME,
} from "../boston.js";
import { ABILITY_CHANNELS } from "../effects.js";
import {
  createMissionAbilityState,
  invokeMissionAbility,
  invokedAbilityEffect,
  missionJumpLaunchScale,
  missionMoveSpeedScale,
  missionStaggerRecoveryScale,
  stepMissionAbilities,
  type MissionAbilityState,
  type MissionAbilityTick,
} from "../missionSession.js";
import type { GameAbility } from "../ability.js";

const EMPTY_WORLD = {
  blockers: [],
  platforms: [],
  bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
};

/**
 * Invoke an ability the way a mission would — through the duel's own ledger — and
 * return the tick it produces. Nothing is faked: a refused invocation fails here.
 */
function invoked(ability: GameAbility, tick = 0): MissionAbilityTick {
  let state: MissionAbilityState = createMissionAbilityState([ability]);
  const result = invokeMissionAbility(
    state,
    ability.abilityId,
    missionInvocationContext({
      tick,
      motion: { grounded: true },
      nearestWatcherHasLineOfSight: false,
    }),
  );
  assert.equal(result.outcome.ok, true, `${ability.abilityId} refused its own invocation`);
  state = result.state;
  return stepMissionAbilities(state, tick);
}

/** The same shape with nothing invoked. */
function idle(ability: GameAbility, tick = 0): MissionAbilityTick {
  return stepMissionAbilities(createMissionAbilityState([ability]), tick);
}

// ---------------------------------------------------------------------------
// selfVisibilityScale
// ---------------------------------------------------------------------------

const GUARD: WatcherPose = { id: "guard", position: { x: 0, y: 0, z: 0 }, baseYaw: 0 };
const EXPOSED: PlayerStealthRead = {
  position: { x: 0, y: 0, z: 6 },
  capsuleHeight: 1.55,
  speedMps: 2,
  sprinting: false,
  traversing: false,
  exposure: "EXPOSED",
  covered: false,
  lightLevel: 1,
};

function peakSuspicion(effect?: ReturnType<typeof invokedAbilityEffect>): number {
  let state = createStealthFieldState([GUARD.id]);
  let peak = 0;
  for (let tick = 0; tick < 180; tick += 1) {
    const result = stepStealthField(EMPTY_WORLD, state, {
      dt: FIELD_DT,
      tick,
      seed: 11,
      watchers: [GUARD],
      player: EXPOSED,
      clusters: [],
      noise: [],
      reflexDisabled: true,
      suspendAccrual: false,
      ...(effect ? { invokedAbility: effect } : {}),
    });
    state = result.state;
    peak = Math.max(peak, result.suspicion);
  }
  return peak;
}

test("LIVE: Out of Time stops a guard resolving a player standing in the open", () => {
  const exposed = peakSuspicion();
  assert.ok(
    exposed >= STEALTH_TUNING.thresholds.alerted,
    `the control run must actually be a detection, peaked at ${exposed.toFixed(2)}`,
  );
  const hidden = peakSuspicion(invokedAbilityEffect(invoked(OUT_OF_TIME)));
  assert.equal(hidden, 0, "a total break accrues nothing at all");
});

test("LIVE: Longcoat Hush halves what a guard resolves without erasing it", () => {
  const exposed = peakSuspicion();
  const hushed = peakSuspicion(invokedAbilityEffect(invoked(LONGCOAT_HUSH)));
  assert.ok(hushed > 0, "half visibility is not immunity");
  assert.ok(hushed < exposed, "but it is a real reduction");
});

test("LIVE: the same abilities with nothing invoked change nothing", () => {
  const exposed = peakSuspicion();
  for (const ability of [OUT_OF_TIME, LONGCOAT_HUSH]) {
    assert.equal(
      peakSuspicion(invokedAbilityEffect(idle(ability))),
      exposed,
      `${ability.abilityId} leaks an effect it was never asked for`,
    );
  }
});

test("LIVE: the effect expires and the world comes back", () => {
  // The window is bounded, so the concealment has to end on its own.
  let state = createMissionAbilityState([OUT_OF_TIME]);
  state = invokeMissionAbility(
    state,
    OUT_OF_TIME.abilityId,
    missionInvocationContext({
      tick: 0,
      motion: { grounded: true },
      nearestWatcherHasLineOfSight: false,
    }),
  ).state;
  const during = stepMissionAbilities(state, 10);
  const after = stepMissionAbilities(during.state, OUT_OF_TIME.durationTicks + 1);
  assert.equal(invokedAbilityEffect(during).visibilityScale, 0);
  assert.equal(invokedAbilityEffect(after).visibilityScale, 1);
  assert.equal(peakSuspicion(invokedAbilityEffect(after)), peakSuspicion());
});

// ---------------------------------------------------------------------------
// diversionAttentionScale
// ---------------------------------------------------------------------------

test("LIVE: Ward Chime pulls a guard who could not have heard the bottle", () => {
  // Fifteen metres from where the object lands: outside the base throw's noise
  // radius, inside the chimed one.
  const distantGuard: WatcherPose = {
    id: "guard",
    position: { x: 0, y: 0, z: 21 },
    baseYaw: Math.PI,
  };
  const run = (effect?: ReturnType<typeof invokedAbilityEffect>): boolean => {
    let state = createStealthFieldState([distantGuard.id]);
    const thrown = throwFieldDiversion(
      EMPTY_WORLD,
      state,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 6 },
      STEALTH_TUNING,
      effect,
    );
    assert.equal(thrown.thrown, true);
    state = thrown.state;
    let turned = false;
    for (let tick = 0; tick < 300; tick += 1) {
      const result = stepStealthField(EMPTY_WORLD, state, {
        dt: FIELD_DT,
        tick,
        seed: 5,
        watchers: [distantGuard],
        // The player is far away and behind him; only the object matters here.
        player: { ...EXPOSED, position: { x: 40, y: 0, z: 40 } },
        clusters: [],
        noise: [],
        reflexDisabled: true,
        suspendAccrual: false,
      });
      state = result.state;
      if (state.watchers[0]?.attentionIsDiversion) turned = true;
    }
    return turned;
  };

  assert.equal(run(), false, "an ordinary throw does not reach him");
  assert.equal(
    run(invokedAbilityEffect(invoked(WARD_CHIME))),
    true,
    "the chimed one does",
  );
});

test("LIVE: the chime is captured at the throw and outlives its own window", () => {
  // Deliberate: the ability arms the throw. A chime that fell silent when the
  // four-second window closed would be worse than the bottle it improved.
  const tick = invoked(WARD_CHIME);
  const armed = throwFieldDiversion(
    EMPTY_WORLD,
    createStealthFieldState(["guard"]),
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 8 },
    STEALTH_TUNING,
    invokedAbilityEffect(tick),
  );
  assert.equal(armed.state.diversions.live[0]?.attentionScale, 2.5);
  assert.ok(
    2.5 * STEALTH_TUNING.diversionHoldTicks > WARD_CHIME.durationTicks,
    "the hold it buys is longer than the window that bought it",
  );
});

// ---------------------------------------------------------------------------
// selfJumpVelocityScale
// ---------------------------------------------------------------------------

test("LIVE: Kite Step raises a real apex through the shared integrator", () => {
  const apexFor = (launchScale: number): number => {
    let motion = beginStandingJump(
      createGroundedState({ x: 0, y: 0, z: 0 }, 0),
      launchScale,
    );
    let peak = 0;
    for (let step = 0; step < 240; step += 1) {
      motion = stepMotion(EMPTY_WORLD, motion, {
        dt: FIELD_DT,
        targetVelX: 0,
        targetVelZ: 0,
        reducedMotion: false,
      }).state;
      peak = Math.max(peak, motion.pos.y);
      if (motion.grounded && step > 4) break;
    }
    return peak;
  };

  const boosted = missionJumpLaunchScale(invoked(KITE_STEP));
  const neutral = missionJumpLaunchScale(idle(KITE_STEP));
  assert.equal(boosted, 1.45);
  assert.equal(neutral, 1);
  assert.ok(
    apexFor(boosted) > apexFor(neutral) + 1.3,
    `boosted ${apexFor(boosted).toFixed(2)}m vs base ${apexFor(neutral).toFixed(2)}m`,
  );
});

// ---------------------------------------------------------------------------
// staggerRecoveryScale
// ---------------------------------------------------------------------------

function recoveryTicks(state: MotionState): number {
  let motion = state;
  let ticks = 0;
  while (isStaggered(motion) && ticks < 600) {
    motion = stepMotion(EMPTY_WORLD, motion, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: 4.6,
      reducedMotion: false,
    }).state;
    ticks += 1;
  }
  return ticks;
}

test("LIVE: Hold Fast shortens a real recovery, and changes nothing else", () => {
  const grab = { kind: "GRAB" as const, from: { x: 0, y: 0, z: 2 }, sourceId: "guard" };
  const standing = () => createGroundedState({ x: 0, y: 0, z: 0 }, 0);

  const helped = missionStaggerRecoveryScale(invoked(HOLD_FAST));
  const neutral = missionStaggerRecoveryScale(idle(HOLD_FAST));
  assert.equal(helped, 0.25, "the authored 0.25 survives the engine's clamp");
  assert.equal(neutral, 1);

  const plain = resolveContact(standing(), grab, neutral);
  const braced = resolveContact(standing(), grab, helped);
  assert.equal(plain.recoveryMs, CONTACT_STAGGER_MS.GRAB);
  assert.equal(braced.recoveryMs, CONTACT_STAGGER_MS.GRAB * 0.25);
  assert.ok(recoveryTicks(braced.state) < recoveryTicks(plain.state));

  // And the scarcity guarantee, from this side of the seam: the ability cannot
  // touch the noise, so being grabbed is a detection risk with or without it.
  assert.deepEqual(braced.noise, plain.noise);
});

test("LIVE: no ability can make being grabbed free", () => {
  // The channel is clamped in the engine, so an ability authored at 0 — or a bug
  // that produced one — still leaves a real window.
  const grab = { kind: "GRAB" as const, from: { x: 0, y: 0, z: 2 } };
  const free = resolveContact(createGroundedState({ x: 0, y: 0, z: 0 }, 0), grab, 0);
  assert.equal(free.staggered, true);
  assert.equal(
    free.recoveryMs,
    CONTACT_STAGGER_MS.GRAB * MIN_STAGGER_RECOVERY_SCALE,
  );
  assert.ok(recoveryTicks(free.state) > 0);
});

// ---------------------------------------------------------------------------
// selfMoveSpeedScale, both halves of the same number
// ---------------------------------------------------------------------------

test("LIVE: Long Stride is one number that both encounters read", () => {
  const tick = invoked(LONG_STRIDE);
  // The mission reads it as a factor on the target velocity handed to the flow
  // layer; the duel reads the identical field off the identical object.
  assert.equal(missionMoveSpeedScale(tick), 1.7);
  assert.equal(tick.duel.selfMoveSpeedScale, 1.7);
  assert.equal(missionMoveSpeedScale(tick), tick.duel.selfMoveSpeedScale);
  assert.equal(missionMoveSpeedScale(idle(LONG_STRIDE)), 1);
});

// ---------------------------------------------------------------------------
// the registry tells the truth
// ---------------------------------------------------------------------------

test("every channel the registry calls LIVE was just proved live", () => {
  const live = ABILITY_CHANNELS.filter((channel) => channel.status === "LIVE").map(
    (channel) => channel.channel,
  );
  // The five duel channels, plus the four world channels this file exercises.
  assert.deepEqual(live.sort(), [
    "diversionAttentionScale",
    "opponentFireIntervalScale",
    "opponentMoveSpeedScale",
    "revealsOpponentThroughCover",
    "selfIncomingDamageScale",
    "selfJumpVelocityScale",
    "selfMoveSpeedScale",
    "selfVisibilityScale",
    "staggerRecoveryScale",
  ]);
});

test("the one channel still PENDING is one the engine should not own", () => {
  const pending = ABILITY_CHANNELS.filter((channel) => channel.status === "PENDING");
  assert.deepEqual(
    pending.map((channel) => channel.channel),
    ["carriedEvidenceConcealed"],
  );
  // Not an oversight and not an engine gap: a document with a readable face and a
  // reading distance is authored mission content. The seam exists and is empty.
  assert.equal(pending[0]?.consumers.some((c) => c.includes("mission content")), true);
});
