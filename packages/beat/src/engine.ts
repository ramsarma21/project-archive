// The beat's single import surface onto the shared world engine.
//
// Same rule as @pa/duel's engine.ts, for the same reason: there is ONE
// simulation core and it lives in @pa/engine-world. This package consumes it and
// never forks it. Every other module here imports the engine through this file.
//
// The imports address the engine's pure modules by subpath rather than through
// the "." barrel, which re-exports React/three components. A beat has to be
// runnable from plain Node — these tests run under `node --test`, and a replay
// harness has no DOM — so a root-barrel import here would quietly pull a
// renderer into a headless simulation.
//
// What this package takes from the engine is deliberately small:
//
//   * the fixed-step clock, because a beat is measured in ticks and nothing else;
//   * the seeded kernel, because a chart is a pure function of a seed;
//   * NoiseEvent and its audibility, because the whole design thesis is that
//     imprecision is paid for in the stealth field's own currency; and
//   * the metres-per-intensity scale the movement layer already uses, so a
//     hammer blow carries exactly as far as a hammer blow's loudness says it
//     should, on the same scale as a landing.

export {
  // The canonical fixed-step heartbeat. The beat does not own a clock, and it
  // never reads a wall clock: every window, every gap and every duration in this
  // package is an integer number of these ticks.
  FIELD_TICK_HZ,
  FIELD_DT,
  // The canonical seeded randomness. A chart is drawn from this and nothing
  // else, so an attempt replays and a retry differs.
  fieldRandom,
  projectFieldSeed,
} from "@pa/engine-world/fieldSimulation";

export {
  // The one currency shared between movement and stealth. A missed strike is a
  // NoiseEvent of exactly the kind a hard landing is, which is what makes it a
  // stealth mistake rather than a scoreboard deduction.
  noiseAudibility,
  noiseImplicatesPlayer,
  STEALTH_TUNING,
  type NoiseEvent,
  type NoiseKind,
} from "@pa/engine-world/stealth";

export {
  // Metres of audible radius per unit of loudness. Read from the movement layer
  // rather than restated, because a hammer stroke is a noise the PLAYER made in
  // the same sense a vault is, and the two must carry on one scale. (The stealth
  // tuning carries a second, longer scale for thrown objects; a diversion is
  // supposed to out-reach the body that threw it, and a hammer is not.)
  PARKOUR_TUNING,
} from "@pa/engine-world/parkour";

export type { Vec3 } from "@pa/engine-world/collision";
