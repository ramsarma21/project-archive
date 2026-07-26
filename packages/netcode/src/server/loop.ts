// The only file in this package that owns a timer, and the only one that reads a
// clock without being handed one.
//
// Everything else — @pa/duel, @pa/pvp, the host, the client — is a pure value that
// advances on explicit ticks. That is what makes a duel replayable from an input log
// and a divergence reducible to a test, and it is a property worth protecting by
// concentrating the impurity in about eighty lines rather than letting it spread.
//
// WHY A TIMER AND NOT ADVANCE-ON-REQUEST. The API's current PvP route advances the
// match when a poll arrives, which is a reasonable thing to build without a socket
// and is wrong in one specific way that matters here: the twenty-second round clock
// then only moves when somebody asks it to. A driven loop moves the clock whether or
// not anyone is talking, so a client that stops sending gains nothing. The round
// timer must be a thing the server does, not a thing a request causes.
//
// DRIVEN FASTER THAN THE TICK RATE, DELIBERATELY. The interval is a few milliseconds
// rather than the full 16.67 ms tick period, because a Node timer fires late far
// more often than it fires early. Polling at 4 ms lets `advanceTo` land each tick
// within a few milliseconds of its due time; polling exactly at the tick period
// would accumulate a late bias and spend the catch-up budget on nothing.

import type { DuelSide } from "@pa/duel";
import type { ClientMessage } from "../protocol.js";
import { advanceTo, drain, detach, receive, type Addressed, type MatchHost } from "./host.js";
import type { DivergenceReport } from "../divergence.js";

export interface LoopTransport {
  /** Deliver one message to one side. Whatever the socket layer provides. */
  send(side: DuelSide, message: Addressed["message"]): void;
}

export interface LoopHooks {
  /** Called for every divergence the host detects. Log it; do not throw. */
  onDivergence?(report: DivergenceReport): void;
  /** Called once when the match has produced a result and can be settled. */
  onResolved?(host: MatchHost): void;
}

export interface RunningLoop {
  host(): MatchHost;
  /** Feed an inbound client message. Safe to call from a socket handler. */
  receive(side: DuelSide, message: ClientMessage): void;
  /** Tell the loop a transport closed. Starts the resume grace window. */
  detach(side: DuelSide): void;
  stop(): void;
}

export interface LoopOptions {
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

/** Fast enough that a tick is rarely more than a poll late. */
export const DEFAULT_POLL_MS = 4;

export function runMatchLoop(
  initial: MatchHost,
  transport: LoopTransport,
  hooks: LoopHooks = {},
  options: LoopOptions = {},
): RunningLoop {
  const now = options.now ?? Date.now;
  const start = options.setIntervalFn ?? setInterval;
  const stopTimer = options.clearIntervalFn ?? clearInterval;

  let host = initial;
  let resolved = false;
  let stopped = false;

  const flush = (): void => {
    const drained = drain(host);
    host = drained.host;
    for (const addressed of drained.messages) {
      transport.send(addressed.side, addressed.message);
    }
  };

  const pump = (): void => {
    if (stopped) return;
    host = advanceTo(host, now());
    flush();
    if (!resolved && host.authority.phase !== "LIVE") {
      resolved = true;
      hooks.onResolved?.(host);
    }
  };

  flush();
  const timer = start(pump, options.pollMs ?? DEFAULT_POLL_MS);
  // Never hold the process open: a match loop is a consequence of a match, not a
  // reason for the server to stay alive.
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref(): void }).unref();
  }

  return {
    host: () => host,
    receive(side, message) {
      if (stopped) return;
      const result = receive(host, side, message, now());
      host = result.host;
      if (result.divergence) hooks.onDivergence?.(result.divergence);
      flush();
    },
    detach(side) {
      if (stopped) return;
      host = detach(host, side, now());
      flush();
    },
    stop() {
      stopped = true;
      stopTimer(timer);
    },
  };
}
