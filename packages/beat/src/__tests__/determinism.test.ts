// Determinism, checked two ways: by replaying a run, and by reading the source.
//
// The netcode agent's replay and the PvP authority both depend on a simulation
// being a pure function of (seed, tick stream). A single wall-clock read
// anywhere in this package would break that quietly — the beat would still play,
// and only a replay taken on a different machine would disagree.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveChart } from "../chart.js";
import { m1NailStanceBeat } from "../m1NailStance.js";
import { playBeat } from "./harness.js";

const SPEC = m1NailStanceBeat();
const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

const PLAN = {
  armAt: 17,
  offsets: [0, -3, 7, null, 2] as (number | null)[],
  extraPresses: [10],
};

test("the same seed and the same presses replay exactly", () => {
  for (const seed of [0, 5, 4242, 0xcafebabe]) {
    const first = playBeat(SPEC, seed, PLAN);
    const second = playBeat(SPEC, seed, PLAN);
    assert.deepEqual(second.events, first.events, `seed ${seed} events diverged`);
    assert.deepEqual(second.noise, first.noise, `seed ${seed} noise diverged`);
    assert.deepEqual(second.outcome, first.outcome, `seed ${seed} outcome diverged`);
  }
});

test("re-entering the stance draws the same chart, so a chart cannot be fished for", () => {
  // Leaving and coming back must not re-roll. A player who could re-roll would
  // simply leave until they drew a chart with its double at the front, and the
  // skill expression would evaporate.
  const seed = 808;
  const abandoned = playBeat(SPEC, seed, {
    armAt: 0,
    offsets: [0, 0, 0, 0, 0],
    leaveAt: 30,
  });
  assert.equal(abandoned.outcome.abandoned, true);
  const retried = deriveChart(SPEC.chart, seed);
  assert.deepEqual(retried.cells, abandoned.chart.cells);
  assert.deepEqual(retried.offsets, abandoned.chart.offsets);
});

test("the chart is what makes two seeds play differently", () => {
  // The same press plan against two seeds produces different results, which is
  // the property that makes a retry a fresh test of skill rather than a repeat.
  const a = playBeat(SPEC, 101, PLAN);
  const b = playBeat(SPEC, 202, PLAN);
  assert.notDeepEqual(a.chart.cells, b.chart.cells);
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("no wall clock and no unseeded randomness anywhere in the package", () => {
  // scripts/check-boundaries.mjs already refuses Math.random repo-wide. The
  // clock reads are this package's own promise and nothing enforces them from
  // outside, so they are enforced from inside.
  const banned: Array<[RegExp, string]> = [
    [/\bDate\s*\.\s*now\s*\(/, "Date.now"],
    [/\bperformance\s*\.\s*now\s*\(/, "performance.now"],
    [/\bsetTimeout\s*\(/, "setTimeout"],
    [/\bsetInterval\s*\(/, "setInterval"],
    [/\brequestAnimationFrame\s*\(/, "requestAnimationFrame"],
    [/\bnew\s+Date\s*\(/, "new Date"],
    [/\bMath\s*\.\s*random\s*\(/, "Math.random"],
  ];
  const offences: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      // Comments talk about these on purpose; only code counts.
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      for (const [pattern, name] of banned) {
        if (pattern.test(code)) {
          offences.push(`${file.slice(SRC.length + 1)}:${index + 1} uses ${name}`);
        }
      }
    });
  }
  assert.deepEqual(offences, []);
});

test("every timing constant is an integer number of ticks", () => {
  // A fractional window would round differently at two call sites, and the
  // difference would only ever show up as a replay that disagrees by one frame.
  const chart = deriveChart(SPEC.chart, 1);
  for (const offset of chart.offsets) {
    assert.equal(Number.isInteger(offset), true, `${offset} is not a whole tick`);
  }
  assert.equal(Number.isInteger(SPEC.verb.settleTicks), true);
});
