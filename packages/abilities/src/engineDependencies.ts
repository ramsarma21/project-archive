// What this package needs from @pa/engine-world.
//
// This file used to be a list of asks. All but one of them have since been built —
// by this package's author, who took ownership of engine-world rather than sending
// a request round-trip and losing the shape in translation. What remains is the
// record of WHAT WAS BUILT AND WHY IT LOOKS LIKE THAT, because every entry is a
// parameter added to an existing function, and the reason each is a parameter rather
// than a system is the thing worth keeping.
//
// The rule that governed all of it: an ability may add an input to something the
// engine already does. It may never own a second copy of anything the engine does.
// One motion integrator, one collision representation, one body model, one
// fixed-step clock, one seeded RNG — `scripts/check-boundaries.mjs` enforces the
// first five repo-wide and would have failed the build if any of this had added a
// second of one.
//
// ============================================================================
// 1. THE BURST / DASH PHASE — LANDED UPSTREAM, NOTHING ADDED HERE
// ============================================================================
//
// `playerMotion.ts` owns a real `DASH` phase, and `stepDash` replaces the target
// velocity and hands it to the SAME `stepGrounded` that walking uses. `combat.ts`
// already drives it for the duel's dodge with `dashSpeed(RUN_SPEED * speedScale)`,
// and `selfMoveSpeedScale` is a factor of that `speedScale`, so `Long Stride` needed
// nothing built at all.
//
// Two things were decided rather than built:
//
//   (a) THE BURST STAYS A VELOCITY. The comment in `beginDash` is load-bearing:
//       "THE BURST IS A SCALE ON THE TARGET VELOCITY HANDED TO THE EXISTING
//       INTEGRATOR, NEVER A DISPLACEMENT." The moment it writes a position, every
//       movement ability silently becomes two abilities — one for missions and one
//       for duels — and they start drifting the same day.
//
//   (b) NO AIRBORNE BURST IN BOSTON. `beginDash` refuses when not grounded and the
//       engine deferred the question to the ability layer. This is the ability
//       layer, and the answer is no: an air dash changes what geometry is traversable
//       in a way a Level 0 player cannot reason about, which is the fourth
//       locomotion family Mission-Slate section 18 forbids. `Long Stride` and
//       `Kite Step` are grounded-only in `canInvoke` to match the engine rather than
//       argue with it.
//
// ============================================================================
// 2. A VISIBILITY FACTOR ON THE STEALTH FIELD — BUILT
// ============================================================================
//
// Serves: `selfVisibilityScale`  (Longcoat Hush, Out of Time)
//
// `StealthFieldInput.invokedAbility?: InvokedAbilityEffect`, whose `visibilityScale`
// is passed to `visibility()` as `abilityVisibilityScale` and multiplies into the
// same product as cover, light and crowd blend. Absent means neutral means the
// field's behaviour before any of this existed, which is asserted rather than
// assumed.
//
// THE CAREFUL PART. `visibility()` is the single detection function for the whole
// game and the parkour work deliberately kept player identity out of it — that is
// how "one difficulty for everyone" is structural rather than aspirational, and
// there is a test asserting the tuning table carries no key matching standing, heat,
// difficulty, tier, skill, rank or level.
//
// An invoked scale is legitimate and the distinction is not a matter of taste:
//
//   * it is NEUTRAL until a player spends a charge, where a difficulty band is
//     always on;
//   * it is SPENT — one use, four competing slots, a bounded window — where a
//     difficulty band has no charge and no cost;
//   * it is SYMMETRIC: two players in identical geometry with the same effect
//     invoked get the same number, where the old Standing band's entire purpose was
//     to give them different ones.
//
// And structurally: the engine cannot compute this value. It has no notion of Level,
// Rank or Standing and depends on no package that does, so the only way to
// reintroduce a per-player multiplier is for a caller to compute one in the open.
// `stealth/invokedAbility.ts` states all of that at its head and carries a
// type-level guard, `assertInvokedAbilityIsNotAPlayerAttribute`, that makes a
// `standing` or `skillBand` field a build error rather than a review question.
//
// It was deliberately NOT put in `StealthTuning`. A tuning value applies to
// everybody, always; that is the definition of the thing that had to be removed.
//
// ============================================================================
// 3. AN ATTENTION SCALE ON THE THROWN OBJECT — BUILT
// ============================================================================
//
// Serves: `diversionAttentionScale`  (Ward Chime)
//
// `throwFieldDiversion` takes the invoked effect and captures its attention scale
// ONTO THE OBJECT, which carries it for life. Per-tick would have been wrong: the
// ability arms a throw, and a chime that fell silent the moment its four-second
// window expired would be worse than the bottle it was meant to improve. Object-owned
// also means a replay reproduces the pull without knowing what was invoked twelve
// seconds earlier.
//
// The scale multiplies the noise RADIUS and the attention HOLD, and deliberately not
// the source intensity. `intensity` is documented [0,1] and the base impact is
// already 0.7, so scaling it would clip at 1.43x and silently cap an ability authored
// at 2.5x — a number that looks like it works and does not. Radius delivers the
// intent exactly, and because audibility is `intensity * (1 - d/r)`, a wider radius
// is also louder at any given distance, so a chimed throw wins the loudest-noise
// contest in `stepWatcherAttention` without breaking the range contract.
//
// The hold rides on the `NoiseEvent` rather than being read from anywhere global, so
// attention needs to know nothing about abilities: it reads a property of the noise
// it just heard, exactly as it reads the loudness.
//
// Rejected: passing a mutated `StealthTuning` for the active ticks. It needed no
// engine change and it was wrong — it would have scaled detection for every watcher
// and every object in the scene, which is precisely the hidden global easing that
// file exists to forbid.
//
// ============================================================================
// 4. A LAUNCH SCALE ON THE JUMP — BUILT
// ============================================================================
//
// Serves: `selfJumpVelocityScale`  (Kite Step)
//
// `beginStandingJump(state, launchScale = 1)` and `beginRunningJump(state,
// launchScale = 1)`. The scale multiplies the vertical launch only; horizontal reach
// stays the move-speed channel's business, which keeps "jump higher" and "travel
// further" two separate decisions instead of one number that quietly does both.
//
// THE CLAMP FLOOR IS 1. This channel may only ever ADD height. A launch scale below
// 1 would be a per-player movement penalty, and a per-player movement penalty is a
// difficulty band wearing different clothes. Refusing the whole lower half in the
// engine means no caller can express one, however well-intentioned.
//
// ONE OUTSTANDING CALL SITE, and it is not this package's to make: `combat.ts`
// calls both initiators with no scale, so Kite Step's authored 1.45 does not yet
// apply in a duel. The change is one argument —
// `beginRunningJump(motion, self.selfJumpVelocityScale)` — in
// `stepFighterMotion`, and @pa/duel is read-only from here. Recorded in
// `ABILITY_CHANNELS` so it is visible rather than remembered.
//
// ============================================================================
// 5. A HEADLESS ROUTE TO THE MOVEMENT ENVELOPE — LANDED, AND IT CAUGHT A BUG
// ============================================================================
//
// `./parkour` and `./stealth` are subpath exports now, so `reach.ts` asks
// `maxGapMetersForDrop` and `jumpApexM` directly. Both grew optional approach-speed
// and launch-velocity parameters, defaulting to the engine's own, so a layer that
// legitimately raises one can ask the authoritative function instead of
// reimplementing the ballistics beside it.
//
// Which immediately mattered. `reach.ts` had claimed a gap scales linearly with
// approach speed — airtime is fixed, range is speed x airtime. The airtime part is
// right and the conclusion is not: the takeoff setback and the capsule radius come
// off every gap as constants, and a constant is a much larger fraction of a 3.7 m gap
// than of a 6.7 m one. A 1.7x approach buys about 1.83x the gap. The ratio was
// wrong by half a metre of level-design budget and nothing would have caught it.
//
// ============================================================================
// 6. A CONTACT / STAGGER MODEL — BUILT, AND SCARCE BY CONSTRUCTION
// ============================================================================
//
// Serves: `staggerRecoveryScale`  (Hold Fast)
//
// A `STAGGER` phase in `playerMotion.ts`, in `BURST_PHASES` beside `DASH` because it
// is the same mechanism — a substituted target velocity handed to `stepGrounded` —
// and one entry point, `resolveContact` in `contact.ts`, which returns the new motion
// state AND the noise together so a caller cannot take one without the other.
//
// There is history here and it is worth respecting: a non-lethal TAKEDOWN was
// refused as a base verb, on the grounds that once a guard can be deleted, the
// diversion, the crowd blend and the reflex window all become slower answers to a
// solved problem. That argument is correct, and it does not apply, because the two
// things are opposite in kind:
//
//   A takedown is a CAPABILITY THE PLAYER WIELDS.  It acts on the world.
//   A stagger is a PENALTY THE PLAYER SUFFERS.     The world acts on it.
//
// Four properties keep it that way, each asserted in contact.test.ts:
//
//   1. THE NOISE IS NOT ON THIS CHANNEL. `resolveContact`'s noise is identical with
//      and without the ability. Seconds are bought back; the detection consequence
//      never is.
//   2. THE RECOVERY FLOOR IS 0.2, NOT 0. At zero the stagger would be a no-op and
//      "walk into the guard" would become a legal route — the rejected takedown
//      arriving through the back door.
//   3. AVOIDANCE STRICTLY DOMINATES. Not being touched costs zero ticks and zero
//      noise; every recovery at every scale costs both. There is no loadout that
//      makes contact preferable to avoiding it.
//   4. THERE IS NO OUTPUT CHANNEL TO THE OTHER BODY. `ContactResolution` carries a
//      `MotionState` and a `NoiseEvent`, both about the player, and
//      `assertContactCannotAffectTheOtherBody` makes adding one a build error.
//
// Scarce by construction rather than by tuning: one of four loadout slots, one use
// per encounter, a window measured in seconds inside a three-minute mission.

