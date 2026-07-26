// The coupling: a judgement becomes a noise the stealth field already knows how
// to react to.
//
// This file is the reason the precision beat is a stealth mechanic and not a
// minigame. Everything else in this package could be lifted into any game; this
// could not, and should not be able to be.
//
// A `NoiseEvent` is the one currency shared between movement and stealth. Parkour
// emits them for landings and verbs; a thrown bottle emits them where it lands.
// A mistimed hammer stroke emits one too, of the same kind a hard landing does —
// so the field needs to learn nothing at all for this to work. `stepWatcherAlert`
// hears it, raises the hearer's suspicion by its audibility, and sets his
// attention and last-known point to the stance. The player then has a constable
// looking at the tree they are standing in.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not detect anybody. The field caps
// noise-built suspicion below certainty, so a botched beat can never end an
// attempt on its own. It changes the situation and hands the outcome back to
// geometry and eyes. That is the right severity — a mistake with consequences
// the player can still play their way out of, made under a patrol they chose to
// start in front of.

import { PARKOUR_TUNING, STEALTH_TUNING, type NoiseEvent, type Vec3 } from "./engine.js";
import { STRIKE_NOISE } from "./tuning.js";
import { BEAT_NOISE_KIND, type BeatVerb } from "./verbs.js";
import type { BeatJudgement } from "./judge.js";

/**
 * Loudness at the source for one judgement, with the verb's scale applied.
 *
 * The scale multiplies the intensity rather than the radius, which is the
 * opposite of what the ability layer does to a thrown object and is right for
 * the opposite reason. An armed diversion is supposed to REACH further than the
 * object physically justifies, so it scales reach. A quieter verb is quieter at
 * the source, and its reach should follow from that on the same
 * metres-per-loudness scale everything else uses.
 */
export function strikeIntensity(judgement: BeatJudgement, verb: BeatVerb): number {
  const base =
    judgement === "FLUSH"
      ? STRIKE_NOISE.FLUSH
      : judgement === "TRUE"
        ? STRIKE_NOISE.TRUE
        : judgement === "GLANCING"
          ? STRIKE_NOISE.GLANCING
          : judgement === "SLIP"
            ? STRIKE_NOISE.SLIP
            : STRIKE_NOISE.STRAY;
  return Math.max(0, Math.min(1, base * verb.noiseScale));
}

/** How far this judgement carries, in metres. */
export function strikeRadiusM(judgement: BeatJudgement, verb: BeatVerb): number {
  return strikeIntensity(judgement, verb) * PARKOUR_TUNING.noiseRadiusPerIntensityM;
}

/**
 * The noise one stroke makes, at the stance.
 *
 * Emitted on exactly one tick, which is a contract the stealth field states
 * explicitly: `noiseSuspicionImpulse` is an impulse rather than a rate, so a
 * caller that repeated the same event across several ticks would multiply its
 * effect by the frame count. The machine emits each of these once.
 */
export function strikeNoiseEvent(
  judgement: BeatJudgement,
  verb: BeatVerb,
  at: Vec3,
): NoiseEvent {
  const intensity = strikeIntensity(judgement, verb);
  return {
    kind: BEAT_NOISE_KIND,
    x: at.x,
    y: at.y,
    z: at.z,
    intensity,
    radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
  };
}

/**
 * True when the field cannot hear this stroke from anywhere, including from
 * zero distance.
 *
 * Audibility is `intensity * (1 - d/r)`, so its maximum is the intensity itself
 * and a stroke quieter than the field's floor is silent everywhere. This is what
 * makes SILENT a real grade rather than a flattering label: a flawless beat is
 * not merely low-risk, it produces nothing any watcher in the game can hear.
 */
export function strikeIsInaudible(judgement: BeatJudgement, verb: BeatVerb): boolean {
  return strikeIntensity(judgement, verb) < STEALTH_TUNING.minAudibleNoise;
}

