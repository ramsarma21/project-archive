import { useEffect, useRef, useState } from "react";
import type { OpenResponsePrompt } from "@pa/contracts";

export interface RetentionConsent {
  policyVersion: string;
  retentionDays: number;
}

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
          <span>ARCHIVE // OPTIONAL REFLECTION</span>
          <strong>Formative—not a grade</strong>
        </header>
        <h2 id="open-response-title">{props.prompt.title}</h2>
        <p id="open-response-prompt">{props.prompt.prompt}</p>

        {props.phase !== "FEEDBACK" ? (
          <>
            <label htmlFor="open-response-text">
              Your response
              <small>
                Aim for {props.prompt.expectedWords.min}–
                {props.prompt.expectedWords.max} words. Spelling and grammar
                are not graded.
              </small>
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
            <div
              className={`open-response-count${validLength ? "" : " invalid"}`}
              aria-live="off"
            >
              {length} / {props.prompt.responseChars.max} characters
              {length < props.prompt.responseChars.min
                ? ` · ${props.prompt.responseChars.min - length} more required`
                : ""}
            </div>
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
                ? "Securing response…"
                : "Submit reflection"}
            </button>
            <small className="open-response-required">
              Once started, submission completes this optional interaction.
              Classification never blocks the story.
            </small>
          </>
        ) : (
          <div className="open-response-feedback">
            <h3>{props.fallback ? "Reflection recorded" : "A connection to carry forward"}</h3>
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
              Return to the exact prior objective
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

