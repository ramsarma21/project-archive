// A link that behaves like a school network, in virtual time.
//
// THE TESTING TRAP THIS EXISTS TO ESCAPE. Tomorrow's test is two tabs on one
// laptop: roughly zero latency, one clock, one CPU, one JavaScript engine. That is
// the single worst environment for finding a netcode bug, because every bug worth
// finding is invisible in it and the result feels perfect. The real deployment is a
// classroom of thirty laptops behind one access point, and the difference between
// those two environments is not a detail — it is the entire problem.
//
// So the harness gets to be the bad network. Latency, jitter, loss, reordering and
// duplication are injected here, the whole two-client system is run through it, and
// the numbers in the report come from that rather than from localhost.
//
// EVERYTHING IS VIRTUAL TIME AND DETERMINISTIC. No real timers, so a twelve-second
// disconnect test takes microseconds and a failure reproduces exactly. Randomness is
// engine-world's `fieldRandom`, seeded per link, so "the run where the shot got
// dropped" is a seed rather than a story — and so this file needs no exemption from
// the repo's ban on `Math.random` in gameplay code, which it would otherwise deserve
// to be refused.
//
// ORDERING IS BY ARRIVAL AND THEN BY SEND, WHICH IS WHY REORDERING WORKS. Each
// packet is stamped with a delivery time drawn from the profile; the queue is sorted
// by it. A packet whose jitter draw was small genuinely overtakes one whose draw was
// large, which is how real reordering happens, rather than being simulated by
// shuffling.

import { fieldRandom } from "@pa/duel";

export interface LinkProfile {
  readonly name: string;
  /** One-way delay floor in milliseconds. */
  readonly baseLatencyMs: number;
  /** Uniform additional delay, 0..jitterMs, drawn per packet. */
  readonly jitterMs: number;
  /** Probability in [0,1] that a packet is dropped outright. */
  readonly loss: number;
  /** Probability a delivered packet is delivered twice. */
  readonly duplication: number;
  /**
   * Probability a packet takes a much longer path, which is what actually produces
   * reordering on a congested access point: not shuffling, but one packet waiting
   * behind a big transfer while the next goes straight through.
   */
  readonly spikeChance: number;
  readonly spikeMs: number;
}

interface QueuedPacket<T> {
  readonly deliverAtMs: number;
  readonly sentAtMs: number;
  readonly sequence: number;
  readonly payload: T;
}

export interface LinkStats {
  readonly sent: number;
  readonly delivered: number;
  readonly dropped: number;
  readonly duplicated: number;
  readonly reordered: number;
  readonly totalLatencyMs: number;
  readonly worstLatencyMs: number;
}

export interface SimulatedLink<T> {
  readonly profile: LinkProfile;
  readonly seed: number;
  readonly queue: readonly QueuedPacket<T>[];
  readonly counter: number;
  readonly lastDeliveredSequence: number;
  readonly stats: LinkStats;
  /** A hard outage window, for modelling an access point handover. */
  readonly outageUntilMs: number;
}

export function createLink<T>(profile: LinkProfile, seed: number): SimulatedLink<T> {
  return {
    profile,
    seed: seed >>> 0,
    queue: [],
    counter: 0,
    lastDeliveredSequence: 0,
    outageUntilMs: 0,
    stats: {
      sent: 0,
      delivered: 0,
      dropped: 0,
      duplicated: 0,
      reordered: 0,
      totalLatencyMs: 0,
      worstLatencyMs: 0,
    },
  };
}

/** Model a wifi handover or a switch reset: everything in flight is lost. */
export function openOutage<T>(
  link: SimulatedLink<T>,
  untilMs: number,
): SimulatedLink<T> {
  return {
    ...link,
    outageUntilMs: untilMs,
    queue: [],
    stats: { ...link.stats, dropped: link.stats.dropped + link.queue.length },
  };
}

export function send<T>(
  link: SimulatedLink<T>,
  payload: T,
  nowMs: number,
): SimulatedLink<T> {
  const counter = link.counter + 1;
  const stats = { ...link.stats, sent: link.stats.sent + 1 };

  if (nowMs < link.outageUntilMs) {
    return { ...link, counter, stats: { ...stats, dropped: stats.dropped + 1 } };
  }

  const roll = (salt: number): number => fieldRandom(link.seed, counter, salt);
  if (roll(1) < link.profile.loss) {
    return { ...link, counter, stats: { ...stats, dropped: stats.dropped + 1 } };
  }

  const jitter = roll(2) * link.profile.jitterMs;
  const spike = roll(3) < link.profile.spikeChance ? link.profile.spikeMs : 0;
  const latency = link.profile.baseLatencyMs + jitter + spike;
  const queue = [
    ...link.queue,
    { deliverAtMs: nowMs + latency, sentAtMs: nowMs, sequence: counter, payload },
  ];

  if (roll(4) < link.profile.duplication) {
    // A duplicate arrives on its own schedule, which is why it is a separate draw.
    const extra = roll(5) * link.profile.jitterMs;
    queue.push({
      deliverAtMs: nowMs + latency + extra,
      sentAtMs: nowMs,
      sequence: counter,
      payload,
    });
    return {
      ...link,
      counter,
      queue: queue.sort(byDelivery),
      stats: { ...stats, duplicated: stats.duplicated + 1 },
    };
  }

  return { ...link, counter, queue: queue.sort(byDelivery), stats };
}

function byDelivery<T>(left: QueuedPacket<T>, right: QueuedPacket<T>): number {
  return left.deliverAtMs - right.deliverAtMs || left.sequence - right.sequence;
}

export interface Delivery<T> {
  readonly link: SimulatedLink<T>;
  readonly payloads: readonly T[];
}

/** Everything that has arrived by `nowMs`, in arrival order. */
export function deliver<T>(link: SimulatedLink<T>, nowMs: number): Delivery<T> {
  const due = link.queue.filter((packet) => packet.deliverAtMs <= nowMs);
  if (due.length === 0) return { link, payloads: [] };

  let stats = link.stats;
  let lastSequence = link.lastDeliveredSequence;
  for (const packet of due) {
    const latency = packet.deliverAtMs - packet.sentAtMs;
    const reordered = packet.sequence < lastSequence;
    stats = {
      ...stats,
      delivered: stats.delivered + 1,
      reordered: stats.reordered + (reordered ? 1 : 0),
      totalLatencyMs: stats.totalLatencyMs + latency,
      worstLatencyMs: Math.max(stats.worstLatencyMs, latency),
    };
    lastSequence = Math.max(lastSequence, packet.sequence);
  }

  return {
    link: {
      ...link,
      queue: link.queue.filter((packet) => packet.deliverAtMs > nowMs),
      lastDeliveredSequence: lastSequence,
      stats,
    },
    payloads: due.map((packet) => packet.payload),
  };
}

export function meanLatencyMs(link: SimulatedLink<unknown>): number {
  return link.stats.delivered === 0
    ? 0
    : link.stats.totalLatencyMs / link.stats.delivered;
}

export function lossRate(link: SimulatedLink<unknown>): number {
  return link.stats.sent === 0 ? 0 : link.stats.dropped / link.stats.sent;
}
