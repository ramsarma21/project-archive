import { useEffect, useState } from "react";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "@pa/duel";
import type { MatchSnapshot, QuestionPayload } from "./protocol.js";

// One round's question.
//
// THE BULLET NUMBERS ARE IMPORTED, NEVER TYPED. `BULLETS_FOR_CORRECT` and
// `BULLETS_FOR_WRONG` are @pa/duel's own constants, and the server derives the
// magazine from the same two. Restating them here as literals would let the screen
// promise a number the simulation does not grant, which is the one kind of lie
// this architecture is built to make impossible — so when the duel's tuning moves,
// this display moves with it and cannot be left behind.
//
// THERE IS NO TIMER. The answering phase is deliberately untimed: these are open
// responses that want evidence in them, and a countdown would buy legibility by
// making the thinking worse. Progress lives in the health readout instead.

export interface PvpQuestionProps {
  readonly question: QuestionPayload | null;
  readonly snapshot: MatchSnapshot;
  readonly lastVerdict: "CORRECT" | "WRONG" | null;
  readonly answering: boolean;
  readonly onSubmit: (text: string) => void;
}

export function PvpQuestion(props: PvpQuestionProps) {
  const { question, snapshot, lastVerdict } = props;
  const [text, setText] = useState("");

  // A fresh box per question, so a previous round's answer cannot be resubmitted
  // by a player who did not notice the round turned over.
  useEffect(() => {
    setText("");
  }, [question?.itemId]);

  if (question) {
    const ready = text.trim().length > 0 && !props.answering;
    return (
      <div className="pvp-panel">
        <div className="pvp-panel-title">Round {snapshot.round} · question</div>
        {question.recycled && (
          <div className="pvp-waiting pvp-warn">
            You have been asked this one before — appearance {question.appearance}. The
            duel outlasted its bank of questions, so it is coming round again.
          </div>
        )}
        <p className="pvp-question">{question.question}</p>
        <textarea
          className="pvp-answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) {
              props.onSubmit(text);
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
        <button
          className="pvp-btn pvp-btn-primary"
          onClick={() => props.onSubmit(text)}
          disabled={!ready}
        >
          {props.answering ? "Grading…" : "Send answer"}
        </button>
        <div className="pvp-waiting pvp-muted">
          Take the time you need — there is no clock on this part. Your opponent never
          sees what you wrote.
        </div>
      </div>
    );
  }

  if (snapshot.phase === "QUESTION_PENDING" || snapshot.phase === "VERDICT_COMMITTED") {
    return (
      <div className="pvp-panel">
        <div className="pvp-panel-title">Round {snapshot.round}</div>
        {lastVerdict && (
          <div
            className={`pvp-verdict ${
              lastVerdict === "CORRECT" ? "pvp-verdict-correct" : "pvp-verdict-wrong"
            }`}
          >
            {lastVerdict === "CORRECT"
              ? `Correct — ${BULLETS_FOR_CORRECT} loaded.`
              : `Not quite — ${BULLETS_FOR_WRONG} loaded.`}
          </div>
        )}
        <div className="pvp-waiting">
          {snapshot.opponent.answering
            ? `Waiting for ${snapshot.opponent.handle} to answer. Play resumes when both answers are in.`
            : "Both answers are in. Play resumes in a moment."}
        </div>
      </div>
    );
  }

  return (
    <div className="pvp-panel">
      <div className="pvp-panel-title">Round {snapshot.round}</div>
      {lastVerdict && (
        <div
          className={`pvp-verdict ${
            lastVerdict === "CORRECT" ? "pvp-verdict-correct" : "pvp-verdict-wrong"
          }`}
        >
          {lastVerdict === "CORRECT"
            ? `Correct — ${BULLETS_FOR_CORRECT} loaded.`
            : `Not quite — ${BULLETS_FOR_WRONG} loaded.`}
        </div>
      )}
      <div className="pvp-waiting">
        Fight. The next question comes when this exchange resolves.
      </div>
    </div>
  );
}
