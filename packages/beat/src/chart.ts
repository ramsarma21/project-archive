// A beat chart, and how a seed becomes one.
//
// A chart is a list of tick offsets from the moment the player starts the beat.
// It is a PURE FUNCTION OF (spec, seed) and draws only from the engine's seeded
// kernel, which buys three properties the design needs:
//
//   * an attempt replays — the netcode agent can re-run the same tick stream and
//     get the same chart, so a recorded beat is reproducible evidence;
//   * a retry differs — the container reseeds per attempt, so failing and coming
//     back is not a memorisation exercise; and
//   * a re-entry does NOT differ. If the player steps out of the stance and back
//     in, the container derives the chart from the same attempt seed and gets the
//     same chart. That is deliberate: a chart re-rolled on re-entry could be
//     fished for, and "leave and re-enter until you get an easy one" would delete
//     the skill expression entirely.
//
// CHARTS ARE BUILT FROM BARS, NOT FROM FREE INTERVALS. A rhythm with no
// underlying pulse gives the player nothing to entrain to: every stroke is read
// cold, prediction is impossible, and the tight windows in tuning.ts stop being
// a skill and become a lottery. So a chart is a run of BARS, each one filled by
// a FIGURE — an authored group of intervals that sums to exactly one bar. A
// player who has heard one bar knows where the next downbeat is, and predicting
// is the thing that gets better with practice.
//
// The variation the seed provides is therefore WHICH figures, not what the bars
// are. The vocabulary is authored; the sentence is drawn.
//
// TWO PROPERTIES FALL OUT OF THE BAR THAT THE OLD FREE-INTERVAL DRAW COULD NOT
// GIVE, and both are load-bearing rather than tidy.
//
//   The chart's length is EXACT. Every figure in the chart is one bar long, so
//   `spanTicks` is identical on every seed. The pacing budget then
//   charges what the beat costs rather than a worst case reached by one seed in
//   four hundred — and, far more importantly, the player can judge the patrol gap
//   they are about to spend, because the commitment is the same length every
//   time. A beat whose length is a dice roll cannot be a stealth decision.
//
//   The chart has a DIFFICULTY CURVE. Phases run in order and may not get
//   sparser, so a chart opens at a density that teaches and ends at one that
//   tests. Difficulty stops being a property of the seed's luck and becomes a
//   property of the chart's shape.

import { fieldRandom, projectFieldSeed } from "./engine.js";
import {
  APPROACH_TICKS,
  HALF_PULSE_TICKS,
  HIT_WINDOW_TICKS,
  PULSE_TICKS,
} from "./tuning.js";

/**
 * The interval vocabulary, in ticks.
 *
 * Every cell is a whole number of half-pulses, so a chart is always on the grid
 * and two charts drawn from the same spec are always in the same time.
 */
export const CELL_TICKS = {
  /** Half a pulse. Two strokes in a row, 200ms apart. The spike. */
  DOUBLE: HALF_PULSE_TICKS,
  /** The pulse. The chart's home interval. */
  PULSE: PULSE_TICKS,
  /** A dotted pulse: off the beat, on the grid. */
  SWING: PULSE_TICKS + HALF_PULSE_TICKS,
  /** Two pulses. Room to breathe, and to re-set the arm. */
  LONG: PULSE_TICKS * 2,
} as const;

export type BeatCell = keyof typeof CELL_TICKS;

/** One letter per cell, so a figure's id reads as its own rhythm. */
const CELL_INITIAL: Readonly<Record<BeatCell, string>> = {
  DOUBLE: "D",
  PULSE: "P",
  SWING: "S",
  LONG: "L",
};

/**
 * One bar's worth of rhythm: an ordered group of intervals.
 *
 * A figure is the unit an author actually thinks in — "four even", "a snap on
 * the three", "two doubles and a rest" — and it is the unit the seed draws.
 * Because every figure in a chart sums to the same bar, drawing one can change
 * the rhythm and can never change the length.
 */
export interface BeatFigure {
  /** The cells' initials, e.g. `PDPS`. Derived, so it cannot describe a lie. */
  readonly id: string;
  readonly cells: readonly BeatCell[];
}

/** Build a figure. The id is its own rhythm, spelled. */
export function figure(...cells: BeatCell[]): BeatFigure {
  return { id: cells.map((cell) => CELL_INITIAL[cell]).join(""), cells };
}

export function figureTicks(entry: BeatFigure): number {
  let total = 0;
  for (const cell of entry.cells) total += CELL_TICKS[cell];
  return total;
}

