// The precision beat, adopted.
//
// @pa/beat authored M1's nail stance in `m1NailStance.ts` and said in its own
// header that it was squatting: the coordinates mirror `PRECISION` in
// opposition.ts, and `m1NailStanceBeat` takes its geometry as arguments
// precisely so the level can hand over its own numbers when it takes the beat
// on. This file is that handover. The stance and the target come from the
// authored `PRECISION` block and nowhere else, so there is one bough in this
// mission rather than two that agree today.
//
// What the level does NOT get to author is the chart, the windows or the noise
// ladder. Those belong to the system, one difficulty for everybody, and a level
// that could widen its own window would be an easy mode with a costume on.

import { beatWorstCaseTicks, m1NailStanceBeat, type BeatSpec } from "@pa/beat";
import { FIELD_TICK_HZ } from "@pa/engine-world/fieldSimulation";
import { PRECISION } from "./level/opposition.js";

/** M1's beat, built from the level's own geometry. */
export function precisionBeatSpec(): BeatSpec {
  return m1NailStanceBeat({
    stance: {
      x: PRECISION.stance[0],
      y: PRECISION.stance[1],
      z: PRECISION.stance[2],
    },
    target: {
      x: PRECISION.target[0],
      y: PRECISION.target[1],
      z: PRECISION.target[2],
    },
  });
}

/**
 * Ticks of mission clock the beat costs at its worst.
 *
 * The chart's span, plus the outer window the last stroke may still be struck
 * in, plus the follow-through — computed by the package that owns all three
 * rather than estimated here. "At its worst" is a narrow claim now that a chart
 * is a whole number of bars: the span is identical on every seed, so the only
 * slack is the player taking the final stroke late. It does not include the time
 * the player spends in stance choosing a patrol gap: that is traversal they are
 * choosing to spend, and charging it to the beat would make the budget claim the
 * mechanic is slower than it is.
 */
export const PRECISION_BEAT_TICKS = beatWorstCaseTicks(precisionBeatSpec());

export const PRECISION_BEAT_SECONDS = PRECISION_BEAT_TICKS / FIELD_TICK_HZ;
