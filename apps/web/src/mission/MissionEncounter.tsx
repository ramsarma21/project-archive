import { useCallback, useEffect, useRef, useState } from "react";
import type { EncounterAuthority } from "./encounterAuthority.js";
import type { ActiveEncounterView, MissionRuntime } from "./traversal.js";
import "./missionEncounter.css";

// ---------------------------------------------------------------------------
// The mission encounter surface — the in-scene half of the cinematic.
//
// A watcher has walked up on the route and is asking the player to argue a case
// HE would accept. The camera has eased into a conversation two-shot (see
// encounterCinematic.ts + MissionStage), the officer is speaking, and this is
// what the player reads and answers WITHIN that shot: the spoken line as a
// cinematic subtitle, the speaker's disposition, and a System-styled answer dock
// docked to the lower third so the two-shot stays visible behind it. It is not a
// modal card dropped over gameplay — the world is the scene and this is part of
// the moment.
//
// It carries NOTHING that could grade an answer — no rubric, no reference, no
// examples. It reads the client-safe projection off the live runtime
// (`runtime.encounterView`), writes the player's submit/dismiss back onto the
// runtime for the fixed step to consume, and calls the authority for the verdict.
// The runtime is the single source of truth; this is a reader and a courier, so
// the cinematic dressing changes nothing about the deterministic machine.
//
// PHASES IT DRAWS:
//   APPROACH   — a slim hail while the officers close, so the hand-over reads as
//                "they come up to you" rather than a freeze with nothing on it.
//   QUESTION   — the spoken prompt as a subtitle + the answer dock.
//   SUBMITTING — the dock, disabled, weighing the answer.
//   RESOLVED   — the in-scene reaction line and the consequence, then "Move on".
//
// Its own CSS namespace (`msn-enc-*`) so it cannot collide with the separately
// owned mission-result styles.
// ---------------------------------------------------------------------------

/** What the officer says as he closes, before the question opens. Kept generic
 *  so every stop (not just the first) reads the same way. */
const APPROACH_HAIL = "Hold there — a word with you.";

/** Generous client cap; the server enforces the real one. */
const MAX_ANSWER_CHARS = 600;

function sameView(a: ActiveEncounterView | null, b: ActiveEncounterView | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.encounterId === b.encounterId &&
    a.phase === b.phase &&
    a.verdictKind === b.verdictKind
  );
}

function resultCopy(view: ActiveEncounterView): {
  readonly headline: string;
  readonly detail: string;
  readonly tone: "reprieve" | "pursuit";
} {
  const role = view.view.speakerRole;
  if (view.verdictKind === "WRONG") {
    return {
      tone: "pursuit",
      headline: "He is not satisfied.",
      detail: `${role} doesn't credit that. He is moving to stop you — go now, while the way is still open.`,
    };
  }
  // CORRECT or the generous GRANTED both buy the reprieve.
  return {
    tone: "reprieve",
    headline: "He stands aside.",
    detail: `${role} accepts it and turns back to his post. You have about ${view.reprieveWorldSeconds} seconds before he is watching again — use them.`,
  };
}

