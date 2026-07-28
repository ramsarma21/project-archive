import {
  speakingGesture,
  type CinePose,
  type SpeakingGesture,
} from "./encounterCinematic.js";
import type { MissionTraversalOutcome } from "./result.js";

// ---------------------------------------------------------------------------
// The boss-challenge cinematic — PRESENTATION ONLY, at the traversal→duel seam.
//
// The mission used to cut straight from "the player steps into the yard" to the
// duel opening. This module is the beat the owner asked for in between: the
// King's officer — the man the player has already slipped twice tonight — is
// there again, bars the way, and calls the reckoning as a duel. Subtitles and a
// conversation two-shot, then the duel.
//
// IT IS THE SAME *KIND* OF MOMENT AS AN ENCOUNTER STOP, deliberately, and it is
// built from the encounter cinematic's own presentation primitives so it reads
// consistently and gets its framing/gesture/subtitle language for free:
//   * the two-shot uses `encounterConversationShot` (see MissionStage);
//   * the officer's "speaking" is the rig `idle` clip plus `speakingGesture`,
//     exactly the fallback the encounter cinematic documents (no talk clip on
//     the rig), and the challenge lands on the real baked `draw` clip;
//   * the subtitle surface reuses MissionEncounter's `.msn-enc-*` styling.
//
// WHAT THE ENCOUNTER CINEMATIC COULD NOT EXPRESS, so this lives here instead of
// as a third encounter: the deterministic encounter machine
// (packages/mission-m1/src/encounters) is a graded Q&A that resolves into a
// reprieve or a pursuit, authored in the level and stepped inside traversal.ts.
// A boss challenge has no answer to grade and must open a *duel*, not grant a
// reprieve — and both the machine and the level are out of this pass's scope. So
// this reuses the presentation and drives the seam the container already owns.
//
// TWO PROPERTIES ARE LOAD-BEARING.
//
//   ON THE PLAYER'S SURFACE. The officer is staged relative to the player's
//   actual grounded arrival pose (a fixed standoff along their facing, at their
//   own y), never at an authored mark on a plane they might not share — which is
//   exactly the assumption that produced the encounter cinematic's old
//   "teleport". Because the whole staging is derived from the live player pose,
//   the two never disagree about the ground.
//
//   IT CANNOT HANG. This module is a pure function of elapsed presentation time;
//   `done` becomes true at `BOSS_CHALLENGE_TOTAL_S` and the overlay backs that
//   with a hard cap (`BOSS_CHALLENGE_HARD_CAP_S`) and a skip, all calling the
//   same idempotent "open the duel". The duel-open depends on NONE of the 3D
//   staging: if the officer GLB never loads, the timeline still elapses and the
//   fight still opens. A stall here would be an unwinnable mission (this is the
//   gateway to the boss), so the beat is structurally impossible to stall on.
//
// Deterministic by construction: no `Math.random` anywhere, no wall-clock read
// inside these functions. The overlay owns the clock and passes elapsed seconds
// in, so a replay at any frame rate reads the same line and the same pose.
// ---------------------------------------------------------------------------

/** The officer's imported rig — the same red-coated King's officer asset the
 *  level's cast and the duel both use. A string, not an import from the duel
 *  directory, so this module carries no dependency on it. */
export const BOSS_OFFICER_ASSET = "officer-rigged";

/** Body height, matching the level's authored officer patrols. */
export const BOSS_OFFICER_HEIGHT_M = 1.55;

/**
 * How far in front of the player the officer stands to bar the way.
 *
 * Conversational, and short enough that the two-shot reads as a face-off rather
 * than a distant hail. Measured along the player's own facing from their real
 * arrival position, so the officer is always on the player's surface.
 */
export const BOSS_STANDOFF_M = 2.4;

/** The three subtitle beats, in order, with how long each holds on screen. */
export interface BossChallengeBeat {
  readonly phase: "HAIL" | "CHARGE" | "CHALLENGE";
  readonly line: string;
  readonly holdS: number;
}

/**
 * The officer's lines. Boston, pre-dawn, 14 August 1765; the player is running
 * unstamped sheets from Edes & Gill to the Liberty Tree and has slipped this
 * officer's watch already (the Shambles stop). Register matched to the
 * perspective-encounter bank: terse, period, second person, civil menace.
 *
 * Kept to three beats. A cinematic that outstays its welcome is worse than none,
 * and this one is the gate to a fight the player is here to have.
 */
export const BOSS_CHALLENGE_BEATS: readonly BossChallengeBeat[] = [
  {
    phase: "HAIL",
    line: "Hold there. You again — I'd know that face in any dark.",
    holdS: 3.4,
  },
  {
    phase: "CHARGE",
    line: "Edes and Gill's ink on your hands, and unstamped sheets for the Tree at your back. I could hang you for far less.",
    holdS: 4.2,
  },
  {
    phase: "CHALLENGE",
    line: "But we'll have it the officer's way — powder and a reckoning, here and now. Stand and answer.",
    holdS: 3.8,
  },
];

/** The speaker labels shown above the subtitle, matching the duel's own name. */
export const BOSS_SPEAKER_ROLE = "The King's officer";
export const BOSS_SPEAKER_AFFILIATION = "Crown & Parliament";

/** A short beat after the last line lands, before the duel opens, so the draw
 *  reads rather than cutting on the final word. */
const BOSS_TAIL_S = 1.0;

