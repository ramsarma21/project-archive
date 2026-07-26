// @pa/beat — the headless precision-beat core.
//
// The osu-side of "Metal Gear Solid V plus osu": a short burst of timed input at
// a fixed spot, inside a live stealth field, where imprecision is paid for in
// attention rather than in points.
//
// No rendering, no React, no three. This package is pure simulation and state,
// so it runs under `node --test`, inside a replay harness, and in the browser
// alike. The fixed-step clock, the seeded RNG and the noise model all belong to
// @pa/engine-world and are consumed through ./engine.ts.
//
// There is no wall clock anywhere in here. No Date.now, no performance.now, no
// setTimeout, no Math.random. Every window, gap and duration is an integer count
// of engine ticks and every draw is `fieldRandom`, so a beat replays exactly and
// a retry differs by seed rather than by chance.

export * from "./tuning.js";
export * from "./chart.js";
export * from "./judge.js";
export * from "./verbs.js";
export * from "./noise.js";
export * from "./spec.js";
export * from "./machine.js";
export * from "./presentation.js";
export * from "./mount.js";
export * from "./m1NailStance.js";

import { STEALTH_TUNING } from "./engine.js";
import { assertFlushIsInaudible, assertWindowsNest } from "./tuning.js";

// The two design failures in this package that no test would report, checked at
// import. Both are silent: an unsorted window ladder makes a grade unreachable
// while everything still renders, and a FLUSH the field can hear deletes the
// reward for the hardest thing in the mission without changing a single visible
// behaviour. Failing to load is the correct response to shipping either.
assertWindowsNest();
assertFlushIsInaudible(STEALTH_TUNING.minAudibleNoise);

// Re-exported so a consumer can mount a beat without importing the engine twice,
// and so the engine surface this package depends on is discoverable from its
// public root.
export {
  FIELD_TICK_HZ,
  FIELD_DT,
  fieldRandom,
  projectFieldSeed,
  noiseAudibility,
  noiseImplicatesPlayer,
  type NoiseEvent,
  type Vec3,
} from "./engine.js";
