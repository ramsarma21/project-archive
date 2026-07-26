import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STEALTH_TUNING,
  createCrowdBlendState,
  stepCrowdBlend,
  type CrowdCluster,
} from "@pa/engine-world/stealth";

import { compileLevel, crowdClustersOf } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { CROWD_CIVILIANS } from "../level/opposition.js";

const level = M1_EFFIGY_RUN;
compileLevel(level);

/** Ramp a blend to completion and report the strength it reaches. */
function blendStrength(cluster: CrowdCluster, speedMps = 2.0): number {
  let state = createCrowdBlendState();
  for (let tick = 0; tick < STEALTH_TUNING.crowdBlendEnterTicks + 10; tick++) {
    state = stepCrowdBlend(state, {
      playerPosition: { x: cluster.x, y: 0, z: cluster.z },
      speedMps,
      clusters: [cluster],
      watchersWithContact: [],
    });
  }
  return state.strength;
}

function cluster(density: number, radiusM = 4): CrowdCluster {
  return { id: "TEST", x: 0, z: 0, radiusM, density };
}

// The civilian count is a rendering cost, so it is worth knowing exactly what
// it buys. These measure the field rather than reading the source, because the
// answer decides whether a feature ships or gets cut for frame time.

test("the blend requirement is a cliff, not a slope", () => {
  const floor = STEALTH_TUNING.crowdBlendMinDensity;
  assert.equal(
    blendStrength(cluster(floor - 1)),
    0,
    "one body under the floor and the crowd hides nobody at all",
  );
  assert.equal(
    blendStrength(cluster(floor)),
    1,
    "at the floor the break is already total",
  );
});

test("bodies above the floor buy nothing whatsoever", () => {
  const floor = STEALTH_TUNING.crowdBlendMinDensity;
  for (const count of [floor, floor + 1, 8, 12, 20, 42, 100]) {
    assert.equal(
      blendStrength(cluster(count)),
      1,
      `${count} bodies produce the same complete break as ${floor}`,
    );
  }
});

test("radius does not change the break either, only where it applies", () => {
  for (const radiusM of [1.5, 4, 6.4, 12]) {
    assert.equal(blendStrength(cluster(12, radiusM)), 1);
  }
});

test("the blend is bought with pace, which is the actual cost", () => {
  assert.equal(
    blendStrength(cluster(12), STEALTH_TUNING.crowdBlendMaxSpeedMps + 0.1),
    0,
    "above the speed cap the crowd parts around you instead of closing over you",
  );
  assert.equal(blendStrength(cluster(12), STEALTH_TUNING.crowdBlendMaxSpeedMps), 1);
});

test("moving to a second crowd restarts the ramp, so one big cluster beats two small", () => {
  const clusters: CrowdCluster[] = [
    { id: "A", x: 0, z: 0, radiusM: 2, density: 12 },
    { id: "B", x: 6, z: 0, radiusM: 2, density: 12 },
  ];
  let state = createCrowdBlendState();
  for (let tick = 0; tick < STEALTH_TUNING.crowdBlendEnterTicks; tick++) {
    state = stepCrowdBlend(state, {
      playerPosition: { x: 0, y: 0, z: 0 },
      speedMps: 2,
      clusters,
      watchersWithContact: [],
    });
  }
  assert.equal(state.strength, 1);
  // One tick inside the neighbouring cluster and the player is exposed again.
  state = stepCrowdBlend(state, {
    playerPosition: { x: 6, y: 0, z: 0 },
    speedMps: 2,
    clusters,
    watchersWithContact: [],
  });
  assert.ok(
    state.strength < 0.1,
    `crossing to a second crowd drops the blend to ${state.strength.toFixed(2)}; this is why the square is authored as one cluster`,
  );
});

test("a close watcher who never lost sight of you is not fooled", () => {
  let state = createCrowdBlendState();
  for (let tick = 0; tick < STEALTH_TUNING.crowdBlendEnterTicks; tick++) {
    state = stepCrowdBlend(state, {
      playerPosition: { x: 0, y: 0, z: 0 },
      speedMps: 2,
      clusters: [cluster(12)],
      watchersWithContact: [
        { id: "WATCH", distanceM: STEALTH_TUNING.crowdBlendPierceM - 1 },
      ],
    });
  }
  assert.equal(state.strength, 0, "he watched you walk in");
  assert.equal(state.piercedBy, "WATCH");
});

test("every authored crowd clears the floor with headroom for an art cut", () => {
  const floor = STEALTH_TUNING.crowdBlendMinDensity;
  const clusters = crowdClustersOf(level);
  assert.ok(clusters.length > 0);
  for (const authored of clusters) {
    assert.ok(
      authored.density >= floor,
      `${authored.id} has ${authored.density}; below ${floor} the mechanic silently stops existing`,
    );
    assert.equal(
      blendStrength(authored),
      1,
      `${authored.id} does not actually produce a break`,
    );
  }
  assert.ok(
    CROWD_CIVILIANS >= floor * 2,
    `the authored count is ${CROWD_CIVILIANS} against a floor of ${floor}; keep at least a factor of two so a cut for frame time cannot switch the verb off`,
  );
});

test("the crowd count is one number in one place", () => {
  const counts = new Set(level.blend.map((volume) => volume.civilians));
  assert.equal(
    counts.size,
    1,
    "every crowd uses CROWD_CIVILIANS, so the art budget is a single edit",
  );
  assert.equal([...counts][0], CROWD_CIVILIANS);
});
