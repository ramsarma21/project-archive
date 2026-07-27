import { useEffect, useState } from "react";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "@pa/duel";
import {
  EvidenceTray,
  evidenceMinimumMet,
  evidenceShortfallHint,
} from "../codex/EvidenceTray.js";
import { pvpOverlayView } from "./pvpQuestionView.js";
import type { MatchSnapshot, QuestionPayload } from "./protocol.js";

// One round's question, wait, verdict and resume countdown — as a large, centered
// overlay in the System's holographic language, over the arena rather than crammed
// into the right sidebar.
//
// THE BULLET NUMBERS ARE IMPORTED, NEVER TYPED. `BULLETS_FOR_CORRECT` /
// `BULLETS_FOR_WRONG` are @pa/duel's own constants, the same two the server derives
// the magazine from, so the display can never promise a count the simulation does not
// grant.
//
// THE COUNTDOWN IS THE SERVER'S. There is no local timer: the "3, 2, 1" is
// `snapshot.resumeCountdownSeconds`, which the authority derives from its own
// `resumesAtTick` and which is non-null only during BULLETS_GRANTED — after BOTH
// verdicts land. While this player waits on the opponent there is no countdown, only
// a wait, because starting one early would be a clock the server is not keeping.
//
// EVIDENCE, NOT A HINT. A question deals an OFFERED HAND — the same collectible
// `ArchiveCard`s the Codex shows, relevant cards mixed indistinguishably with decoys.
// The player drags the ones that back their answer into the evidence tray before they
// write, and the server grades the placement. The old "draws on …" chips are gone:
// they named the relevant cards, which under the evidence mechanic is the answer.

export interface PvpQuestionProps {
  readonly question: QuestionPayload | null;
  readonly snapshot: MatchSnapshot;
  readonly lastVerdict: "CORRECT" | "WRONG" | null;
  /** Why this player's evidence fell short last round, if it did. A class, never the answer. */
  readonly lastEvidence?: string | null;
  readonly answering: boolean;
  readonly reducedMotion?: boolean;
  readonly onSubmit: (text: string, selectedCardIds: readonly string[]) => void;
}

function VerdictLine(props: { verdict: "CORRECT" | "WRONG" | null }) {
  if (!props.verdict) return null;
  const correct = props.verdict === "CORRECT";
  return (
    <div className={`pvp-verdict ${correct ? "pvp-verdict-correct" : "pvp-verdict-wrong"}`}>
      {correct
        ? `Correct — ${BULLETS_FOR_CORRECT} loaded.`
        : `Not quite — ${BULLETS_FOR_WRONG} loaded.`}
    </div>
  );
}

export function PvpQuestion(props: PvpQuestionProps) {
  const { snapshot, question, lastVerdict } = props;
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);

  // A fresh box AND a fresh hand per question, so a previous round's answer or its
  // placed cards cannot be resubmitted by a player who did not notice the round
  // turned over. This is also the round-boundary reset the countdown demands.
  useEffect(() => {
    setText("");
    setSelected([]);
  }, [question?.itemId]);

  const view = pvpOverlayView({ snapshot, question, lastVerdict });
  if (view.mode === "HIDDEN") return null;

  // Only the interactive question card captures the pointer; the wait/countdown
  // banner is inert so movement during BULLETS_GRANTED still reaches the canvas.
  const interactive = view.mode === "QUESTION";

  return (
    <div
      className={`pvp-overlay${props.reducedMotion ? " is-reduced" : ""}`}
      data-mode={view.mode.toLowerCase()}
    >
      <div
        className={`pvp-overlay-card${interactive ? " is-interactive" : ""}`}
        role={interactive ? "form" : "status"}
        aria-live={interactive ? undefined : "polite"}
      >
        {view.mode === "QUESTION" ? (
          <QuestionForm
            view={view}
            text={text}
            setText={setText}
            selected={selected}
            setSelected={setSelected}
            answering={props.answering}
            reducedMotion={props.reducedMotion ?? false}
            onSubmit={props.onSubmit}
          />
        ) : (
          <>
            <div className="pvp-overlay-kicker">Round {view.round}</div>
            <VerdictLine verdict={view.verdict} />
            {view.verdict === "WRONG" && evidenceShortfallHint(props.lastEvidence) && (
              <div className="pvp-evidence-hint" role="note">
                {evidenceShortfallHint(props.lastEvidence)}
              </div>
            )}
            {view.mode === "COUNTDOWN" ? (
              <div className="pvp-countdown">
                <div className="pvp-countdown-copy">Fight resumes in</div>
                <div
                  className="pvp-countdown-number"
                  key={view.seconds}
                  aria-live="assertive"
                >
                  {view.seconds}
                </div>
              </div>
            ) : (
              <div className="pvp-waiting">
                {view.opponentAnswering
                  ? `Waiting for ${snapshot.opponent.handle} to answer. Play resumes when both answers are in.`
                  : "Both answers are in. Play resumes in a moment."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QuestionForm(props: {
  readonly view: { readonly round: number; readonly question: QuestionPayload };
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly selected: readonly string[];
  readonly setSelected: (value: readonly string[]) => void;
  readonly answering: boolean;
  readonly reducedMotion: boolean;
  readonly onSubmit: (text: string, selectedCardIds: readonly string[]) => void;
}) {
  const { view, text, setText, selected, setSelected } = props;
  const minSupport = view.question.minSupport;
  const proseReady = text.trim().length > 0;
  const evidenceReady = evidenceMinimumMet(selected.length, minSupport);
  const ready = proseReady && evidenceReady && !props.answering;
  const submit = (): void => {
    if (ready) props.onSubmit(text, selected);
  };
  return (
    <>
      <div className="pvp-overlay-kicker">Round {view.round} · question</div>
      {view.question.recycled && (
        <div className="pvp-waiting pvp-warn">
          You have been asked this one before — appearance {view.question.appearance}. The
          duel outlasted its bank of questions, so it is coming round again.
        </div>
      )}
      <p className="pvp-question">{view.question.question}</p>
      {view.question.offeredCardIds.length > 0 && (
        <EvidenceTray
          offeredCardIds={view.question.offeredCardIds}
          minSupport={minSupport}
          maxSelectable={view.question.maxSelectable}
          selected={selected}
          onChange={setSelected}
          locked={props.answering}
          reducedMotion={props.reducedMotion}
        />
      )}
      <textarea
        className="pvp-answer"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            submit();
          }
        }}
        placeholder="Answer in your own words. Say what happened and why it mattered."
        maxLength={4000}
        autoFocus
        spellCheck
      />
      <div className="pvp-reward">
        <span>
          Correct: <b>{BULLETS_FOR_CORRECT}</b> loaded
        </span>
        <span>
          Wrong: <b>{BULLETS_FOR_WRONG}</b> loaded
        </span>
      </div>
      <div className="pvp-submit-group">
        {!ready && !props.answering && (
          <span className="pvp-gate" data-testid="pvp-gate">
            {!proseReady
              ? "write an answer"
              : `${selected.length} / ${minSupport} cards`}
          </span>
        )}
        <button
          className="pvp-btn pvp-btn-primary"
          onClick={submit}
          disabled={!ready}
          title={
            ready
              ? undefined
              : !proseReady
                ? "Write your answer first."
                : `Place at least ${minSupport === 1 ? "one card" : `${minSupport} cards`} as evidence.`
          }
        >
          {props.answering ? "Grading…" : "Send answer"}
        </button>
      </div>
      <div className="pvp-waiting pvp-muted">
        Untimed, and private. Your opponent never sees your answer or your cards.
      </div>
    </>
  );
}
