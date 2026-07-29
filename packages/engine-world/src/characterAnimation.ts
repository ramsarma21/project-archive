import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
} from "three";
import {
  PARKOUR_CLIP_FALLBACKS,
  PARKOUR_CLIP_TARGET_MS,
} from "./parkour/clips.js";

// ---------------------------------------------------------------------------
// Clip selection for imported rigs.
//
// Every production character is a self-contained GLB with its clips baked
// against its own rig, so selection is always "what does THIS rig carry?" —
// never "bind the shared clip". The engine owns that rule; a chapter owns its
// cast and declares each rig's contract through registerCharacterClips.
// ---------------------------------------------------------------------------

export interface CharacterClipSpec {
  /** Played when the requested clip is not baked onto this rig. */
  fallback: string;
  /** Every clip the rig should carry; anything missing warns once. */
  expected: readonly string[];
  /**
   * Per-clip substitutes, tried before `fallback`.
   *
   * `fallback` alone is a single answer for every miss, and for a rig with a
   * movement contract that answer is nearly always wrong: an absent `dash`
   * resolved to the rig-wide `idle` plants a standing pose on a body crossing
   * the ground at sprint speed. The clip contract already names what each
   * performance should degrade to — a dash reads as a `run`, a curb absorb
   * reads as a `run` — and this is what makes those authored answers reach the
   * mixer instead of only the unit test that checks the table exists.
   */
  fallbacks?: Readonly<Record<string, string>>;
}

const clipSpecs = new Map<string, CharacterClipSpec>();

/** Declares a rig's clip contract. A later call for the same key replaces it. */
export function registerCharacterClips(
  glbKey: string,
  spec: CharacterClipSpec,
): void {
  clipSpecs.set(glbKey, spec);
}

/** True once a rig has declared a contract, so a caller can avoid clobbering it. */
export function hasCharacterClips(glbKey: string): boolean {
  return clipSpecs.has(glbKey);
}

/**
 * Every clip baked onto playerboy-rigged as of the 2026-07-26 traversal rebake.
 *
 * TWO OF THESE NAMES ARE STILL ALIASES, WHATEVER THE REBAKE INTENDED. The note
 * that used to sit here said `dropRoll` had stopped being an alias of `dodge`
 * and taken Mixamo's "Falling To Roll". It has not: in the shipped GLB the two
 * animations reference the identical 99 channels and the identical sampler
 * accessors, so a landing roll and a combat evade are the same 1200ms
 * performance, and `land`/`landHard` are the same 2033ms one. Both pairs are
 * checkable from the glTF JSON in a few lines and neither is a judgement call.
 *
 * That mattered beyond tidiness: CLIP_AUTHORED_MS recorded `dropRoll` at the
 * 1830ms the rebake was expected to produce, so every drop-roll was fitted as
 * though it were half a second longer than it is and played 53% too fast.
 * `leapOfFaith` did stop being frozen 2.39m downrange, which had been detaching
 * the body from the capsule for the whole descent.
 *
 * `dash` is now baked here (appended 2026-07-27). Mixamo files no card under
 * "dash" — the whole query is cyclic runs, strafes and falls — so the search
 * was for the launch the verb actually asks for, "an explosive directed push
 * off one foot, low and forward, recovering into a run". Mixamo's "Idle To
 * Sprint" (Start Sprint From Action Idle) is that performance: a low
 * action-ready load driving off the plant into a sprint, a committed burst
 * rather than a faster stride. It was appended with append_clips.py and baked
 * root-neutral in the horizontal plane (the dash's displacement is code-driven)
 * while keeping the ~13cm vertical drive that reads as the push.
 *
 * This is the rig's own manifest and the authority on what it carries. It lives
 * here rather than in a chapter package because the chapter that used to own it
 * (@pa/chapter-boston-world) is being deleted, and the hub already mounts the
 * player through @pa/engine-world.
 *
 * The 23 dialogue-game performances (talk*, argu*, cheer*, work*, search, carry*,
 * handoff, circleWalk*, scolded, ropePull, read, doorOpen*) plus leftTurn,
 * rightTurn, crouchLeft and crouchRight were dropped in that rebake: nothing in
 * the surviving movement code selected them.
 */
