// A whole two-player match, both browsers, both links, in virtual time.
//
// Nothing here is mocked except the network and the grader. The server is the real
// `MatchHost` driving the real @pa/pvp authority driving the real @pa/duel reducer;
// the clients are the real `NetClient`; the arena is @pa/duel's reference arena and
// the questions are the real authored M1 bank. What is injected is the link, and the
// point of injecting it is that the link is the variable the owner's own test cannot
// vary.
//
// VIRTUAL TIME. Every participant is driven from one integer millisecond counter, so
// a twelve-second disconnect costs microseconds, a run is exactly reproducible from a
// seed, and a failure can be re-run with one number changed. Real timers in a netcode
// test buy nothing and cost determinism.
//
// THE HARNESS IS OMNISCIENT AND THE CLIENTS ARE NOT. It reads the host's authoritative
// state directly to measure how wrong each client is. That is the measurement the
// whole exercise turns on and it is only available from outside — neither client can
// know its own error, which is precisely why the hash comparison exists inside the
// protocol as well.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELD_TICK_HZ,
  playerParams,
  referenceArena,
  type CombatIntent,
  type CombatParams,
  type DuelSide,
  type Vec3,
} from "@pa/duel";
// The harness reaches for @pa/pvp's whole surface rather than netcode's narrow
// `pvpPort`, on purpose: the port describes what PRODUCTION netcode depends on, and
// keeping it narrow is the point. A fixture that builds a real match legitimately
// needs the lobby and question-pool machinery that production netcode never touches.
import {
  askableItems,
  createLobby,
  createPvpMatch,
  generateHandle,
  joinLobby,
  lobbySides,
  parseQuestionBank,
  selectRoundQuestions,
  submitVerdict,
  DEFAULT_COSMETIC_LOADOUT,
  type LobbyMember,
  type PvpAuthority,
  type PvpQuestionBank,
  type PvpVerdictEnvelope,
  type ReceiptVerifier,
} from "@pa/pvp";
import {
  absorbFrame,
  advanceTo,
  clientConfig,
  createClient,
  createHost,
  createLink,
  drain,
  drainClient,
  hostConfig,
  markDisconnected,
  receive,
  receiveServer,
  renderView,
  requestResume,
  sampleInput,
  tickSend,
  deliver,
  detach,
  send,
  type ClientMessage,
  type DivergenceReport,
  type LinkProfile,
  type MatchHost,
  type NetClient,
  type ServerMessage,
  type SimulatedLink,
} from "../index.js";

const arena = referenceArena();

