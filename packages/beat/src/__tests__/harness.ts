// Driving a reaction beat from a test, on the same fixed clock the mission uses.
//
// Every test in this package plays the run tick by tick rather than calling into
// its internals, so what is measured is the machine a mission would actually
// mount. A "player" here is a plan: which flares they strike, which they let
// fade, and any strikes at the wrong cell.

import assert from "node:assert/strict";
import {
  createBeatRun,
  stepBeat,
  type BeatEvent,
  type BeatOutcome,
  type BeatRun,
} from "../machine.js";
import { deriveSchedule, type ReactionSchedule } from "../schedule.js";
import type { NoiseEvent } from "../engine.js";
import type { BeatSpec } from "../spec.js";

export interface PlayPlan {
  /** Flare indices the player never clicks. They fade to a miss. */
  readonly dropped?: readonly number[];
  /**
   * Flare indices the player clicks on the WRONG cell while they are up. Each
   * one costs a stray AND then fades to a miss, since it is never struck true.
   */
  readonly wrongCell?: readonly number[];
  /** Ticks after a flare spawns at which the player clicks it. Default 6. */
  readonly hitOffset?: number;
  /** Absolute tick the player steps out of the stance. */
  readonly leaveAt?: number;
  /** Absolute tick the container tears the run down. */
  readonly abandonAt?: number;
}

export interface PlayResult {
  readonly schedule: ReactionSchedule;
  readonly run: BeatRun;
  readonly outcome: BeatOutcome;
  readonly events: readonly BeatEvent[];
  readonly noise: readonly NoiseEvent[];
  readonly elapsedTicks: number;
}

/** For each tick, the cell the plan clicks on that tick (at most one). */
export function clickSchedule(
  spec: BeatSpec,
  seed: number,
  plan: PlayPlan,
): { clicks: Map<number, number>; schedule: ReactionSchedule } {
  const schedule = deriveSchedule(spec.reaction, seed);
  const dropped = new Set(plan.dropped ?? []);
  const wrong = new Set(plan.wrongCell ?? []);
  const offset = plan.hitOffset ?? 6;
  const clicks = new Map<number, number>();
  for (const target of schedule.targets) {
    if (dropped.has(target.index)) continue;
    const cell = wrong.has(target.index)
      ? (target.cell + 1) % spec.reaction.cellCount
      : target.cell;
    // Arm is at tick 0, so a flare is live from its spawn offset.
    const tick = target.spawnTick + offset;
    assert.equal(clicks.has(tick), false, `the plan clicks twice on tick ${tick}`);
    clicks.set(tick, cell);
  }
  return { clicks, schedule };
}

/** Play a whole run and return everything it produced. Arms at tick 0. */
export function playBeat(spec: BeatSpec, seed: number, plan: PlayPlan = {}): PlayResult {
  const { clicks, schedule } = clickSchedule(spec, seed, plan);
  let run = createBeatRun(spec, seed);
  const events: BeatEvent[] = [];
  const noise: NoiseEvent[] = [];

  const limit = schedule.spanTicks + spec.verb.settleTicks + 600;
  let outcome: BeatOutcome | null = null;
  for (let tick = 0; tick <= limit && outcome === null; tick++) {
    const step = stepBeat(run, {
      tick,
      hitCell: clicks.get(tick) ?? null,
      inStance: plan.leaveAt === undefined || tick < plan.leaveAt,
      abandon: plan.abandonAt !== undefined && tick >= plan.abandonAt,
    });
    run = step.run;
    events.push(...step.events);
    noise.push(...step.noise);
    outcome = step.outcome;
  }

  assert.ok(outcome, "the run never resolved; the machine has a state with no exit");
  return { schedule, run, outcome, events, noise, elapsedTicks: outcome.elapsedTicks };
}

/** A plan that strikes every flare. */
export function perfectPlan(): PlayPlan {
  return {};
}
