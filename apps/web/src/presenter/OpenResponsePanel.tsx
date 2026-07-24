import { useEffect, useRef, useState } from "react";
import type {
  OpenResponsePrompt,
  TypesetComposition,
} from "@pa/contracts";
import { getDocumentImageUrl } from "@pa/chapter-boston-world";

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

const CLAIMS: Record<
  OpenResponsePrompt["operation"],
  readonly { id: string; label: string }[]
> = {
  COMPARE_SOURCES: [
    { id: "CLAIM.COMPARE.COST", label: "One gives the reason; one shows the cost" },
    { id: "CLAIM.COMPARE.AGREE", label: "The sources reinforce each other" },
    { id: "CLAIM.COMPARE.TENSION", label: "The sources pull in different directions" },
  ],
  APPLY_CONCEPT: [
    { id: "CLAIM.APPLY.EXPLAINS", label: "This idea explains what happened" },
    { id: "CLAIM.APPLY.LIMIT", label: "This idea explains only part of it" },
    { id: "CLAIM.APPLY.CHANGES", label: "The event changes how the idea reads" },
  ],
  HISTORICAL_PERSPECTIVE: [
    { id: "CLAIM.POV.SUPPORT", label: "This person would support the choice" },
    { id: "CLAIM.POV.RESIST", label: "This person would resist the choice" },
    { id: "CLAIM.POV.DIVIDED", label: "This person would feel divided" },
  ],
  STRATEGY_JUSTIFICATION: [
    { id: "CLAIM.STRATEGY.WORTH", label: "The risk was worth taking" },
    { id: "CLAIM.STRATEGY.COSTLY", label: "The cost outweighed the gain" },
    { id: "CLAIM.STRATEGY.ALTERNATE", label: "Another route would work better" },
  ],
  CAUSAL_SYNTHESIS: [
    { id: "CLAIM.CAUSE.POLICY", label: "Policy set the change in motion" },
    { id: "CLAIM.CAUSE.ENFORCEMENT", label: "Enforcement made the change felt" },
    { id: "CLAIM.CAUSE.RESPONSE", label: "Boston's response widened the effect" },
  ],
};

function evidenceLabel(id: string): string {
  return id
    .split(/[.:_-]/)
    .filter(Boolean)
    .slice(-3)
    .join(" ")
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function OpenResponsePanel(props: {
  prompt: OpenResponsePrompt;
  authenticated: boolean;
  phase: "COMPOSE" | "PENDING" | "FEEDBACK";
  feedback: readonly string[];
  fallback: boolean;
  retained: boolean;
  closeEnabled: boolean;
  onSubmit: (
    composition: TypesetComposition,
    consent: RetentionConsent | null,
  ) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [claimId, setClaimId] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [consented, setConsented] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const validLength =
    draft.trim().length > 0 &&
    draft.length <= props.prompt.responseChars.max;
  const canSubmit =
    props.phase === "COMPOSE" &&
    validLength &&
    Boolean(claimId) &&
    evidenceIds.length > 0 &&
    (!props.authenticated || consented);
  const selectedClaim =
    CLAIMS[props.prompt.operation].find((claim) => claim.id === claimId)
      ?.label ?? "";
  const composition = (): TypesetComposition => ({
    claimId,
    evidenceIds,
    learnerLine: draft.trim(),
  });

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
          <span>COMPOSING STICK // MINI-BROADSIDE</span>
          <strong>Set the claim · lock evidence · pull your line</strong>
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
          <div className="typeset-workbench">
            <fieldset className="typeset-chips">
              <legend>1 · Set a claim</legend>
              {CLAIMS[props.prompt.operation].map((claim) => (
                <button
                  key={claim.id}
                  type="button"
                  aria-pressed={claimId === claim.id}
                  disabled={props.phase === "PENDING"}
                  onClick={() => setClaimId(claim.id)}
                >
                  {claim.label}
                </button>
              ))}
            </fieldset>
            <fieldset className="typeset-chips evidence">
              <legend>2 · Set the evidence</legend>
              {props.prompt.sourcePacket.sourceIds.map((evidenceId) => {
                const selected = evidenceIds.includes(evidenceId);
                return (
                  <button
                    key={evidenceId}
                    type="button"
                    aria-pressed={selected}
                    disabled={props.phase === "PENDING"}
                    onClick={() =>
                      setEvidenceIds((current) =>
                        selected
                          ? current.filter((id) => id !== evidenceId)
                          : [...current, evidenceId],
                      )
                    }
                  >
                    {evidenceLabel(evidenceId)}
                  </button>
                );
              })}
            </fieldset>
            <label htmlFor="open-response-text" className="composing-stick">
              <span>3 · Add your line</span>
              <small>Your own reason is the line that makes this yours.</small>
              <textarea
                ref={textarea}
                id="open-response-text"
                value={draft}
                maxLength={props.prompt.responseChars.max}
                disabled={props.phase === "PENDING"}
                placeholder="Set one short line in your own words…"
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === "Enter" &&
                    canSubmit
                  ) {
                    props.onSubmit(
                      composition(),
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
            </label>
            <section
              className="mini-broadside"
              aria-label="Mini-broadside preview"
              style={{ backgroundImage: `url(${getDocumentImageUrl("BLANK_SHEET")})` }}
            >
              <span>Mercer's Press · A connection</span>
              <strong>{selectedClaim || "Set a claim above"}</strong>
              <p>{draft.trim() || "Your line will sit here."}</p>
              <small>
                {evidenceIds.length > 0
                  ? `Evidence: ${evidenceIds.map(evidenceLabel).join(" · ")}`
                  : "Choose at least one piece of evidence."}
              </small>
            </section>
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
                  composition(),
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
                ? "Setting the forme…"
                : "Print mini-broadside"}
            </button>
            <small className="open-response-required">
              Optional, never gating, and it will not advance without you.
            </small>
          </div>
        ) : (
          <div className="open-response-feedback">
            <h3>{props.fallback ? "Pulled and filed with the day" : "Fresh from the press"}</h3>
            <section
              className="mini-broadside printed"
              aria-label="Printed mini-broadside"
              style={{ backgroundImage: `url(${getDocumentImageUrl("BLANK_SHEET")})` }}
            >
              <span>Mercer's Press · Archive copy</span>
              <strong>{selectedClaim}</strong>
              <p>{draft.trim()}</p>
              <small>
                Evidence: {evidenceIds.map(evidenceLabel).join(" · ")}
              </small>
            </section>
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

