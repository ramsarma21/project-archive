import { useEffect, useRef, useState } from "react";
import {
  BULLETS_FOR_CORRECT,
  ENGAGEMENT_SECONDS,
  duelClearedMission,
  type DuelOutcome,
} from "@pa/duel";
import { duelControls } from "./duelInput.js";
import { grantSummary } from "./RoundHud.js";
import type { DuelHud } from "./duelRuntime.js";

// Everything the round says to the player that is not the question box.
//
// The beats are the core's phases, one panel each, and they exist because the phase
// boundaries are the design's dramatic structure rather than bookkeeping: the
// line-of-sight break IS the reload that justifies the round ending, and the bullet
// grant IS knowledge turning into ammunition. Both are told, not implied.
//
// THE FACE-OFF NOW CARRIES THE TERMINATION RULE, which it did not have to when the
// duel was six rounds. A player who is never told how the fight ends and cannot
// count rounds toward it has no way to read their own progress; a player told
// "it ends when one of you goes down" on the first screen reads both health bars
// as the clock for the rest of the duel. One sentence, once, and the HUD does the
// rest.

export function FaceOffTitle(props: { hud: DuelHud; opponentName: string }) {
  const seconds = props.hud.secondsRemaining ?? 0;
  return (
    <div className="duel-faceoff">
      <div className="duel-faceoff-inner">
        <span className="duel-kicker">Boston · 1765 · the rope-walk yard</span>
        <h1>{props.opponentName}</h1>
        <p className="duel-faceoff-line">
          He asks, then you fight for {ENGAGEMENT_SECONDS} seconds, and what you know
          is what you load. It ends when one of you goes down.
        </p>
        <p className="duel-faceoff-count">
          {seconds > 0 ? `${seconds}` : "weapons up"}
        </p>
      </div>
    </div>
  );
}

export function VerdictBeat(props: { hud: DuelHud }) {
  const { hud } = props;
  const grant = hud.grants?.A;
  const verdict = hud.lastVerdict;
  if (!grant) return null;
  const correct = verdict?.kind === "CORRECT";
  return (
    <div className={`duel-panel duel-verdict${correct ? " is-correct" : " is-wrong"}`}>
      <span className="duel-kicker">
        {verdict ? (correct ? "Correct" : "Wrong") : "Verdict in"}
      </span>
      <p className="duel-verdict-grant">
        <strong>{grant.magazine}</strong>
        {grant.magazine === 1 ? " ball" : " balls"} loaded
      </p>
      <p className="duel-verdict-detail">{grantSummary(grant)}</p>
      {verdict?.source === "GRADING_TIMEOUT" && (
        <p className="duel-notice">
          The grader took too long, so you were given the maximum and the answer was
          logged for review.
        </p>
      )}
      <p className="duel-verdict-count">
        Resuming in {hud.secondsRemaining ?? 0}
      </p>
    </div>
  );
}

/**
 * What the round moved, in the only currency that ends the duel.
 *
 * This is the round boundary's job now that there is no round total: a player who
 * cannot count down to the end needs to see that the end got closer. A round that
 * moved nothing says so plainly, which is the honest report and also the right
 * nudge — standing off costs nothing but time, and time is no longer the resource.
 */
function ExchangeLedger(props: { hud: DuelHud }) {
  const exchange = props.hud.roundExchange;
  const dealt = Math.round(exchange.B);
  const taken = Math.round(exchange.A);
  if (dealt === 0 && taken === 0) {
    return <p className="duel-ledger is-still">Neither of you is bleeding yet.</p>;
  }
  return (
    <p className="duel-ledger">
      <span className={dealt > 0 ? "is-dealt" : ""}>
        {dealt > 0 ? `You put ${dealt} into him` : "You did not touch him"}
      </span>
      {" · "}
      <span className={taken > 0 ? "is-taken" : ""}>
        {taken > 0 ? `he put ${taken} into you` : "he did not touch you"}
      </span>
    </p>
  );
}

/** Who is closer to falling, stated as the hits that are actually left. */
function Standing(props: { hud: DuelHud }) {
  const { hitsToFall } = props.hud;
  if (hitsToFall.A === hitsToFall.B) {
    return <p className="duel-standing">Level: {hitsToFall.A} clean hits apiece.</p>;
  }
  const ahead = hitsToFall.B < hitsToFall.A;
  const hits = ahead ? hitsToFall.B : hitsToFall.A;
  return (
    <p className={`duel-standing${ahead ? " is-ahead" : " is-behind"}`}>
      {ahead
        ? `He is ${hits} clean ${hits === 1 ? "hit" : "hits"} from the ground.`
        : `You are ${hits} clean ${hits === 1 ? "hit" : "hits"} from the ground.`}
    </p>
  );
}

