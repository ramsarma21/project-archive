import { useEffect, useRef, useState } from "react";
import type {
  CheckpointDebriefRequest,
  CheckpointGateState,
  PresenterEvent,
} from "@pa/contracts";
import { SystemWindow } from "./Controls.js";

const MACRO_LABELS: Record<string, string> = {
  "RCC.DEBT_POLICY_INTRO": "Postwar debt and British revenue policy",
  "RCC.STAMP_INTERNAL_INTRO": "The Stamp Act as an internal tax",
  "RCC.REPRESENTATION_CAUSE": "Representation as a cause of resistance",
};

// Compressed street-level debrief (design1 feature 3): each required macro
// reads as one of the three things a printer stands behind at the board —
// the headline, the cause line, the evidence — not as an exam category. The
// item stems and options themselves are the untouched authored bank content.
const MACRO_KICKERS: Record<string, string> = {
  "RCC.REPRESENTATION_CAUSE": "The headline you'd defend",
  "RCC.DEBT_POLICY_INTRO": "The cause you'd print under it",
  "RCC.STAMP_INTERNAL_INTRO": "Your best evidence",
};

const GATE_HEADING: Record<CheckpointGateState["hintKind"], string> = {
  MEMORY_CUE: "ARCHIVE // THINK BACK",
  EXPLICIT: "ARCHIVE // ANOTHER WAY TO SAY IT",
  ELIMINATION: "ARCHIVE // NARROWING IT DOWN",
};