export const PLAYER_CLIPS = [
  // Locomotion and parkour.
  "idle", "walk", "run", "sprint",
  "jump", "runJump", "vault", "climbUp", "climbDown",
  "land", "landHard",
  // Chained-traversal verbs for parkour/clips.ts. "stepUp" is absent on purpose:
  // Mixamo's only candidate is a 2.9s airborne hurdle, and the authored "run"
  // fallback reads better on a sub-0.5m lip than a hurdle does.
  "mantle", "slide", "climbOver", "landRun", "hangDrop",
  // The leap of faith is a three-beat chain, not one clip: leapOfFaithDive plays
  // once off the ledge, leapOfFaith loops as the held swan attitude for however
  // long the fall lasts, leapOfFaithLand receives it. Only the middle one is in
  // parkour/clips.ts today; the dive is additive and safe to ignore until wired.
  "leapOfFaithDive", "leapOfFaith", "leapOfFaithLand", "throwLight",
  // Directed movement burst: an explosive push off one foot, low and forward,
  // recovering into a run. Mixamo "Idle To Sprint", appended 2026-07-27.
  "dash",
  // Jump-hang vocabulary (Mixamo "Jump To Hang" / "Hanging Idle" / "Freehang
  // Climb", appended 2026-07-29). The upward mirror of hangDrop: leap and catch a
  // lip (jumpToHang, one-shot), hold on it (hangIdle, looped — the occupied hang),
  // pull up over it (freehangClimb, one-shot). Baked root-neutral in the
  // horizontal plane like every traversal clip; the world controller owns the
  // leap arc, the hold position and the pull-up displacement.
  "jumpToHang", "hangIdle", "freehangClimb",
  // Stealth.
  "crouchIdle", "crouchWalk", "crouchToStand", "blendWalk",
  // Handbill precision beat: knock is the nailing strike, reach the placement.
  "knock", "reach",
  // Flintlock duel.
  "standoff", "draw", "idleAim", "fire", "reload",
  "aimWalk", "aimRun",
  "dodge", "dropRoll", "hitReaction", "death",
] as const;

// Clips that should play once and clamp (physics/motion owns displacement; the
// mixer only plays out the visible pose). Consumed by RiggedCharacter for fade
// length and by callers deciding loopOnce.
export const PLAYER_ACTION_CLIPS: ReadonlySet<string> = new Set([
  "jump", "runJump", "vault", "climbUp", "climbDown", "knock", "reach",
  // Duel one-shots. draw ends on the idleAim pose so it clamps into the aim;
  // hitReaction and fire return to it, so the duel can fire without re-entering.
  "draw", "fire", "reload", "dodge", "dropRoll", "hitReaction", "death",
  // Landing recovery: the capsule is already grounded, so this is pose-only.
  "land", "landHard",
  "crouchToStand",
  // Traversal verbs. leapOfFaith is excluded because it is the held descent and
  // must loop for an arbitrary fall duration.
  "mantle", "slide", "climbOver", "landRun", "hangDrop", "leapOfFaithDive",
  "leapOfFaithLand", "throwLight",
  // The dash is a one-shot burst: it fires on a cooldown, plays out its launch,
  // and clamps into the run the motion layer is already driving.
  "dash",
  // Jump-hang one-shots. The catch clamps into the hang; the pull-up clamps onto
  // the ledge the motion layer is already placing the body on. hangIdle is NOT
  // here — it is the looped occupied hold (see CYCLIC_VERB_CLIPS).
  "jumpToHang", "freehangClimb",
]);

