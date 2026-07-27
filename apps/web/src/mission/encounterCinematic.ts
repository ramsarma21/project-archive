import type { EncounterPhase, EncounterVerdictKind } from "@pa/mission-m1";

// ---------------------------------------------------------------------------
// The encounter cinematic — PRESENTATION ONLY, and generic across stops.
//
// The deterministic encounter machine (packages/mission-m1/src/encounters) is
// the single authority for approach, verdict and consequence. This module adds
// nothing to that: it takes the machine's phase and the live poses of the
// speaker, the secondary and the player, and answers three purely visual
// questions the machine has no business knowing about —
//
//   1. WHERE THE CAMERA GOES. A conversation two-shot that frames the officer
//      and the player, eased into from the chase camera as the officers walk up
//      and eased back out on release. `encounterConversationShot`.
//   2. HOW AN OFFICER MOVES IN THE SCENE. Which clip each actor plays and
//      whether a restrained speaking gesture is applied. `encounterActorDirective`.
//   3. HOW MUCH THE CAMERA IS IN THE SCENE. A target weight per phase that the
//      camera eases toward, so the hand-over and the return are smooth rather
//      than a cut. `cinematicActive`.
//
// Everything here is a pure function of plain numbers — no three.js, no React,
// no wall clock — so it is unit-testable in node and cannot drift a verdict.
//
// A HONEST NOTE ON THE SPEAKING GESTURE. Neither the officer rig nor the player
// rig carries a talk/gesture clip: the dialogue-game performances (talk*, argu*,
// …) were dropped in the 2026-07-26 cast rebake (see engine-world
// characterAnimation.ts, OFFICER_CLIPS / PLAYER_CLIPS). Baking a new one is an
// asset-pipeline job (Meshy → Blender → verify) out of this pass's scope, so the
// speaker's "speaking" is the rig's `idle` clip plus the restrained procedural
// nod/bob computed here — the explicit fallback the brief calls for, not a
// static idle pretending to be a cutscene. The reactions reuse real baked clips:
// `draw` on a wrong answer (he moves to stop you) and a calm `idle` on a reprieve.
// ---------------------------------------------------------------------------

export interface CineVec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CinePose extends CineVec {
  /** Body facing, radians. Only used to recover an axis when two bodies coincide. */
  readonly yaw: number;
}

export interface EncounterShot {
  readonly position: CineVec;
  readonly target: CineVec;
}

/** Eye height the shot is framed at. Head-ish on a ~1.8m body. */
const HEAD_Y = 1.52;
const HEAD_Y_REDUCED = 1.58;
/**
 * How far BEHIND the player the camera sits, down the axis toward the speaker.
 *
 * A conversation on the M1 route happens in a narrow market street lined with
 * stall canopies, so a side-on two-shot puts the camera inside an awning. An
 * over-the-shoulder from behind the player looks down the open lane they just
 * ran up instead — the player's near shoulder in the foreground, the officer
 * framed beyond — which stays clear and still shows both of them.
 */
const BEHIND_M = 2.5;
const BEHIND_M_REDUCED = 3.0;
/** A small lateral offset so it reads as a composed ¾ shot, not a pure chase.
 *  Kept modest: the market street is narrow, so a large offset lands the lens
 *  beside a stall post. */
const SIDE_M = 0.55;
/** The look target sits between the two, biased toward the speaker (the talker). */
const TARGET_TOWARD_SPEAKER_M = 0.35;
const TARGET_Y = 1.32;

function len2(x: number, z: number): number {
  return Math.hypot(x, z);
}

/**
 * The conversation shot for a stop, from the live poses. Pure.
 *
 * An over-the-shoulder: the camera sits behind the player along the line toward
 * the speaker, a touch to one side and at head height, aimed at a point between
 * the two biased toward the speaker. Behind-the-player keeps it in the open lane
 * the player arrived down rather than in the stalls that flank the street; the
 * small side offset makes it a composed shot rather than the gameplay chase.
 * When a secondary is present the side is chosen AWAY from him so he is not hidden
 * behind the speaker.
 *
 * Recomputed every frame from the actors' current positions, so while the
 * officers are still walking up (APPROACH) the framing forms smoothly instead of
 * snapping to a mark they have not reached yet.
 */
