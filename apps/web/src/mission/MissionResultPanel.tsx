import React from "react";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import type { MissionResult } from "./result.js";
import "./missionResult.css";

// ---------------------------------------------------------------------------
// The result screen.
//
// A failed attempt is not a dead end and must not read like one. This surface
// explains, from the run's own truthful figures and nothing else, what
// happened, what progress was made, what to change, and what the attempt cost.
// It never invents telemetry, never promises an instant retry the progression
// rules do not grant, and never blames the player for the machine's frame
// stalls.
//
// Every number it draws already lives on `MissionResult`; this file adds no
// arithmetic beyond rounding seconds and counting the facts it already has. The
// authoritative failure reason stays the level's authored `headline`/`detail`.
// The XP line states the truth: a failed attempt pays nothing, and only a clear
// pays. See result.ts for where those numbers come from.
// ---------------------------------------------------------------------------

/**
 * Why the attempt ended, chosen only from figures the run actually reported.
 *
 *  - TRAVERSAL   the arena was never reached and no watcher read the player
 *  - DETECTION   the arena was never reached and a watcher read the player
 *  - DUEL        the route held to the arena but the duel was not won
 *  - UNRESOLVED  the shape does not match any of the above (abandoned/unknown)
 */
export type MissionFailureKind = "TRAVERSAL" | "DETECTION" | "DUEL" | "UNRESOLVED";

export function classifyMissionFailure(result: MissionResult): MissionFailureKind {
  const a = result.achievement;
  if (a.traversalCompleted && !a.duelWon) return "DUEL";
  if (!a.traversalCompleted && a.detections > 0) return "DETECTION";
  if (!a.traversalCompleted) return "TRAVERSAL";
  return "UNRESOLVED";
}

/**
 * Humanise an authored id for display, safely.
 *
 * Ids arrive as `market-crowd` or `duck.beam.frame` or `reachThePost`. A string
 * that already reads as a sentence (it has a space) is left exactly as authored.
 * Everything else has its separators opened out and its words title-cased, so a
 * raw id never lands on the screen as jargon.
 */
