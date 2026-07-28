// Determinism, checked two ways: by replaying a run, and by reading the source.
//
// The netcode agent's replay and the PvP authority both depend on a simulation
// being a pure function of (seed, tick stream). A single wall-clock read anywhere
// in this package would break that quietly — the beat would still play, and only
// a replay taken on a different machine would disagree.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSchedule } from "../schedule.js";
import { m1NailStanceBeat } from "../m1NailStance.js";
import { playBeat } from "./harness.js";

const SPEC = m1NailStanceBeat();
const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

const PLAN = { dropped: [2], wrongCell: [4] };

test("the same seed and the same play replay exactly", () => {
  for (const seed of [0, 5, 4242, 0xcafebabe]) {
    const first = playBeat(SPEC, seed, PLAN);
    const second = playBeat(SPEC, seed, PLAN);
    assert.deepEqual(second.events, first.events, `seed ${seed} events diverged`);
    assert.deepEqual(second.noise, first.noise, `seed ${seed} noise diverged`);
    assert.deepEqual(second.outcome, first.outcome, `seed ${seed} outcome diverged`);
  }
});

test("re-entering the stance draws the same schedule, so it cannot be fished for", () => {
  // Leaving and coming back must not re-roll. A player who could re-roll would
  // simply leave until the flares fell somewhere easy, and the act would be free.
  const seed = 808;
  const abandoned = playBeat(SPEC, seed, {
    leaveAt: deriveSchedule(SPEC.reaction, seed).targets[1]!.spawnTick + 1,
  });
  assert.equal(abandoned.outcome.abandoned, true);
  const retried = deriveSchedule(SPEC.reaction, seed);
  assert.deepEqual(retried.targets, abandoned.schedule.targets);
});

test("the schedule is what makes two seeds play differently", () => {
  const a = deriveSchedule(SPEC.reaction, 101);
  const b = deriveSchedule(SPEC.reaction, 202);
  const cellsA = a.targets.map((target) => target.cell).join(",");
  const cellsB = b.targets.map((target) => target.cell).join(",");
  assert.notEqual(cellsA, cellsB, "two seeds drew the same flares");
});

test("the same seed always draws the same flares, cell for cell and tick for tick", () => {
  for (const seed of [0, 1, 99, 4242]) {
    assert.deepEqual(
      deriveSchedule(SPEC.reaction, seed).targets,
      deriveSchedule(SPEC.reaction, seed).targets,
    );
  }
});

test("a flare never lands on the cell the one before it used", () => {
  for (const seed of [0, 1, 2, 3, 17, 88, 404, 2025]) {
    const targets = deriveSchedule(SPEC.reaction, seed).targets;
    for (let index = 1; index < targets.length; index++) {
      assert.notEqual(
        targets[index]!.cell,
        targets[index - 1]!.cell,
        `seed ${seed}: flare ${index} repeated the previous cell`,
      );
    }
  }
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

test("every schedule tick is an integer number of ticks", () => {
  const schedule = deriveSchedule(SPEC.reaction, 1);
  for (const target of schedule.targets) {
    assert.equal(Number.isInteger(target.spawnTick), true, `${target.spawnTick} is fractional`);
    assert.equal(Number.isInteger(target.expireTick), true, `${target.expireTick} is fractional`);
  }
  assert.equal(Number.isInteger(SPEC.verb.settleTicks), true);
});
