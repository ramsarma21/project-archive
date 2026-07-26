// The physics constants an ability's numbers are derived from.
//
// Imported through @pa/engine-world's headless subpath export, never through the
// package root: the root re-exports React components and this package is pure
// data and arithmetic.
//
// Nothing is redefined here. `RUN_SPEED`, `RUNNING_JUMP_VY` and `GRAVITY` are
// read so that an ability's reach can be REPORTED in metres rather than asserted
// in prose — if somebody retunes the jump, the numbers this package prints move
// with it and the tests that bound them start failing. That is the point.
//
// `DASH_SPEED_SCALE` / `dashSpeed` are read for the same reason: the burst phase
// exists in the engine, the duel already drives it with
// `dashSpeed(RUN_SPEED * speedScale)`, and a movement ability is nothing more
// than a contribution to that `speedScale`.

export {
  CONTACT_PUSH_MPS,
  CONTACT_STAGGER_MS,
  DASH_DURATION_MS,
  DASH_SPEED_SCALE,
  GRAVITY,
  MAX_JUMP_LAUNCH_SCALE,
  MAX_STAGGER_RECOVERY_SCALE,
  MIN_JUMP_LAUNCH_SCALE,
  MIN_STAGGER_RECOVERY_SCALE,
  RUNNING_JUMP_VY,
  RUN_SPEED,
  STANDING_JUMP_VY,
  WALK_SPEED,
  dashSpeed,
  jumpLaunchScale,
  staggerRecoveryScale,
  type ContactKind,
  type MotionState,
} from "@pa/engine-world/playerMotion";

// The stealth field's invoked-ability record. Imported rather than mirrored, for
// the same reason `AbilityModifiers` is imported rather than mirrored: a shape this
// package produces and another package consumes must have exactly one definition,
// and it belongs to the consumer.
export {
  NO_INVOKED_ABILITY,
  resolveInvokedAbility,
  type InvokedAbilityEffect,
} from "@pa/engine-world/stealth";
