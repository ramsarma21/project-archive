// Named network conditions to test against.
//
// The numbers are one-way delays, so double them for a round trip. They are chosen
// to bracket what a middle school actually has rather than to look impressive:
// thirty laptops on one access point, a building uplink shared with the office, and
// a captive portal in the path.
//
// LOCALHOST IS IN THE LIST FOR ONE REASON. It is what tomorrow's test measures, and
// having it named makes the comparison explicit: a result that only holds on
// LOCALHOST is a result that has not been tested. Every measurement in the report
// is quoted at CONGESTED as well, because that is the one that matters.

import type { LinkProfile } from "./link.js";

/** Two tabs on one laptop. Tomorrow's test, and the least informative case. */
export const LOCALHOST: LinkProfile = {
  name: "LOCALHOST",
  baseLatencyMs: 0,
  jitterMs: 0,
  loss: 0,
  duplication: 0,
  spikeChance: 0,
  spikeMs: 0,
};

/** Same room, quiet access point, wired uplink. The best a school gets. */
export const SCHOOL_GOOD: LinkProfile = {
  name: "SCHOOL_GOOD",
  baseLatencyMs: 12,
  jitterMs: 8,
  loss: 0.005,
  duplication: 0.001,
  spikeChance: 0.01,
  spikeMs: 40,
};

/** A normal classroom period. This is the profile to design against. */
export const SCHOOL_TYPICAL: LinkProfile = {
  name: "SCHOOL_TYPICAL",
  baseLatencyMs: 30,
  jitterMs: 25,
  loss: 0.02,
  duplication: 0.002,
  spikeChance: 0.04,
  spikeMs: 120,
};

/** Everyone streaming at once. Playable is the bar here, not pretty. */
export const SCHOOL_CONGESTED: LinkProfile = {
  name: "SCHOOL_CONGESTED",
  baseLatencyMs: 65,
  jitterMs: 60,
  loss: 0.05,
  duplication: 0.005,
  spikeChance: 0.08,
  spikeMs: 250,
};

/**
 * The edge of the building, one bar, sharing with a video call.
 *
 * Included because the honest question is not "does it work when the network is
 * fine" but "what does it do when the network is not, and does it degrade or
 * collapse". A round trip here approaches the point where @pa/pvp's acceptance
 * window starts refusing frames, which is exactly the limit worth measuring.
 */
export const SCHOOL_AWFUL: LinkProfile = {
  name: "SCHOOL_AWFUL",
  baseLatencyMs: 120,
  jitterMs: 110,
  loss: 0.1,
  duplication: 0.01,
  spikeChance: 0.12,
  spikeMs: 400,
};

export const ALL_PROFILES: readonly LinkProfile[] = [
  LOCALHOST,
  SCHOOL_GOOD,
  SCHOOL_TYPICAL,
  SCHOOL_CONGESTED,
  SCHOOL_AWFUL,
];

/** An asymmetric pair: one student on the good side of the building, one not. */
export function mismatchedPair(): { readonly A: LinkProfile; readonly B: LinkProfile } {
  return { A: SCHOOL_GOOD, B: SCHOOL_CONGESTED };
}
