// A chart is a pure function of a seed, and the seed is the only thing that
// varies. These are the properties the replay guarantee, the anti-memorisation
// guarantee and the pacing budget all rest on.

import assert from "node:assert/strict";
import test from "node:test";
import {
  CELL_TICKS,
  FIVE_TO_THE_BAR,
  FOUR_TO_THE_BAR,
  THREE_TO_THE_BAR,
  chartSpecDefects,
  chartSummary,
  defineChart,
  deriveChart,
  evenly,
  figure,
  figureTicks,
  peakMarksInFlight,
  phaseStrokesPerBar,
  weighted,
  type BeatChartAuthoring,
  type BeatFigure,
} from "../chart.js";
import { APPROACH_TICKS, BAR_TICKS, HALF_PULSE_TICKS } from "../tuning.js";
import { M1_HANDBILL_CHART, M1_SECOND_BEAT_CHART } from "../m1NailStance.js";

const SEEDS = [1, 2, 7, 41, 99, 1234, 65535, 0xdeadbeef, 0x7fffffff];
const SPIKE = M1_HANDBILL_CHART.spikeCell;

const LIBRARY: Array<[string, readonly BeatFigure[], number]> = [
  ["THREE_TO_THE_BAR", THREE_TO_THE_BAR, 3],
  ["FOUR_TO_THE_BAR", FOUR_TO_THE_BAR, 4],
  ["FIVE_TO_THE_BAR", FIVE_TO_THE_BAR, 5],
];

test("the same seed always draws the same chart", () => {
  for (const seed of SEEDS) {
    const first = deriveChart(M1_HANDBILL_CHART, seed);
    const second = deriveChart(M1_HANDBILL_CHART, seed);
    assert.deepEqual(first, second, `seed ${seed} drew two different charts`);
  }
});

test("a retry draws a different chart", () => {
  // Not every pair need differ, but the population has to be varied enough that
  // a player cannot learn one chart and be handed it again. Memorising is
  // supposed to be the wrong strategy.
  const shapes = new Set(
    SEEDS.map((seed) => deriveChart(M1_HANDBILL_CHART, seed).figures.join(",")),
  );
  assert.ok(
    shapes.size >= SEEDS.length - 1,
    `nine seeds produced only ${shapes.size} distinct charts, so retries repeat`,
  );
  const population = new Set<string>();
  for (let seed = 0; seed < 4000; seed++) {
    population.add(deriveChart(M1_HANDBILL_CHART, seed).figures.join(","));
  }
  assert.ok(
    population.size >= 100,
    `the whole seed space only reaches ${population.size} charts, which is memorisable`,
  );
});

test("every chart is exactly the same length, on every seed", () => {
  // THE PACING CLAIM, and it is the reason charts are built from bars. A beat is
  // spent inside a patrol gap the player has to judge before they commit, and a
  // commitment whose length is a dice roll cannot be judged. It is also what
  // lets the mission clock be charged what the beat costs instead of a tail it
  // reaches once in four hundred attempts.
  for (let seed = 0; seed < 4000; seed++) {
    const chart = deriveChart(M1_HANDBILL_CHART, seed);
    assert.equal(
      chart.spanTicks,
      M1_HANDBILL_CHART.spanTicks,
      `seed ${seed} spans ${chart.spanTicks}t against the declared ${M1_HANDBILL_CHART.spanTicks}t`,
    );
    assert.equal(chart.judgedBeats, M1_HANDBILL_CHART.judgedBeats, `seed ${seed}`);
    assert.equal(chart.offsets.length, M1_HANDBILL_CHART.strikes, `seed ${seed}`);
  }
});

test("the chart is long enough to be a skill and short enough to spend", () => {
  // Thirteen judged strokes is the number this rework exists for: five was one
  // sample and thirty-nine across a mission's three-attempt lifetime, which is
  // not something a player can get better at. Thirteen is thirty-nine an
  // attempt.
  assert.equal(M1_HANDBILL_CHART.judgedBeats, 13);
  assert.equal(M1_HANDBILL_CHART.strikes, 14);
  assert.equal(M1_HANDBILL_CHART.spanTicks, CELL_TICKS.LONG + 3 * BAR_TICKS);
});

test("every chart opens with the authored teaching interval, a full approach long", () => {
  // The opening teaches how fast a mark travels, and a speed cannot be read off
  // a partial journey: an opening shorter than the approach spawns the first
  // mark already part-way down the lane.
  assert.ok(CELL_TICKS[M1_HANDBILL_CHART.openingCell] >= APPROACH_TICKS);
  for (const seed of SEEDS) {
    const chart = deriveChart(M1_HANDBILL_CHART, seed);
    assert.equal(chart.cells[0], M1_HANDBILL_CHART.openingCell, `seed ${seed}`);
    assert.equal(chart.offsets[1], APPROACH_TICKS, `seed ${seed}`);
  }
});

