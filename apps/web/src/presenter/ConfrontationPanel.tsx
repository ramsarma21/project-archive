import { useEffect, useRef, useState } from "react";
import type {
  ConfrontationChoice,
  FieldCommittedEvent,
  FieldRuntimeView,
} from "@pa/contracts";
import { dispatchPresentationNotice } from "./noticeArbiter.js";

const CARRIED_LABELS: Record<string, string> = {
  CARRIER_HANDBILLS: "the political handbills",
  PIKE_PROOF: "Pike's proof",
  THOMAS_CIRCULAR: "Thomas's circular",
  CUSTOMHOUSE_NOTICE: "the Custom House notice",
  TAVERN_NOTE: "Thomas's folded note",
  DOCK_BARREL: "the dock barrel",
};

// What the officer will find if the player complies right now.
function exposedCarried(field: FieldRuntimeView): string[] {
  return field.carriedObjectIds
    .filter(
      (objectId) =>
        (field.concealmentByObjectId[objectId] ?? "EXPOSED") === "EXPOSED" &&
        CARRIED_LABELS[objectId],
    )
    .map((objectId) => CARRIED_LABELS[objectId]!);
}

// Why a Talk attempt lands the way it does — surfaced so the outcome reads
// as a system, not a coin flip.
function talkReadout(field: FieldRuntimeView): string {
  if (field.identity.clarkeMarked) {
    return "Clarke has marked you to the watch — your word is worth little here.";
  }
  if (field.heat.band === "HUNTED" || field.heat.band === "WATCHED") {
    return "The street is too hot: the watch has been told to check everyone.";
  }
  if (field.standing.band === "MARKED") {
    return "You are a marked face in this town. Talk will not carry.";
  }
  if (field.standing.band === "NEUTRAL") {
    return "The officer does not know you. A stranger's word carries only so far.";
  }
  return "You are known here — a familiar face can talk its way through.";
}

function aftermathToast(
  outcome: "COMPLIED_CLEAR" | "COMPLIED_CONFISCATED" | "TALK_RELEASED",
  seized: string[],
): string {
  if (outcome === "COMPLIED_CONFISCATED") {
    return `Seized: ${seized.join(", ")} — and an hour gone. The watch knows your face now.`;
  }
  if (outcome === "COMPLIED_CLEAR") {
    return "Nothing to seize — waved through. The officer will remember your face.";
  }
  return "Your standing carried it. Released without a search.";
}

