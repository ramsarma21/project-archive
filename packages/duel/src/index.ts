// @pa/duel — the headless boss/PvP duel core.
//
// No rendering, no React, no three: this package is pure simulation and state, so
// it runs under `node --test` and inside the PvP server authority as well as in
// the browser. Physics, movement, collision, the fixed-step clock and the seeded
// RNG all belong to @pa/engine-world and are consumed through ./engine.ts.

export * from "./sides.js";
export * from "./tuning.js";
export * from "./verdict.js";
export * from "./bullets.js";
export * from "./abilities.js";
export * from "./boss.js";
export * from "./cover.js";
export * from "./combat.js";
export * from "./policy.js";
export * from "./bossAi.js";
export * from "./events.js";
export * from "./questions.js";
export * from "./machine.js";
export * from "./arena.js";

import { assertGrantIsSpendable } from "./tuning.js";

// The one design failure in this package that no test would catch, checked at
// import: if the correct-answer magazine is larger than a round can discharge,
// 14 balls and 7 balls are the same round and knowledge stops buying anything.
// Failing to load is the correct response to shipping that.
assertGrantIsSpendable();

// Deliberately re-exported so a consumer can build a duel without importing the
// engine twice, and so the engine surface the duel depends on is discoverable.
export {
  FIELD_DT,
  FIELD_TICK_HZ,
  createFieldClock,
  advanceFieldClock,
  fieldRandom,
  projectFieldSeed,
  type CollisionWorld,
  type Vec3,
} from "./engine.js";

// There is no engineGaps.ts any more. Every capability it declared landed in
// @pa/engine-world — the DASH burst phase, the segment-vs-capsule actor query, and
// the body landmarks — so the file was deleted rather than grown, and the duel now
// holds no physics, geometry or body model of its own.
