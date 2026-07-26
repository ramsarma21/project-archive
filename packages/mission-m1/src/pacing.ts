// The three-minute budget, computed rather than asserted.
//
// The mission clock is 180s. This walks the actual cheapest verified path for
// each line, sums the per-link durations the verifier derived from the shipped
// physics, and adds the two non-locomotive costs the design owns: the precision
// beat and the reflex-time window. If the geometry changes, the budget changes
// with it and pacing.test.ts notices.

import { PARKOUR_TUNING } from "@pa/engine-world/parkour";
import { FIELD_TICK_HZ } from "@pa/engine-world/fieldSimulation";
import { STEALTH_TUNING } from "@pa/engine-world/stealth";
import { PRECISION_BEAT_SECONDS } from "./beat.js";
import { ACTION_MS } from "./envelope.js";
import { cheapestPath, routeGraph } from "./routeGraph.js";
import type { LinkVerdict } from "./traversal.js";
import type { MissionLevel, RouteLink, SectionId } from "./types.js";

/**
 * What one beat encounter actually costs the clock, measured rather than reserved.
 *
 * This was 20 seconds — the mission slate's figure for POST_JOB, written before a
 * beat runtime existed. Now that one does, the number is derived from the chart the
 * encounter mounts, and @pa/beat computes it rather than this file estimating it.
 *
 * WHAT A CHART IS, because the old note here described a different mechanic. A chart
 * is a run of BARS, each filled by an authored figure that sums to exactly one bar,
 * and the seed picks which figures rather than how long the bar is. M1's handbill
 * chart is three bars whose density rises — three strokes to the bar, then four, then
 * five — which puts the guaranteed spikes in the closing bar, where the constable is
 * nearest. That comes to 14 strikes, 13 of them judged, over a span of 336 ticks.
 *
 * THE SPAN IS THE SAME ON EVERY SEED, and that is the property the budget rests on
 * rather than a detail. The chart used to be free intervals, so its length was a dice
 * roll and this line had to charge the widest span the seed could draw. Bars make
 * 336 ticks exact, so the only slack left is the nine ticks a player spends taking
 * the last stroke late. The budget is charged what the beat costs instead of a tail
 * reached once in four hundred attempts — and, more to the point, the player can
 * judge the patrol gap they are about to spend, because the commitment is the same
 * length every time.
 *
 * So the cost is 5.6 seconds of chart plus the outer window the final stroke may
 * still be struck in plus the follow-through, and it lands at 6.25s. That is up from
 * the ~3.65s the five-stroke chart cost and still well under the 20 the slate
 * reserved; the difference goes back to traversal, which is a real change to the
 * pacing question, because `shortfallS` is how much more route the level still owes
 * the three minutes.
 *
 * THIS IS A PER-ENCOUNTER FIGURE, not M1's beat total. `pacingReport` charges it once
 * because the level mounts one beat today. A second encounter is a second charge and
 * a chart of its own — @pa/beat already carries a shorter one — so it is the caller's
 * arithmetic that would change, not this constant.
 */
export const PRECISION_BEAT_S = PRECISION_BEAT_SECONDS;
/**
 * Reflex time. The world slows to REFLEX_SCALE for REFLEX_WINDOW_S of world
 * time, so it costs the player REFLEX_WINDOW_S / REFLEX_SCALE of wall clock.
 * Only the world-time share is charged against the mission clock.
 */
export const REFLEX_WINDOW_S = 2.0;
export const REFLEX_SCALE = 0.35;
/** Handing over the sheets at the drying rack; no dialogue, no stop. */
export const OPENING_S = 3.0;

/**
 * What a competent player costs that an optimal line does not. Every factor
 * here is a shipped constant rather than a guess:
 *
 *   coldExitSpeedFraction     a player who does not chain a verb leaves it at
 *                             82% of their entry speed, so their running is
 *                             correspondingly slower
 *   slowEntryDurationMultiplier  a verb entered below the sprint threshold takes
 *                             35% longer
 *   reflexWindowTicks         three windows of held world time
 *
 * plus the authored per-section reroute allowance, which is design intent and
 * is declared on the section rather than hidden in a fudge factor.
 */
export const COMPETENT = {
  runSpeedFactor: PARKOUR_TUNING.coldExitSpeedFraction,
  authoredMultiplier: PARKOUR_TUNING.slowEntryDurationMultiplier,
  reflexWindows: STEALTH_TUNING.reflexChargesPerMission,
  reflexWorldSecondsEach: STEALTH_TUNING.reflexWindowTicks / FIELD_TICK_HZ,
} as const;

const GROUNDED_KINDS = new Set(["RUN", "RAMP", "BLEND"]);

export interface PacingRow {
  section: SectionId;
  budgetS: number;
  safeS: number;
  fastS: number;
  metresSafe: number;
  metresFast: number;
}

