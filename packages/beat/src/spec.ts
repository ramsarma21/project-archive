// An authored beat: one verb, one chart vocabulary, one place in the world.
//
// This is the whole authoring surface. A later mission adds a beat by writing
// one of these and mounting it; it does not write a runtime, a judge or a noise
// table, and it cannot widen a window.
//
// The spec deliberately holds the STANCE as well as the chart. Where the beat
// happens is not decoration: it decides which patrols can hear a botched stroke,
// how far a watcher has to walk to look, and therefore what imprecision actually
// costs. A beat authored in a quiet corner is a different mechanic from the same
// beat authored under a torch, and the author should have to say which one they
// meant.

import { chartSpecDefects, type BeatChartSpec } from "./chart.js";
import type { BeatGradeThresholds } from "./judge.js";
import { verbLadderDefects } from "./noise.js";
import {
  reactionSpecDefects,
  reactionWorstCaseSpan,
  type BeatReactionSpec,
} from "./schedule.js";
import { beatVerbDefects, type BeatVerb } from "./verbs.js";
import type { Vec3 } from "./engine.js";

export interface BeatSpec {
  readonly id: string;
  readonly verb: BeatVerb;
  /**
   * The rhythmic description of the act, kept for the briefing and the pacing
   * budget. The player no longer plays a timing chart — see `reaction` — but the
   * held-moment hologram still reads the number of strokes and bars off this to
   * describe the work, and the pacing report costs the beat from its span.
   */
  readonly chart: BeatChartSpec;
  /** What the player actually does: a reaction test on a holographic panel. */
  readonly reaction: BeatReactionSpec;
  /** Where the player's feet are while they work. */
  readonly stance: Vec3;
  /** Where the work is: the nail point, the lock, the crank. */
  readonly target: Vec3;
  /** Facing the player is expected to hold. */
  readonly facingYaw: number;
  /**
   * How far off that facing the player may be and still be working.
   *
   * Generous on purpose. The facing check exists so the beat cannot be played
   * with the player's back to the work — which would make the convergence
   * off-screen and the mechanic unreadable — and not as a second precision test.
   * Asking a thirteen-year-old to hold a heading to within a few degrees while
   * hitting 33ms windows is two skills stacked, and only one of them is the one
   * being taught.
   */
  readonly facingToleranceRad: number;
  /**
   * Where the noise comes from. Defaults to the target rather than the stance,
   * because a hammer's sound happens at the head and not at the feet — and at
   * the ranges that matter the difference is under a metre either way, so this
   * is fidelity rather than tuning.
   */
  readonly noiseAt?: Vec3;
  readonly thresholds: BeatGradeThresholds;
  /** Horizontal radius within which the player counts as in stance. */
  readonly stanceRadiusM: number;
  /** Vertical tolerance on the same test. */
  readonly stanceHeightToleranceM: number;
  /** Design intent, in one sentence, for whoever tunes it later. */
  readonly note?: string;
}

/** Where this beat's noise originates. */
export function noiseOrigin(spec: BeatSpec): Vec3 {
  return spec.noiseAt ?? spec.target;
}

/** Is this heading close enough to the authored facing to be working? */
export function inFacingArc(spec: BeatSpec, yaw: number): boolean {
  let delta = yaw - spec.facingYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta) <= spec.facingToleranceRad;
}

/**
 * How long this beat occupies the mission clock, at its longest.
 *
 * The reaction schedule's widest span — every seeded gap taken at maximum jitter
 * — plus the verb's follow-through. It is a ceiling rather than a typical run,
 * so the pacing budget reserves what the beat can cost rather than a tail it
 * rarely reaches, and the run auto-resolves at this point whatever the player
 * has done, which is what guarantees the machine terminates.
 *
 * It does NOT include the time the player spends in stance before the first
 * flare beyond the authored lead. Standing on the bough choosing a patrol gap is
 * traversal they are choosing to spend, and charging it to the beat would make
 * the pacing budget claim the mechanic is slower than it is.
 */
export function beatWorstCaseTicks(spec: BeatSpec): number {
  return reactionWorstCaseSpan(spec.reaction) + spec.verb.settleTicks;
}

/** Everything wrong with an authored beat, as sentences. */
export function beatSpecDefects(spec: BeatSpec): string[] {
  const defects: string[] = [
    ...chartSpecDefects(spec.chart).map((defect) => `${spec.id}: chart: ${defect}`),
    ...reactionSpecDefects(spec.reaction).map(
      (defect) => `${spec.id}: reaction: ${defect}`,
    ),
    ...beatVerbDefects(spec.verb).map((defect) => `${spec.id}: verb: ${defect}`),
    ...verbLadderDefects(spec.verb).map((defect) => `${spec.id}: verb: ${defect}`),
  ];

  if (!(spec.thresholds.tornQuality < spec.thresholds.passQuality)) {
    defects.push(
      `${spec.id}: the tear threshold ${spec.thresholds.tornQuality} is not below the ` +
        `pass threshold ${spec.thresholds.passQuality}, so there is no band in which the ` +
        "sheet goes up badly — every imperfect beat would end the attempt",
    );
  }
  if (spec.thresholds.passQuality > 1 || spec.thresholds.tornQuality < 0) {
    defects.push(`${spec.id}: a quality threshold is outside [0,1]`);
  }
  if (!(spec.stanceRadiusM > 0)) {
    defects.push(`${spec.id}: the stance radius is not positive, so nobody can stand in it`);
  }
  if (!(spec.stanceHeightToleranceM > 0)) {
    defects.push(`${spec.id}: the stance height tolerance is not positive`);
  }
  if (!(spec.facingToleranceRad > 0)) {
    defects.push(
      `${spec.id}: the facing tolerance is not positive, so the player would have to ` +
        "hold an exact heading to the last float and the beat would be unplayable",
    );
  }
  if (spec.facingToleranceRad >= Math.PI) {
    defects.push(
      `${spec.id}: the facing tolerance is a full circle, so the beat can be played ` +
        "with the player's back to the work and the convergence off screen",
    );
  }

  if (spec.chart.spanTicks <= 0) {
    defects.push(`${spec.id}: the chart has no span, so there is nothing to time`);
  }
  return defects;
}