/**
 * Authored clip length in ms — the whole file, measured off the baked rig by
 * `assets/pipeline/measure_clip_rates.mjs`.
 *
 * THIS IS THE FILE LENGTH AND IT IS NOT THE RIGHT DIVISOR FOR A PLAYBACK RATE.
 * Use `verbTimeScale`, which divides the CONTENT length below instead. This
 * table survives because the duel reads it as "how long is this clip", which is
 * a fair question with this as its answer.
 *
 * `dropRoll` was 1830 here and is 1200 on the rig. The 2026-07-26 rebake note
 * says it stopped being an alias of `dodge` and took Mixamo's "Falling To
 * Roll"; whatever landed in the shipped GLB, the two clips are still the same
 * 1200ms performance, byte-identical in length and in pose profile. The 1830
 * was the length the rebake was expected to produce, written down before it was
 * measured, and it made every drop-roll play 53% faster than intended.
 */
export const CLIP_AUTHORED_MS: Readonly<Record<string, number>> = {
  mantle: 3867,
  slide: 1567,
  climbOver: 3167,
  landRun: 1400,
  hangDrop: 1700,
  vault: 3567,
  climbUp: 3000,
  climbDown: 2033,
  // The dive is the only timed beat of the three. leapOfFaith is a held pose
  // looped for the descent, so its 133ms is a loop period, not a target.
  leapOfFaithDive: 733,
  leapOfFaith: 133,
  leapOfFaithLand: 8367,
  throwLight: 2233,
  blendWalk: 1067,
  land: 2033,
  landHard: 2033,
  dodge: 1200,
  dropRoll: 1200,
  draw: 7133,
  // Mixamo "Idle To Sprint", 25 frames at 30fps, measured off the baked rig by
  // measure_clip_rates.mjs.
  dash: 833,
  // Jump-hang vocabulary, measured off the baked rig by measure_clip_rates.mjs
  // (2026-07-29): file lengths at 30fps.
  jumpToHang: 2033,
  hangIdle: 4733,
  freehangClimb: 3900,
};

/**
 * How much of each clip is actually a performance, in ms, and where it starts.
 *
 * A Mixamo download is a take, not a beat: it opens on a held pose while the
 * actor settles and closes on another while they stop. `leapOfFaithLand` is the
 * extreme — 2.50s lying motionless, 3.67s of getting up, 2.20s standing
 * motionless — and it is 56% dead air. Every rate in this system used to be
 * `fileLength / window`, so 56% of that clip's screen time was spent playing
 * stillness fast.
 *
 * Dividing the CONTENT by the window instead is the whole fix, and it is why a
 * clip can now be given a slower rate and still show more of itself.
 *
 * Measured by `assets/pipeline/measure_clip_rates.mjs`, which gates on 8% of
 * each clip's own peak pose speed. Only the one-shot performances are listed;
 * a locomotion cycle has no dead air by construction and is stride-matched
 * rather than fitted.
 */
export const CLIP_CONTENT_MS: Readonly<Record<string, number>> = {
  vault: 3000,
  mantle: 3729,
  climbOver: 2567,
  hangDrop: 1633,
  slide: 1529,
  landRun: 1362,
  dropRoll: 1163,
  landHard: 1633,
  land: 1633,
  leapOfFaithLand: 3667,
  leapOfFaithDive: 696,
  throwLight: 1667,
  dodge: 1163,
  // The whole launch is a performance — no settle lead, no held tail — so the
  // content is nearly the full 833ms file (measure_clip_rates.mjs: lead 33ms,
  // tail 0). Fitted to the 320ms dash window this rides just under 2.5x, below
  // the MAX_VERB_TIME_SCALE ceiling.
  dash: 796,
  // Jump-hang vocabulary (measure_clip_rates.mjs, 2026-07-29). jumpToHang trims a
  // 262ms held tail (the settled hang) from its content; freehangClimb is pure
  // performance (183ms settle lead, no tail); hangIdle is a near-continuous loop.
  // Content < file for each, as the ceiling test requires.
  jumpToHang: 1733,
  freehangClimb: 3713,
  hangIdle: 4696,
};

