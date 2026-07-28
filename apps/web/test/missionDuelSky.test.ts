import { test } from "node:test";
import assert from "node:assert/strict";
import { dawnSky } from "../src/mission/dawn.js";
import { missionDuelSky } from "../src/mission/missionDuelSky.js";

// The bridge that stops the cutscene→duel seam jumping from pre-dawn to midday.
// It carries the mission's dawn COLOURS into the arena and expresses INTENSITIES
// in the arena's own (dimmer, pre-dawn) range. These pin the properties the
// continuity depends on.

// The arena's stand-alone daylight rig, for the "dimmer than midday" comparison.
const ARENA_DAY_HEMI = 0.55;
const ARENA_DAY_SUN = 2.1;

test("the sky colours are the shared dawn palette (so the two frames are one moment)", () => {
  for (const lift of [0, 0.3, 0.55, 0.8]) {
    const sky = missionDuelSky(lift);
    const dawn = dawnSky(lift);
    assert.equal(sky.background, dawn.sky);
    assert.equal(sky.fogColor, dawn.sky);
    assert.equal(sky.hemiSky, dawn.hemiSky);
    assert.equal(sky.hemiGround, dawn.hemiGround);
    assert.equal(sky.sunColor, dawn.sunColour);
  }
});

test("arrival is pre-dawn, not midday: dimmer than the arena's own daylight", () => {
  // Across the range a mission actually arrives in (before and at dawn), both
  // lights sit under the stand-alone yard's midday rig — the whole fix.
  for (const lift of [0, 0.2, 0.4, 0.55]) {
    const sky = missionDuelSky(lift);
    assert.ok(sky.hemiIntensity < ARENA_DAY_HEMI, `hemi ${sky.hemiIntensity} !< ${ARENA_DAY_HEMI} at ${lift}`);
    assert.ok(sky.sunIntensity < ARENA_DAY_SUN, `sun ${sky.sunIntensity} !< ${ARENA_DAY_SUN} at ${lift}`);
  }
  // Full dark is markedly dimmer still — a floor, not merely a shade off day.
  const dark = missionDuelSky(0);
  assert.ok(dark.hemiIntensity <= 0.25 && dark.sunIntensity <= 0.7);
});

test("the light rises monotonically with the dawn lift", () => {
  let prevHemi = -1;
  let prevSun = -1;
  for (let lift = 0; lift <= 1.0001; lift += 0.1) {
    const sky = missionDuelSky(lift);
    assert.ok(sky.hemiIntensity >= prevHemi, `hemi regressed at ${lift}`);
    assert.ok(sky.sunIntensity >= prevSun, `sun regressed at ${lift}`);
    prevHemi = sky.hemiIntensity;
    prevSun = sky.sunIntensity;
  }
});

test("it is a pure function of the lift, and stays kept-alive readable (positive light)", () => {
  assert.deepEqual(missionDuelSky(0.42), missionDuelSky(0.42));
  // Never zero: a duel you cannot see is worse than one at the wrong hour.
  const sky = missionDuelSky(0);
  assert.ok(sky.hemiIntensity > 0 && sky.sunIntensity > 0);
  assert.ok(sky.fogDensity > 0);
});
