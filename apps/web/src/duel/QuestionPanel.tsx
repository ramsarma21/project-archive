import { useEffect, useRef, useState } from "react";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "@pa/duel";
import type { DuelItemContent } from "./duelItems.js";

// The question, and the free-response box.
//
// UNTIMED, AND SAID SO. The core pauses its clock in QUESTION_PENDING, so there is no
// countdown to draw here and the panel says as much out loud — a player who thinks
// they are being timed writes worse answers. The three-second countdown belongs to the
// beat after the verdict, not to this one.
//
// The box is the only place a player's own words exist in the client. They go to the
// grading authority and nowhere else: not into an event, not into the commit log, and
// in PvP never to the opponent, who would otherwise have an unmoderated chat channel.
//
// A REPEAT IS SAID OUT LOUD. A duel that runs long outlasts its question bank, and
// the core hands over `appearance` and `recycled` rather than quietly re-asking. The
// panel discloses it for the same reason the core does: a student who recognises a
// question and is not told it is a repeat assumes the game has lost its place.

export interface QuestionPanelProps {
  /** An ordinal. There is no total to pair it with and there must not appear to be. */
  readonly round: number;
  readonly item: DuelItemContent;
  /** How many times this item has been asked in this duel, per the core. */
  readonly appearance: number;
  readonly recycled: boolean;
  /** Who is asking: the duel's opponent in PvE, the System in PvP. */
  readonly speaker: string;
  readonly submitting: boolean;
  readonly onSubmit: (answer: string) => void;
  /** Rendered under the box while the authority is being waited on. */
  readonly notice?: string | null;
}

export function QuestionPanel(props: QuestionPanelProps) {
  const [answer, setAnswer] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setAnswer("");
    // The fight has the keyboard the rest of the time, so the box has to claim it.
    boxRef.current?.focus();
  }, [props.item.itemId, props.round]);

  const send = (): void => {
    if (props.submitting) return;
    props.onSubmit(answer.trim());
  };

  return (
    <div className="duel-panel duel-question">
      <div className="duel-panel-head">
        <span className="duel-kicker">
          Round {props.round} · {props.item.conceptLabel}
          {props.recycled && (
            <span className="duel-again"> · asked again</span>
          )}
        </span>
        <span className="duel-kicker duel-kicker-dim">the duel clock is stopped</span>
      </div>

      <p className="duel-speaker">{props.speaker}</p>
      <p className="duel-prompt">“{props.item.prompt}”</p>

      <textarea
        ref={boxRef}
        className="duel-answer"
        value={answer}
        rows={3}
        spellCheck
        placeholder="Answer him."
        disabled={props.submitting}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
          // The duel's own keys must not reach the fight while the box has focus.
          event.stopPropagation();
        }}
      />

      <div className="duel-question-foot">
        <span className="duel-stake">
          Right answer, <strong>{BULLETS_FOR_CORRECT} balls</strong>. Wrong answer,{" "}
          <strong>{BULLETS_FOR_WRONG}</strong>.
        </span>
        <button className="duel-submit" onClick={send} disabled={props.submitting}>
          {props.submitting ? "Sending…" : "Answer"}
        </button>
      </div>

      {props.notice && <p className="duel-notice">{props.notice}</p>}
      <p className="duel-fineprint">
        Take as long as you like — answering spends no duel time. Enter sends;
        Shift+Enter starts a new line.
      </p>
    </div>
  );
}