/**
 * Where the performance starts inside the file, in ms. Handed to the mixer as a
 * start time so the window opens on the beat instead of on the dead air.
 *
 * Only clips with a lead worth skipping are listed. Almost every clip in this
 * cast opens with a single held frame (33ms), which is not worth seeking past
 * and would cost the run/walk cycle its phase continuity if it were applied
 * indiscriminately. `leapOfFaithLand` is the one clip where the lead is
 * material: without this, three tenths of the payoff beat is a corpse.
 */
export const CLIP_CONTENT_START_MS: Readonly<Record<string, number>> = {
  leapOfFaithLand: 2500,
};

/**
 * Fraction of a clip's total bone rotation that happens above the hips.
 *
 * THIS IS THE TEST FOR "CAN THIS CLIP BE AN ADDITIVE LAYER", and it is here
 * because two clips in the contract claim to be one and only one of them is.
 *
 * An additive layer adds its rotation to whatever the base clip is doing. That
 * is a good deal for a performance that lives in the arms and a bad one for a
 * performance that drives the legs, because added to a run the legs scissor.
 *
 *   * `throwLight` is the real candidate. 76% above the hips, and only 834
 *     degrees of leg rotation in the whole clip — 93 per leg bone, half what
 *     the run itself uses. Layering it would deliver the contract's "the player
 *     never stops to throw" and remove the plant that MissionStage currently
 *     documents as a known compromise.
 *   * `landRun` is NOT, despite its contract note reading "upper-body-weighted
 *     so it can blend over run". It is 52/48, with 2572 degrees of leg rotation
 *     across nine bones — 286 per bone, MORE per bone than the run. Whatever
 *     was asked for, what was baked is a full-body landing. Layering it would
 *     add a second pair of legs' worth of rotation to a running pair, which is
 *     worse than the replacement it does today, so the residual oddness in the
 *     landing is not something an additive layer would fix. It needs a re-bake
 *     as a genuine upper-body clip first, and then the layer is worth building.
 *
 * Measured by `assets/pipeline/measure_clip_rates.mjs`.
 */
export const CLIP_UPPER_BODY_SHARE: Readonly<Record<string, number>> = {
  throwLight: 0.76,
  landRun: 0.52,
  landHard: 0.61,
  dropRoll: 0.60,
  run: 0.45,
};

/** Above this an overlay is arms-and-torso enough to be added to locomotion. */
export const ADDITIVE_UPPER_BODY_THRESHOLD = 0.7;

/**
 * Cyclic clips that must not be fitted to a mechanical window at all.
 *
 * `climbUp` is a LOOPING ladder-climb: four reach-and-pull cycles of ~750ms in
 * a 3.0s file, not one 3.0s pull. Fitting it to the 900ms CLIMB_UP window would
 * run four cycles in nine tenths of a second — the arms would blur — when
 * playing it unscaled gives exactly the one-and-a-bit cycles a 900ms climb
 * wants. Its rate is 1 for the same reason a run's is not fitted: the clip is
 * already the right length per repetition, and the window just takes as many
 * repetitions as it takes.
 */
export const CYCLIC_VERB_CLIPS: ReadonlySet<string> = new Set([
  "climbUp",
  "climbDown",
  "leapOfFaith",
  // The occupied hang: a held attitude looped for however long the player hangs,
  // exactly like leapOfFaith's held descent. It must never be fitted to a window.
  "hangIdle",
]);

/**
 * Ceiling on any derived playback rate.
 *
 * A mechanical window is a physics decision and a clip length is an animation
 * decision, and dividing one by the other lets the physics silently overrule
 * the animation as far as it likes. It went a long way: `mantle` was fitted at
 * 8.3x, `vault` would have been 7.9x, `leapOfFaithLand` was 10.5x.
 *
 * THE NUMBER IS THE ONE AUTHORING JUDGEMENT THIS REPOSITORY HAS RECORDED ABOUT
 * A RATE BEING TOO FAST. `leapOfFaithLand` carried a note that 10.5x makes the
 * get-up frantic and that 4-5x reads; 4 is the conservative end of the only
 * calibration anybody has written down. Nothing else here is better evidence,
 * and inventing a second opinion beside it would be worse than reusing it.
 *
 * When this binds, the clip overruns its mechanical window and is faded out
 * mid-performance rather than compressed further. THAT OVERRUN IS A REPORT, NOT
 * A FIX: it means the window and the performance disagree, and the disagreement
 * belongs to whoever owns the window. It currently binds on vault, mantle,
 * climbOver, landRun and leapOfFaithLand.
 */
