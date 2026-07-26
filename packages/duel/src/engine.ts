// The duel's single import surface onto the shared world engine.
//
// There is ONE physics, movement and collision core for the game and it lives
// in @pa/engine-world. The duel consumes it; it does not fork it. Every other
// module in this package imports the engine through this file and never reaches
// for @pa/engine-world directly, which is what made consolidating the duel's
// declared gaps a single-file change when they landed upstream.
//
// The duel owns no physics. There is no local integrator, no local geometry, no
// local body model and no local clock or RNG: movement is `stepMotion`, a dodge is
// the shared `DASH` burst, cover and sight are collision queries, a body is the
// engine's capsule and landmarks, and every random draw is `fieldRandom`.
//
// The imports below address the engine's pure modules by subpath, never through
// the package root. That is deliberate and load-bearing: the "." barrel
// re-exports React/three components (RiggedCharacter, ImportedAssets, …), and the
// duel must stay importable from plain Node, because the PvP authority simulates
// duels server-side and these tests run under `node --test` with no DOM. Adding a
// root-barrel import here would quietly pull a renderer into the server.

export {
  // The canonical fixed-step heartbeat. The duel does not own a clock.
  FIELD_TICK_HZ,
  FIELD_DT,
  MAX_CATCHUP_STEPS,
  MAX_FRAME_DT_S,
  createFieldClock,
  advanceFieldClock,
  pauseFieldClock,
  resumeFieldClock,
  // The canonical seeded randomness. The duel does not own an RNG.
  fieldRandom,
  projectFieldSeed,
  type FieldClock,
  type FieldAdvanceResult,
} from "@pa/engine-world/fieldSimulation";

export {
  // Spatial queries and occlusion. Cover and line of sight are queries against
  // the mission's CollisionWorld, not a second geometry system.
  segmentClear,
  segmentOccluderIds,
  positionClear,
  blockerIdsAt,
  sweepXZ,
  supportBelow,
  headClearance,
  canStand,
  landingValid,
  depenetrateXZ,
  slideVelocityXZ,
  wallFromRect,
  wallFromOrientedRect,
  platformFromRect,
  // Actors are not in the CollisionWorld, so a ball that should hit or pass a
  // body needs its own query. This is the engine's, not a local copy: it resolves
  // the vertical band across the whole segment rather than judging it by an
  // endpoint, which matters the moment anything arcs.
  segmentHitsCapsule,
  firstActorHit,
  // The body model. All five numbers live together in collision.ts so a patrol's
  // sightline and a ball's aim point cannot disagree about where a crouching
  // person's chest is, and the landmarks are fractions of the LIVE capsule height
  // so a crouched silhouette is automatically the same silhouette to both.
  eyePosition,
  chestPosition,
  eyeHeightForCapsule,
  chestHeightForCapsule,
  isCrouched,
  EYE_HEIGHT_FRACTION,
  CHEST_HEIGHT_FRACTION,
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  CROUCH_HEIGHT,
  CONTACT_EPS,
  PHYSICS_SUBSTEP,
  type CollisionWorld,
  type Blocker,
  type Platform,
  type Vec3,
  type BodyPose,
  type SweepResult,
  type SegmentCapsuleHit,
} from "@pa/engine-world/collision";

export {
  // Locomotion. Duel movement is the same movement as mission movement.
  stepMotion,
  createGroundedState,
  beginStandingJump,
  beginRunningJump,
  toggleFreeCrouch,
  simulateBallistic,
  // The shared burst. A duel dodge, a parkour dash and any future movement
  // ability are ONE phase driving the integrator walking already uses, so they
  // cannot drift apart. The duel decides when a burst may open and what it means;
  // every metre of it is the engine's.
  beginDash,
  canDash,
  cancelDash,
  isDashing,
  dashSpeed,
  dashProgress,
  dashRemainingMs,
  DASH_SPEED_SCALE,
  DASH_DURATION_MS,
  WALK_SPEED,
  RUN_SPEED,
  CROUCH_SPEED,
  GRAVITY,
  AIRBORNE_PHASES,
  AUTHORED_PHASES,
  BURST_PHASES,
  type MotionState,
  type MotionInput,
  type MotionResult,
  type MotionPhase,
  type MotionEventType,
  type DashWindow,
} from "@pa/engine-world/playerMotion";

export {
  // Input policy. Sprint/walk/crouch speed selection and the jump decision are
  // authored once, in the engine, for both contexts.
  freeMoveSpeed,
  resolveFreeJump,
  freeLocomotionClip,
  FREE_JUMP_COYOTE_MS,
  type FreeJumpDecision,
  type FreeJumpContext,
} from "@pa/engine-world/playerInput";