export interface PacingReport {
  rows: PacingRow[];
  /** Optimal line, full sprint, no mistakes. */
  totals: {
    budgetS: number;
    safeS: number;
    fastS: number;
    metresSafe: number;
    metresFast: number;
    precisionS: number;
    reflexS: number;
    openingS: number;
    missionClockS: number;
    /**
     * How far short of the mission clock the authored route currently falls,
     * walked at optimal speed with no mistakes and no patrol interference.
     * Reported rather than hidden: it is the honest measure of how much more
     * traversal the level still needs.
     */
    shortfallS: number;
    /** What the same route costs a competent player. */
    competentS: number;
    competentShortfallS: number;
    rerouteS: number;
  };
}

function accumulate(
  level: MissionLevel,
  verdicts: readonly LinkVerdict[],
  allow: RouteLink["line"][],
): { seconds: Map<SectionId, number>; metres: Map<SectionId, number>; total: number; totalMetres: number } {
  const graph = routeGraph(level, verdicts);
  const nodeSection = new Map(level.nodes.map((n) => [n.id, n.section]));
  const linkById = new Map(level.links.map((l) => [l.id, l]));
  const verdictById = new Map(verdicts.map((v) => [v.id, v]));
  const seconds = new Map<SectionId, number>();
  const metres = new Map<SectionId, number>();
  let total = 0;
  let totalMetres = 0;

  // Via the post, always. The objective is not "reach the yard", and a graph
  // search that skips the handbill is measuring a route nobody may take.
  const toPost = cheapestPath(graph, level.startNode, level.postNode, allow);
  const toArena = cheapestPath(graph, level.postNode, level.arenaNode, allow);
  const path =
    toPost && toArena
      ? { links: [...toPost.links, ...toArena.links] }
      : null;
  if (path) {
    for (const id of path.links) {
      const link = linkById.get(id)!;
      const verdict = verdictById.get(id)!;
      const section = nodeSection.get(link.from) ?? "A_LEADS";
      seconds.set(section, (seconds.get(section) ?? 0) + verdict.durationS);
      metres.set(section, (metres.get(section) ?? 0) + verdict.distanceM);
      total += verdict.durationS;
      totalMetres += verdict.distanceM;
    }
  }
  return { seconds, metres, total, totalMetres };
}

export function pacingReport(
  level: MissionLevel,
  verdicts: readonly LinkVerdict[],
): PacingReport {
  const safe = accumulate(level, verdicts, ["SAFE"]);
  const fast = accumulate(level, verdicts, ["SAFE", "FAST", "EXPERT"]);

  const rows: PacingRow[] = level.sections.map((section) => ({
    section: section.id,
    budgetS: section.budgetS,
    safeS: safe.seconds.get(section.id) ?? 0,
    fastS: fast.seconds.get(section.id) ?? 0,
    metresSafe: safe.metres.get(section.id) ?? 0,
    metresFast: fast.metres.get(section.id) ?? 0,
  }));

  const fixed = PRECISION_BEAT_S + REFLEX_WINDOW_S + OPENING_S;

  // The same authored route, walked by somebody who is not perfect.
  let competentTraversal = 0;
  const linkById = new Map(level.links.map((l) => [l.id, l]));
  const verdictById = new Map(verdicts.map((v) => [v.id, v]));
  const graph = routeGraph(level, verdicts);
  const legs = [
    cheapestPath(graph, level.startNode, level.postNode, ["SAFE"]),
    cheapestPath(graph, level.postNode, level.arenaNode, ["SAFE"]),
  ];
  for (const leg of legs) {
    for (const id of leg?.links ?? []) {
      const verdict = verdictById.get(id)!;
      const kind = linkById.get(id)!.kind;
      competentTraversal += GROUNDED_KINDS.has(kind)
        ? verdict.durationS / COMPETENT.runSpeedFactor
        : verdict.durationS * COMPETENT.authoredMultiplier;
    }
  }
  const rerouteS = level.sections.reduce((sum, s) => sum + s.rerouteBudgetS, 0);
  const reflexS =
    COMPETENT.reflexWindows * COMPETENT.reflexWorldSecondsEach;
  const competentS = competentTraversal + fixed + rerouteS + reflexS;

  return {
    rows,
    totals: {
      budgetS: level.sections.reduce((sum, s) => sum + s.budgetS, 0),
      safeS: safe.total + fixed,
      fastS: fast.total + fixed,
      metresSafe: safe.totalMetres,
      metresFast: fast.totalMetres,
      precisionS: PRECISION_BEAT_S,
      reflexS: REFLEX_WINDOW_S,
      openingS: OPENING_S,
      missionClockS: level.missionClockS,
      shortfallS: Math.max(0, level.missionClockS - (safe.total + fixed)),
      competentS,
      competentShortfallS: Math.max(0, level.missionClockS - competentS),
      rerouteS,
    },
  };
}

/**
 * Locomotion is the whole mission except the precision beat: the brief's
 * "moving for three straight minutes" is a measurable claim, so measure it.
 */
export function movingFraction(report: PacingReport): number {
  return (report.totals.safeS - PRECISION_BEAT_S) / report.totals.safeS;
}

export const AUTHORED_ACTION_MS = ACTION_MS;