export const MAX_VERB_TIME_SCALE = 4;

/**
 * Mixer timeScale for a one-shot performance covering a mechanical window.
 *
 * Three claims, and the rate is the slowest of them:
 *
 *   1. THE WINDOW. The clip should not be cut to a sliver by a window shorter
 *      than the performance.
 *   2. THE CONTRACT. `PARKOUR_CLIP_TARGET_MS` is how long the beat was asked to
 *      read for. Where it is longer than the window, it wins, and the tail is
 *      blended out rather than snapped.
 *   3. THE CEILING. `MAX_VERB_TIME_SCALE`, above.
 *
 * Returns null for a clip with no measured performance — a locomotion cycle, a
 * cyclic verb, or a name this rig answers with a substitute — so the caller can
 * fall through to `strideTimeScale` rather than being handed a 1 it cannot tell
 * apart from a real answer.
 */
export function verbTimeScale(clip: string, windowMs: number): number | null {
  if (CYCLIC_VERB_CLIPS.has(clip)) return 1;
  const content = CLIP_CONTENT_MS[clip];
  if (!content) return null;
  const target = Math.max(windowMs, PARKOUR_CLIP_TARGET_MS[clip] ?? 0);
  if (target <= 0) return null;
  return Math.min(MAX_VERB_TIME_SCALE, content / target);
}

/** Mixer start time for a clip, in seconds. Skips a measured dead lead. */
export function clipStartSeconds(clip: string): number {
  return (CLIP_CONTENT_START_MS[clip] ?? 0) / 1000;
}

/**
 * Cycle speed each locomotion clip was authored at, in m/s.
 *
 * Divide the speed the motion code is driving by this to get the mixer
 * timeScale that removes foot sliding — that is `strideTimeScale`.
 *
 * MEASURED AT THE SCALE THE RENDERER DRAWS, BY THE STANCE SLOPE, using
 * `assets/pipeline/measure_clip_rates.mjs`. Both halves of that sentence are
 * corrections, and between them they had `run` playing at 1.64x when it wanted
 * 0.79x — a run cycle at 295 steps per minute under a body covering ground at
 * 143, which is the "running animation looks too fast for how fast u are going"
 * the owner reported.
 *
 *   * THE DENOMINATOR. The previous numbers came from
 *     `verify_clip_contacts.py`, which measures the planted foot's backward
 *     sweep correctly and then divides it by HALF THE CYCLE. Those agree only
 *     for a gait with no flight phase. This run is airborne for 78% of its
 *     cycle, so the divisor was three and a half times too large. The foot only
 *     slides while it is DOWN, so the sweep must be divided by the time it was
 *     down, which is a measurement with no gait assumption in it.
 *   * THE SCALE. It measured the source rig. This cast is authored at 1.80m and
 *     every loader fits it to STAND_HEIGHT, so a stride measured on the file is
 *     16% longer than the one on screen.
 *
 * Cross-checked against the thing the constant exists to prevent: simulating a
 * body driven at each speed and integrating how far a planted foot slides
 * across the ground per cycle puts the minimum at exactly `speed / authored`
 * for all four cases in play (walk 1.47x, run 0.79x, crouchWalk 0.90x, and the
 * burst's 1.15x). At the old `run` figure the same integral is 0.91m of slide
 * per cycle against 0.34m at this one.
 *
 * The 0.34m that remains is the clip disagreeing with itself: its planted foot
 * sweeps at 5.1 m/s early in the stance and 6.6 m/s at toe-off, and no single
 * rate can satisfy both. That is a bake problem, not a tuning one.
 */
