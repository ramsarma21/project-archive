import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import type { MissionResult } from "./result.js";

// ---------------------------------------------------------------------------
// The result screen.
//
// It reports the duel's per-question verdicts and the concepts they touched, and
// it deliberately does not claim demonstration, mint a Codex card, or show a
// competitive rating or a mechanical grade. §4.11's list of what this surface is
// allowed to say is short, and this is it.
//
// The XP line states the fraction as a fraction. A player on the second retry
// should be able to read the exact reason the number is a third of what it could
// have been, rather than discovering a decayed award and inferring the rule.
// ---------------------------------------------------------------------------

export function MissionResultPanel(props: {
  title: string;
  result: MissionResult;
  onReturn: () => void;
}) {
  const result = props.result;
  const cleared = result.outcome === "CLEARED";
  const fraction = `${result.xpFraction.numerator}/${result.xpFraction.denominator}`;

  return (
    <section
      className={`msn-result${cleared ? " is-cleared" : " is-failed"}`}
      aria-labelledby="msn-result-title"
    >
      <span className="msn-result-scan" aria-hidden="true" />

      <header className="msn-result-head">
        <span className="msn-result-kicker">
          {props.title} · attempt {result.attemptOrdinal} of {MAX_MISSION_ATTEMPTS}
        </span>
        <h1 className="msn-result-title" id="msn-result-title">
          {result.headline}
        </h1>
        <p className="msn-result-detail">{result.detail}</p>
      </header>

      <dl className="msn-result-grid">
        <div className="msn-result-cell">
          <dt>Route</dt>
          <dd>
            {result.achievement.traversalCompleted
              ? `Complete in ${Math.round(result.timing.traversalSimulatedS)}s`
              : "Not completed"}
          </dd>
        </div>
        <div className="msn-result-cell">
          <dt>Duel</dt>
          <dd>
            {!result.achievement.duelReached
              ? "Never armed"
              : result.achievement.duelWon
                ? `Won · ${Math.round(result.timing.duelEngagementS)}s of engagement`
                : "Lost"}
          </dd>
        </div>
        <div className="msn-result-cell">
          <dt>Read by a watcher</dt>
          <dd>{result.achievement.detections === 0 ? "Never" : `${result.achievement.detections}×`}</dd>
        </div>
        <div className="msn-result-cell is-xp">
          <dt>XP</dt>
          <dd>
            <span className="msn-result-xp">{result.awardedXp}</span>
            <span className="msn-result-xp-note">
              {cleared
                ? `${fraction} of ${result.baseXp} for attempt ${result.attemptOrdinal}`
                : "A failed attempt pays nothing"}
            </span>
          </dd>
        </div>
      </dl>

      {result.knowledge.asked > 0 && (
        <section className="msn-result-rounds" aria-label="Duel questions">
          <span className="msn-result-section-kicker">
            {result.knowledge.correct} of {result.knowledge.asked} answered · each
            verdict only set that round's ammunition
          </span>
          <ol className="msn-result-round-list">
            {result.knowledge.rounds.map((round) => (
              <li
                key={round.round}
                className={`msn-result-round${round.verdict === "CORRECT" ? " is-correct" : ""}`}
              >
                <span className="msn-result-round-no">R{round.round}</span>
                <span className="msn-result-round-concept">{round.conceptId}</span>
                <span className="msn-result-round-bullets">
                  {round.bullets} {round.bullets === 1 ? "bullet" : "bullets"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Pacing evidence, not a score. The chapter is costed at fourteen missions
          of roughly five minutes and the only figure anyone has is an estimate, so
          every attempt reports what it actually took beside what it was authored
          against. Nothing here changes the outcome or the award. */}
      <section className="msn-result-pacing" aria-label="Pacing">
        {/* The authored budget is the moment dawn breaks on the floor, so it is
            named as that here rather than as an abstract allowance. Every figure
            below is the one the run already reported; nothing on this screen
            computes a second measure of the same seconds. */}
        <span className="msn-result-section-kicker">
          Pacing · dawn at {Math.round(result.timing.traversalBudgetS)}s
        </span>
        <ul className="msn-result-pacing-list">
          <li>
            <span>Traversal, simulated</span>
            <span
              className={
                result.timing.traversalOverBudgetS > 0 ? "is-over" : undefined
              }
            >
              {Math.round(result.timing.traversalSimulatedS)}s
              {result.timing.traversalOverBudgetS > 0
                ? ` (+${Math.round(result.timing.traversalOverBudgetS)}s past dawn)`
                : ""}
            </span>
          </li>
          <li>
            <span>Traversal, wall clock</span>
            <span>{Math.round(result.timing.traversalWallS)}s</span>
          </li>
          <li>
            <span>Module</span>
            <span>{Math.round(result.timing.moduleObservedS)}s</span>
          </li>
          <li>
            <span>Duel, wall clock</span>
            <span>{Math.round(result.timing.duelWallS)}s</span>
          </li>
          <li>
            <span>Whole attempt</span>
            <span>{Math.round(result.timing.attemptWallS)}s</span>
          </li>
          {result.timing.droppedSteps > 0 && (
            <li>
              {/* Said out loud rather than absorbed: with steps dropped, the
                  simulated figure understates the time the student spent. */}
              <span>Simulation steps dropped</span>
              <span className="is-over">{result.timing.droppedSteps}</span>
            </li>
          )}
        </ul>
      </section>

      <footer className="msn-result-actions">
        <span className="msn-result-standing">
          {result.missionSpentAfter
            ? result.outcome === "CLEARED"
              ? "Recorded. Nothing here is owed to you twice."
              : "Spent. This operation is closed and you move on."
            : `${result.attemptsRemaining} of ${MAX_MISSION_ATTEMPTS} attempts left · the module runs again`}
        </span>
        <button type="button" className="msn-result-return" onClick={props.onReturn} autoFocus>
          Return to the hub
        </button>
      </footer>
    </section>
  );
}