export function MissionEncounter(props: {
  runtime: MissionRuntime;
  authority: EncounterAuthority;
  reducedMotion: boolean;
}) {
  const { runtime, authority } = props;
  const [view, setView] = useState<ActiveEncounterView | null>(
    () => runtime.encounterView,
  );
  // Sampled alongside the view: the cinematic shot has eased in and the speaker
  // is at conversational separation. The answer dock is gated on this so it can
  // never enable while the officer is far or the camera is still handing over.
  const [shotReady, setShotReady] = useState(false);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const submittedForRef = useRef<string | null>(null);

  // Sample the live projection each frame. Only re-render on a change that the
  // overlay actually draws, so a stationary question costs no renders.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const live = runtime.encounterView;
      setView((prev) => (sameView(prev, live) ? prev : live));
      setShotReady((prev) =>
        prev === runtime.encounterShotReady ? prev : runtime.encounterShotReady,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);

  // A new stop, or a fresh attempt, starts with an empty box and no pending grade.
  const activeId = view?.encounterId ?? null;
  useEffect(() => {
    setAnswer("");
    setSubmitting(false);
    submittedForRef.current = null;
  }, [activeId]);

  // Cancel any in-flight grade when the overlay tears down (attempt end, retry).
  useEffect(() => () => abortRef.current?.abort(), []);

  // Focus the box when a question opens, so a keyboard player is typing at once.
  const phase = view?.phase ?? null;
  useEffect(() => {
    if (phase === "QUESTION") textareaRef.current?.focus();
  }, [phase, activeId]);

  const submit = useCallback(() => {
    if (!view || submitting) return;
    if (answer.trim().length === 0) return;
    if (submittedForRef.current === view.encounterId) return;
    submittedForRef.current = view.encounterId;
    // Tell the fixed step this stop was answered: QUESTION -> SUBMITTING.
    runtime.encounterSubmit = view.encounterId;
    setSubmitting(true);
    const controller = new AbortController();
    abortRef.current = controller;
    authority({
      encounterId: view.encounterId,
      itemId: view.view.itemId,
      answer,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        // The verdict lands in the runtime; the machine consumes it next step
        // and resolves the consequence. Never a raw answer, only a kind.
        runtime.encounterVerdictInbox.set(view.encounterId, result.kind);
      })
      .catch(() => {
        // The authority never rejects (it grants on failure), but a truly
        // unexpected throw still must not trap the player: grant.
        if (!controller.signal.aborted) {
          runtime.encounterVerdictInbox.set(view.encounterId, "GRANTED");
        }
      });
  }, [answer, authority, runtime, submitting, view]);

  const dismiss = useCallback(() => {
    if (!view) return;
    runtime.encounterDismiss = view.encounterId;
  }, [runtime, view]);

  if (!view) return null;

  const speaker = view.view;
  const activePhase = view.phase;
  const resolved = activePhase === "RESOLVED";
  const grading = activePhase === "SUBMITTING";
  // The question has opened but the shot is still settling (the camera easing in
  // over the last stride): the officer is already speaking his line, but the
  // dock stays shut for the beat it takes the two-shot to form. This is what
  // makes "the question cannot enable while the shot is unready" true in the UI.
  const settling = activePhase === "QUESTION" && !shotReady;
  const approaching = activePhase === "APPROACH";
  const answerable = (activePhase === "QUESTION" && shotReady) || grading;

  const result = resolved ? resultCopy(view) : null;
  // The line the officer is "saying" this frame — a hail as he closes, the
  // question the moment he's in front of you (even while the shot settles), and
  // the verdict in his own words at the end. The accessible subtitle for the
  // spoken beat as well as the visible one.
  const spokenLine = approaching
    ? APPROACH_HAIL
    : resolved && result
      ? result.headline
      : speaker.prompt;

  return (
    <div
      className={
        `msn-enc is-${activePhase.toLowerCase()}` +
        (settling ? " is-settling" : "") +
        (props.reducedMotion ? " is-reduced" : "") +
        (result ? ` is-${result.tone}` : "")
      }
      onKeyDown={(event) => {
        // Escape must not reach the container's abandon toggle while a forced
        // stop is open: the player answers to move on, they do not walk out of
        // a conversation with a raised pistol by tapping Escape.
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      {/* The spoken beat, framed as an in-scene subtitle rather than a modal
          card. `aria-live` reads the officer's line to a screen reader as it
          changes, which is the subtitle for the spoken audio the design calls
          for. */}
      <div className="msn-enc-say" role="status" aria-live="polite">
        <p className="msn-enc-speaker">
          <span className="msn-enc-role" id="msn-enc-role">
            {speaker.speakerRole}
          </span>
          <span className="msn-enc-affiliation">{speaker.affiliation}</span>
        </p>
        <p className="msn-enc-line" id="msn-enc-prompt">
          {spokenLine}
        </p>
        {resolved && result && (
          <p className="msn-enc-line-detail">{result.detail}</p>
        )}
      </div>

      {/* The answer affordance, in the System's holographic language, docked to
          the lower third so the two-shot stays visible behind it. Not a modal:
          the officer and the player are the scene. */}
      {answerable && (
        <div
          className="msn-enc-dock"
          role="group"
          aria-labelledby="msn-enc-role"
          aria-describedby="msn-enc-prompt"
        >
          <ul className="msn-enc-priorities" aria-label="What he cares about">
            {speaker.priorities.map((priority) => (
              <li className="msn-enc-chip" key={priority}>
                {priority}
              </li>
            ))}
          </ul>
          <p className="msn-enc-hint">{speaker.hint}</p>
          <div className="msn-enc-answer">
            <label className="msn-enc-label" htmlFor="msn-enc-input">
              Your answer to him
            </label>
            <textarea
              id="msn-enc-input"
              ref={textareaRef}
              className="msn-enc-input"
              value={answer}
              maxLength={MAX_ANSWER_CHARS}
              disabled={grading}
              rows={2}
              spellCheck
              aria-describedby="msn-enc-hint-help"
              placeholder="Speak to what he cares about…"
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="msn-enc-foot">
              <span className="msn-enc-help" id="msn-enc-hint-help">
                {grading
                  ? "Weighing your answer…"
                  : `${answer.length}/${MAX_ANSWER_CHARS} · Ctrl/Cmd+Enter to answer`}
              </span>
              <button
                type="button"
                className="msn-enc-submit"
                disabled={grading || answer.trim().length === 0}
                onClick={submit}
              >
                {grading ? "Answering…" : "Answer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resolved && result && (
        <div className="msn-enc-dock is-result">
          {/* A labelled tag, not colour alone: the word says which outcome this
              is, and the border tint only reinforces it. */}
          <p className="msn-enc-tag">
            {result.tone === "reprieve" ? "✓ Reprieve" : "! Pursuit"}
          </p>
          <div className="msn-enc-foot">
            <button
              type="button"
              className="msn-enc-submit"
              autoFocus
              onClick={dismiss}
            >
              Move on
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