export const CLIP_AUTHORED_SPEED_MPS: Readonly<Record<string, number>> = {
  walk: 1.57,
  run: 5.80,
  sprint: 5.64,
  crouchWalk: 1.28,
  aimWalk: 2.53,
  aimRun: 3.20,
  // Still counter-intuitively brisker than `walk` (longer stride, slower
  // cadence), so an unhurried crowd-blend pace needs timeScale below 1.
  blendWalk: 1.80,
};

/** Mixer timeScale that matches a clip's stride to the driven ground speed. */
export function strideTimeScale(clip: string, speedMps: number): number {
  const authored = CLIP_AUTHORED_SPEED_MPS[clip];
  if (!authored || speedMps <= 0) return 1;
  return speedMps / authored;
}

/**
 * The M1 duel antagonist's clip set, baked onto officer-rigged 2026-07-25.
 *
 * He carries the player's combat vocabulary rather than a firing pose, because
 * the duel has both sides moving, taking cover, shooting and dodging across six
 * rounds. Locomotion is included so he can close and break line of sight, armed
 * locomotion so he reads as armed while moving, and dodge because the tuning has
 * him evading roughly a third of incoming fire.
 *
 * His 10 dialogue-game clips (talk/talk2/argu1/argue2/work1/work2/carryWalk) are
 * gone. Note his rig carries 41 bones to the player's 33 — the extra finger
 * chains simply hold their rest pose, since the motion sources only drive 33.
 */
export const OFFICER_CLIPS = [
  "idle", "walk", "run",
  "standoff", "draw", "idleAim", "fire", "reload",
  "aimWalk", "aimRun", "dodge", "hitReaction", "death",
] as const;

export const OFFICER_CLIP_SPEC: CharacterClipSpec = {
  fallback: "idle",
  expected: OFFICER_CLIPS,
};

/**
 * The player rig's contract, ready for registerCharacterClips.
 *
 * Deliberately NOT self-registering: @pa/chapter-boston-world still registers
 * playerboy-rigged from its own stale list at import time, and whichever module
 * loads last would win. Whoever mounts the player should register this
 * explicitly, which also makes the ownership obvious at the call site.
 */
export const PLAYER_CLIP_SPEC: CharacterClipSpec = {
  fallback: "idle",
  expected: PLAYER_CLIPS,
  // `dash` is now baked (see PLAYER_CLIPS), so the one clip this rig still does
  // not carry is `stepUp`, which the contract answers with `run`. Without this
  // line it answered `idle` instead: a curb absorb dropped the body into a
  // standing pose while it was still crossing ground at speed. The fallbacks
  // also still name dash -> run, harmlessly: chooseAvailableClip returns the
  // real dash before it ever consults the substitution table.
  fallbacks: PARKOUR_CLIP_FALLBACKS,
};

const PLAYER_CLIP_SET: ReadonlySet<string> = new Set<string>(PLAYER_CLIPS);

/**
 * The clip the player rig will actually play when asked for `requested`.
 *
 * `chooseAvailableClip` already does this, inside the renderer, against the
 * clips the loaded GLB turned out to carry. This is the same walk of the same
 * table against the rig's declared manifest, and it exists because THE
 * PRESENTATION LAYER HAS TO KNOW WHICH CLIP IT IS TIMING.
 *
 * A `dash` resolves to `run`. Ask "how fast should dash play" and there is no
 * answer, so the rate came out 1 — and a run cycle authored for 5.8 m/s played
 * at 1.0 under a body bursting at 6.7 skates every time the player dashes.
 * Ask "how fast should the clip that dash resolves to play" and the answer is
 * the stride match, 1.15x, which is the correct rate for the burst and the
 * closest thing to a dash animation this rig can offer. `stepUp` is the same
 * story at running speed.
 */
export function playerClipFor(requested: string): string {
  if (PLAYER_CLIP_SET.has(requested)) return requested;
  const visited = new Set<string>([requested]);
  let candidate: string | undefined = PARKOUR_CLIP_FALLBACKS[requested];
  while (candidate && !visited.has(candidate)) {
    if (PLAYER_CLIP_SET.has(candidate)) return candidate;
    visited.add(candidate);
    candidate = PARKOUR_CLIP_FALLBACKS[candidate];
  }
  return PLAYER_CLIP_SPEC.fallback;
}