// The mastery gate's enforced friction (Archive-Spec R6, locked):
// a required hint dwell, then a pause, before the answers re-enable. The
// runtime computes dwellMs/pauseMs; this component merely enforces them.
// Reduced-motion profiles keep the timing (it is pedagogy, not decoration)
// but drop the progress animation.
function GateCard(props: {
  gate: CheckpointGateState;
  reducedMotion: boolean;
  onReady: () => void;
  ready: boolean;
}) {
  const { gate } = props;
  const total = gate.dwellMs + gate.pauseMs;
  const [remaining, setRemaining] = useState(total);
  const deadline = useRef(0);
  useEffect(() => {
    deadline.current = performance.now() + total;
    setRemaining(total);
    const timer = window.setInterval(() => {
      const left = Math.max(0, deadline.current - performance.now());
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(timer);
        props.onReady();
      }
    }, 200);
    return () => window.clearInterval(timer);
    // A new gate state (attempt) restarts the friction window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.attempt, gate.hintKind, total]);

  return (
    <aside
      className={`checkpoint-gate gate-${gate.hintKind.toLowerCase()}`}
      role="alert"
      data-gate-attempt={gate.attempt}
      data-gate-kind={gate.hintKind}
    >
      <header className="checkpoint-gate-heading">
        {GATE_HEADING[gate.hintKind]}
      </header>
      <p className="checkpoint-gate-hint">{gate.hint}</p>
      {!props.ready && (
        <div className="checkpoint-gate-wait" aria-live="polite">
          <span>
            Take a moment with this before answering again
            {remaining > 0 ? ` (${Math.ceil(remaining / 1000)}s)` : ""}.
          </span>
          {!props.reducedMotion && (
            <i
              className="checkpoint-gate-progress"
              style={{ width: `${100 - (remaining / total) * 100}%` }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </aside>
  );
}

// How often the FORM_SELECTION phase re-attempts a dropped selection commit.
const FORM_SELECTION_RETRY_MS = 700;

export function CheckpointDebrief(props: {
  request: CheckpointDebriefRequest;
  busy: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  // Returns whether the runtime accepted the event (see Play.onEvent).
  onEvent: (event: PresenterEvent) => void | Promise<boolean>;
}) {
  const { request } = props;
  const onEventRef = useRef(props.onEvent);
  onEventRef.current = props.onEvent;
  // DEBRIEF_FORM_SELECTED is presenter-owed: the runtime proposes the form
  // and waits. The commit can be transiently dropped (the plan lands while
  // the DAY_END persist round-trip is still in flight), so this effect
  // retries until the runtime accepts. A latch-first, fire-once emission
  // stranded the debrief on "Locking your authored Day Record…" forever
  // (feel-audit-1 P0-4).
  const acceptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (request.phase !== "FORM_SELECTION" || !request.proposedSelection) {
      return;
    }
    const formId = request.proposedSelection.formId;
    if (acceptedRef.current === formId) return;
    let cancelled = false;
    let timer = 0;
    let attemptInFlight = false;
    const attempt = async () => {
      if (cancelled || attemptInFlight || acceptedRef.current === formId) return;
      attemptInFlight = true;
      try {
        const accepted = await onEventRef.current({
          type: "DEBRIEF_FORM_SELECTED",
          checkpointId: request.checkpointId,
          selection: request.proposedSelection!,
        });
        // Void-returning presenters keep legacy fire-once semantics; only an
        // explicit `false` (guard-dropped commit) schedules a retry.
        if (accepted !== false) {
          acceptedRef.current = formId;
          return;
        }
      } finally {
        attemptInFlight = false;
      }
      if (!cancelled) {
        timer = window.setTimeout(() => void attempt(), FORM_SELECTION_RETRY_MS);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request]);

  const formId =
    request.state.selection?.formId ?? request.proposedSelection?.formId ?? "";
  const rootClass = [
    "checkpoint-debrief",
    props.highContrast ? "is-high-contrast" : "",
    props.reducedMotion ? "is-reduced-motion" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (request.phase === "CONTENT_BLOCKED") {
    return (
      <div className={rootClass} data-checkpoint-phase="CONTENT_BLOCKED">
        <SystemWindow heading="ARCHIVE // CP1 CONTENT GATE">
          <h2>Engineering ready · approval required</h2>
          <p className="checkpoint-copy">
            CP1 cannot open in production until the assessment bank is
            SME-approved. Your Day Record remains safely filed in progress.
          </p>
          <ul className="checkpoint-issues">
            {(request.contentIssues ?? []).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </SystemWindow>
      </div>
    );
  }

  if (request.phase === "FORM_SELECTION") {
    return (
      <div
        className={rootClass}
        data-checkpoint-phase="FORM_SELECTION"
        role="status"
        aria-live="polite"
      >
        <SystemWindow heading="ARCHIVE // BEFORE YOU GO">
          <p className="checkpoint-copy">
            The page is on the board. Three quick calls before the street has
            it…
          </p>
        </SystemWindow>
      </div>
    );
  }

  if (request.phase === "QUESTION" && request.item) {
    return (
      <CheckpointQuestion
        key={`${request.item.itemId}:${request.gate?.attempt ?? 0}`}
        request={request}
        formId={formId}
        rootClass={rootClass}
        busy={props.busy}
        reducedMotion={props.reducedMotion}
        onEvent={props.onEvent}
      />
    );
  }

  if (request.phase === "REVIEW") {
    return (
      <CheckpointReview
        request={request}
        formId={formId}
        rootClass={rootClass}
        busy={props.busy}
        onEvent={props.onEvent}
      />
    );
  }

  return (
    <div className={rootClass} data-checkpoint-phase="TRANSITION">
      <SystemWindow heading="ARCHIVE // FILED">
        <header className="checkpoint-title">
          <span>DAY ONE STANDS</span>
          <h2>Your record is in the ledger</h2>
        </header>
        <p className="checkpoint-copy">
          Everything you did today carries forward with you. The next Boston
          insertion is still being prepared; nothing here will reroll.
        </p>
        <button
          autoFocus
          className="checkpoint-confirm"
          disabled={props.busy}
          onClick={() =>
            props.onEvent({
              type: "ACT_TRANSITIONED",
              eventId: `${formId}.TRANSITION.v1`,
              checkpointId: request.checkpointId,
              formId,
              targetChapterId:
                request.state.nextInsertion?.chapterId ??
                "PA.SEA01.CH02.BOSTON.1770.PENDING.v1",
            })
          }
        >
          DONE FOR THE DAY
        </button>
      </SystemWindow>
    </div>
  );
}

// Compressed review (design1 feature 3): one tap to file, one tap to commit.
// The long-form record is an OPT-IN expander ("annotate the full record")
// carrying the optional never-scored one-liner on the commit event.
function CheckpointReview(props: {
  request: CheckpointDebriefRequest;
  formId: string;
  rootClass: string;
  busy: boolean;
  onEvent: (event: PresenterEvent) => void;
}) {
  const { request, formId } = props;
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [annotation, setAnnotation] = useState("");
  const micros = request.state.selection?.microItemIds.length ?? 0;
  return (
    <div className={props.rootClass} data-checkpoint-phase="REVIEW">
      <SystemWindow heading="ARCHIVE // THE RECORD">
        <header className="checkpoint-title">
          <span>DAY ONE</span>
          <h2>{request.readyToCommit ? "Put it in the ledger" : "Your day, in three calls"}</h2>
        </header>
        <ul className="checkpoint-macros">
          {request.state.macroOutcomes.map((outcome) => (
            <li key={outcome.conceptId}>
              <span aria-hidden="true" />
              {MACRO_KICKERS[outcome.conceptId] ??
                MACRO_LABELS[outcome.conceptId] ??
                outcome.conceptId}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="checkpoint-annotate-toggle"
          aria-expanded={annotateOpen}
          onClick={() => setAnnotateOpen((open) => !open)}
        >
          {annotateOpen ? "Close the full record" : "Annotate the full record (optional)"}
        </button>
        {annotateOpen && (
          <section className="checkpoint-annotate" aria-label="The full record">
            <ul className="checkpoint-macros">
              {request.state.macroOutcomes.map((outcome) => (
                <li key={`full-${outcome.conceptId}`}>
                  <span aria-hidden="true" />
                  {MACRO_LABELS[outcome.conceptId] ?? outcome.conceptId}
                </li>
              ))}
            </ul>
            {micros > 0 && (
              <p className="checkpoint-copy">
                What you explored beyond the run rides along as enrichment. It
                never touches your progress.
              </p>
            )}
            <p className="checkpoint-copy">
              Relationships, the watch's memory of your face, town Standing,
              Threads, routes, and what you carry all come with you.
            </p>
            <label className="checkpoint-annotation-label">
              A line of your own for the record
              <input
                type="text"
                maxLength={160}
                placeholder="(optional)"
                value={annotation}
                onChange={(event) => setAnnotation(event.currentTarget.value)}
              />
            </label>
          </section>
        )}
        {!request.readyToCommit ? (
          <button
            autoFocus
            className="checkpoint-confirm"
            disabled={props.busy}
            onClick={() =>
              props.onEvent({
                type: "DEBRIEF_CONTINUED",
                checkpointId: request.checkpointId,
                formId,
              })
            }
          >
            FILE IT
          </button>
        ) : (
          <button
            autoFocus
            className="checkpoint-confirm"
            disabled={props.busy}
            onClick={() =>
              props.onEvent({
                type: "DEBRIEF_COMMITTED",
                eventId: `${formId}.COMMIT.v1`,
                checkpointId: request.checkpointId,
                formId,
                bankVersion: request.state.bankVersion ?? "",
                ...(annotation.trim()
                  ? { annotation: annotation.trim() }
                  : {}),
              })
            }
          >
            PRINT THE RECORD
          </button>
        )}
      </SystemWindow>
    </div>
  );
}

function CheckpointQuestion(props: {
  request: CheckpointDebriefRequest;
  formId: string;
  rootClass: string;
  busy: boolean;
  reducedMotion: boolean;
  onEvent: (event: PresenterEvent) => void;
}) {
  const { request, formId } = props;
  const item = request.item!;
  const gate = request.gate;
  const isMicro = item.tier === "MICRO";
  const total = request.state.selection?.itemIds.length ?? 0;
  // Answers stay locked until the gate's dwell+pause elapses. No gate =
  // immediately ready. The keyed remount (per attempt) resets this.
  const [gateReady, setGateReady] = useState(!gate);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const disabled = new Set(gate?.disabledOptionIds ?? []);
  const selected = item.options.find(
    (option) => option.optionId === selectedOptionId,
  );
  const selectedCorrect = selectedOptionId === item.correctOptionId;
  const submitSelection = () => {
    if (!selectedOptionId || props.busy) return;
    props.onEvent({
      type: "DEBRIEF_ANSWERED",
      checkpointId: request.checkpointId,
      formId,
      itemId: item.itemId,
      optionId: selectedOptionId,
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (props.busy || !gateReady) return;
      if (selectedOptionId) {
        if (event.key === "Enter") {
          event.preventDefault();
          submitSelection();
        }
        return;
      }
      if (!/^[1-4]$/.test(event.key)) return;
      const option = item.options[Number(event.key) - 1];
      if (!option || disabled.has(option.optionId)) return;
      event.preventDefault();
      setSelectedOptionId(option.optionId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className={props.rootClass} data-checkpoint-phase="QUESTION">
      <SystemWindow
        heading={`TOMORROW'S PAGE // ${request.state.currentItemIndex + 1} OF ${total}`}
      >
        <div className={`checkpoint-tier ${isMicro ? "micro" : "macro"}`}>
          {isMicro
            ? "From what you explored"
            : MACRO_KICKERS[item.conceptId] ?? "The record you stand behind"}
        </div>
        {isMicro && !gate && (
          <p className="checkpoint-enrichment-note">
            You earned this one out on the street. It rides along for interest
            only.
          </p>
        )}
        {(item.provenance || item.era) && (
          <p className="checkpoint-source-context">
            {item.era ? `Context: ${item.era}` : "Historical context"}
            {item.provenance ? ` · Source: ${item.provenance}` : ""}
          </p>
        )}
        <h2 className="checkpoint-stem">{item.stem}</h2>
        {gate && (
          <GateCard
            gate={gate}
            reducedMotion={props.reducedMotion}
            ready={gateReady}
            onReady={() => setGateReady(true)}
          />
        )}
        <div
          className="checkpoint-options"
          role="group"
          aria-label="Response choices"
        >
          {item.options.map((option, index) => {
            const eliminated = disabled.has(option.optionId);
            const isSelected = selectedOptionId === option.optionId;
            return (
              <button
                key={option.optionId}
                className={`checkpoint-option${eliminated ? " is-eliminated" : ""}${isSelected ? " is-selected" : ""}`}
                disabled={
                  props.busy ||
                  eliminated ||
                  !gateReady ||
                  selectedOptionId !== null
                }
                aria-disabled={eliminated || !gateReady}
                aria-pressed={isSelected}
                onClick={() => setSelectedOptionId(option.optionId)}
              >
                <kbd>{index + 1}</kbd>
                {eliminated ? <s>{option.text}</s> : option.text}
              </button>
            );
          })}
        </div>
        {selected && (
          <section
            className={`checkpoint-answer-feedback ${selectedCorrect ? "is-correct" : "is-incorrect"}`}
            role="status"
            aria-live="polite"
          >
            <header>{selectedCorrect ? "That answer holds" : "Look once more"}</header>
            <p>
              {selected.rationale ??
                (selectedCorrect
                  ? "This choice fits the evidence in the question."
                  : "This choice does not fit the question's time, source, or claim.")}
            </p>
            <ul aria-label="Why each choice works or fails">
              {item.options.map((option) => (
                <li
                  key={`rationale-${option.optionId}`}
                  className={
                    option.optionId === item.correctOptionId
                      ? "is-correct"
                      : "is-distractor"
                  }
                >
                  <strong>{option.text}</strong>
                  <span>
                    {option.rationale ??
                      (option.optionId === item.correctOptionId
                        ? "Fits the evidence."
                        : "Does not fit the evidence.")}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="checkpoint-feedback-continue"
              disabled={props.busy}
              onClick={submitSelection}
            >
              {selectedCorrect
                ? "Continue to the next call"
                : "Continue to the hint"}
              <kbd>Enter</kbd>
            </button>
          </section>
        )}
      </SystemWindow>
    </div>
  );
}

export function ActTransitionComplete(props: { onExit: () => void }) {
  return (
    <div className="checkpoint-debrief" data-checkpoint-phase="COMPLETE">
      <SystemWindow heading="ARCHIVE // DAY ONE STANDS">
        <header className="checkpoint-title">
          <span>YOUR PAGE IS ON THE BOARD</span>
          <h2>Boston will wake up reading it</h2>
        </header>
        <p className="checkpoint-copy">
          Everything you did today is kept, exactly as you did it.
        </p>
        <button autoFocus className="checkpoint-confirm" onClick={props.onExit}>
          BACK TO PROFILES
        </button>
      </SystemWindow>
    </div>
  );
}
