// Crowd blending: the ramp, the walking requirement, and the pierce rule.

import assert from "node:assert/strict";
import { test } from "node:test";

import { STAND_HEIGHT } from "../collision.js";
import { FIELD_DT } from "../fieldSimulation.js";
import { RUN_SPEED, WALK_SPEED } from "../playerMotion.js";
import {
  STEALTH_TUNING,
  clusterContaining,
  createCrowdBlendState,
  createStealthFieldState,
  stepCrowdBlend,
  stepStealthField,
  visibility,
  type CrowdBlendState,
  type CrowdCluster,
  type PlayerStealthRead,
  type WatcherPose,
} from "../stealth/index.js";
import { world } from "./parkourHarness.js";

const MOB: CrowdCluster = { id: "mob", x: 0, z: 10, radiusM: 3, density: 12 };

function blendFor(
  ticks: number,
  options: {
    speedMps?: number;
    z?: number;
    contacts?: readonly { id: string; distanceM: number }[];
    from?: CrowdBlendState;
    clusters?: readonly CrowdCluster[];
  } = {},
): CrowdBlendState {
  let state = options.from ?? createCrowdBlendState();
  for (let tick = 0; tick < ticks; tick++) {
    state = stepCrowdBlend(state, {
      playerPosition: { x: 0, y: 0, z: options.z ?? MOB.z },
      speedMps: options.speedMps ?? WALK_SPEED,
      clusters: options.clusters ?? [MOB],
      watchersWithContact: options.contacts ?? [],
    });
  }
  return state;
}

test("walking into a crowd blends, over a moment rather than instantly", () => {
  const partial = blendFor(Math.floor(STEALTH_TUNING.crowdBlendEnterTicks / 2));
  assert.ok(partial.strength > 0 && partial.strength < 1, `ramp was ${partial.strength}`);
  const complete = blendFor(STEALTH_TUNING.crowdBlendEnterTicks);
  assert.equal(complete.strength, 1);
  assert.equal(complete.clusterId, "mob");
});

test("sprinting through a crowd does not blend: you part it", () => {
  const sprinting = blendFor(120, { speedMps: RUN_SPEED });
  assert.equal(sprinting.strength, 0);
  assert.equal(sprinting.clusterId, null);
});

test("the speed limit is exactly the tuned one", () => {
  assert.equal(
    blendFor(120, { speedMps: STEALTH_TUNING.crowdBlendMaxSpeedMps }).strength,
    1,
  );
  assert.equal(
    blendFor(120, { speedMps: STEALTH_TUNING.crowdBlendMaxSpeedMps + 0.01 })
      .strength,
    0,
  );
});

test("standing outside the cluster blends nothing", () => {
  assert.equal(blendFor(120, { z: MOB.z + MOB.radiusM + 1 }).strength, 0);
});

test("a thin gathering is not a crowd", () => {
  const thin: CrowdCluster = {
    ...MOB,
    id: "thin",
    density: STEALTH_TUNING.crowdBlendMinDensity - 1,
  };
  assert.equal(blendFor(120, { clusters: [thin] }).strength, 0);
  assert.equal(clusterContaining([thin], 0, thin.z), null);
});

test("a close watcher who watched you walk in is not fooled", () => {
  const pierced = blendFor(STEALTH_TUNING.crowdBlendEnterTicks, {
    contacts: [{ id: "guard", distanceM: STEALTH_TUNING.crowdBlendPierceM - 1 }],
  });
  assert.equal(pierced.pierced, true);
  assert.equal(pierced.piercedBy, "guard");
  assert.equal(pierced.strength, 0, "the blend does not take");
});

test("a distant watcher cannot pierce the blend", () => {
  const blended = blendFor(STEALTH_TUNING.crowdBlendEnterTicks, {
    contacts: [{ id: "guard", distanceM: STEALTH_TUNING.crowdBlendPierceM + 1 }],
  });
  assert.equal(blended.pierced, false);
  assert.equal(blended.strength, 1);
});

