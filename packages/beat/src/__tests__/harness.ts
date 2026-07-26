// Driving a beat from a test, on the same fixed clock the mission uses.
//
// Every test in this package plays the run tick by tick rather than calling into
// its internals, so what is measured is the machine a mission would actually
// mount. A "player" here is a plan: which beats they strike, how many ticks off
// they are on each, and any extra swings they take at nothing.

import assert from "node:assert/strict";
import { deriveChart, type BeatChart } from "../chart.js";
import {
  createBeatRun,
  stepBeat,
  type BeatEvent,
  type BeatOutcome,
  type BeatRun,
} from "../machine.js";
import type { NoiseEvent } from "../engine.js";
import type { BeatSpec } from "../spec.js";

export interface PlayPlan {
  /** Tick the opening stroke lands on. */
  readonly armAt?: number;
  /**
   * Signed tick offset per judged beat, in chart order. Negative is early, null
   * means the player never swings at that beat.
   */
  readonly offsets: readonly (number | null)[];
  /** Absolute ticks the player swings at nothing. */
  readonly extraPresses?: readonly number[];
  /** Tick the player steps out of the stance. */
  readonly leaveAt?: number;
  /** Tick the container tears the run down. */
  readonly abandonAt?: number;
}

export interface PlayResult {
  readonly chart: BeatChart;
  readonly run: BeatRun;
  readonly outcome: BeatOutcome;
  readonly events: readonly BeatEvent[];
  readonly noise: readonly NoiseEvent[];
  /** Ticks the run took from the opening stroke to the resolve. */
  readonly elapsedTicks: number;
}

/** Every tick the plan presses on, and the beat each press is aimed at. */
export function pressSchedule(
  spec: BeatSpec,
  seed: number,
  plan: PlayPlan,
): { armAt: number; presses: Set<number>; chart: BeatChart } {
  const chart = deriveChart(spec.chart, seed);
  const armAt = plan.armAt ?? 10;
  const presses = new Set<number>([armAt]);
  plan.offsets.forEach((offset, index) => {
    if (offset === null) return;
    const beat = chart.offsets[index + 1];
    if (beat === undefined) return;
    const tick = armAt + beat + offset;
    assert.equal(
      presses.has(tick),
      false,
      `the plan presses twice on tick ${tick}; a tick carries at most one stroke`,
    );
    presses.add(tick);
  });
  for (const tick of plan.extraPresses ?? []) {
    assert.equal(
      presses.has(tick),
      false,
      `the plan's extra press on tick ${tick} collides with a scheduled stroke`,
    );
    presses.add(tick);
  }
  return { armAt, presses, chart };
}

/** Play a whole run and return everything it produced. */
export function playBeat(spec: BeatSpec, seed: number, plan: PlayPlan): PlayResult {
  const { armAt, presses, chart } = pressSchedule(spec, seed, plan);
  let run = createBeatRun(spec, seed);
  const events: BeatEvent[] = [];
  const noise: NoiseEvent[] = [];

  // Generous bound: the machine's own backstop is span + window + settle, and a
  // run that has not ended well before this has a stuck state rather than a slow
  // one. The assertion below is the point of the bound.
  const limit = armAt + chart.spanTicks + 600;
  let outcome: BeatOutcome | null = null;
  for (let tick = 0; tick <= limit && outcome === null; tick++) {
    const step = stepBeat(run, {
      tick,
      strike: presses.has(tick),
      inStance: plan.leaveAt === undefined || tick < plan.leaveAt,
      abandon: plan.abandonAt !== undefined && tick >= plan.abandonAt,
    });
    run = step.run;
    events.push(...step.events);
    noise.push(...step.noise);
    outcome = step.outcome;
  }

  assert.ok(outcome, "the run never resolved; the machine has a state with no exit");
  return {
    chart,
    run,
    outcome,
    events,
    noise,
    elapsedTicks: outcome.elapsedTicks,
  };
}

/** A plan that centres every judged beat. */
export function perfectPlan(spec: BeatSpec, seed: number): PlayPlan {
  const chart = deriveChart(spec.chart, seed);
  return { offsets: new Array<number>(chart.judgedBeats).fill(0) };
}

/** A plan that strikes every judged beat at a fixed offset. */
export function uniformPlan(
  spec: BeatSpec,
  seed: number,
  offsetTicks: number,
): PlayPlan {
  const chart = deriveChart(spec.chart, seed);
  return { offsets: new Array<number>(chart.judgedBeats).fill(offsetTicks) };
}
