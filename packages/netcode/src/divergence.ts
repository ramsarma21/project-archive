// Desync DETECTION, and the reduction of a detection to a reproducible case.
//
// The brief for this file is one sentence: a divergence report must be reducible
// to a failing test. Everything below is in service of that.
//
// WHY DETECTION AND NOT ONLY AVOIDANCE. Server authority prevents a desync from
// deciding a match — the server's answer is the answer, always — but it does not
// prevent a client from RENDERING something different from what the server
// resolved, and that is what a player experiences as "he shot me but I dodged on
// my screen". Without instrumentation that report is unfalsifiable: there is no
// artefact, no tick, no state, nothing to argue with. With it, the same complaint
// arrives as a tick number, two digests, a named field and a delta.
//
// THE REPORT IS WRITTEN BY THE SERVER, NOT BY THE CLIENT. A client contributes one
// claim — "at tick 412 I had digest X" — and the server, which holds the baseline
// state and the accepted input log, writes everything else. That ordering matters
// for two reasons. It keeps the reproduction inputs authoritative rather than
// self-reported, so a lying client cannot manufacture a plausible-looking case.
// And it means the instrument cannot become a lever: the worst a modified client
// achieves by reporting nonsense is a divergence record with its own side on it.
//
// WHAT A REPORT CARRIES, AND WHY EACH PART. A baseline state, because a replay
// needs somewhere to start. The exact per-tick intents from the baseline to the
// divergent tick, because those are the only other input. The expected hash chain,
// because that is what the replay is checked against. And a field-level diff of
// the two states, because "the hashes differ" is a fact and "A.pos.x differs by
// 3.4e-13 and A.motion.phase differs GROUNDED/DASH" is a lead.

import {
  stepCombat,
  type BySide,
  type CombatIntent,
  type CombatParams,
  type CombatState,
  type CollisionWorld,
  type DuelSide,
  type FighterState,
} from "@pa/duel";
import { hashCombatState, hashSelf, type StateHash } from "./hash.js";
import {
  checkpointBefore,
  intentsBetween,
  recordAt,
  type TickHistory,
} from "./history.js";

export type DivergenceKind =
  /** A client's digest of its own body disagrees with the server's. */
  | "CLIENT_SELF_MISMATCH"
  /** A replay of the server's own input log did not reproduce the server. */
  | "SERVER_REPLAY_MISMATCH";

/**
 * A recorded step of the reproduction. Intents are plain data — @pa/duel's
 * `CombatIntent` is eleven scalars and a string — so this serialises as-is.
 */
export interface ReplayStep {
  readonly tick: number;
  readonly intents: BySide<CombatIntent>;
}

export interface DivergenceReport {
  readonly kind: DivergenceKind;
  readonly matchId: string;
  readonly seed: number;
  /** The side whose view disagreed. Null for a server self-check. */
  readonly side: DuelSide | null;
  readonly tick: number;
  readonly round: number;
  readonly expectedHash: StateHash;
  readonly reportedHash: StateHash;
  /** Where a replay starts: the last checkpoint at or before the divergence. */
  readonly baselineTick: number;
  readonly baseline: CombatState;
  /** Every tick from baseline+1 to `tick`, with the intents actually applied. */
  readonly steps: readonly ReplayStep[];
  /** The server's per-tick digests over the same span, for a bisect. */
  readonly expectedChain: readonly { tick: number; stateHash: StateHash }[];
  /** Ability ids in play, so a persisted report can rebuild the loadouts. */
  readonly abilityIds: BySide<readonly string[]>;
  readonly observedAtMs: number;
  readonly note: string;
}

export interface BuildReportInput {
  readonly kind: DivergenceKind;
  readonly matchId: string;
  readonly seed: number;
  readonly side: DuelSide | null;
  readonly tick: number;
  readonly round: number;
  readonly history: TickHistory;
  readonly reportedHash: StateHash;
  readonly params: CombatParams;
  readonly observedAtMs: number;
  readonly note?: string;
}

/**
 * Build a reproducible report, or explain why the divergence cannot be reproduced.
 *
 * A null return is not a silent failure: it means the tick fell outside the
 * retained window, which is itself worth logging, because a client reporting on a
 * tick from two rounds ago is either badly clocked or being interesting.
 */