/**
 * What a listener at (x, z) hears from a stroke at the stance, [0,1].
 *
 * Exposed so level tooling can answer "would this patrol hear a botched beat
 * from its closest approach" as a measurement over a real patrol cycle, rather
 * than as an assertion in a comment. That is how the rest of this repo checks
 * claims about cones and noise, and this claim deserves the same treatment.
 */
export function strikeAudibilityAt(
  judgement: BeatJudgement,
  verb: BeatVerb,
  at: Vec3,
  listenerX: number,
  listenerZ: number,
): number {
  const radiusM = strikeRadiusM(judgement, verb);
  if (radiusM <= 0) return 0;
  const distance = Math.hypot(at.x - listenerX, at.z - listenerZ);
  if (distance >= radiusM) return 0;
  return strikeIntensity(judgement, verb) * (1 - distance / radiusM);
}

/**
 * Everything wrong with a verb's place on the loudness ladder, as sentences.
 *
 * A verb may scale the whole table, and the two ends of the table are the two
 * things this package promises. Both of them can be broken by a single innocent
 * number on a new verb, and neither break is visible in play — the beat still
 * runs, the grades still read, and the coupling has simply stopped existing.
 *
 * Too quiet and a TRUE or a GLANCING stroke drops under the field's floor, so
 * the rungs between perfect and botched cost nothing and the whole ladder
 * collapses into "centred or caught". Too loud and a centred stroke is audible,
 * which deletes the reward for the hardest thing in the mission. Kept out of
 * `beatVerbDefects` only because the audibility floor lives in the engine and
 * verbs.ts is deliberately the one file here that knows nothing about noise
 * beyond its kind.
 */
export function verbLadderDefects(verb: BeatVerb): string[] {
  const defects: string[] = [];
  if (!strikeIsInaudible("FLUSH", verb)) {
    defects.push(
      `${verb.id} scales a centred stroke to ${strikeIntensity("FLUSH", verb)}, at or above ` +
        `the field's ${STEALTH_TUNING.minAudibleNoise} floor, so a perfect beat would be ` +
        "heard and the ceiling of this mechanic would pay nothing",
    );
  }
  for (const judgement of ["TRUE", "GLANCING", "SLIP", "STRAY"] as const) {
    if (strikeIsInaudible(judgement, verb)) {
      defects.push(
        `${verb.id} scales a ${judgement} stroke to ${strikeIntensity(judgement, verb)}, under ` +
          `the field's ${STEALTH_TUNING.minAudibleNoise} floor, so that grade of mistake is ` +
          "silent and the rung below the ceiling costs the player nothing",
      );
    }
  }
  return defects;
}

export interface NoiseBudgetRow {
  readonly judgement: BeatJudgement;
  readonly intensity: number;
  readonly radiusM: number;
  /** Suspicion a watcher at zero distance would take from one of these. */
  readonly peakSuspicion: number;
  readonly inaudible: boolean;
}

/**
 * The whole coupling as a table, for a level report.
 *
 * `peakSuspicion` is the field's own arithmetic — impulse times audibility —
 * rather than a restatement of it, so a change to `noiseSuspicionImpulse`
 * upstream shows up here instead of quietly making this document wrong.
 */
export function noiseBudget(verb: BeatVerb): NoiseBudgetRow[] {
  const impulse = STEALTH_TUNING.noiseSuspicionImpulse[BEAT_NOISE_KIND];
  const judgements: BeatJudgement[] = ["FLUSH", "TRUE", "GLANCING", "SLIP", "STRAY"];
  return judgements.map((judgement) => {
    const intensity = strikeIntensity(judgement, verb);
    const audible = intensity >= STEALTH_TUNING.minAudibleNoise;
    return {
      judgement,
      intensity,
      radiusM: strikeRadiusM(judgement, verb),
      peakSuspicion: audible ? impulse * intensity : 0,
      inaudible: !audible,
    };
  });
}