export function ConfrontationPanel(props: {
  field: FieldRuntimeView;
  reducedMotion: boolean;
  onFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>;
}) {
  const confrontation = props.field.activeConfrontation;
  const interrupt = props.field.activeInterrupt;
  const [submitting, setSubmitting] = useState(false);
  const processingKey = useRef<string | null>(null);
  const submitRef = useRef(props.onFieldEvent);
  submitRef.current = props.onFieldEvent;

  const choose = async (choice: ConfrontationChoice) => {
    if (!confrontation || submitting) return;
    setSubmitting(true);
    await props.onFieldEvent({
      type: "FIELD_CONFRONTATION_DECISION",
      eventId: `M2_DECISION_${confrontation.interruptId}_${choice}_${confrontation.phase}`,
      interruptId: confrontation.interruptId,
      choice,
    });
    setSubmitting(false);
  };

  useEffect(() => {
    if (!confrontation || interrupt?.kind !== "CONFRONTATION") return;
    const key = `${confrontation.interruptId}_${confrontation.phase}`;
    if (processingKey.current === key) return;

    if (
      (confrontation.phase === "INSPECTING" ||
        confrontation.phase === "RESOLVING") &&
      (confrontation.outcome === "COMPLIED_CLEAR" ||
        confrontation.outcome === "COMPLIED_CONFISCATED" ||
        confrontation.outcome === "TALK_RELEASED")
    ) {
      processingKey.current = key;
      // Capture what is about to be seized BEFORE resolution moves custody,
      // so the aftermath toast can name it.
      const seized = exposedCarried(props.field);
      const timer = window.setTimeout(
        () => {
          void (async () => {
            for (let attempt = 0; attempt < 20; attempt++) {
              const outcome = confrontation.outcome as
                | "COMPLIED_CLEAR"
                | "COMPLIED_CONFISCATED"
                | "TALK_RELEASED";
              const ok = await submitRef.current({
                type: "FIELD_CONFRONTATION_RESOLVED",
                eventId: `M2_RESOLVE_${confrontation.interruptId}_${confrontation.outcome}`,
                interruptId: confrontation.interruptId,
                outcome,
              });
              if (ok) {
                // The panel unmounts the moment the interrupt clears; the
                // consequence summary persists as an Archive toast so the
                // outcome never just "vanishes".
                window.setTimeout(
                  () =>
                    dispatchPresentationNotice({
                      id: `confrontation:${confrontation.interruptId}:aftermath`,
                      kind: "ARCHIVE_NOTICE",
                      speaker: "ARCHIVE",
                      text: aftermathToast(outcome, seized),
                      durationMs: 4_200,
                      cooldownMs: 30_000,
                      captions: true,
                    }),
                  100,
                );
                return;
              }
              await new Promise((resolve) => window.setTimeout(resolve, 100));
            }
            processingKey.current = null;
          })();
        },
        confrontation.phase === "INSPECTING"
          ? props.reducedMotion
            ? 650
            : 1300
          : props.reducedMotion
            ? 80
            : 500,
      );
      return () => window.clearTimeout(timer);
    }

    if (
      confrontation.phase === "CHASE_ACTIVE" &&
      props.field.activeChase === null
    ) {
      processingKey.current = key;
      void (async () => {
        const commitWithRetry = async (
          event: FieldCommittedEvent,
        ): Promise<boolean> => {
          for (let attempt = 0; attempt < 20; attempt++) {
            if (await submitRef.current(event)) return true;
            await new Promise((resolve) => window.setTimeout(resolve, 100));
          }
          return false;
        };
        if (props.field.heat.band !== "HUNTED") {
          const heat = await commitWithRetry({
            type: "FIELD_HEAT_TRANSITION",
            eventId: `M2_RUN_HEAT_${confrontation.interruptId}`,
            interruptId: confrontation.interruptId,
            from: props.field.heat.band,
            to: "HUNTED",
            cause: "RUN",
          });
          if (!heat) {
            processingKey.current = null;
            return;
          }
        }
        const started = await commitWithRetry({
          type: "FIELD_CHASE_STARTED",
          eventId: `M2_RUN_CHASE_START_${confrontation.interruptId}`,
          interruptId: confrontation.interruptId,
          chaseId: `M2_CHASE_${confrontation.challengeId}`,
          sourceId: confrontation.watcherId,
        });
        if (!started) processingKey.current = null;
      })();
    }
  }, [
    confrontation,
    interrupt?.kind,
    props.field.activeChase,
    props.field.heat.band,
    props.reducedMotion,
  ]);

  if (!confrontation || interrupt?.kind !== "CONFRONTATION") return null;

  const talkFailed = confrontation.phase === "TALK_FAILED";
  const resolving =
    confrontation.phase === "INSPECTING" ||
    confrontation.phase === "RESOLVING" ||
    confrontation.phase === "CHASE_ACTIVE";
  const exposed = exposedCarried(props.field);

  return (
    <section
      className="confrontation-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confrontation-title"
      data-confrontation-phase={confrontation.phase}
      data-confrontation-reason={confrontation.reason}
    >
      <div className="confrontation-glyph" aria-hidden="true">
        !
      </div>
      <div>
        <strong id="confrontation-title">
          {talkFailed ? "The watcher does not accept that answer." : "A watcher stops you."}
        </strong>
        <p>
          {talkFailed
            ? "You can still submit to inspection or run. The route remains open either way."
            : confrontation.reason === "CLARKE_INFORMED"
              ? "Clarke has marked you out to the watch."
              : "The officer demands to know what you are carrying."}
        </p>
        {/* Archive R4 decision-frame: one historical consideration, never the
            answer (Boston-Archive-Spec §5). Shown only while choosing. */}
        {confrontation.phase === "CHOOSING" && !talkFailed && (
          <p className="archive-frame">
            (The officer's writ names no one — and the watch remembers faces
            that run.)
          </p>
        )}
        {/* The stakes are legible BEFORE the choice: what a search will find,
            and how far your word will carry. No hidden dice. */}
        {(confrontation.phase === "CHOOSING" || talkFailed) && (
          <ul className="confrontation-stakes">
            <li>
              {exposed.length > 0
                ? `In your bag, plain to see: ${exposed.join(", ")}.`
                : "Everything you carry is wrapped or hidden — a search finds nothing."}
            </li>
            {!talkFailed && <li>{talkReadout(props.field)}</li>}
          </ul>
        )}
        {talkFailed && (
          <p className="confrontation-reason">{talkReadout(props.field)}</p>
        )}
        {confrontation.phase === "INSPECTING" && (
          <p role="status">The officer opens and inspects the imported paper satchel.</p>
        )}
        {confrontation.phase === "RESOLVING" && (
          <>
            <p role="status">
              {confrontation.outcome === "COMPLIED_CLEAR"
                ? "Nothing to seize. The officer waves you on."
                : "Your account is accepted. The watcher releases you."}
            </p>
            {/* Archive R5 bridge: names the vocabulary the search just taught
                implicitly (writs of assistance). One line, once. */}
            <p className="archive-frame">
              ARCHIVE // That search ran on a writ of assistance — a standing
              warrant that names no one and never expires.
            </p>
          </>
        )}
        {confrontation.phase === "CHASE_ACTIVE" && (
          <p role="status">Movement remains live. Break sight and open a gap.</p>
        )}
      </div>
      {!resolving && (
        <div className="confrontation-options">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void choose("COMPLY")}
          >
            Comply — open the bag
          </button>
          {!talkFailed && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void choose("TALK")}
            >
              Talk — answer the watcher
            </button>
          )}
          <button
            type="button"
            disabled={submitting}
            onClick={() => void choose("RUN")}
          >
            Run — keep moving
          </button>
        </div>
      )}
    </section>
  );
}