export interface BeatFigureWeight {
  readonly figure: BeatFigure;
  /** Relative likelihood. Must be positive. */
  readonly weight: number;
}

/** Every figure in a set, equally likely. */
export function evenly(figures: readonly BeatFigure[]): BeatFigureWeight[] {
  return figures.map((entry) => ({ figure: entry, weight: 1 }));
}

/**
 * Every figure in a set, with named ones weighted up.
 *
 * Keyed by figure id rather than by index, and it throws on an id the set does
 * not contain: a weight silently applied to nothing would show up only as a
 * chart that felt subtly wrong, which is the least debuggable kind of tuning
 * mistake there is.
 */
export function weighted(
  figures: readonly BeatFigure[],
  weights: Readonly<Record<string, number>>,
): BeatFigureWeight[] {
  const known = new Set(figures.map((entry) => entry.id));
  for (const id of Object.keys(weights)) {
    if (!known.has(id)) {
      throw new Error(
        `figure "${id}" was given a weight but is not in this set (${[...known].join(", ")})`,
      );
    }
  }
  return figures.map((entry) => ({
    figure: entry,
    weight: weights[entry.id] ?? 1,
  }));
}

/**
 * A stretch of the chart drawn from one vocabulary at one density.
 *
 * Phases are how a chart gets a shape. An author writes two or three of them,
 * each a little denser than the last, and the chart opens at a rate that teaches
 * and closes at a rate that tests. Everything inside a phase is the same
 * difficulty in the only sense this package can measure — strokes per bar — so
 * the curve is a property of the spec rather than of the draw.
 */
export interface BeatPhaseSpec {
  /** For reports and failure messages. */
  readonly id: string;
  readonly bars: number;
  readonly figures: readonly BeatFigureWeight[];
  /** Design intent, in one sentence. */
  readonly note?: string;
}

/** What an author writes. */
export interface BeatChartAuthoring {
  readonly id: string;
  /** Ticks in one bar. Every figure in every phase must sum to exactly this. */
  readonly barTicks: number;
  /**
   * The gap between the first stroke and the second. Authored, never drawn.
   *
   * THIS IS THE TEACHING INTERVAL and it is the reason the beat needs no
   * tutorial. Whatever the seed does with the rest of the chart, the first thing
   * that ever happens is one plain interval: the player strikes, one mark
   * appears and travels, and they strike again when it arrives.
   *
   * It is required to be at least one full approach long, and that is not
   * fussiness. What the opening teaches is not "hit the line" but HOW FAST A
   * MARK TRAVELS, and a speed cannot be read off a partial journey. An opening
   * shorter than the approach spawns the first mark already part-way down the
   * lane, so the one demonstration the player gets is a demonstration of the
   * wrong thing.
   */
  readonly openingCell: BeatCell;
  /**
   * The chart's spike: the cell that separates a good player from a great one.
   *
   * Declared once, at the chart, because two rules depend on knowing which cell
   * it is. Two spikes are never adjacent — three strokes at half-pulse spacing
   * is a tremolo, not a hammer, and the hit windows would overlap two deep —
   * and at least one phase must carry the spike in EVERY figure, so that no seed
   * is a free pass.
   */
  readonly spikeCell: BeatCell;
  /** In order. Density may rise between them and may never fall. */
  readonly phases: readonly BeatPhaseSpec[];
}

/**
 * An authored chart plus everything derivable from it.
 *
 * The derived fields are computed by `defineChart` rather than restated by the
 * author, because all three of them are things a spec could otherwise claim
 * wrongly: a chart that says it has six strokes and draws thirteen would still
 * play, and only the pacing report would be quietly false.
 */
export interface BeatChartSpec extends BeatChartAuthoring {
  /**
   * Total strokes, INCLUDING the first one.
   *
   * The first stroke is not judged — it is how the player starts the chart, and
   * why is set out at length in machine.ts.
   */
  readonly strikes: number;
  /** Strokes that carry a window. `strikes - 1`. */
  readonly judgedBeats: number;
  /** Ticks from the first stroke to the last. THE SAME ON EVERY SEED. */
  readonly spanTicks: number;
}