export function buildDivergenceReport(input: BuildReportInput): DivergenceReport | null {
  const record = recordAt(input.history, input.tick);
  if (!record) return null;
  const baseline = checkpointBefore(input.history, input.tick);
  if (!baseline) return null;

  const expectedHash =
    input.side === null ? record.stateHash : record.selfHashes[input.side];
  const steps = intentsBetween(input.history, baseline.tick, input.tick).map((entry) => ({
    tick: entry.tick,
    intents: entry.intents,
  }));
  const expectedChain: { tick: number; stateHash: StateHash }[] = [];
  for (const entry of input.history.records) {
    if (entry.tick > baseline.tick && entry.tick <= input.tick) {
      expectedChain.push({ tick: entry.tick, stateHash: entry.stateHash });
    }
  }

  return {
    kind: input.kind,
    matchId: input.matchId,
    seed: input.seed,
    side: input.side,
    tick: input.tick,
    round: input.round,
    expectedHash,
    reportedHash: input.reportedHash,
    baselineTick: baseline.tick,
    baseline: baseline.state,
    steps,
    expectedChain,
    abilityIds: {
      A: input.params.A.loadout.map((ability) => ability.abilityId),
      B: input.params.B.loadout.map((ability) => ability.abilityId),
    },
    observedAtMs: input.observedAtMs,
    note: input.note ?? "",
  };
}

export interface ReplayOutcome {
  /** The state the replay produced at the report's tick. */
  readonly state: CombatState;
  readonly stateHash: StateHash;
  readonly selfHash: BySide<StateHash>;
  /**
   * The first tick at which the replay's digest left the server's recorded chain,
   * or null when the replay reproduced the server exactly.
   *
   * Non-null means the SERVER is non-deterministic, which is a far more serious
   * finding than a client disagreeing, and the reason a replay checks the whole
   * chain rather than only the endpoint.
   */
  readonly firstChainMismatch: number | null;
  /** True when the replay agrees with what the client claimed. */
  readonly reproducesReportedHash: boolean;
}

/**
 * Re-derive the report by driving @pa/duel's own `stepCombat` over the recorded
 * inputs. This is the whole reduction: a report plus this function is a test.
 *
 * The world and the resolved ability loadouts are passed in rather than carried in
 * the report, because a CollisionWorld is arena content and a loadout holds
 * functions. Both are reconstructible from ids by the caller, and requiring them
 * explicitly is what keeps this package free of content and of the ability
 * catalogue.
 */
export function replayDivergence(
  report: DivergenceReport,
  context: { readonly world: CollisionWorld; readonly params: CombatParams },
): ReplayOutcome {
  let state = report.baseline;
  let firstChainMismatch: number | null = null;

  for (const step of report.steps) {
    const stepped = stepCombat(
      context.world,
      state,
      step.intents,
      context.params,
      report.round,
    );
    state = stepped.state;
    const expected = report.expectedChain.find((entry) => entry.tick === state.tick);
    if (
      firstChainMismatch === null &&
      expected &&
      expected.stateHash !== hashCombatState(state)
    ) {
      firstChainMismatch = state.tick;
    }
  }

  const stateHash = hashCombatState(state);
  const selfHash: BySide<StateHash> = {
    A: hashSelf(state.fighters.A),
    B: hashSelf(state.fighters.B),
  };
  const derived = report.side === null ? stateHash : selfHash[report.side];
  return {
    state,
    stateHash,
    selfHash,
    firstChainMismatch,
    reproducesReportedHash: derived === report.reportedHash,
  };
}

// ---- field-level diffing ----------------------------------------------------

export interface FieldDifference {
  readonly path: string;
  readonly left: string;
  readonly right: string;
  /** Absolute difference, for numeric fields. Null for everything else. */
  readonly delta: number | null;
}

function pushNumber(
  out: FieldDifference[],
  path: string,
  left: number,
  right: number,
): void {
  // Exact comparison on purpose. A tolerance here would hide the one-ulp
  // difference that is the entire thing this file is looking for.
  if (Object.is(left, right)) return;
  out.push({
    path,
    left: String(left),
    right: String(right),
    delta: Math.abs(left - right),
  });
}

function pushValue(
  out: FieldDifference[],
  path: string,
  left: string | boolean | null,
  right: string | boolean | null,
): void {
  if (left === right) return;
  out.push({ path, left: String(left), right: String(right), delta: null });
}