/** When the scripted timeline is complete and the duel should open. */
export const BOSS_CHALLENGE_TOTAL_S =
  BOSS_CHALLENGE_BEATS.reduce((sum, beat) => sum + beat.holdS, 0) + BOSS_TAIL_S;

/**
 * The independent hard backstop.
 *
 * Even if the scripted timeline were somehow prevented from completing, the
 * overlay opens the duel at this cap regardless — the "impossible to hang"
 * guarantee, set above the scripted total with margin. Mirrors the 16s abort the
 * encounter cinematic adopted for approaches that cannot complete.
 */
export const BOSS_CHALLENGE_HARD_CAP_S = 16;

// The cutscene's presentation clock. Deliberately the ONE place the wall clock
// is read for this feature, so the boundary check's allowlist names a single
// file and the components stay clock-free. It is legitimately wall time: the run
// is frozen (its outcome is already latched) while the cutscene plays, so there
// are no ticks advancing to derive seconds from, and nothing here is ever read
// back into the deterministic simulation — this only paces subtitles and a
// camera ease. See WALL_CLOCK_ALLOWLIST in scripts/check-boundaries.mjs.
export function bossCutsceneNowMs(): number {
  return performance.now();
}

/** Seconds elapsed since the cutscene armed. Presentation only. */
export function bossElapsedS(startedAtMs: number): number {
  return (performance.now() - startedAtMs) / 1000;
}

/** Where the officer stands and which way he faces, from the player's arrival
 *  pose. Pure. On the player's surface (same y) by construction. */
export function bossOfficerStaging(player: CinePose): CinePose {
  const forwardX = Math.sin(player.yaw);
  const forwardZ = Math.cos(player.yaw);
  const x = player.x + forwardX * BOSS_STANDOFF_M;
  const z = player.z + forwardZ * BOSS_STANDOFF_M;
  // Face back toward the player.
  const yaw = Math.atan2(player.x - x, player.z - z);
  return { x, y: player.y, z, yaw };
}

/** The subtitle beat active at an elapsed time, and its 0-based index. */
export function bossBeatAt(elapsedS: number): {
  readonly beat: BossChallengeBeat;
  readonly index: number;
} {
  let acc = 0;
  for (let i = 0; i < BOSS_CHALLENGE_BEATS.length; i += 1) {
    acc += BOSS_CHALLENGE_BEATS[i]!.holdS;
    if (elapsedS < acc) return { beat: BOSS_CHALLENGE_BEATS[i]!, index: i };
  }
  const last = BOSS_CHALLENGE_BEATS.length - 1;
  return { beat: BOSS_CHALLENGE_BEATS[last]!, index: last };
}

/** What the officer's body does this frame. Reuses the encounter cinematic's
 *  own vocabulary: `idle` + a restrained speaking gesture while he talks, and
 *  the baked `draw` (once, clamped) as he issues the challenge. */
export interface BossOfficerDirective {
  readonly pose: CinePose;
  readonly clip: string;
  readonly loopOnce: boolean;
  readonly gesture: SpeakingGesture;
}

/** The full presentation read for an elapsed time. Pure. */
export interface BossChallengeRead {
  readonly spokenLine: string;
  readonly phase: BossChallengeBeat["phase"];
  readonly beatIndex: number;
  /** True once the scripted timeline has run its course. */
  readonly done: boolean;
  /** True whenever the conversation two-shot should be held. */
  readonly cameraActive: boolean;
  readonly officer: BossOfficerDirective;
}

export function bossChallengeAt(input: {
  readonly elapsedS: number;
  readonly player: CinePose;
  readonly reducedMotion: boolean;
}): BossChallengeRead {
  const { elapsedS, player, reducedMotion } = input;
  const { beat, index } = bossBeatAt(elapsedS);
  const pose = bossOfficerStaging(player);
  const drawing = beat.phase === "CHALLENGE";
  return {
    spokenLine: beat.line,
    phase: beat.phase,
    beatIndex: index,
    done: elapsedS >= BOSS_CHALLENGE_TOTAL_S,
    cameraActive: true,
    officer: {
      pose,
      // He draws on the challenge (he moves to force the reckoning), else he
      // stands and speaks — the same reactions the encounter cinematic uses.
      clip: drawing ? "draw" : "idle",
      loopOnce: drawing,
      // No speaking bob while the pistol is coming up; a gentle one while he
      // talks. Zero under reduced motion (speakingGesture handles that).
      gesture: drawing ? { bobY: 0, nod: 0 } : speakingGesture(elapsedS, reducedMotion),
    },
  };
}

/**
 * The arming decision. Pure, so the container's "play the cutscene exactly once
 * on yard arrival" is a tested property rather than a habit.
 *
 * Arms only for a traversal that REACHED the duel, and only if it has not
 * already armed this attempt — a FAILED traversal goes straight to its result,
 * and a REACHED_DUEL that has already staged the challenge must not restage it.
 */
export function shouldArmBossChallenge(
  outcome: MissionTraversalOutcome,
  alreadyArmed: boolean,
): boolean {
  return outcome.kind === "REACHED_DUEL" && !alreadyArmed;
}

/** The MissionStage staging read: the captured arrival pose and the clock start,
 *  from which the stage recomputes the officer/camera each frame. */
export interface BossChallengeStage {
  /** `performance.now()` at the moment the challenge armed. */
  readonly startedAtMs: number;
  /** The player's grounded arrival pose. The officer is staged from it. */
  readonly player: CinePose;
}