export function humanizeMissionId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return trimmed;
  const words = trimmed
    .replace(/[._/:-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return trimmed;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Deterministic "try next time" guidance, specific to what the data shows and
 * silent about anything it does not. Never claims a cause the figures do not
 * carry; an unresolved/abandoned attempt gets generic route guidance and leans
 * on the authored detail already shown in the header.
 */
export function missionGuidance(result: MissionResult): string[] {
  const tips: string[] = [];
  switch (classifyMissionFailure(result)) {
    case "TRAVERSAL":
      tips.push(
        "You did not reach the arena. Take the route in shorter legs — reach the " +
          "next piece of cover before the last one runs out — so one slip does not " +
          "end the whole run.",
      );
      break;
    case "DETECTION": {
      const n = result.achievement.detections;
      tips.push(
        `A watcher read you ${n === 1 ? "once" : `${n} times`} and the route closed. ` +
          "Stay inside the crowd and behind hard cover, and break line of sight " +
          "before you cross open ground.",
      );
      break;
    }
    case "DUEL": {
      tips.push(
        "The route held — you reached the arena, and the attempt ended in the duel " +
          "itself. Keep moving between cover and make every shot count.",
      );
      if (result.knowledge.asked > 0 && result.knowledge.correct < result.knowledge.asked) {
        tips.push(
          `You answered ${result.knowledge.correct} of ${result.knowledge.asked} ` +
            "questions correctly. Each correct answer loads a bigger magazine, so the " +
            "fight is easier when the answers are.",
        );
      }
      break;
    }
    default:
      tips.push(
        "Pick the attempt back up from the Archive and commit to a clean run: reach " +
          "the arena first, then win the duel.",
      );
  }
  if (result.achievement.throwsStruckBody > 0) {
    const n = result.achievement.throwsStruckBody;
    tips.push(
      `${n === 1 ? "A thrown object" : `${n} thrown objects`} struck a person instead ` +
        "of clearing them. Aim a diversion past a body, not into it — a blocked throw " +
        "does no work.",
    );
  }
  return tips;
}

interface ResultFact {
  readonly term: string;
  readonly value: string;
  readonly tone?: "good" | "warn" | "bad";
}

function summaryFacts(result: MissionResult): ResultFact[] {
  const a = result.achievement;
  const t = result.timing;
  const facts: ResultFact[] = [];

  facts.push({
    term: "Route",
    value: a.traversalCompleted
      ? `Reached the arena in about ${Math.round(t.traversalSimulatedS)}s`
      : "Did not reach the arena",
    tone: a.traversalCompleted ? "good" : "bad",
  });

  facts.push({
    term: "Duel",
    value: !a.duelReached
      ? "Never began"
      : a.duelWon
        ? t.duelEngagementS > 0
          ? `Won after about ${Math.round(t.duelEngagementS)}s of fighting`
          : "Won"
        : "Lost",
    tone: !a.duelReached ? undefined : a.duelWon ? "good" : "bad",
  });

  facts.push({
    term: "Watchers",
    value:
      a.detections === 0
        ? "Never spotted"
        : `Spotted ${a.detections === 1 ? "once" : `${a.detections} times`}`,
    tone: a.detections === 0 ? "good" : "warn",
  });

  if (a.objectiveIds.length > 0) {
    const named = a.objectiveIds.slice(0, 3).map(humanizeMissionId).join(", ");
    const more = a.objectiveIds.length > 3 ? ` +${a.objectiveIds.length - 3} more` : "";
    facts.push({
      term: a.objectiveIds.length === 1 ? "Objective" : "Objectives",
      value: `${named}${more}`,
    });
  } else {
    facts.push({ term: "Objectives", value: "None reached" });
  }

  if (result.knowledge.asked > 0) {
    facts.push({
      term: "Questions",
      value: `${result.knowledge.correct} of ${result.knowledge.asked} answered correctly`,
      tone:
        result.knowledge.correct === result.knowledge.asked
          ? "good"
          : result.knowledge.correct === 0
            ? "bad"
            : undefined,
    });
  }

  return facts;
}

function pacingLine(result: MissionResult): string {
  const t = result.timing;
  const attempt = `This attempt took about ${Math.round(t.attemptWallS)}s from the module to here.`;
  if (!result.achievement.traversalCompleted && t.traversalSimulatedS <= 0) {
    return attempt;
  }
  const over =
    t.traversalOverBudgetS > 0
      ? `, ${Math.round(t.traversalOverBudgetS)}s past first light`
      : "";
  return (
    `${attempt} Dawn was set for about ${Math.round(t.traversalBudgetS)}s; your route ran ` +
    `about ${Math.round(t.traversalSimulatedS)}s${over}.`
  );
}

export function MissionResultPanel(props: {
  title: string;
  result: MissionResult;
  onReturn: () => void;
}) {
  const result = props.result;
  const cleared = result.outcome === "CLEARED";
  const fraction = `${result.xpFraction.numerator}/${result.xpFraction.denominator}`;
  const facts = summaryFacts(result);
  const guidance = cleared ? [] : missionGuidance(result);
  const frameStall = result.timing.droppedSteps > 0;

  const nextStep = result.missionSpentAfter
    ? cleared
      ? "This mission is recorded and closed. Nothing here is owed to you twice — return to the Archive for what comes next."
      : "This mission is spent — closed for good. You advance to the next operation regardless; clearing was never required to move on. Return to the Archive to continue."
    : cleared
      ? "Recorded. Return to the Archive for what comes next."
      : `${result.attemptsRemaining} of ${MAX_MISSION_ATTEMPTS} attempts remain. The module runs again from the Archive — the next attempt still needs the full route and the duel, and nothing gets easier.`;

  return (
    <section
      className={`mrp${cleared ? " is-cleared" : " is-failed"}`}
      aria-labelledby="mrp-title"
    >
      <span className="mrp-scan" aria-hidden="true" />

      <header className="mrp-head">
        <p className="mrp-kicker">
          {props.title} · attempt {result.attemptOrdinal} of {MAX_MISSION_ATTEMPTS}
        </p>
        <div className="mrp-head-row">
          <span className="mrp-status" role="status">
            {cleared ? "Cleared" : "Failed"}
          </span>
          <h1 className="mrp-title" id="mrp-title">
            {result.headline}
          </h1>
        </div>
        <p className="mrp-detail">{result.detail}</p>
      </header>

      <div className="mrp-columns">
        <div className="mrp-main">
          <section className="mrp-card" aria-labelledby="mrp-happened">
            <h2 className="mrp-card-title" id="mrp-happened">
              What happened
            </h2>
            <dl className="mrp-facts">
              {facts.map((fact) => (
                <div className="mrp-fact" key={fact.term}>
                  <dt>{fact.term}</dt>
                  <dd className={fact.tone ? `is-${fact.tone}` : undefined}>{fact.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mrp-pacing">{pacingLine(result)}</p>
            {frameStall && (
              <p className="mrp-note" role="note">
                This run hit some frame stalls, so the timing above may have felt uneven.
                That is the machine, not you.
              </p>
            )}
          </section>

          {guidance.length > 0 && (
            <section className="mrp-card" aria-labelledby="mrp-next">
              <h2 className="mrp-card-title" id="mrp-next">
                Try next time
              </h2>
              <ul className="mrp-guidance">
                {guidance.map((tip, index) => (
                  <li key={index}>{tip}</li>
                ))}
              </ul>
            </section>
          )}

          {result.knowledge.asked > 0 && (
            <section className="mrp-card" aria-labelledby="mrp-rounds">
              <h2 className="mrp-card-title" id="mrp-rounds">
                Duel questions
              </h2>
              <p className="mrp-card-sub">
                Each answer only set that round's ammunition — the questions never
                won or lost the duel on their own.
              </p>
              <ol className="mrp-rounds">
                {result.knowledge.rounds.map((round) => (
                  <li
                    key={round.round}
                    className={`mrp-round${round.verdict === "CORRECT" ? " is-correct" : ""}`}
                  >
                    <span className="mrp-round-no">R{round.round}</span>
                    <span className="mrp-round-concept">{humanizeMissionId(round.conceptId)}</span>
                    <span className="mrp-round-verdict">
                      {round.verdict === "CORRECT" ? "Correct" : "Wrong"}
                    </span>
                    <span className="mrp-round-ammo">
                      {round.bullets} {round.bullets === 1 ? "shot" : "shots"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="mrp-side">
          <section className="mrp-card mrp-economy" aria-labelledby="mrp-cost">
            <h2 className="mrp-card-title" id="mrp-cost">
              The attempt
            </h2>
            <div className="mrp-xp">
              <span className="mrp-xp-value">{result.awardedXp}</span>
              <span className="mrp-xp-label">XP</span>
            </div>
            <p className="mrp-xp-note">
              {cleared
                ? `${fraction} of ${result.baseXp} for attempt ${result.attemptOrdinal}.`
                : "A failed attempt pays no XP. Only a cleared mission pays."}
            </p>
            <dl className="mrp-ledger">
              <div>
                <dt>Attempt</dt>
                <dd>
                  {result.attemptOrdinal} of {MAX_MISSION_ATTEMPTS}
                </dd>
              </div>
              <div>
                <dt>Standing</dt>
                <dd>
                  {result.missionSpentAfter
                    ? "Spent — closed for good"
                    : `${result.attemptsRemaining} left`}
                </dd>
              </div>
              <div>
                <dt>Next mission</dt>
                <dd>{result.advancesToNextMission ? "Unlocked" : "Still ahead"}</dd>
              </div>
            </dl>
            <p className="mrp-standing">{nextStep}</p>
          </section>
        </aside>
      </div>

      <footer className="mrp-actions">
        <button type="button" className="mrp-return" onClick={props.onReturn} autoFocus>
          Return to the Archive
        </button>
      </footer>
    </section>
  );
}