function diffFighter(
  out: FieldDifference[],
  prefix: string,
  left: FighterState,
  right: FighterState,
): void {
  pushValue(out, `${prefix}.motion.phase`, left.motion.phase, right.motion.phase);
  for (const axis of ["x", "y", "z"] as const) {
    pushNumber(out, `${prefix}.motion.pos.${axis}`, left.motion.pos[axis], right.motion.pos[axis]);
    pushNumber(out, `${prefix}.motion.vel.${axis}`, left.motion.vel[axis], right.motion.vel[axis]);
  }
  pushNumber(out, `${prefix}.motion.yaw`, left.motion.yaw, right.motion.yaw);
  pushNumber(
    out,
    `${prefix}.motion.capsuleHeight`,
    left.motion.capsuleHeight,
    right.motion.capsuleHeight,
  );
  pushValue(out, `${prefix}.motion.grounded`, left.motion.grounded, right.motion.grounded);
  pushNumber(out, `${prefix}.motion.airtimeMs`, left.motion.airtimeMs, right.motion.airtimeMs);
  pushValue(
    out,
    `${prefix}.motion.dash`,
    left.motion.dash ? "open" : "closed",
    right.motion.dash ? "open" : "closed",
  );
  if (left.motion.dash && right.motion.dash) {
    pushNumber(out, `${prefix}.motion.dash.dirX`, left.motion.dash.dirX, right.motion.dash.dirX);
    pushNumber(out, `${prefix}.motion.dash.dirZ`, left.motion.dash.dirZ, right.motion.dash.dirZ);
    pushNumber(out, `${prefix}.motion.dash.speed`, left.motion.dash.speed, right.motion.dash.speed);
    pushNumber(
      out,
      `${prefix}.motion.dash.elapsedMs`,
      left.motion.dash.elapsedMs,
      right.motion.dash.elapsedMs,
    );
  }
  pushNumber(out, `${prefix}.health`, left.health, right.health);
  pushNumber(out, `${prefix}.ammo`, left.ammo, right.ammo);
  pushNumber(
    out,
    `${prefix}.dodge.iframeUntilTick`,
    left.dodge.iframeUntilTick,
    right.dodge.iframeUntilTick,
  );
  pushNumber(out, `${prefix}.dodge.readyAtTick`, left.dodge.readyAtTick, right.dodge.readyAtTick);
  pushNumber(out, `${prefix}.fireReadyAtTick`, left.fireReadyAtTick, right.fireReadyAtTick);
  pushNumber(out, `${prefix}.shotsFired`, left.shotsFired, right.shotsFired);
  pushNumber(out, `${prefix}.hitsLanded`, left.hitsLanded, right.hitsLanded);
  pushNumber(out, `${prefix}.hitsTaken`, left.hitsTaken, right.hitsTaken);
  pushNumber(out, `${prefix}.aimX`, left.aimX, right.aimX);
  pushNumber(out, `${prefix}.aimZ`, left.aimZ, right.aimZ);
}

/**
 * Every field on which two states disagree, deepest first by magnitude.
 *
 * This is what turns a digest mismatch into a lead. A divergence in
 * `motion.pos.x` of 1e-16 says the integrator took a different rounding path; one
 * of 0.4 says an input went missing; `motion.phase` differing says a dodge opened
 * on one side and not the other.
 */
export function diffCombatStates(
  left: CombatState,
  right: CombatState,
): readonly FieldDifference[] {
  const out: FieldDifference[] = [];
  pushNumber(out, "tick", left.tick, right.tick);
  diffFighter(out, "A", left.fighters.A, right.fighters.A);
  diffFighter(out, "B", left.fighters.B, right.fighters.B);
  pushNumber(out, "projectiles.length", left.projectiles.length, right.projectiles.length);
  const shared = Math.min(left.projectiles.length, right.projectiles.length);
  for (let index = 0; index < shared; index++) {
    const a = left.projectiles[index]!;
    const b = right.projectiles[index]!;
    pushNumber(out, `projectiles[${index}].id`, a.id, b.id);
    pushNumber(out, `projectiles[${index}].x`, a.x, b.x);
    pushNumber(out, `projectiles[${index}].z`, a.z, b.z);
    pushNumber(out, `projectiles[${index}].vx`, a.vx, b.vx);
    pushNumber(out, `projectiles[${index}].vz`, a.vz, b.vz);
  }
  return out.sort((first, second) => (second.delta ?? Infinity) - (first.delta ?? Infinity));
}

/** A short human-readable summary, for a log line that has to fit on a screen. */
export function summariseDivergence(
  report: DivergenceReport,
  differences: readonly FieldDifference[] = [],
): string {
  const head =
    `${report.kind} match=${report.matchId} side=${report.side ?? "-"} ` +
    `round=${report.round} tick=${report.tick} ` +
    `expected=${report.expectedHash} reported=${report.reportedHash} ` +
    `replayFrom=${report.baselineTick} steps=${report.steps.length}`;
  if (differences.length === 0) return head;
  const worst = differences
    .slice(0, 3)
    .map((difference) => `${difference.path} ${difference.left}!=${difference.right}`)
    .join("; ");
  return `${head} | ${worst}`;
}
