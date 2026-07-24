import { useEffect, useRef, useState } from "react";
import type { OpenResponsePrompt } from "@pa/contracts";

export interface RetentionConsent {
  policyVersion: string;
  retentionDays: number;
}

const OPERATION_LABELS: Record<OpenResponsePrompt["operation"], string> = {
  COMPARE_SOURCES: "Compare two pieces of evidence",
  APPLY_CONCEPT: "Apply an idea to what happened",
  HISTORICAL_PERSPECTIVE: "Write from a historical point of view",
  STRATEGY_JUSTIFICATION: "Support a decision with evidence",
  CAUSAL_SYNTHESIS: "Explain what caused the change",
};

export function OpenResponsePanel(props: {
  prompt: OpenResponsePrompt;
  authenticated: boolean;
  phase: "COMPOSE" | "PENDING" | "FEEDBACK";
  feedback: readonly string[];
  fallback: boolean;
  retained: boolean;
  closeEnabled: boolean;
  onSubmit: (responseText: string, consent: RetentionConsent | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [consented, setConsented] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const length = draft.length;
  const validLength =
    length >= props.prompt.responseChars.min &&
    length <= props.prompt.responseChars.max;
  const canSubmit =
    props.phase === "COMPOSE" &&
    validLength &&
    (!props.authenticated || consented);

  useEffect(() => {
    textarea.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        props.phase === "FEEDBACK" &&
        props.closeEnabled
      ) {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.closeEnabled, props.onClose, props.phase]);

  return (
    <div className="open-response-backdrop">
      <section
        className="open-response-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-response-title"
        aria-describedby="open-response-prompt"
      >
        <header>
          <span>ARCHIVE // A LINE OF YOUR OWN</span>
          <strong>Say it the way you would print it</strong>
        </header>
        <h2 id="open-response-title">{props.prompt.title}</h2>
        <p id="open-response-prompt">{props.prompt.prompt}</p>
        <aside className="open-response-context" aria-label="Response context">
          <strong>{OPERATION_LABELS[props.prompt.operation]}</strong>
          <span>
            Use the {props.prompt.sourcePacket.sourceIds.length}{" "}
            {props.prompt.sourcePacket.sourceIds.length === 1
              ? "source"
              : "sources"}{" "}
            you already handled today.
          </span>
        </aside>

        {props.phase !== "FEEDBACK" ? (
          <>
            <label htmlFor="open-response-text">
              Your line
              <small>A sentence or two in your own words is plenty.</small>
            </label>
            <textarea
              ref={textarea}
              id="open-response-text"
              value={draft}
              minLength={props.prompt.responseChars.min}
              maxLength={props.prompt.responseChars.max}
              disabled={props.phase === "PENDING"}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  (event.ctrlKey || event.metaKey) &&
                  event.key === "Enter" &&
                  canSubmit
                ) {
                  props.onSubmit(
                    draft,
                    props.authenticated
                      ? {
                          policyVersion: "PA.FORMATIVE.PRIVACY.v1",
                          retentionDays,
                        }
                      : null,
                  );
                }
              }}
            />
            {/* Length validation is unchanged underneath (the grading service
                keeps its contract); the UI only offers a quiet hint instead
                of a live counter (design1 kill list). */}
            {length > 0 && !validLength && (
              <div className="open-response-hint" aria-live="off">
                {length < props.prompt.responseChars.min
                  ? "Give it one more beat and it can hold the page."
                  : "Trim it a little; a page line runs short."}
              </div>
            )}
            {props.authenticated ? (
              <fieldset className="open-response-privacy">
                <legend>Encrypted educator review</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={consented}
                    disabled={props.phase === "PENDING"}
                    onChange={(event) =>
                      setConsented(event.currentTarget.checked)
                    }
                  />
                  I consent to encrypted retention for authorized educator
                  review under policy PA.FORMATIVE.PRIVACY.v1. I can request
                  export, correction, or deletion.
                </label>
                <label>
                  Retain for
                  <select
                    value={retentionDays}
                    disabled={props.phase === "PENDING"}
                    onChange={(event) =>
                      setRetentionDays(Number(event.currentTarget.value))
                    }
                  >
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </label>
              </fieldset>
            ) : (
              <p className="open-response-local">
                Local/offline profile: this text is used only to complete this
                panel. It is not retained, uploaded, or graded by a provider.
              </p>
            )}
            <button
              type="button"
              className="system-confirm"
              disabled={!canSubmit}
              onClick={() =>
                props.onSubmit(
                  draft,
                  props.authenticated
                    ? {
                        policyVersion: "PA.FORMATIVE.PRIVACY.v1",
                        retentionDays,
                      }
                    : null,
                )
              }
            >
              {props.phase === "PENDING"
                ? "Reading your line…"
                : "Submit this line"}
            </button>
            <small className="open-response-required">
              Optional, and never marked. Finish the line and the street takes
              you back.
            </small>
          </>
        ) : (
          <div className="open-response-feedback">
            <h3>{props.fallback ? "Filed with the day" : "A connection to carry forward"}</h3>
            {props.feedback.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {props.fallback && (
              <small>
                Authored fallback was used. Provider availability did not
                affect your progress.
              </small>
            )}
            {props.authenticated && !props.retained && (
              <small>
                Secure retention was unavailable. This text was not retained
                or represented as provider-graded.
              </small>
            )}
            <button
              type="button"
              className="system-confirm"
              disabled={!props.closeEnabled}
              onClick={props.onClose}
            >
              Back to the street
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