export function BreakBeat(props: { hud: DuelHud }) {
  const unspent = props.hud.summary?.unspentA ?? 0;
  return (
    <div className="duel-panel duel-break">
      <span className="duel-kicker">Line of sight broken</span>
      <p>He drops behind cover to reload. A flintlock takes about that long.</p>
      <ExchangeLedger hud={props.hud} />
      <Standing hud={props.hud} />
      {unspent > 0 && (
        <p className="duel-notice">
          {unspent === 1 ? "One ball" : `${unspent} balls`} unfired — they do not carry.
        </p>
      )}
    </div>
  );
}

function outcomeHeadline(outcome: DuelOutcome): string {
  if (outcome.winner === null) return "Drawn";
  if (outcome.winner === "A") {
    return outcome.reason === "KNOCKOUT" ? "He is down" : "You outfought him";
  }
  return outcome.reason === "KNOCKOUT" ? "You are down" : "He outfought you";
}

/**
 * A duel ends by knockout. Anything else is the core's structural backstop firing,
 * which means the fight failed to converge rather than that a count ran out — so
 * the copy names it as the stall it is, and never as a round limit, because there
 * is no round limit to have reached.
 */
function outcomeKicker(outcome: DuelOutcome): string {
  return outcome.reason === "KNOCKOUT" ? "Knockout" : "Neither of you fell";
}

export function OutcomePanel(props: { hud: DuelHud; onExit?: () => void; onAgain?: () => void }) {
  const outcome = props.hud.outcome;
  if (!outcome) return null;
  const cleared = duelClearedMission(outcome);
  return (
    <div className={`duel-panel duel-outcome${cleared ? " is-won" : " is-lost"}`}>
      <span className="duel-kicker">
        {outcomeKicker(outcome)}
        {outcome.tiebreak !== "NONE" && outcome.tiebreak !== "DRAWN"
          ? ` · decided on ${outcome.tiebreak === "HEALTH" ? "damage dealt" : "hits landed"}`
          : ""}
      </span>
      <h2>{outcomeHeadline(outcome)}</h2>
      <p className="duel-outcome-line">
        You {Math.max(0, Math.round(outcome.healthA))} · him{" "}
        {Math.max(0, Math.round(outcome.healthB))}
      </p>
      <p className="duel-outcome-line duel-outcome-verdict">
        {cleared ? "Mission cleared." : "The mission is not cleared."}
      </p>
      <div className="duel-outcome-actions">
        {props.onAgain && (
          <button className="duel-submit" onClick={props.onAgain}>
            Again
          </button>
        )}
        {props.onExit && (
          <button className="duel-ghost" onClick={props.onExit}>
            Leave the yard
          </button>
        )}
      </div>
    </div>
  );
}

/** Red edge on damage taken. Driven by the health the core reported, nothing else. */
export function DamageVignette(props: { health: number }) {
  const previous = useRef(props.health);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (props.health < previous.current) setPulse((value) => value + 1);
    previous.current = props.health;
  }, [props.health]);
  if (pulse === 0) return null;
  return <div key={pulse} className="duel-damage" aria-hidden />;
}

export function ControlsHint(props: { visible: boolean; abilityCount?: number }) {
  if (!props.visible) return null;
  return (
    <div className="duel-controls">
      {duelControls(props.abilityCount ?? 0).map((control) => (
        <span key={control.action}>
          <kbd>{control.keys}</kbd>
          {control.action}
        </span>
      ))}
    </div>
  );
}

/** Live feedback that the boss slipped a ball, so evasion reads as evasion. */
export function EvasionFlash(props: { evadeTick: number; tick: number }) {
  const age = props.tick - props.evadeTick;
  if (props.evadeTick < 0 || age < 0 || age > 42) return null;
  return (
    <div key={props.evadeTick} className="duel-evade" aria-hidden>
      slipped it
    </div>
  );
}

/** Copy for the "you have three balls" moment, kept next to the number it names. */
export const MAX_GRANT_COPY = `${BULLETS_FOR_CORRECT} balls`;
