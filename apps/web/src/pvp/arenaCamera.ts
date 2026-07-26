// The one place PvP's camera parts company with the boss duel's.
//
// Everything else about the camera is imported: `desiredCamera` for the pose,
// `cameraFollowRate` for how fast it closes, both from ../duel/duelCamera.ts. PvP does
// not own a camera and must not grow one — a player should not have to re-learn how
// they see their own character between running a route and fighting at the end of it,
// which is the same reasoning that has this directory importing the yard's props and
// the ball treatments rather than inventing a second set.
//
// This file is a pure function so the decision below can be asserted rather than
// described. It lives outside the render tree for the same reason.

import type { DuelPhase } from "@pa/duel";

/**
 * Which phase the CAMERA should behave as, given the phase the fight is actually in.
 *
 * Identity everywhere except the answering beat, and that exception is the whole point.
 * `desiredCamera` frames a question as a reverse angle on the OPPONENT at fov 34, and
 * its own comment gives the reason: in a boss fight the officer is the one asking, so
 * he is the one in shot.
 *
 * IN PvP NOBODY IS ASKING. The System asks, from a bank neither player chose, out of
 * the intersection of what both have mastered. Pointing the camera at the other student
 * while the question is open would be three things at once: dull, because it is a
 * motionless stranger held in frame for however long it takes somebody to type a
 * paragraph; faintly rude, because it stares at a classmate who cannot see that it is
 * happening; and false, because it dramatises a relationship that does not exist in
 * this mode.
 *
 * So the answering beat holds the ordinary third-person gameplay camera, and gets three
 * things from doing it:
 *
 *   THE PLAYER STAYS PRESENT. They are over their own shoulder, the subject of their
 *   own screen, rather than a shoulder in the corner of somebody else's portrait.
 *
 *   THE ARENA STAYS READABLE, AND IN THE FRAMING THEY WILL FIGHT IN. The cover they are
 *   looking at while they think is the cover they will use, from the angle they will see
 *   it from — so the thinking time is also orientation time, which is a small gift in a
 *   mode where the exchange lasts twenty seconds.
 *
 *   NOTHING MOVES AT THE WORST MOMENT. Bullets are granted and the engagement opens
 *   straight out of the view already on screen, instead of the camera swinging back from
 *   a portrait exactly as the first ball leaves a barrel.
 *
 * The RATE is deliberately not substituted — see `answeringCameraSettles`.
 */
export function cameraPhaseFor(phase: DuelPhase): DuelPhase {
  return isAnsweringBeat(phase) ? "ENGAGEMENT_LIVE" : phase;
}

/** Phases where the fight is paused on a question and nobody is steering. */
export function isAnsweringBeat(phase: DuelPhase): boolean {
  return phase === "QUESTION_PENDING" || phase === "VERDICT_COMMITTED";
}

/**
 * Whether the camera should stop following the body's facing.
 *
 * True on the answering beat. The player is in a textarea, the authority is holding
 * their last aim, and a pointer wandering across the yard on its way to the Send button
 * must not turn the camera under them. The pose is the gameplay pose; the tracking is
 * not, because there is nothing to track.
 */
export function answeringCameraSettles(phase: DuelPhase): boolean {
  return isAnsweringBeat(phase);
}