export const AIRBORNE_VISUAL_TUNING = {
  standingTimeScale: 2.25,
  runningTimeScale: 0.86,
  landingRecoverySeconds: 0.18,
} as const;

const AIRBORNE_ARM_COMPACTION: Record<string, number> = {
  jump: 0.36,
  runJump: 0.52,
};

/**
 * The imported Mixamo jump performances have useful anticipation/landing
 * timing but over-open both upper arms at the apex (the audited "starfish").
 * Keep every authored keyframe and blend only upper-arm rotation toward the
 * imported idle stance. No procedural body or replacement clip is introduced.
 *
 * Scoped to the player rig: it is the only rig carrying the free-jump bake.
 */
export function compactPlayerAirborneClips(
  glbKey: string,
  clips: readonly AnimationClip[],
): AnimationClip[] {
  if (glbKey !== "playerboy-rigged") return [...clips];
  const idle = clips.find((clip) => clip.name === "idle");
  if (!idle) return [...clips];
  const idleRotations = new Map<string, Quaternion>();
  for (const track of idle.tracks) {
    if (
      track instanceof QuaternionKeyframeTrack &&
      /(?:LeftArm|RightArm)\.quaternion$/.test(track.name)
    ) {
      idleRotations.set(
        track.name,
        new Quaternion().fromArray(track.values, 0),
      );
    }
  }
  const current = new Quaternion();
  return clips.map((source) => {
    const blend = AIRBORNE_ARM_COMPACTION[source.name];
    if (!blend) return source;
    const clip = source.clone();
    for (const track of clip.tracks) {
      if (!(track instanceof QuaternionKeyframeTrack)) continue;
      const idleRotation = idleRotations.get(track.name);
      if (!idleRotation) continue;
      for (let index = 0; index < track.values.length; index += 4) {
        current
          .fromArray(track.values, index)
          .slerp(idleRotation, blend)
          .toArray(track.values, index);
      }
    }
    return clip;
  });
}

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export function chooseAvailableClip(
  glbKey: string,
  requested: string,
  availableNames: readonly string[],
): string | null {
  const spec = clipSpecs.get(glbKey);
  if (spec) {
    const missing = spec.expected.filter((name) => !availableNames.includes(name));
    if (missing.length > 0) {
      warnOnce(
        `${glbKey}:manifest:${missing.join(",")}`,
        `[animation] ${glbKey} is missing expected clips: ${missing.join(", ")}.`,
      );
    }
  }
  if (availableNames.includes(requested)) return requested;

  // Follow the authored substitutions as far as they go before giving up on
  // the rig-wide fallback. The chain is real rather than theoretical —
  // `landHard` degrades to `dropRoll`, which degrades to `runJump` — and the
  // visited set is what keeps a table that ever gains a cycle from hanging the
  // render loop rather than dropping one pose.
  const substitutes = spec?.fallbacks;
  if (substitutes) {
    const visited = new Set<string>([requested]);
    let candidate = substitutes[requested];
    while (candidate && !visited.has(candidate)) {
      if (availableNames.includes(candidate)) {
        warnOnce(
          `${glbKey}:${requested}:${candidate}`,
          `[animation] ${glbKey} has no "${requested}" clip; using its authored fallback "${candidate}".`,
        );
        return candidate;
      }
      visited.add(candidate);
      candidate = substitutes[candidate];
    }
  }

  const fallbackName = spec?.fallback ?? "idle";
  const fallback = availableNames.includes(fallbackName) ? fallbackName : availableNames[0] ?? null;
  warnOnce(
    `${glbKey}:${requested}:${fallback ?? "none"}`,
    `[animation] ${glbKey} has no "${requested}" clip; using ${fallback ? `"${fallback}"` : "a static pose"}.`,
  );
  return fallback;
}