export function m1Bank(): PvpQuestionBank {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../content/m1/duel-items.json");
  const parsed = parseQuestionBank(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.bank;
}

function member(profileId: string): LobbyMember {
  return {
    profileId,
    handle: generateHandle(profileId).handle,
    rank: 1,
    unlockedAbilityIds: [],
    cosmetics: DEFAULT_COSMETIC_LOADOUT,
    pvpLegalCardIds: [],
  };
}

/** The same shape @pa/pvp's own tests use, so the trust boundary behaves alike. */
export function stubVerifier(secret = "harness-secret"): ReceiptVerifier {
  return (envelope, binding, receipt) => receipt === receiptFor(envelope, binding, secret);
}

export function receiptFor(
  envelope: PvpVerdictEnvelope,
  binding: { profileId: string; attemptId: string; roundIndex: number },
  secret = "harness-secret",
): string {
  return [
    secret,
    binding.profileId,
    binding.attemptId,
    String(binding.roundIndex),
    envelope.itemId,
    envelope.itemVersion,
    envelope.kind,
    envelope.source,
    envelope.responseRef ?? "",
  ].join("|");
}

export function liveAuthority(rounds = 6, startedAtMs = 0): {
  authority: PvpAuthority;
  questions: readonly { itemId: string }[];
} {
  const lobby = createLobby(member("profile-a"), 1_000_000);
  const joined = joinLobby(lobby, member("profile-b"), 1_000_100);
  if (!joined.ok) throw new Error(joined.reason);
  const sides = lobbySides(joined.lobby);
  if (!sides) throw new Error("no sides");

  const bank = m1Bank();
  const drawn = selectRoundQuestions({
    bank,
    seed: joined.lobby.seed,
    rounds,
    askable: askableItems(bank, { A: [], B: [] }),
  });
  if (!drawn.ok) throw new Error(drawn.reason);

  const created = createPvpMatch({
    identity: { matchId: `pvp_${joined.lobby.code}`, seed: joined.lobby.seed, startedAtMs },
    participants: { A: sides.A, B: sides.B },
    world: arena.world,
    questions: drawn.questions,
    placement: arena.placement,
    rounds,
  });
  if (!created.ok) throw new Error(created.reason);
  return { authority: created.authority, questions: drawn.questions };
}

// ---- the two-client simulation ---------------------------------------------

export interface ErrorSample {
  readonly tick: number;
  /** Metres between the client's predicted own position and the server's. */
  readonly metres: number;
}

export interface SideMetrics {
  readonly samples: readonly ErrorSample[];
  readonly opponentRenderLagTicks: readonly number[];
}

export interface Sim {
  nowMs: number;
  host: MatchHost;
  clients: { A: NetClient; B: NetClient };
  up: { A: SimulatedLink<ClientMessage>; B: SimulatedLink<ClientMessage> };
  down: { A: SimulatedLink<ServerMessage>; B: SimulatedLink<ServerMessage> };
  offline: { A: boolean; B: boolean };
  metrics: { A: SideMetrics; B: SideMetrics };
  divergences: DivergenceReport[];
  readonly questions: readonly { itemId: string }[];
  readonly params: CombatParams;
  /** Set per side each frame by the test; the client samples it at 60 Hz. */
  intent: { A: CombatIntent; B: CombatIntent };
  nextFrameAtMs: number;
}

export interface SimOptions {
  readonly profiles?: { readonly A: LinkProfile; readonly B: LinkProfile };
  readonly seed?: number;
  readonly rounds?: number;
  readonly snapshotEveryTicks?: number;
  readonly sendEveryMs?: number;
  readonly redundancy?: number;
}

const IDLE: CombatIntent = {
  moveX: 0,
  moveZ: 0,
  sprint: false,
  crouch: false,
  jump: false,
  dodge: false,
  fire: false,
  aimX: 0,
  aimZ: 1,
  abilityId: null,
};

export function createSim(profile: LinkProfile, options: SimOptions = {}): Sim {
  const profiles = options.profiles ?? { A: profile, B: profile };
  const seed = options.seed ?? 0xc0ffee;
  const { authority, questions } = liveAuthority(options.rounds ?? 6, 0);
  // The authority's own params, so the clients predict with exactly the numbers the
  // server simulates with. Taking them from anywhere else is how a prediction and an
  // authority quietly end up with two different fire intervals.
  const params: CombatParams = authority.state.params;

  let counter = 0;
  const host = createHost(
    authority,
    hostConfig(
      (side) => `resume-${side}-${(counter += 1)}`,
      options.snapshotEveryTicks !== undefined
        ? { snapshotEveryTicks: options.snapshotEveryTicks }
        : {},
    ),
    0,
  );

  const config = (side: DuelSide) =>
    clientConfig(arena.world, clientParams(params, side), {
      ...(options.sendEveryMs !== undefined ? { sendEveryMs: options.sendEveryMs } : {}),
      ...(options.redundancy !== undefined ? { redundancy: options.redundancy } : {}),
    });

  return {
    nowMs: 0,
    host,
    clients: { A: createClient("A", config("A")), B: createClient("B", config("B")) },
    up: {
      A: createLink<ClientMessage>(profiles.A, seed ^ 0x11),
      B: createLink<ClientMessage>(profiles.B, seed ^ 0x22),
    },
    down: {
      A: createLink<ServerMessage>(profiles.A, seed ^ 0x33),
      B: createLink<ServerMessage>(profiles.B, seed ^ 0x44),
    },
    offline: { A: false, B: false },
    metrics: {
      A: { samples: [], opponentRenderLagTicks: [] },
      B: { samples: [], opponentRenderLagTicks: [] },
    },
    divergences: [],
    questions,
    params,
    intent: { A: IDLE, B: IDLE },
    nextFrameAtMs: 0,
  };
}

/**
 * A client predicts with the same params the authority holds. Handed over whole
 * rather than rebuilt, because rebuilding is where a client and a server end up
 * disagreeing about a fire interval and nobody notices for a month.
 */
function clientParams(params: CombatParams, side: DuelSide): CombatParams {
  void side;
  return params;
}

const FRAME_MS = 1000 / 60;

/** Advance the whole world by one virtual millisecond. */
export function step(sim: Sim): void {
  sim.nowMs += 1;

  // 1. The server runs whatever ticks are due and queues what it owes.
  sim.host = advanceTo(sim.host, sim.nowMs);
  const drained = drain(sim.host);
  sim.host = drained.host;
  for (const addressed of drained.messages) {
    sim.down[addressed.side] = send(
      sim.down[addressed.side],
      addressed.message,
      sim.nowMs,
    );
  }

  // 2. Deliver downstream, then render a frame if one is due.
  for (const side of ["A", "B"] as const) {
    const arrival = deliver(sim.down[side], sim.nowMs);
    sim.down[side] = arrival.link;
    if (sim.offline[side]) continue;
    for (const message of arrival.payloads) {
      sim.clients[side] = receiveServer(sim.clients[side], message, sim.nowMs);
    }
  }

  if (sim.nowMs >= sim.nextFrameAtMs) {
    sim.nextFrameAtMs += FRAME_MS;
    for (const side of ["A", "B"] as const) {
      if (sim.offline[side]) continue;
      sim.clients[side] = sampleInput(sim.clients[side], sim.intent[side], sim.nowMs);
      recordError(sim, side);
      sim.clients[side] = absorbFrame(sim.clients[side]);
    }
  }

  // 3. Clients send on their own cadence; deliver upstream.
  for (const side of ["A", "B"] as const) {
    if (!sim.offline[side]) {
      sim.clients[side] = tickSend(sim.clients[side], sim.nowMs);
      const out = drainClient(sim.clients[side]);
      sim.clients[side] = out.client;
      for (const message of out.messages) {
        sim.up[side] = send(sim.up[side], message, sim.nowMs);
      }
    }
    const arrival = deliver(sim.up[side], sim.nowMs);
    sim.up[side] = arrival.link;
    for (const message of arrival.payloads) {
      const result = receive(sim.host, side, message, sim.nowMs);
      sim.host = result.host;
      if (result.divergence) sim.divergences.push(result.divergence);
    }
  }
}

/**
 * Sample the reconciliation error, which is the number that describes smoothness.
 *
 * NOT "the client's position now versus the server's position now". A correctly
 * working prediction is deliberately about a round trip AHEAD of the server, so that
 * comparison scores a healthy client badly and would have sent me optimising the
 * wrong thing. What a player feels is the correction: the gap between what the client
 * had already drawn for tick T and what the server later says tick T actually was.
 * The client computes exactly that when a snapshot lands, and this reads it once per
 * new snapshot rather than once per frame.
 */
function recordError(sim: Sim, side: DuelSide): void {
  if (sim.host.authority.state.phase !== "ENGAGEMENT_LIVE") return;
  const client = sim.clients[side];
  const reconciliation = client.lastReconciliation;
  const previous = sim.metrics[side].samples;
  const already = previous[previous.length - 1]?.tick ?? -1;
  const view = renderView(client);
  const lag =
    view.opponent === null
      ? 0
      : sim.host.authority.state.combat.tick - view.opponent.atTick;

  sim.metrics[side] = {
    samples:
      reconciliation && reconciliation.tick !== already
        ? [...previous, { tick: reconciliation.tick, metres: reconciliation.metres }]
        : previous,
    opponentRenderLagTicks: [...sim.metrics[side].opponentRenderLagTicks, lag],
  };
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function run(sim: Sim, forMs: number): void {
  const until = sim.nowMs + forMs;
  while (sim.nowMs < until) step(sim);
}

export function runUntil(
  sim: Sim,
  predicate: (sim: Sim) => boolean,
  limitMs = 120_000,
): void {
  const deadline = sim.nowMs + limitMs;
  while (sim.nowMs < deadline) {
    if (predicate(sim)) return;
    step(sim);
  }
  throw new Error(
    `predicate never held: phase ${sim.host.authority.state.phase} ` +
      `tick ${sim.host.authority.state.combat.tick} at ${sim.nowMs}ms`,
  );
}

/**
 * Answer the round currently being asked, on both sides, through the real path.
 *
 * THE ITEM IS READ FROM THE MACHINE, NOT INDEXED OUT OF THE DRAW. @pa/duel used to
 * ask `questions[round - 1]`; it now chooses through a seeded policy so a duel can
 * outlast its bank, and the asked item is published on the state. Anything that
 * assumes the old indexing gets `WRONG_ITEM` from `submitVerdict` — quietly, and only
 * once a real question bank is wired up.
 */
export function answerRound(
  sim: Sim,
  kinds: { A: "CORRECT" | "WRONG"; B: "CORRECT" | "WRONG" },
  verify: ReceiptVerifier = stubVerifier(),
): void {
  const state = sim.host.authority.state;
  if (state.phase !== "QUESTION_PENDING") {
    throw new Error(`not awaiting verdicts, phase is ${state.phase}`);
  }
  const round = state.round;
  const item = state.item;
  let authority = sim.host.authority;
  for (const side of ["A", "B"] as const) {
    const envelope: PvpVerdictEnvelope = {
      kind: kinds[side],
      itemId: item.itemId,
      itemVersion: item.itemVersion,
      source: "CLASSIFIER",
      responseRef: `resp_${item.itemId}_${side}`,
    };
    const receipt = receiptFor(envelope, {
      profileId: authority.participants[side].profileId,
      attemptId: authority.identity.matchId,
      roundIndex: round,
    });
    const committed = submitVerdict(authority, side, envelope, receipt, verify);
    if (!committed.ok) throw new Error(`${side}: ${committed.reason} ${committed.detail}`);
    authority = committed.authority;
  }
  sim.host = { ...sim.host, authority };
}

/** Get to the first live engagement, both sides answering correctly. */
export function reachEngagement(sim: Sim): void {
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  // Let both clients see at least one live snapshot before anything is measured.
  run(sim, 250);
}

// ---- disconnection ----------------------------------------------------------

export function goOffline(sim: Sim, side: DuelSide, outageMs: number): void {
  sim.offline[side] = true;
  sim.clients[side] = markDisconnected(sim.clients[side]);
  sim.up[side] = { ...sim.up[side], outageUntilMs: sim.nowMs + outageMs, queue: [] };
  sim.down[side] = { ...sim.down[side], outageUntilMs: sim.nowMs + outageMs, queue: [] };
  sim.host = detach(sim.host, side, sim.nowMs);
}

export function comeBack(sim: Sim, side: DuelSide): void {
  sim.offline[side] = false;
  sim.up[side] = { ...sim.up[side], outageUntilMs: 0 };
  sim.down[side] = { ...sim.down[side], outageUntilMs: 0 };
  sim.clients[side] = requestResume(sim.clients[side]);
}

// ---- reporting --------------------------------------------------------------

export interface Measurement {
  readonly profile: string;
  readonly side: DuelSide;
  readonly samples: number;
  readonly meanErrorMm: number;
  readonly p95ErrorMm: number;
  readonly worstErrorMm: number;
  /**
   * The worst correction in micrometres.
   *
   * Carried alongside the millimetre figures because rounding a sub-millimetre error
   * to zero and then reporting "zero" is the kind of accidental overclaim that makes
   * a whole measurement table untrustworthy.
   */
  readonly worstErrorUm: number;
  readonly meanOpponentLagMs: number;
  readonly corrections: number;
  readonly worstCorrectionMm: number;
  readonly comparisonsMade: number;
  readonly comparisonsSkipped: number;
  readonly divergencesFound: number;
  readonly framesSent: number;
  readonly upLossRate: number;
  readonly downLossRate: number;
}

export function measure(sim: Sim, side: DuelSide, profile: string): Measurement {
  const metres = sim.metrics[side].samples.map((sample) => sample.metres).sort((a, b) => a - b);
  const lags = sim.metrics[side].opponentRenderLagTicks;
  const stats = sim.clients[side].stats;
  const mm = (value: number) => Math.round(value * 1000);
  return {
    profile,
    side,
    samples: metres.length,
    meanErrorMm: mm(mean(metres)),
    p95ErrorMm: mm(percentile(metres, 0.95)),
    worstErrorMm: mm(metres[metres.length - 1] ?? 0),
    worstErrorUm: Math.round((metres[metres.length - 1] ?? 0) * 1_000_000),
    meanOpponentLagMs: Math.round((mean(lags) / FIELD_TICK_HZ) * 1000),
    corrections: stats.correctionsAbsorbed,
    worstCorrectionMm: mm(stats.worstCorrectionMetres),
    comparisonsMade: stats.comparisonsMade,
    comparisonsSkipped: stats.comparisonsSkipped,
    divergencesFound: stats.divergencesFound,
    framesSent: stats.framesSent,
    upLossRate: rate(sim.up[side].stats.dropped, sim.up[side].stats.sent),
    downLossRate: rate(sim.down[side].stats.dropped, sim.down[side].stats.sent),
  };
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 10000) / 10000;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index]!;
}

export function reportLine(measurement: Measurement): string {
  return (
    `${measurement.profile.padEnd(17)} ${measurement.side}  ` +
    `mean ${String(measurement.meanErrorMm).padStart(5)}mm  ` +
    `p95 ${String(measurement.p95ErrorMm).padStart(5)}mm  ` +
    `worst ${String(measurement.worstErrorUm).padStart(7)}um  ` +
    `oppLag ${String(measurement.meanOpponentLagMs).padStart(4)}ms  ` +
    `checks ${String(measurement.comparisonsMade).padStart(4)}` +
    `/${String(measurement.comparisonsSkipped).padStart(4)} skipped  ` +
    `desync ${measurement.divergencesFound}`
  );
}

export { arena, playerParams };