export interface BeatChart {
  readonly specId: string;
  readonly seed: number;
  /**
   * Tick offsets from the first stroke, ascending. `offsets[0]` is always 0 and
   * is the un-judged opening stroke; every later entry is a beat with a window.
   */
  readonly offsets: readonly number[];
  /** The gap cells, in order. Length is `offsets.length - 1`. */
  readonly cells: readonly BeatCell[];
  /** The figure drawn for each bar, in order. */
  readonly figures: readonly string[];
  /**
   * Tick offsets of the bar lines, ascending, ending on the last stroke.
   *
   * Published so a renderer can draw the phrase rather than a row of thirteen
   * identical marks. The downbeats are what make a long chart legible in the
   * preview: the player reads three bars of rising density, not a queue.
   */
  readonly downbeats: readonly number[];
  /** Ticks from the first stroke to the last. */
  readonly spanTicks: number;
  /** Beats that carry a window. `offsets.length - 1`. */
  readonly judgedBeats: number;
}

/** Strokes to the bar in this phase, which is the phase's density. */
export function phaseStrokesPerBar(phase: BeatPhaseSpec): number {
  return phase.figures[0]?.figure.cells.length ?? 0;
}

/**
 * Compile an authored chart.
 *
 * Total and pure. It does not validate — `chartSpecDefects` does that, and it is
 * a separate call so a level report can list everything wrong with a spec
 * instead of dying on the first thing.
 */
export function defineChart(authoring: BeatChartAuthoring): BeatChartSpec {
  // Every figure in a phase carries the same stroke count — that is checked as a
  // defect — so one figure answers for the whole phase.
  const judgedBeats = authoring.phases.reduce(
    (total, phase) => total + phase.bars * phaseStrokesPerBar(phase),
    1,
  );
  const spanTicks = authoring.phases.reduce(
    (total, phase) => total + phase.bars * authoring.barTicks,
    CELL_TICKS[authoring.openingCell],
  );
  return { ...authoring, strikes: judgedBeats + 1, judgedBeats, spanTicks };
}

function paletteTotal(palette: readonly BeatFigureWeight[]): number {
  let total = 0;
  for (const entry of palette) total += entry.weight;
  return total;
}

/** Weighted pick from a [0,1) roll. Deterministic for a given palette order. */
function pick(palette: readonly BeatFigureWeight[], roll: number): BeatFigure {
  const total = paletteTotal(palette);
  let remaining = roll * total;
  for (const entry of palette) {
    remaining -= entry.weight;
    if (remaining < 0) return entry.figure;
  }
  // Floating-point tail. The last entry is the only honest answer here.
  return palette[palette.length - 1]!.figure;
}

/**
 * Draw the chart for one attempt.
 *
 * Pure, total, and free of wall-clock and of `Math.random`. The same (spec,
 * seed) always produces the same chart on every machine.
 */
export function deriveChart(spec: BeatChartSpec, seed: number): BeatChart {
  const salt = projectFieldSeed([spec.id, "figures"]) & 0xffff;
  const cells: BeatCell[] = [spec.openingCell];
  const figures: string[] = [];
  const downbeats: number[] = [];
  let bar = 0;

  for (const phase of spec.phases) {
    for (let index = 0; index < phase.bars; index++) {
      // A figure that OPENS on the spike is withdrawn when the previous bar
      // CLOSED on one, so non-adjacency holds across the bar line as well as
      // inside a figure. Enforced by never offering the illegal choice rather
      // than by drawing and rejecting, which keeps the draw a single call and
      // the distribution honest.
      const previous = cells[cells.length - 1];
      const allowed =
        previous === spec.spikeCell
          ? phase.figures.filter((entry) => entry.figure.cells[0] !== spec.spikeCell)
          : phase.figures;
      const usable = allowed.length > 0 ? allowed : phase.figures;
      const drawn = pick(usable, fieldRandom(seed, bar, salt));
      cells.push(...drawn.cells);
      figures.push(drawn.id);
      bar += 1;
    }
  }

  const offsets: number[] = [0];
  for (const cell of cells) {
    offsets.push(offsets[offsets.length - 1]! + CELL_TICKS[cell]);
  }
  const firstBar = CELL_TICKS[spec.openingCell];
  for (let index = 0; index < bar; index++) {
    downbeats.push(firstBar + (index + 1) * spec.barTicks);
  }

  return {
    specId: spec.id,
    seed: seed >>> 0,
    offsets,
    cells,
    figures,
    downbeats,
    spanTicks: offsets[offsets.length - 1]!,
    judgedBeats: offsets.length - 1,
  };
}

