// The read. These tests pin what the holographic panel is handed, because if it
// is wrong the mechanic is unplayable in a way no simulation test would notice.

import assert from "node:assert/strict";
import test from "node:test";
import { createBeatRun, stepBeat, type BeatRun } from "../machine.js";
import { beatPresentation } from "../presentation.js";
import { deriveSchedule } from "../schedule.js";
import { m1NailStanceBeat } from "../m1NailStance.js";

const SPEC = m1NailStanceBeat();

function armed(seed: number, at = 0): BeatRun {
  return stepBeat(createBeatRun(SPEC, seed), { tick: at, hitCell: null, inStance: true }).run;
}

test("the panel has a cell per authored cell and lights the live one", () => {
  const seed = 7;
  const schedule = deriveSchedule(SPEC.reaction, seed);
  const run = armed(seed);
  const first = schedule.targets[0]!;
  // Mid-window on the first flare: exactly one cell is active, and it is the
  // flare's cell.
  const view = beatPresentation(run, first.spawnTick + 10);
  assert.equal(view.cells.length, SPEC.reaction.cellCount);
  assert.equal(view.activeCell, first.cell);
  assert.equal(view.cells.filter((cell) => cell.active).length, 1);
  assert.equal(view.cells[first.cell]!.active, true);
});

test("nothing is lit before the lead or during a gap", () => {
  const seed = 7;
  const schedule = deriveSchedule(SPEC.reaction, seed);
  const run = armed(seed);
  // Inside the lead, before the first flare.
  assert.equal(beatPresentation(run, 1).activeCell, null);
  // Just after the first flare fades, before the second appears.
  const gapTick = schedule.targets[0]!.expireTick + 2;
  if (gapTick < schedule.targets[1]!.spawnTick) {
    assert.equal(beatPresentation(run, gapTick).activeCell, null);
  }
});

test("the live flare's remaining window runs from 1 down to 0", () => {
  const seed = 7;
  const schedule = deriveSchedule(SPEC.reaction, seed);
  const run = armed(seed);
  const first = schedule.targets[0]!;
  assert.equal(beatPresentation(run, first.spawnTick).activeRemaining01, 1);
  const mid = beatPresentation(run, first.spawnTick + SPEC.reaction.windowTicks / 2);
  assert.ok(Math.abs(mid.activeRemaining01 - 0.5) < 1e-9);
  assert.equal(beatPresentation(run, first.expireTick).activeRemaining01, 0);
});

test("the whole panel is present in stance, before the run arms", () => {
  const run = createBeatRun(SPEC, 7);
  const view = beatPresentation(run, 0);
  assert.equal(view.phase, "STANCE");
  assert.equal(view.cells.length, SPEC.reaction.cellCount);
  assert.equal(view.activeCell, null);
  assert.equal(view.total, SPEC.reaction.targetCount);
  assert.equal(view.struck, 0);
  assert.equal(view.remaining, SPEC.reaction.targetCount);
  assert.equal(view.remainingTicks, null);
});

test("the tally counts strikes as they land and the last result flashes", () => {
  const seed = 7;
  const schedule = deriveSchedule(SPEC.reaction, seed);
  let run = armed(seed);
  const first = schedule.targets[0]!;
  run = stepBeat(run, {
    tick: first.spawnTick + 5,
    hitCell: first.cell,
    inStance: true,
  }).run;
  const view = beatPresentation(run, first.spawnTick + 5);
  assert.equal(view.struck, 1);
  assert.equal(view.remaining, SPEC.reaction.targetCount - 1);
  assert.equal(view.lastResult, "HIT");
  assert.ok(view.quality01 < 1, "a run one strike in has not scored full");
});

test("a faded flare flashes as a miss and is heard", () => {
  const seed = 7;
  const schedule = deriveSchedule(SPEC.reaction, seed);
  let run = armed(seed);
  const first = schedule.targets[0]!;
  // Step past the first flare's window without clicking.
  run = stepBeat(run, { tick: first.expireTick + 1, hitCell: null, inStance: true }).run;
  const view = beatPresentation(run, first.expireTick + 1);
  assert.equal(view.lastResult, "MISS");
  assert.equal(view.heard, true, "a fumbled tack is loud");
});

test("the countdown to the resolve is available from the moment of arming", () => {
  const run = armed(7, 100);
  const view = beatPresentation(run, 100);
  assert.ok(view.remainingTicks !== null && view.remainingTicks > 0);
  assert.equal(view.remainingTicks, run.resolveAtTick! - 100);
});
