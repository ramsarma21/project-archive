// Beat verbs: what the player is actually doing while the chart runs.
//
// The timing model, the chart, the judgement and the noise coupling are all verb
// agnostic. What a verb supplies is the fiction and the two things the fiction
// legitimately changes: how loud the work is, and which clips the presentation
// layer plays.
//
// This exists so later missions can author a different action against the same
// system without the system learning anything about hammers. Picking a lock,
// setting type, working a winch, counting out coin under a clerk's eye — all of
// them are "a short burst of timed input at a fixed spot while the world keeps
// moving", and all of them should cost imprecision in attention. The only thing
// that should differ is what it sounds like and what the body does.
//
// WHAT A VERB MAY NOT CHANGE, and the reason:
//
//   * the windows. One difficulty means one FLUSH, everywhere. A verb that
//     widened its own windows would be an easy mode with a costume on.
//   * the noise KIND. Every beat noise is PLAYER_MOVE, which is the kind the
//     stealth field treats as implicating the player. A verb whose mistakes
//     pointed attention somewhere else would be a diversion, and a mechanic
//     whose failure state helps you is not a mechanic.

import type { NoiseKind } from "./engine.js";

/**
 * The kind every beat noise carries.
 *
 * Fixed, not a per-verb field. `noiseImplicatesPlayer` is true for this kind, so
 * the noise raises the hearer's suspicion and points his attention AT the stance
 * — which is the entire design thesis of this package expressed in one constant.
 */
export const BEAT_NOISE_KIND: NoiseKind = "PLAYER_MOVE";

export interface BeatVerbClips {
  /** Held while the player is in stance with the work not yet started. */
  readonly stance: string;
  /** Fired on a stroke that connected. */
  readonly strike: string;
  /** Fired on a swing that hit nothing. */
  readonly stray: string;
  /** Played once when the run resolves. */
  readonly finish: string;
}

export interface BeatVerb {
  readonly id: string;
  /** For HUD copy and level reports. */
  readonly label: string;
  /**
   * Multiplier on the shared strike-noise table.
   *
   * 1 is a hammer driving a tack into bark: the reference. A quieter verb scales
   * the WHOLE ladder down together, so the relationship between a centred stroke
   * and a botched one is preserved and only the absolute reach changes. Scaling
   * one rung independently would let a verb be tuned into having no consequence,
   * which is the failure this package is built to avoid.
   */
  readonly noiseScale: number;
  /**
   * Ticks after the final beat before the run resolves.
   *
   * The follow-through. It exists so the outcome does not land on the same frame
   * as the last stroke — a result that appears before the hammer has finished
   * moving reads as the game having decided in advance — and so the presentation
   * layer has somewhere to put the finish clip.
   */
  readonly settleTicks: number;
  readonly clips: BeatVerbClips;
}

/**
 * Driving a fastener: nails, tacks, a sheet onto a surface.
 *
 * M1's verb. Three bars of hammering into the bole of the Liberty Tree beside
 * the effigy, eight metres up, with torches under it and a constable working the
 * street below. There is nothing to read and nothing to know — it is pure
 * timing, which is why it is the mission's one mechanical-skill expression.
 */
export const DRIVE_FASTENER: BeatVerb = {
  id: "BEAT.VERB.DRIVE_FASTENER.v1",
  label: "drive the tacks",
  noiseScale: 1,
  // 0.5s. A hammer stroke's follow-through, and long enough for a player to see
  // the last mark resolve before the panel tells them how they did.
  settleTicks: 30,
  clips: {
    stance: "beatStance",
    strike: "beatStrike",
    stray: "beatStray",
    finish: "beatFinish",
  },
};

/** Everything wrong with an authored verb, as sentences. */
export function beatVerbDefects(verb: BeatVerb): string[] {
  const defects: string[] = [];
  if (!(verb.noiseScale > 0)) {
    defects.push(
      `${verb.id} scales its noise by ${verb.noiseScale}, which silences the verb ` +
        "entirely — a beat whose mistakes cost nothing is a minigame, not a mechanic",
    );
  }
  if (verb.settleTicks < 0) {
    defects.push(`${verb.id} has a negative settle`);
  }
  return defects;
}