/** Does every figure in this phase carry the spike? */
function phaseGuaranteesSpike(phase: BeatPhaseSpec, spike: BeatCell): boolean {
  return (
    phase.figures.length > 0 &&
    phase.figures.every((entry) => entry.figure.cells.includes(spike))
  );
}

/** Everything wrong with an authored chart spec, as sentences. */
export function chartSpecDefects(spec: BeatChartSpec): string[] {
  const defects: string[] = [];

  if (spec.barTicks <= 0 || spec.barTicks % HALF_PULSE_TICKS !== 0) {
    defects.push(
      `the bar is ${spec.barTicks} ticks, which is not a whole number of ${HALF_PULSE_TICKS}-tick ` +
        "half-pulses, so no figure can fill it and stay on the grid",
    );
  }
  if (spec.phases.length === 0) {
    defects.push("the chart has no phases, so there is nothing to draw");
  }
  if (spec.strikes < 2) {
    defects.push(
      `a chart needs at least two strokes (one to start it and one to judge); this one has ${spec.strikes}`,
    );
  }
  if (CELL_TICKS[spec.openingCell] < APPROACH_TICKS) {
    defects.push(
      `the opening gap is ${CELL_TICKS[spec.openingCell]} ticks against a ${APPROACH_TICKS}-tick ` +
        "approach, so the first mark appears already part-way down the lane. What the " +
        "opening teaches is how fast a mark travels, and that cannot be read off a " +
        "partial journey",
    );
  }
  if (spec.openingCell === spec.spikeCell) {
    defects.push(
      "the opening gap is the spike, so the very first thing the player is asked to do " +
        "is the hardest thing in the chart and nothing has taught them the read yet",
    );
  }

  let previousDensity = 0;
  spec.phases.forEach((phase, index) => {
    if (phase.bars < 1) {
      defects.push(`phase ${phase.id} has ${phase.bars} bars, so it draws nothing`);
    }
    if (phase.figures.length === 0) {
      defects.push(`phase ${phase.id} has no figures, so its bars cannot be filled`);
      return;
    }
    for (const entry of phase.figures) {
      if (!(entry.weight > 0)) {
        defects.push(`phase ${phase.id}: figure ${entry.figure.id} has a non-positive weight`);
      }
      const ticks = figureTicks(entry.figure);
      if (ticks !== spec.barTicks) {
        defects.push(
          `phase ${phase.id}: figure ${entry.figure.id} is ${ticks} ticks against a ` +
            `${spec.barTicks}-tick bar, so drawing it would move every downbeat after it ` +
            "and the chart would no longer be the length it claims",
        );
      }
      for (let cell = 1; cell < entry.figure.cells.length; cell++) {
        if (
          entry.figure.cells[cell] === spec.spikeCell &&
          entry.figure.cells[cell - 1] === spec.spikeCell
        ) {
          defects.push(
            `phase ${phase.id}: figure ${entry.figure.id} puts two spikes back to back, ` +
              "which is a tremolo rather than a hammer and stacks the hit windows two deep",
          );
          break;
        }
      }
    }

    const density = phaseStrokesPerBar(phase);
    const uneven = phase.figures.find((entry) => entry.figure.cells.length !== density);
    if (uneven) {
      defects.push(
        `phase ${phase.id} mixes densities — ${uneven.figure.id} has ` +
          `${uneven.figure.cells.length} strokes against the phase's ${density} — so how many ` +
          "strokes the chart asks for would depend on the seed, and no two attempts would " +
          "be the same test",
      );
    }
    if (density < previousDensity) {
      defects.push(
        `phase ${phase.id} is sparser than the phase before it (${density} strokes to the ` +
          `bar against ${previousDensity}), so the chart gets easier as it goes and the ` +
          "player's warm-up arrives after the test",
      );
    }
    previousDensity = Math.max(previousDensity, density);

    if (phase.figures.every((entry) => entry.figure.cells[0] === spec.spikeCell)) {
      defects.push(
        `phase ${phase.id}: every figure opens on the spike, so a bar that closed on one ` +
          "has no legal successor and the draw would have to break its own adjacency rule",
      );
    }
    if (index === 0 && spec.phases.length > 1 && phaseGuaranteesSpike(phase, spec.spikeCell)) {
      defects.push(
        `phase ${phase.id} is the chart's opening phase and every one of its figures carries ` +
          "the spike, so the chart is at its hardest while it is still teaching",
      );
    }
  });

  if (!spec.phases.some((phase) => phaseGuaranteesSpike(phase, spec.spikeCell))) {
    defects.push(
      "no phase carries the spike in every figure, so some seed draws a chart with no teeth " +
        "in it and that attempt is a free pass",
    );
  }

  return defects;
}

