import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkSelection,
  isExactCheckSelection,
  type ModuleCheck,
} from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The mastery check.
//
// A fieldset placed immediately after a concept card. It pays no XP, is never
// timed, and gates only advancement past its own concept:
//
//   A wrong answer shows misconception-specific feedback for what was chosen
//   and can be revised, without cost — no attempt spent, no XP, and the check
//   is not cleared.
//
//   The correct answer shows concise reinforcement, marks the check mastered
//   and unlocks Continue. Mastery is remembered for the whole run by the
//   player, so going back never forces the check again.
//
// Two shapes, one gate. A single-select is a radio group with one right answer;
// a multiple-select is a checkbox group where the learner must assemble the
// EXACT correct set — every correct statement, no distractor. Both are judged
// by `isExactCheckSelection`, and neither auto-submits: choosing an option only
// stages it, and a separate Check answer button reveals feedback. That is what
// keeps Space (which toggles a focused radio/checkbox) from ever clearing a
// concept by itself.
//
// Accessibility: a real fieldset/legend; radios for single, checkboxes for
// multiple with an explicit "Select all that apply" instruction; each option's
// revealed feedback is linked to it with aria-describedby; focus moves onto the
// check once when it becomes active.
// ---------------------------------------------------------------------------

export function ModuleCheckPanel(props: {
  check: ModuleCheck;
  /** True once the scene has played and the check owns focus. */
  active: boolean;
  /** True when the run has already mastered this check (e.g. after going back). */
  mastered: boolean;
  reducedMotion: boolean;
  onMastered: () => void;
}) {
  const { check } = props;
  const selection = checkSelection(check);
  const multiple = selection === "multiple";

  // Staged choices, and the set that was actually submitted (null before the
  // first submit). Feedback is shown against the submitted set, never the staged
  // one, so revising choices after feedback does not flicker the notes until the
  // learner submits again.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState<ReadonlySet<string> | null>(null);
  const legendRef = useRef<HTMLLegendElement | null>(null);

  const feedbackId = (optionId: string) => `${check.id}-fb-${optionId}`;

  // The check owns focus the moment it becomes active, and only once, so a
  // returning reader is not re-trapped on every render.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (props.active && !props.mastered && !focusedRef.current) {
      focusedRef.current = true;
      legendRef.current?.focus();
    }
    if (!props.active) focusedRef.current = false;
  }, [props.active, props.mastered]);

  const submittedCorrect = submitted !== null && isExactCheckSelection(check, submitted);
  const showAsMastered = props.mastered || submittedCorrect;

  // A correct option the learner left unchecked (multiple-select only). Used to
  // nudge — "some correct choices are still unchecked" — without naming which.
  const missingCorrect =
    submitted !== null &&
    (check.options ?? []).some((option) => option.correct && !submitted.has(option.id));

  const toggle = (optionId: string) => {
    if (showAsMastered) return;
    setSelected((current) => {
      if (!multiple) return new Set([optionId]);
      const next = new Set(current);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };

  const onSubmit = () => {
    if (selected.size === 0 || showAsMastered) return;
    const snapshot = new Set(selected);
    setSubmitted(snapshot);
    if (isExactCheckSelection(check, snapshot)) props.onMastered();
  };

  const submitLabel = submitted === null ? "Check answer" : "Try again";

  return (
    <section
      className={`mod-check${props.active ? " is-active" : ""}${
        showAsMastered ? " is-mastered" : ""
      }`}
      data-selection={selection}
      aria-live="polite"
    >
      <fieldset className="mod-check-set">
        <legend className="mod-check-prompt" tabIndex={-1} ref={legendRef}>
          <span className="mod-check-kicker">Check your understanding</span>
          {check.prompt}
          {multiple && (
            <span className="mod-check-instruction">Select all that apply.</span>
          )}
        </legend>
        {(check.options ?? []).map((option) => {
          const isRevealed = submitted !== null && submitted.has(option.id);
          return (
            <label
              key={option.id}
              className={`mod-check-option${
                isRevealed ? (option.correct ? " is-correct" : " is-wrong") : ""
              }`}
            >
              <input
                type={multiple ? "checkbox" : "radio"}
                name={check.id}
                value={option.id}
                checked={selected.has(option.id)}
                disabled={showAsMastered}
                aria-describedby={isRevealed ? feedbackId(option.id) : undefined}
                onChange={() => toggle(option.id)}
              />
              <span className="mod-check-option-text">{option.text}</span>
              {isRevealed && (
                <span className="mod-check-feedback" id={feedbackId(option.id)} role="note">
                  {option.feedback}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

      {showAsMastered ? (
        <p className="mod-check-reinforce" role="status">
          {check.reinforcement}
        </p>
      ) : (
        <>
          {multiple && submitted !== null && missingCorrect && (
            <p className="mod-check-hint" role="status">
              Not the full set yet. One or more correct statements are still
              unchecked. Choose every statement that is true.
            </p>
          )}
          <button
            type="button"
            className="mod-check-submit"
            onClick={onSubmit}
            disabled={selected.size === 0}
          >
            {submitLabel}
          </button>
        </>
      )}
    </section>
  );
}
