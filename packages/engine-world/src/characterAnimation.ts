import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
} from "three";

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
 * That rebake changed two of the 37 and left the other 35 bit-identical:
 * `dropRoll` stopped being an alias of `dodge` and took Mixamo's "Falling To
 * Roll", so a landing roll and a combat evade are no longer the same 1.2s
 * performance; and `leapOfFaith` stopped being frozen 2.39m downrange, which
 * had been detaching the body from the capsule for the whole descent.
 *
 * `dash` is in the parkour contract but is NOT baked here, and deliberately so:
 * Mixamo carries no dash performance. Its nearest neighbours are all rolls,
 * which is the one thing the rig already has, so `dash` takes its authored
 * `run` fallback until a non-Mixamo source is found.
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
]);

/**
 * Authored clip length in ms, measured off the baked rig.
 *
 * Mixamo performances are uniformly slower than the parkour contract's
 * `targetMs`, so a clip played at timeScale 1 will feel sluggish. Divide the
 * measured value by the target to get the timeScale that hits the authored
 * intent: `mantle` needs ~8.6x, `landRun` ~5.6x, `climbOver` ~6.1x.
 *
 * Two of these should NOT simply be scaled to target. `leapOfFaith` loops, so it
 * plays for as long as the fall lasts. `leapOfFaithLand` at 8.37s against an
 * 800ms target would need 10.5x, which makes the get-up frantic; it is the
 * payoff beat, and roughly 1.5-2s (4-5x) reads far better.
 */
export const CLIP_AUTHORED_MS: Readonly<Record<string, number>> = {
  mantle: 3870,
  slide: 1570,
  climbOver: 3170,
  landRun: 1400,
  hangDrop: 1700,
  // The dive is the only timed beat of the three. leapOfFaith is a held pose
  // looped for the descent, so its 130ms is a loop period, not a target.
  leapOfFaithDive: 730,
  leapOfFaith: 130,
  leapOfFaithLand: 8370,
  throwLight: 2230,
  blendWalk: 1070,
  land: 2030,
  landHard: 2030,
  dodge: 1200,
  // Its own performance since the 2026-07-26 rebake, no longer dodge under a
  // second name, so it is a third longer and needs ~3.1x rather than ~2x.
  dropRoll: 1830,
  draw: 7130,
};

/**
 * Cycle speed each locomotion clip was authored at, in m/s, measured from the
 * planted foot's backward sweep (assets/pipeline/verify_clip_contacts.py).
 *
 * Divide the speed the motion code is driving by this to get the mixer
 * timeScale that removes foot sliding. Without it `run` skates ~64% at
 * RUN_SPEED, which is the single most visible locomotion artifact on this rig.
 */
export const CLIP_AUTHORED_SPEED_MPS: Readonly<Record<string, number>> = {
  walk: 1.55,
  run: 2.81,
  sprint: 3.01,
  crouchWalk: 1.70,
  aimWalk: 2.30,
  aimRun: 2.55,
  // Counter-intuitively brisker than `walk` (longer stride, slower cadence), so
  // an unhurried crowd-blend pace needs timeScale BELOW 1, not above it.
  blendWalk: 1.73,
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
};

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

export function chooseAvailableClip(
  glbKey: string,
  requested: string,
  availableNames: readonly string[],
): string | null {
  const spec = clipSpecs.get(glbKey);
  if (spec) {
    const missing = spec.expected.filter((name) => !availableNames.includes(name));
    const manifestWarning = `${glbKey}:manifest:${missing.join(",")}`;
    if (missing.length > 0 && !warned.has(manifestWarning)) {
      warned.add(manifestWarning);
      console.warn(`[animation] ${glbKey} is missing expected clips: ${missing.join(", ")}.`);
    }
  }
  if (availableNames.includes(requested)) return requested;
  const fallbackName = spec?.fallback ?? "idle";
  const fallback = availableNames.includes(fallbackName) ? fallbackName : availableNames[0] ?? null;
  const warningKey = `${glbKey}:${requested}:${fallback ?? "none"}`;
  if (!warned.has(warningKey)) {
    warned.add(warningKey);
    console.warn(
      `[animation] ${glbKey} has no "${requested}" clip; using ${fallback ? `"${fallback}"` : "a static pose"}.`,
    );
  }
  return fallback;
}
