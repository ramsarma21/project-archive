import { useEffect, useRef, useState } from "react";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "@pa/duel";
import {
  EvidenceTray,
  evidenceMinimumMet,
} from "../codex/EvidenceTray.js";
import type { DuelItemContent } from "./duelItems.js";

// The question, the evidence hand, and the free-response box.
//
// UNTIMED, AND SAID SO. The core pauses its clock in QUESTION_PENDING, so there is no
// countdown to draw here and the panel says as much out loud — a player who thinks
// they are being timed writes worse answers. The three-second countdown belongs to the
// beat after the verdict, not to this one.
//
// TWO CLAIMS, ONE SUBMIT. A player now answers with prose AND the Codex cards they
// place to support it. The evidence hand is `EvidenceTray`; the box is the prose. The
// server grades both and the verdict is CORRECT only when both hold, so submit stays
// disabled until at least the minimum cards are placed and the box is non-empty.
//
// ONE SENTENCE, NOT A PARAGRAPH (owner decision, 28 Jul). The evidence placement IS
// the reasoning; the sentence only has to say WHY. So the box invites a single
// sentence and is sized for one — a paragraph took 45-90s to compose and was ~80% of
// the round's wall clock, and the pipeline the grader now rests on
// (content/QUESTION-PIPELINE.md) compares a short answer against a reference core far
// better than it judges an open essay. This is guidance, NOT a gate: nothing here
// rejects a longer answer or enforces a length, because a hard length limit in the
// client is exactly how a correct-but-verbose answer would become a false negative,
// and the false-negative rate is gated at 0.00%. Whether each item's required core
// actually fits one sentence is the grader/content side's to verify (the reference
// answers and required cores live in @pa/grading + content, another lane); if a core
// cannot be carried in a sentence, that item is reported, not this box loosened.
//
// NO RELEVANCE LEAKS. The old "draws on …" chips named the item's own cards — which
// are exactly the relevant ones — and that would hand the player the answer to the new
// evidence mechanic. They are gone: the tray shows the OFFERED hand (relevant cards
// mixed with decoys, indistinguishable), and which are relevant is the server's secret
// until it grades.
//
// The box is the only place a player's own words exist in the client. They go to the
// grading authority and nowhere else.

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
  readonly onSubmit: (answer: string, selectedCardIds: readonly string[]) => void;
  /** Rendered under the box while the authority is being waited on. */
  readonly notice?: string | null;
  readonly reducedMotion?: boolean;
}

export function QuestionPanel(props: QuestionPanelProps) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // A fresh round resets both prose and placed cards, and reclaims the keyboard the
  // fight otherwise holds.
  useEffect(() => {
    setAnswer("");
    setSelected([]);
    boxRef.current?.focus();
  }, [props.item.itemId, props.round]);

  const minSupport = props.item.evidence.minSupport;
  const evidenceReady = evidenceMinimumMet(selected.length, minSupport);
  const proseReady = answer.trim().length > 0;
  const ready = proseReady && evidenceReady && !props.submitting;

  const send = (): void => {
    if (!ready) return;
    props.onSubmit(answer.trim(), selected);
  };

  return (
    <div className="duel-panel duel-question">
      <div className="duel-panel-head">
        <span className="duel-kicker">
          Round {props.round} · {props.item.conceptLabel}
          {props.recycled && <span className="duel-again"> · asked again</span>}
        </span>
        <span className="duel-kicker duel-kicker-dim">the duel clock is stopped</span>
      </div>

      <p className="duel-speaker">{props.speaker}</p>
      <p className="duel-prompt">“{props.item.prompt}”</p>

      {props.item.evidence.offeredCardIds.length > 0 && (
        <EvidenceTray
          offeredCardIds={props.item.evidence.offeredCardIds}
          minSupport={minSupport}
          maxSelectable={props.item.evidence.maxSelectable}
          selected={selected}
          onChange={setSelected}
          locked={props.submitting}
          {...(props.reducedMotion === undefined
            ? {}
            : { reducedMotion: props.reducedMotion })}
        />
      )}

      <textarea
        ref={boxRef}
        className="duel-answer"
        value={answer}
        rows={2}
        spellCheck
        placeholder="One sentence — say why your evidence proves it."
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
          Right <strong>{BULLETS_FOR_CORRECT}</strong> · wrong{" "}
          <strong>{BULLETS_FOR_WRONG}</strong>
        </span>
        <div className="duel-submit-group">
          {!ready && !props.submitting && (
            <span className="duel-gate" data-testid="duel-gate">
              {!proseReady
                ? "write an answer"
                : `${selected.length} / ${minSupport} cards`}
            </span>
          )}
          <button
            className="duel-submit"
            onClick={send}
            disabled={!ready}
            title={
              ready
                ? undefined
                : !proseReady
                  ? "Write your answer first."
                  : `Place at least ${minSupport === 1 ? "one card" : `${minSupport} cards`} as evidence.`
            }
          >
            {props.submitting ? "Sending…" : "Answer"}
          </button>
        </div>
      </div>

      {props.notice && <p className="duel-notice">{props.notice}</p>}
      <p className="duel-fineprint">
        Untimed. A sentence is enough. Enter sends, Shift+Enter for a new line.
      </p>
    </div>
  );
}