test("a watcher who arrives after the blend completes is too late", () => {
  const blended = blendFor(STEALTH_TUNING.crowdBlendEnterTicks + 10);
  assert.equal(blended.strength, 1);
  const stillBlended = blendFor(60, {
    from: blended,
    contacts: [{ id: "guard", distanceM: 2 }],
  });
  assert.equal(
    stillBlended.pierced,
    false,
    "once you are one more body in a throng, arriving eyes do not undo it",
  );
  assert.equal(stillBlended.strength, 1);
});

test("breaking sight first, then blending, is the counterplay that works", () => {
  // Contact during the ramp-in pierces; no contact during the ramp-in does not.
  const watched = blendFor(STEALTH_TUNING.crowdBlendEnterTicks, {
    contacts: [{ id: "guard", distanceM: 3 }],
  });
  const unwatched = blendFor(STEALTH_TUNING.crowdBlendEnterTicks);
  assert.equal(watched.strength, 0);
  assert.equal(unwatched.strength, 1);
});

test("leaving the crowd fades the blend out", () => {
  const blended = blendFor(STEALTH_TUNING.crowdBlendEnterTicks + 10);
  const left = blendFor(STEALTH_TUNING.crowdBlendExitTicks + 2, {
    from: blended,
    z: MOB.z + 20,
  });
  assert.equal(left.strength, 0);
  assert.equal(left.clusterId, null);
});

test("a completed blend is a full cone break, not a discount", () => {
  const eye = { position: { x: 0, y: 0, z: 0 }, forwardX: 0, forwardZ: 1 };
  const seen = visibility(world(), eye, {
    position: { x: 0, y: 0, z: 10 },
    exposure: "EXPOSED",
    motion: "WALK",
    covered: false,
    capsuleHeight: STAND_HEIGHT,
    lightLevel: 1,
    crowdBlend: 0,
  });
  const blended = visibility(world(), eye, {
    position: { x: 0, y: 0, z: 10 },
    exposure: "EXPOSED",
    motion: "WALK",
    covered: false,
    capsuleHeight: STAND_HEIGHT,
    lightLevel: 1,
    crowdBlend: 1,
  });
  assert.ok(seen.visibility > 0);
  assert.equal(blended.visibility, 0);
});

// ---- through the field -----------------------------------------------------

test("walking into a mob breaks a pursuer's cone; standing in the open does not", () => {
  const guard: WatcherPose = {
    id: "guard",
    position: { x: 0, y: 0, z: 0 },
    baseYaw: 0,
  };
  const read = (z: number): PlayerStealthRead => ({
    position: { x: 0, y: 0, z },
    speedMps: WALK_SPEED,
    capsuleHeight: STAND_HEIGHT,
    sprinting: false,
    traversing: false,
    exposure: "EXPOSED",
    covered: false,
    lightLevel: 1,
  });

  const runFor = (clusters: readonly CrowdCluster[]) => {
    let state = createStealthFieldState(["guard"]);
    let peak = 0;
    for (let tick = 1; tick <= 300; tick++) {
      const result = stepStealthField(world(), state, {
        dt: FIELD_DT,
        tick,
        seed: 11,
        watchers: [guard],
        player: read(10),
        clusters,
        noise: [],
        reflexDisabled: false,
        suspendAccrual: false,
      });
      state = result.state;
      peak = Math.max(peak, result.suspicion);
    }
    return { state, peak };
  };

  const inMob = runFor([MOB]);
  const exposed = runFor([]);
  assert.ok(
    inMob.peak < exposed.peak,
    `blending should beat standing exposed (${inMob.peak} vs ${exposed.peak})`,
  );
  assert.equal(inMob.state.crowd.strength, 1);
  assert.notEqual(exposed.state.watchers[0]!.state, "UNAWARE");
});