test("every chart carries the spike, and never two in a row", () => {
  // Two spikes are never adjacent — three strokes at half-pulse spacing is a
  // tremolo, not a hammer — and the rule has to hold ACROSS a bar line as well
  // as inside a figure, which is the join a figure-based draw could lose.
  for (let seed = 0; seed < 4000; seed++) {
    const chart = deriveChart(M1_HANDBILL_CHART, seed);
    const spikes = chart.cells.filter((cell) => cell === SPIKE).length;
    assert.ok(spikes >= 1, `seed ${seed} drew a chart with no spike: ${chartSummary(chart)}`);
    for (let index = 1; index < chart.cells.length; index++) {
      assert.ok(
        !(chart.cells[index] === SPIKE && chart.cells[index - 1] === SPIKE),
        `seed ${seed} put two spikes back to back: ${chartSummary(chart)}`,
      );
    }
  }
});

test("the spike never lands in the bar that is still teaching", () => {
  // The difficulty curve, at the one place it matters most. The opening phase is
  // where a player finds the pulse, and nothing in it may punish somebody who
  // has not found it yet.
  const opening = M1_HANDBILL_CHART.phases[0]!;
  const openingCells = 1 + opening.bars * phaseStrokesPerBar(opening);
  for (let seed = 0; seed < 2000; seed++) {
    const chart = deriveChart(M1_HANDBILL_CHART, seed);
    assert.ok(
      !chart.cells.slice(0, openingCells).includes(SPIKE),
      `seed ${seed} put a spike in the ${opening.id} bar: ${chartSummary(chart)}`,
    );
  }
});

test("the chart gets denser and never sparser", () => {
  // The whole point of phases. Difficulty is a property of the chart's shape
  // rather than of the seed's luck, so a player always warms up before the test
  // instead of sometimes after it.
  let previous = 0;
  for (const phase of M1_HANDBILL_CHART.phases) {
    const density = phaseStrokesPerBar(phase);
    assert.ok(
      density >= previous,
      `phase ${phase.id} is sparser (${density}) than the one before it (${previous})`,
    );
    previous = density;
  }
  assert.deepEqual(
    M1_HANDBILL_CHART.phases.map(phaseStrokesPerBar),
    [3, 4, 5],
    "M1's chart no longer runs three, four and then five strokes to the bar",
  );
});

test("the longest gap in a bar shrinks as the chart runs", () => {
  // The stealth consequence of the density curve, and it is emergent rather than
  // authored. The field only begins forgiving a noise after `decayHoldTicks` of
  // silence, so the loose opening bars let an early mistake bleed off and the
  // closing bar — where nothing is longer than a pulse — lets nothing bleed off
  // at all. The chart is at its most expensive exactly where it is hardest.
  for (let seed = 0; seed < 2000; seed++) {
    const chart = deriveChart(M1_HANDBILL_CHART, seed);
    let cell = 1;
    let previous = Number.POSITIVE_INFINITY;
    for (const phase of M1_HANDBILL_CHART.phases) {
      const strokes = phase.bars * phaseStrokesPerBar(phase);
      const longest = Math.max(
        ...chart.cells.slice(cell, cell + strokes).map((entry) => CELL_TICKS[entry]),
      );
      assert.ok(
        longest <= previous,
        `seed ${seed}: phase ${phase.id} has a ${longest}t gap after a ${previous}t one`,
      );
      previous = longest;
      cell += strokes;
    }
  }
});

test("every beat lands on the half-pulse grid, and every bar line on the bar", () => {
  // The grid is what a player entrains to. A chart with an off-grid beat would
  // make prediction impossible for that one stroke, which at a 33ms top window
  // is indistinguishable from the game cheating.
  for (const seed of SEEDS) {
    const chart = deriveChart(M1_HANDBILL_CHART, seed);
    for (const offset of chart.offsets) {
      assert.equal(offset % HALF_PULSE_TICKS, 0, `seed ${seed}: ${offset}t is off the grid`);
    }
    // Every bar line is also a stroke: figures fill the bar exactly, so there is
    // a hammer blow on the downbeat every 1.6 seconds whatever the seed drew.
    for (const downbeat of chart.downbeats) {
      assert.ok(
        chart.offsets.includes(downbeat),
        `seed ${seed}: no stroke on the downbeat at ${downbeat}t`,
      );
    }
    assert.equal(chart.downbeats[chart.downbeats.length - 1], chart.spanTicks);
  }
});