/** Whether the engine can honour a channel today. */
export type DependencyStatus = "LANDED" | "REQUIRED" | "WANTED";

export interface EngineDependency {
  readonly id: string;
  readonly title: string;
  readonly status: DependencyStatus;
  /** Effect channels that cannot work until this lands. */
  readonly blocksChannels: readonly string[];
  /** The upstream symbol that satisfies it, or the signature still expected. */
  readonly expectedUpstream: string;
}

/**
 * The same list as the prose above, machine-readable, so a status board can render
 * it and `verifyChannelDependencies` can assert that every PENDING channel has a
 * declared dependency behind it rather than a silent gap — and, now, that every LIVE
 * channel does NOT.
 */
export const ENGINE_DEPENDENCIES: readonly EngineDependency[] = [
  {
    id: "BURST_PHASE",
    title: "First-class DASH/burst motion phase",
    status: "LANDED",
    blocksChannels: [],
    expectedUpstream:
      "playerMotion.ts: canDash / beginDash / stepDash / dashSpeed. Keep it a velocity scale; Boston takes no airborne burst.",
  },
  {
    id: "STEALTH_VISIBILITY_FACTOR",
    title: "Invoked-ability visibility factor in the stealth field",
    status: "LANDED",
    blocksChannels: [],
    expectedUpstream:
      "stealth/field.ts: StealthFieldInput.invokedAbility.visibilityScale -> vision.ts PlayerSighting.abilityVisibilityScale, one more multiplicand in visibility()",
  },
  {
    id: "DIVERSION_ATTENTION_SCALE",
    title: "Invoked-ability attention scale on the thrown object",
    status: "LANDED",
    blocksChannels: [],
    expectedUpstream:
      "stealth/diversion.ts: DiversionObject.attentionScale captured at the throw, scaling noise radius; NoiseEvent.attentionHoldScale scaling the hold in alert.ts",
  },
  {
    id: "JUMP_LAUNCH_SCALE",
    title: "Launch scale on the jump initiators",
    status: "LANDED",
    blocksChannels: [],
    expectedUpstream:
      "playerMotion.ts: beginStandingJump(state, launchScale = 1) and beginRunningJump(state, launchScale = 1), clamped to [MIN_JUMP_LAUNCH_SCALE, MAX_JUMP_LAUNCH_SCALE]",
  },
  {
    id: "PARKOUR_SUBPATH_EXPORT",
    title: "Headless subpath export for the movement envelope",
    status: "LANDED",
    blocksChannels: [],
    expectedUpstream:
      'engine-world package.json: "./parkour" and "./stealth", plus speed and launch parameters on maxGapMetersForDrop / jumpAirtimeForDrop / jumpApexM',
  },
  {
    id: "CONTACT_STAGGER_MODEL",
    title: "Non-lethal contact recovery window",
    status: "LANDED",
    blocksChannels: [],
    expectedUpstream:
      "playerMotion.ts: a STAGGER burst phase and beginStagger; contact.ts: resolveContact returning the motion state and the noise together",
  },
  {
    id: "CARRIED_EVIDENCE_MODEL",
    title: "Carried evidence a watcher can read",
    status: "REQUIRED",
    blocksChannels: ["carriedEvidenceConcealed"],
    expectedUpstream:
      "mission content, and deliberately not engine-world: a carried object with a readable face and a reading distance is authored content, not physics",
  },
];
