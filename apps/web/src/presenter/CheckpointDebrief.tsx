import { useEffect, useRef, useState } from "react";
import type {
  CheckpointDebriefRequest,
  CheckpointGateState,
  DayEndCard,
  PresenterEvent,
} from "@pa/contracts";
import { SystemWindow } from "./Controls.js";

const MACRO_LABELS: Record<string, string> = {
  "RCC.DEBT_POLICY_INTRO": "Postwar debt and British revenue policy",
  "RCC.STAMP_INTERNAL_INTRO": "The Stamp Act as an internal tax",
  "RCC.REPRESENTATION_CAUSE": "Representation as a cause of resistance",
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

export function CheckpointDebrief(props: {
  request: CheckpointDebriefRequest;
  dayRecord?: DayEndCard;
  busy: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  onEvent: (event: PresenterEvent) => void;
}) {
  const { request } = props;
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      request.phase !== "FORM_SELECTION" ||
      !request.proposedSelection ||
      selectedRef.current === request.proposedSelection.formId
    ) {
      return;
    }
    selectedRef.current = request.proposedSelection.formId;
    props.onEvent({
      type: "DEBRIEF_FORM_SELECTED",
      checkpointId: request.checkpointId,
      selection: request.proposedSelection,
    });
  }, [props.onEvent, request]);

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
        <SystemWindow heading="ARCHIVE // CP1">
          <p className="checkpoint-copy">Locking your authored Day Record…</p>
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
    const micros = request.state.selection?.microItemIds.length ?? 0;
    return (
      <div className={rootClass} data-checkpoint-phase="REVIEW">
        <SystemWindow heading="ARCHIVE // CP1 DEBRIEF">
          <header className="checkpoint-title">
            <span>CHECKPOINT ONE</span>
            <h2>Act 1 Day Record</h2>
          </header>
          {props.dayRecord && (
            <section className="checkpoint-day-record">
              <span>ARTIFACT OF RECORD</span>
              <strong>{props.dayRecord.selectedHeadline}</strong>
            </section>
          )}
          <section aria-labelledby="checkpoint-macros">
            <h3 id="checkpoint-macros">Fixed Day Record</h3>
            <ul className="checkpoint-macros">
              {request.state.macroOutcomes.map((outcome) => (
                <li key={outcome.conceptId}>
                  <span aria-hidden="true" />
                  {MACRO_LABELS[outcome.conceptId] ?? outcome.conceptId}
                </li>
              ))}
            </ul>
          </section>
          {micros > 0 && (
            <section
              className="checkpoint-enrichment-summary"
              aria-labelledby="checkpoint-enrichment"
            >
              <h3 id="checkpoint-enrichment">From what you explored</h3>
              <p>
                Your completed field interactions opened an optional enrichment
                record. It remains separate from required learning and progression.
              </p>
            </section>
          )}
          <section className="checkpoint-carry" aria-labelledby="checkpoint-carry">
            <h3 id="checkpoint-carry">Carried forward</h3>
            <p>
              Relationships, known-face and heat consequences, town Standing,
              Threads, routes, custody, and learner evidence remain attached to
              the next insertion.
            </p>
          </section>
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
              CONTINUE TO FILE
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
                })
              }
            >
              COMMIT CHECKPOINT
            </button>
          )}
        </SystemWindow>
      </div>
    );
  }

  return (
    <div className={rootClass} data-checkpoint-phase="TRANSITION">
      <SystemWindow heading="ARCHIVE // ACT TRANSITION">
        <header className="checkpoint-title">
          <span>ACT ONE COMPLETE</span>
          <h2>Next insertion pending</h2>
        </header>
        <p className="checkpoint-copy">
          The 1770 Boston segment is not installed yet. This is a stable
          reinsertion point; CP1 will not reroll.
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
          FILE ACT TRANSITION
        </button>
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
  // Answers stay locked until the gate's dwell+pause elapses. No gate =
  // immediately ready. The keyed remount (per attempt) resets this.
  const [gateReady, setGateReady] = useState(!gate);
  const disabled = new Set(gate?.disabledOptionIds ?? []);
  return (
    <div className={props.rootClass} data-checkpoint-phase="QUESTION">
      <SystemWindow
        heading={
          isMicro ? "ARCHIVE // FROM WHAT YOU EXPLORED" : "ARCHIVE // DAY RECORD"
        }
      >
        <div className={`checkpoint-tier ${isMicro ? "micro" : "macro"}`}>
          {isMicro ? "OPTIONAL ENRICHMENT" : "FIXED DAY RECORD"}
        </div>
        {isMicro && !gate && (
          <p className="checkpoint-enrichment-note">
            This question comes only from an interaction you completed. It is
            enrichment and does not affect progression or your learning record.
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
          {item.options.map((option) => {
            const eliminated = disabled.has(option.optionId);
            return (
              <button
                key={option.optionId}
                className={`checkpoint-option${eliminated ? " is-eliminated" : ""}`}
                disabled={props.busy || eliminated || !gateReady}
                aria-disabled={eliminated || !gateReady}
                onClick={() =>
                  props.onEvent({
                    type: "DEBRIEF_ANSWERED",
                    checkpointId: request.checkpointId,
                    formId,
                    itemId: item.itemId,
                    optionId: option.optionId,
                  })
                }
              >
                {eliminated ? <s>{option.text}</s> : option.text}
              </button>
            );
          })}
        </div>
        <p className="checkpoint-progress" aria-live="polite">
          Record {request.state.currentItemIndex + 1} of{" "}
          {request.state.selection?.itemIds.length ?? 0}
        </p>
      </SystemWindow>
    </div>
  );
}

export function ActTransitionComplete(props: { onExit: () => void }) {
  return (
    <div className="checkpoint-debrief" data-checkpoint-phase="COMPLETE">
      <SystemWindow heading="ARCHIVE // REINSERTION STABLE">
        <header className="checkpoint-title">
          <span>ACT ONE FILED</span>
          <h2>Next insertion pending</h2>
        </header>
        <p className="checkpoint-copy">
          Your complete event-sourced record and carryover are preserved.
        </p>
        <button autoFocus className="checkpoint-confirm" onClick={props.onExit}>
          BACK TO PROFILES
        </button>
      </SystemWindow>
    </div>
  );
}