test("offsets ascend and the opener is at zero", () => {
  for (const seed of SEEDS) {
    const chart = deriveChart(M1_HANDBILL_CHART, seed);
    assert.equal(chart.offsets[0], 0);
    assert.equal(chart.judgedBeats, chart.offsets.length - 1);
    for (let index = 1; index < chart.offsets.length; index++) {
      assert.ok(
        chart.offsets[index]! > chart.offsets[index - 1]!,
        `seed ${seed} has a non-ascending offset at ${index}`,
      );
    }
    assert.equal(chart.spanTicks, chart.offsets[chart.offsets.length - 1]);
  }
});

test("the lane never has to carry more marks than a player can read", () => {
  // The readability budget. A mark is visible for one approach, so a dense bar
  // puts several on the lane at once — which is what a dense bar is FOR, and is
  // also the thing that stops being legible if a chart overdoes it. Four is the
  // most the half-pulse grid can produce without two spikes touching, which the
  // draw already refuses.
  for (let seed = 0; seed < 2000; seed++) {
    const peak = peakMarksInFlight(deriveChart(M1_HANDBILL_CHART, seed));
    assert.ok(peak <= 4, `seed ${seed} put ${peak} marks on the lane at once`);
  }
});

// ---- the figure library ----------------------------------------------------

test("every figure in the library fills exactly one bar", () => {
  // A figure that did not would move every downbeat after it, and the chart
  // would silently stop being the length it charges the mission clock for.
  for (const [name, figures] of LIBRARY) {
    for (const entry of figures) {
      assert.equal(figureTicks(entry), BAR_TICKS, `${name}: ${entry.id} is the wrong length`);
    }
  }
});

test("every figure in the library is one density, and its id is its rhythm", () => {
  for (const [name, figures, strokes] of LIBRARY) {
    const ids = new Set<string>();
    for (const entry of figures) {
      assert.equal(entry.cells.length, strokes, `${name}: ${entry.id} has the wrong count`);
      assert.equal(entry.id.length, strokes, `${name}: ${entry.id} does not spell itself`);
      assert.equal(ids.has(entry.id), false, `${name} lists ${entry.id} twice`);
      ids.add(entry.id);
    }
  }
});

test("spike density rises with the library and never doubles up", () => {
  // Three to the bar carries none, four carries at most one, five carries
  // exactly two — so how spiky a bar is follows the phase rather than jumping.
  const spikes = (entry: BeatFigure): number =>
    entry.cells.filter((cell) => cell === "DOUBLE").length;
  assert.ok(THREE_TO_THE_BAR.every((entry) => spikes(entry) === 0));
  assert.ok(FOUR_TO_THE_BAR.every((entry) => spikes(entry) <= 1));
  assert.ok(FIVE_TO_THE_BAR.every((entry) => spikes(entry) === 2));
  for (const [name, figures] of LIBRARY) {
    for (const entry of figures) {
      for (let index = 1; index < entry.cells.length; index++) {
        assert.ok(
          !(entry.cells[index] === "DOUBLE" && entry.cells[index - 1] === "DOUBLE"),
          `${name}: ${entry.id} puts two spikes together`,
        );
      }
    }
  }
});

test("no library set can be emptied by the cross-bar adjacency filter", () => {
  // The draw withdraws figures that open on a spike when the previous bar closed
  // on one. If a set were entirely spike-opening the draw would have to fall
  // back and break its own rule, so every set keeps some other way in.
  for (const [name, figures] of LIBRARY) {
    assert.ok(
      figures.some((entry) => entry.cells[0] !== "DOUBLE"),
      `every figure in ${name} opens on the spike`,
    );
  }
});

// ---- authoring guards ------------------------------------------------------

function authoring(overrides: Partial<BeatChartAuthoring> = {}): BeatChartAuthoring {
  return {
    id: "test",
    barTicks: BAR_TICKS,
    openingCell: "LONG",
    spikeCell: "DOUBLE",
    phases: [
      { id: "A", bars: 1, figures: evenly(THREE_TO_THE_BAR) },
      { id: "B", bars: 1, figures: evenly(FIVE_TO_THE_BAR) },
    ],
    ...overrides,
  };
}

function defects(overrides: Partial<BeatChartAuthoring>): string[] {
  return chartSpecDefects(defineChart(authoring(overrides)));
}

test("the fixture the guards are tested against is itself clean", () => {
  assert.deepEqual(chartSpecDefects(defineChart(authoring())), []);
});

test("a figure that does not fill the bar is refused", () => {
  const found = defects({
    phases: [
      { id: "A", bars: 1, figures: evenly([figure("PULSE", "PULSE")]) },
      { id: "B", bars: 1, figures: evenly(FIVE_TO_THE_BAR) },
    ],
  });
  assert.ok(
    found.some((defect) => defect.includes("no longer be the length it claims")),
    `expected a bar-length defect, got: ${found.join(" | ")}`,
  );
});

