import { useEffect, useRef, useState } from "react";
import {
  BULLETS_FOR_CORRECT,
  ENGAGEMENT_SECONDS,
  duelClearedMission,
  type DuelOutcome,
} from "@pa/duel";
import { duelControls } from "./duelInput.js";
import { grantSummary } from "./RoundHud.js";
import { useLearnOnce } from "./learnOnce.js";
import type { DuelHud } from "./duelRuntime.js";
import type { VerdictOrigin } from "./duelGrading.js";

// Everything the round says to the player that is not the question box.
//
// The beats are the core's phases, one panel each, and they exist because the phase
// boundaries are the design's dramatic structure rather than bookkeeping: the
// bullet grant IS knowledge turning into ammunition, told and not implied.
//
// THE LINE-OF-SIGHT BREAK NO LONGER STOPS THE FIGHT. It used to raise a blocking stat
// card mid-round; the owner retired it because a fight should not pause to show a stat
// block. What that card carried is now redistributed rather than dropped: the one
// genuinely useful line — how many clean hits the opponent is from the ground — lives
// on the persistent combat HUD so it is readable WHILE shooting; the raw damage
// numerals are deleted (unitless, they told a player nothing); the reload narration is
// deleted; and the single real mechanic, that unfired balls do not carry across the
// break, is taught once by `BreakNotice` below and then never again.
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

/**
 * What a generous grant should SAY, told apart by how it was granted.
 *
 * Every case here grants the maximum — that is Mission-Slate §1.7 and it does not
 * change. What changes is the sentence: the verdict's `source` is `GRADING_TIMEOUT`
 * for a client abort, a refused endpoint AND a server-side fallback alike (the wire
 * has one word for "granted without a grade"), so `source` alone cannot tell a slow
 * grader from an unreachable one. The `origin` the authority reported can, and
 * saying "the grader took too long" when the endpoint returned a 404 or a 401 was
 * a lie the player had no way to see through.
 */
function generousGrantNotice(
  origin: VerdictOrigin | null,
  serverFallbackDiagnosis: string | null,
): string | null {
  const logged = "you were given the maximum and your answer was logged for review.";
  switch (origin) {
    case "AUTHORITY_TIMEOUT":
      return `The grader did not answer in time, so ${logged}`;
    case "AUTHORITY_UNREACHABLE":
      return `The grader could not be reached, so ${logged}`;
    case "AUTHORITY":
      // A 200 whose verdict is still a generous grant: the SERVER fell back. Name the
      // server's own diagnosis when it sent one, so a slow model and an unreachable
      // gateway do not read identically to the player either.
      return serverFallbackDiagnosis === "DEADLINE_EXCEEDED"
        ? `The grader did not decide in time, so ${logged}`
        : `The grader could not decide this round, so ${logged}`;
    default:
      // A stand-in or an unknown origin: keep the original, honest-enough copy.
      return `The grader took too long, so ${logged}`;
  }
}

export function VerdictBeat(props: {
  hud: DuelHud;
  /** How the last verdict was obtained, when the screen recorded it. */
  grantOrigin?: VerdictOrigin | null;
  /** The server's fallback diagnosis header, when it granted without grading. */
  serverFallbackDiagnosis?: string | null;
}) {
  const { hud } = props;
  const grant = hud.grants?.A;
  const verdict = hud.lastVerdict;
  if (!grant) return null;
  const correct = verdict?.kind === "CORRECT";
  const notice =
    verdict?.source === "GRADING_TIMEOUT"
      ? generousGrantNotice(
          props.grantOrigin ?? null,
          props.serverFallbackDiagnosis ?? null,
        )
      : null;
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
      {notice && <p className="duel-notice">{notice}</p>}
      <p className="duel-verdict-count">
        Resuming in {hud.secondsRemaining ?? 0}
      </p>
    </div>
  );
}

/** The persisted id of the one-time "unfired balls do not carry" lesson. */
export const DUEL_UNSPENT_BALLS_HINT = "DUEL_UNSPENT_BALLS_EXPIRE";

/**
 * The one mechanic the retired break card had to teach, told without stopping the
 * fight and exactly once per player.
 *
 * A player must learn once that balls left unfired when the round's engagement ends do
 * not carry across the reload. It is shown the first time a break actually discards
 * unspent balls — teaching it on a break that discarded nothing would be teaching a
 * rule with no example — and `useLearnOnce` persists that it has been shown, per
 * player, surviving a reload, using the same local-first store progression uses. After
 * that it never appears again. The notice is non-blocking (see `.duel-learn`): it takes
 * no input and does not pause the fight, unlike the card it replaces.
 */
export function BreakNotice(props: { hud: DuelHud }) {
  const unspent = props.hud.breakUnspentA;
  const active = props.hud.phase === "LINE_OF_SIGHT_BREAK" && unspent > 0;
  const learn = useLearnOnce(DUEL_UNSPENT_BALLS_HINT);
  // Latched per break, NOT read straight off `learn.seen`: `markSeen` flips `seen`
  // the instant the notice appears, and reading `seen` directly would unmount it after
  // one frame. So the reveal decision is taken once — the first eligible break for a
  // player who has not seen it — and held for the life of THAT break; leaving the break
  // phase clears the latch. Because `markSeen` has already persisted (and set `seen`),
  // no later break, duel or reload can pass the `!learn.seen` gate again.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (active && learn.ready && !learn.seen && !revealed) {
      setRevealed(true);
      learn.markSeen();
    }
  }, [active, learn.ready, learn.seen, learn.markSeen, revealed]);
  useEffect(() => {
    if (!active && revealed) setRevealed(false);
  }, [active, revealed]);
  if (!(revealed && active)) return null;
  return (
    <div className="duel-learn" role="status" aria-live="polite">
      <span className="duel-learn-lead">
        {unspent === 1 ? "One ball" : `${unspent} balls`} unfired
      </span>
      <span className="duel-learn-rule"> — they do not carry.</span>
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