export function encounterConversationShot(input: {
  readonly player: CinePose;
  readonly speaker: CinePose;
  readonly secondary: CinePose | null;
  readonly reducedMotion: boolean;
}): EncounterShot {
  const { player, speaker, secondary, reducedMotion } = input;

  const midX = (player.x + speaker.x) / 2;
  const midZ = (player.z + speaker.z) / 2;

  // Axis from player to speaker (XZ). Fall back to the speaker's facing if the
  // two bodies are almost coincident, so the shot never divides by zero.
  let axisX = speaker.x - player.x;
  let axisZ = speaker.z - player.z;
  let axisLen = len2(axisX, axisZ);
  if (axisLen < 0.2) {
    axisX = Math.sin(speaker.yaw);
    axisZ = Math.cos(speaker.yaw);
    axisLen = len2(axisX, axisZ) || 1;
  }
  axisX /= axisLen;
  axisZ /= axisLen;

  // Perpendicular in XZ. Choose the side away from the secondary so both bodies
  // stay in frame; deterministic default when there is no secondary.
  let sideX = axisZ;
  let sideZ = -axisX;
  if (secondary) {
    const towardSecondary = (secondary.x - midX) * sideX + (secondary.z - midZ) * sideZ;
    if (towardSecondary > 0) {
      sideX = -sideX;
      sideZ = -sideZ;
    }
  }

  const behind = reducedMotion ? BEHIND_M_REDUCED : BEHIND_M;
  const headY = reducedMotion ? HEAD_Y_REDUCED : HEAD_Y;

  const position: CineVec = {
    x: player.x - axisX * behind + sideX * SIDE_M,
    y: headY,
    z: player.z - axisZ * behind + sideZ * SIDE_M,
  };
  const target: CineVec = {
    x: midX + axisX * TARGET_TOWARD_SPEAKER_M,
    y: TARGET_Y,
    z: midZ + axisZ * TARGET_TOWARD_SPEAKER_M,
  };
  return { position, target };
}

/**
 * The phases during which the camera should be in the conversation shot. The
 * chase camera eases its weight toward 1 while this is true and back to 0 once
 * the stop RELEASES, which is what makes the hand-over and the return smooth.
 */
export function cinematicActive(phase: EncounterPhase): boolean {
  return (
    phase === "APPROACH" ||
    phase === "QUESTION" ||
    phase === "SUBMITTING" ||
    phase === "RESOLVED"
  );
}

/**
 * The per-frame ease amount toward a target weight, given the frame delta.
 *
 * Reduced motion settles faster and with less mid-flight drift — the point of
 * the opt-out is to remove the camera's own travel, not to keep it moving
 * gently for longer. Clamped delta so a stalled tab does not jump the camera.
 */
export function cinematicEase(reducedMotion: boolean, deltaS: number): number {
  const dt = Math.min(Math.max(deltaS, 0), 1 / 20);
  const base = reducedMotion ? 0.0005 : 0.02;
  return 1 - Math.pow(base, dt);
}

export function isReprieveVerdict(kind: EncounterVerdictKind | null): boolean {
  return kind === "CORRECT" || kind === "GRANTED";
}

export interface EncounterActorDirective {
  /** Force this clip, or null to keep the renderer's speed-based selection. */
  readonly clip: string | null;
  /** Play the forced clip once and clamp (a draw holds the drawn pose). */
  readonly loopOnce: boolean;
  /** Apply the restrained procedural speaking gesture this frame. */
  readonly gesture: boolean;
}

const NO_DIRECTIVE: EncounterActorDirective = {
  clip: null,
  loopOnce: false,
  gesture: false,
};

/**
 * What one actor should be doing this frame, by phase and role. Pure.
 *
 *   APPROACH   — nothing forced; the renderer's measured walk/idle selection
 *                already reads the machine's swept movement as a walk.
 *   QUESTION / SUBMITTING — the SPEAKER stands (`idle`) and gets the speaking
 *                gesture; a SECONDARY just stands.
 *   RESOLVED   — a reprieve stands calm (`idle`); a wrong answer draws (`draw`,
 *                once, clamped) so both officers visibly move to stop the player.
 */
export function encounterActorDirective(input: {
  readonly phase: EncounterPhase;
  readonly verdictKind: EncounterVerdictKind | null;
  readonly role: "SPEAKER" | "SECONDARY";
}): EncounterActorDirective {
  switch (input.phase) {
    case "QUESTION":
    case "SUBMITTING":
      return {
        clip: "idle",
        loopOnce: false,
        gesture: input.role === "SPEAKER",
      };
    case "RESOLVED":
      if (isReprieveVerdict(input.verdictKind)) {
        return { clip: "idle", loopOnce: false, gesture: false };
      }
      return { clip: "draw", loopOnce: true, gesture: false };
    default:
      return NO_DIRECTIVE;
  }
}

export interface SpeakingGesture {
  /** Vertical bob added to the speaker's feet, metres. */
  readonly bobY: number;
  /** Forward/back nod, radians, applied as a small rotation about X. */
  readonly nod: number;
}

const NO_GESTURE: SpeakingGesture = { bobY: 0, nod: 0 };

/**
 * The restrained speaking motion for a talking officer, given an elapsed time.
 *
 * Deliberately small — a gentle nod and bob, not a mime — because it is standing
 * in for a talk clip the rig does not carry, and an over-large procedural motion
 * would read as worse than the honest idle. Zero under reduced motion.
 */
export function speakingGesture(timeS: number, reducedMotion: boolean): SpeakingGesture {
  if (reducedMotion) return NO_GESTURE;
  const nod = Math.sin(timeS * 5.2) * 0.05 + Math.sin(timeS * 2.3) * 0.02;
  const bobY = Math.sin(timeS * 5.2 + 0.6) * 0.012;
  return { bobY, nod };
}