test("a phase that mixes densities is refused", () => {
  // How many strokes the chart asks for would otherwise depend on the seed, and
  // no two attempts would be the same test.
  const found = defects({
    phases: [
      {
        id: "A",
        bars: 1,
        figures: evenly([...THREE_TO_THE_BAR, figure("PULSE", "PULSE", "PULSE", "PULSE")]),
      },
      { id: "B", bars: 1, figures: evenly(FIVE_TO_THE_BAR) },
    ],
  });
  assert.ok(
    found.some((defect) => defect.includes("mixes densities")),
    `expected a density defect, got: ${found.join(" | ")}`,
  );
});

test("a chart that gets easier as it goes is refused", () => {
  const found = defects({
    phases: [
      { id: "A", bars: 1, figures: evenly(FIVE_TO_THE_BAR) },
      { id: "B", bars: 1, figures: evenly(THREE_TO_THE_BAR) },
    ],
  });
  assert.ok(
    found.some((defect) => defect.includes("warm-up arrives after the test")),
    `expected a curve defect, got: ${found.join(" | ")}`,
  );
});

test("a chart with a phase that has no teeth anywhere is refused", () => {
  const found = defects({
    phases: [
      { id: "A", bars: 1, figures: evenly(THREE_TO_THE_BAR) },
      { id: "B", bars: 1, figures: evenly([figure("PULSE", "PULSE", "PULSE", "PULSE")]) },
    ],
  });
  assert.ok(
    found.some((defect) => defect.includes("free pass")),
    `expected a spike-guarantee defect, got: ${found.join(" | ")}`,
  );
});

test("a chart that is hardest while it is still teaching is refused", () => {
  const found = defects({
    phases: [
      { id: "A", bars: 1, figures: evenly(FIVE_TO_THE_BAR) },
      { id: "B", bars: 1, figures: evenly(FIVE_TO_THE_BAR) },
    ],
  });
  assert.ok(
    found.some((defect) => defect.includes("still teaching")),
    `expected an opening-phase defect, got: ${found.join(" | ")}`,
  );
});

test("an opening gap shorter than the approach is refused", () => {
  const found = defects({ openingCell: "PULSE" });
  assert.ok(
    found.some((defect) => defect.includes("how fast a mark travels")),
    `expected an opening-gap defect, got: ${found.join(" | ")}`,
  );
});

test("a spec whose opening gap is the spike is refused", () => {
  // The opening gap is the only thing that teaches the read. Making it the
  // hardest cell in the vocabulary would put the spike before the lesson.
  const found = defects({ openingCell: "DOUBLE" });
  assert.ok(
    found.some((defect) => defect.includes("nothing has taught them the read")),
    `expected a spiked-opening defect, got: ${found.join(" | ")}`,
  );
});

test("a figure with two spikes back to back is refused", () => {
  const found = defects({
    phases: [
      { id: "A", bars: 1, figures: evenly(THREE_TO_THE_BAR) },
      {
        id: "B",
        bars: 1,
        figures: evenly([figure("DOUBLE", "DOUBLE", "PULSE", "PULSE", "SWING")]),
      },
    ],
  });
  assert.ok(
    found.some((defect) => defect.includes("tremolo")),
    `expected a tremolo defect, got: ${found.join(" | ")}`,
  );
});

test("a phase whose every figure opens on the spike is refused", () => {
  const found = defects({
    phases: [
      { id: "A", bars: 1, figures: evenly(THREE_TO_THE_BAR) },
      {
        id: "B",
        bars: 2,
        figures: evenly(FIVE_TO_THE_BAR.filter((entry) => entry.cells[0] === "DOUBLE")),
      },
    ],
  });
  assert.ok(
    found.some((defect) => defect.includes("no legal successor")),
    `expected an adjacency-deadlock defect, got: ${found.join(" | ")}`,
  );
});

test("a weight aimed at a figure that is not in the set throws", () => {
  // A weight silently applied to nothing shows up only as a chart that feels
  // subtly wrong, which is the least debuggable kind of tuning mistake there is.
  assert.throws(() => weighted(THREE_TO_THE_BAR, { PPPP: 3 }), /not in this set/);
  assert.doesNotThrow(() => weighted(FOUR_TO_THE_BAR, { PPPP: 3 }));
});

test("the shipped chart specs have no defects", () => {
  assert.deepEqual(chartSpecDefects(M1_HANDBILL_CHART), []);
  assert.deepEqual(chartSpecDefects(M1_SECOND_BEAT_CHART), []);
});

test("the cell vocabulary is whole half-pulses and fits the bar", () => {
  for (const [cell, cellTicks] of Object.entries(CELL_TICKS)) {
    assert.equal(cellTicks % HALF_PULSE_TICKS, 0, `${cell} is off the grid`);
    assert.ok(cellTicks > 0, `${cell} has no length`);
    assert.ok(cellTicks <= BAR_TICKS, `${cell} is longer than a whole bar`);
  }
});