/**
 * The most marks a renderer will have to show at once, over the whole chart.
 *
 * The readability budget. Marks are visible for one approach, so a dense bar
 * puts several on the lane together — which is the point of a dense bar and is
 * also the thing that stops being readable if a chart overdoes it. Measured
 * rather than asserted, because it is a consequence of the figures an author
 * chose and not of anything they wrote down.
 */
export function peakMarksInFlight(chart: BeatChart): number {
  let peak = 0;
  for (let tick = 0; tick <= chart.spanTicks + HIT_WINDOW_TICKS; tick++) {
    let together = 0;
    for (let index = 1; index < chart.offsets.length; index++) {
      const away = chart.offsets[index]! - tick;
      if (away <= APPROACH_TICKS && away >= -HIT_WINDOW_TICKS) together += 1;
    }
    if (together > peak) peak = together;
  }
  return peak;
}

/** One-line description of a drawn chart. For reports and failure messages. */
export function chartSummary(chart: BeatChart): string {
  return (
    `${chart.specId}#${chart.seed >>> 0}: ` +
    `${chart.judgedBeats} judged over ${chart.spanTicks}t [${chart.figures.join(" ")}]`
  );
}

// ---- the figure library ----------------------------------------------------
//
// Bars of `BAR_TICKS`, grouped by how many strokes they ask for. These are the
// rhythms available at each density rather than every rhythm that fits: a figure
// is in here because a person can play it and hear it, not because it sums
// correctly.
//
// Three constraints shaped the lists. Nothing puts two spikes together. Nothing
// at four to the bar carries more than one spike, and everything at five carries
// exactly two — so spike density rises with the phase rather than jumping. And
// each list holds figures that both open and close on something other than the
// spike, so the cross-bar adjacency filter can never empty a palette.

/**
 * Three strokes to the bar. 32 ticks a stroke on average, and no spike anywhere.
 *
 * The opening vocabulary. It is the only density at which a bar can be entirely
 * on-pulse with room left over, which is what a player needs while they are
 * still working out how fast a mark travels.
 */
export const THREE_TO_THE_BAR: readonly BeatFigure[] = [
  figure("PULSE", "PULSE", "LONG"),
  figure("LONG", "PULSE", "PULSE"),
  figure("PULSE", "LONG", "PULSE"),
  figure("SWING", "SWING", "PULSE"),
  figure("PULSE", "SWING", "SWING"),
  figure("SWING", "PULSE", "SWING"),
];

/**
 * Four strokes to the bar: the home rate, 24 ticks a stroke.
 *
 * `PPPP` is the plain hammering bar and the rest are the same bar with one snap
 * moved around inside it, so the phase sounds like work with a catch in it
 * rather than like an exercise.
 */
export const FOUR_TO_THE_BAR: readonly BeatFigure[] = [
  figure("PULSE", "PULSE", "PULSE", "PULSE"),
  figure("DOUBLE", "PULSE", "PULSE", "SWING"),
  figure("PULSE", "DOUBLE", "PULSE", "SWING"),
  figure("PULSE", "SWING", "DOUBLE", "PULSE"),
  figure("SWING", "PULSE", "PULSE", "DOUBLE"),
  figure("DOUBLE", "SWING", "PULSE", "PULSE"),
];

/**
 * Five strokes to the bar, which is as dense as the grid goes.
 *
 * Five strokes cannot fit in a bar without at least one half-pulse gap, so every
 * one of these carries the spike by arithmetic rather than by authoring — a
 * phase drawn from this list is the "no seed is a free pass" guarantee, not a
 * hope. Exactly two spikes each, never touching.
 */
export const FIVE_TO_THE_BAR: readonly BeatFigure[] = [
  figure("DOUBLE", "PULSE", "DOUBLE", "PULSE", "PULSE"),
  figure("DOUBLE", "PULSE", "PULSE", "DOUBLE", "PULSE"),
  figure("DOUBLE", "PULSE", "PULSE", "PULSE", "DOUBLE"),
  figure("PULSE", "DOUBLE", "PULSE", "DOUBLE", "PULSE"),
  figure("PULSE", "DOUBLE", "PULSE", "PULSE", "DOUBLE"),
  figure("PULSE", "PULSE", "DOUBLE", "PULSE", "DOUBLE"),
];
