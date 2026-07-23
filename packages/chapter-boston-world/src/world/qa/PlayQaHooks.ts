import { useEffect, useRef } from "react";
import type {
  ExecutionPlan,
  FieldCommittedEvent,
  RuntimeView,
} from "@pa/contracts";
import {
  M1_QA_CONTRACT,
  qaChaseEligibility,
  qaChaseStartEvents,
  type QaChaseResult,
} from "../qaChaseContract.js";
import { presentationCueReady } from "@pa/engine-world";
import { QA_RUNTIME_ENABLED } from "../qaEnvironment.js";

// QA-only Play-level window hooks, gated on QA_RUNTIME_ENABLED (no-ops in
// production builds). Moved verbatim from Play.tsx.

// Exposes __PA_FIELD_EVENT__ so browser harnesses can commit durable field
// events through the exact production pipeline.
export function useFieldEventQaHook(
  onFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>,
): void {
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type FieldQaWindow = Window & {
      __PA_FIELD_EVENT__?: (
        event: FieldCommittedEvent,
      ) => Promise<boolean>;
    };
    const qaWindow = window as FieldQaWindow;
    qaWindow.__PA_FIELD_EVENT__ = onFieldEvent;
    return () => {
      delete qaWindow.__PA_FIELD_EVENT__;
    };
  }, [onFieldEvent]);
}

// Installs __PA_QA_CHASE__ plus the M1 QA start event/keyboard shortcut:
// starts a chase through the production field-event pipeline and publishes
// the result on the play root's dataset + a window event.
export function useQaChaseHook(args: {
  playRootRef: { current: HTMLDivElement | null };
  // The production commit-in-flight ref: QA eligibility treats an in-flight
  // commit as busy.
  commitInFlightRef: { current: boolean };
  eventsRef: { current: unknown[] };
  onFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>;
  plan: ExecutionPlan | null;
  view: RuntimeView | null;
  error: string | null;
  readyCueId: string | null;
}): void {
  const { playRootRef, commitInFlightRef, eventsRef } = args;
  const onFieldEventRef = useRef(args.onFieldEvent);
  onFieldEventRef.current = args.onFieldEvent;
  const qaStartInFlightRef = useRef(false);
  const qaSnapshotRef = useRef({
    request: args.plan?.request ?? null,
    field: args.view?.field ?? null,
    error: args.error,
    choreographyReady: presentationCueReady(args.plan?.cueId, args.readyCueId),
  });
  qaSnapshotRef.current = {
    request: args.plan?.request ?? null,
    field: args.view?.field ?? null,
    error: args.error,
    choreographyReady: presentationCueReady(args.plan?.cueId, args.readyCueId),
  };

  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type QaWindow = Window & {
      __PA_QA_CHASE__?: () => Promise<QaChaseResult>;
    };
    const qaWindow = window as QaWindow;
    const publish = (result: QaChaseResult): QaChaseResult => {
      const root = playRootRef.current;
      if (root) {
        root.dataset.qaChaseStatus = result.status;
        root.dataset.qaChaseReason = result.reason;
      }
      window.dispatchEvent(
        new CustomEvent<QaChaseResult>(M1_QA_CONTRACT.resultEvent, {
          detail: result,
        }),
      );
      return result;
    };
    const start = async (): Promise<QaChaseResult> => {
      const eligibility = qaChaseEligibility({
        ...qaSnapshotRef.current,
        busy: commitInFlightRef.current,
      });
      if (eligibility) return publish(eligibility);
      if (qaStartInFlightRef.current) {
        return publish({
          ok: false,
          status: "BUSY",
          reason: "A QA chase start is already in flight.",
        });
      }
      qaStartInFlightRef.current = true;
      const field = qaSnapshotRef.current.field!;
      const suffix = `${field.seedHex.slice(-8)}_${eventsRef.current.length}`;
      const built = qaChaseStartEvents({
        suffix,
        heatBand: field.heat.band,
      });
      // Keep one eligibility snapshot for the interrupt envelope. React
      // publishes the intermediate CONFRONTATION plan after event one; using a
      // newly rendered callback for event two would reject on that transient
      // cue even though the runtime is correctly waiting for CHASE_STARTED.
      const commitEnvelopeEvent = onFieldEventRef.current;
      try {
        for (const event of built.events) {
          if (playRootRef.current) {
            playRootRef.current.dataset.qaChaseStep =
              `COMMITTING_${event.type}`;
          }
          const committed = await commitEnvelopeEvent(event);
          if (!committed) {
            return publish({
              ok: false,
              status: "COMMIT_REJECTED",
              reason: `Runtime rejected ${event.type}.`,
              interruptId: built.interruptId,
              chaseId: built.chaseId,
            });
          }
          if (playRootRef.current) {
            playRootRef.current.dataset.qaChaseStep =
              `COMMITTED_${event.type}`;
          }
        }
        return publish({
          ok: true,
          status: "STARTED",
          reason: "QA chase started.",
          interruptId: built.interruptId,
          chaseId: built.chaseId,
        });
      } finally {
        qaStartInFlightRef.current = false;
      }
    };
    qaWindow.__PA_QA_CHASE__ = start;
    const root = playRootRef.current;
    if (root) {
      root.dataset.qaChaseHook = "READY";
      root.dataset.qaChaseStatus = "IDLE";
      root.dataset.qaChaseReason = "";
    }
    const onCommand = () => {
      void start().then((result) => {
        console.info(`[m1-qa] ${result.status}: ${result.reason}`);
      });
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (
        event.code === M1_QA_CONTRACT.shortcutCode &&
        !event.repeat &&
        !editable
      ) {
        onCommand();
      }
    };
    window.addEventListener(M1_QA_CONTRACT.startEvent, onCommand);
    window.addEventListener("keydown", onKey);
    return () => {
      if (qaWindow.__PA_QA_CHASE__ === start) {
        delete qaWindow.__PA_QA_CHASE__;
      }
      window.removeEventListener(M1_QA_CONTRACT.startEvent, onCommand);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
