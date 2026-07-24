import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExecutionPlan,
  FieldCommittedEvent,
  OpenResponseReference,
  RuntimeView,
  TypesetComposition,
} from "@pa/contracts";
import type { LocalProfile } from "../../db.js";
import { submitOpenResponse } from "../../gradingClient.js";
import {
  authoredFallbackForPrompt,
  authoredFeedback,
} from "@pa/chapter-boston";
import type { RetentionConsent } from "../OpenResponsePanel.js";

// ---------------------------------------------------------------------------
// Optional open-response reflection flow (three-phase state machine):
//   COMPOSE -> PENDING -> FEEDBACK, with a close-dwell timer in FEEDBACK and
// a resume path that rebuilds FEEDBACK from committed evidence when a save is
// resumed mid-interrupt. Moved verbatim from Play.tsx; every callback keeps
// its original dependency list.
// ---------------------------------------------------------------------------

export type OpenResponsePhase = "COMPOSE" | "PENDING" | "FEEDBACK";

export interface OpenResponseFlow {
  phase: OpenResponsePhase;
  feedback: string[];
  fallback: boolean;
  retained: boolean;
  closeEnabled: boolean;
  begin: (promptId: string) => Promise<void>;
  submit: (
    composition: TypesetComposition,
    consent: RetentionConsent | null,
  ) => Promise<void>;
  close: () => Promise<void>;
}

export function useOpenResponseFlow(args: {
  view: RuntimeView | null;
  plan: ExecutionPlan | null;
  busy: boolean;
  profile: LocalProfile;
  apiUp: boolean;
  onFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>;
}): OpenResponseFlow {
  const { view, plan, busy, profile, onFieldEvent } = args;
  const [openResponsePhase, setOpenResponsePhase] = useState<
    "COMPOSE" | "PENDING" | "FEEDBACK"
  >("COMPOSE");
  const [openResponseFeedback, setOpenResponseFeedback] = useState<string[]>([]);
  const [openResponseFallback, setOpenResponseFallback] = useState(false);
  const [openResponseRetained, setOpenResponseRetained] = useState(false);
  const [openResponseCloseEnabled, setOpenResponseCloseEnabled] = useState(false);
  const openResponseDwellTimer = useRef(0);
  useEffect(() => () => {
    window.clearTimeout(openResponseDwellTimer.current);
  }, []);

  const beginOpenResponse = useCallback(
    async (promptId: string) => {
      if (
        !view ||
        (plan?.request.kind !== "FREE_ROAM" &&
          plan?.request.kind !== "BREATHER") ||
        view?.field.activeInterrupt ||
        busy
      ) {
        return;
      }
      const interruptId = `OPEN_${promptId}_${view.field.interactionOrdinal + 1}`;
      const opened = await onFieldEvent({
        type: "FIELD_OPEN_RESPONSE_STARTED",
        eventId: `${interruptId}_START`,
        interruptId,
        promptId,
      });
      if (opened) {
        setOpenResponsePhase("COMPOSE");
        setOpenResponseFeedback([]);
        setOpenResponseFallback(false);
        setOpenResponseRetained(false);
        setOpenResponseCloseEnabled(false);
      }
    },
    [busy, onFieldEvent, plan?.request.kind, view?.field],
  );

  const submitActiveOpenResponse = useCallback(
    async (composition: TypesetComposition, consent: RetentionConsent | null) => {
      const prompt = view?.openResponse.activePrompt;
      const interrupt = view?.field.activeInterrupt;
      if (
        !prompt ||
        interrupt?.kind !== "OPEN_RESPONSE" ||
        openResponsePhase !== "COMPOSE"
      ) {
        return;
      }
      setOpenResponsePhase("PENDING");
      let response: OpenResponseReference = {
        responseId: `local-${crypto.randomUUID()}`,
        attemptId: `BOS.ACT01.${profile.profileId}`,
        promptId: prompt.promptId,
        promptVersion: prompt.version,
        submittedAt: new Date().toISOString(),
        storage: "LOCAL_EPHEMERAL" as const,
      };
      let resolution = authoredFallbackForPrompt(prompt.promptId);
      if (
        profile.source === "GOOGLE" &&
        args.apiUp &&
        consent
      ) {
        const result = await submitOpenResponse({
          profileId: profile.profileId,
          attemptId: response.attemptId,
          body: {
            promptId: prompt.promptId,
            promptVersion: prompt.version,
            responseText: composition.learnerLine,
            composition,
            idempotencyKey: interrupt.interruptId,
            consent: {
              granted: true,
              policyVersion: consent.policyVersion,
              retainedForEducatorReview: true,
              retentionDays: consent.retentionDays,
            },
          },
        });
        if (result.ok) {
          response = result.value.response;
          resolution = result.value.resolution;
          setOpenResponseRetained(
            result.value.response.storage === "ENCRYPTED_SERVER",
          );
        }
      }
      const committed = await onFieldEvent({
        type: "FIELD_OPEN_RESPONSE_SUBMITTED",
        eventId: `${interrupt.interruptId}_SUBMITTED`,
        interruptId: interrupt.interruptId,
        promptId: prompt.promptId,
        response,
        artifact: {
          claimId: composition.claimId,
          evidenceIds: composition.evidenceIds,
        },
        resolution,
      });
      if (!committed) {
        setOpenResponsePhase("COMPOSE");
        return;
      }
      setOpenResponseFeedback(
        resolution.feedbackIds
          .map((feedbackId) => authoredFeedback(feedbackId))
          .filter((line): line is string => Boolean(line)),
      );
      setOpenResponseFallback(
        resolution.status === "AUTHORED_FALLBACK",
      );
      if (response.storage !== "ENCRYPTED_SERVER") {
        setOpenResponseRetained(false);
      }
      setOpenResponsePhase("FEEDBACK");
      setOpenResponseCloseEnabled(false);
      window.clearTimeout(openResponseDwellTimer.current);
      openResponseDwellTimer.current = window.setTimeout(
        () => setOpenResponseCloseEnabled(true),
        profile.onboarding?.reducedMotion ? 700 : 1200,
      );
    },
    [
      onFieldEvent,
      openResponsePhase,
      profile.onboarding?.reducedMotion,
      profile.profileId,
      profile.source,
      args.apiUp,
      view?.field.activeInterrupt,
      view?.openResponse.activePrompt,
    ],
  );

  const closeActiveOpenResponse = useCallback(async () => {
    const interrupt = view?.field.activeInterrupt;
    if (
      interrupt?.kind !== "OPEN_RESPONSE" ||
      openResponsePhase !== "FEEDBACK" ||
      !openResponseCloseEnabled
    ) {
      return;
    }
    const closed = await onFieldEvent({
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: `${interrupt.interruptId}_RESOLVED`,
      interruptId: interrupt.interruptId,
      outcome: openResponseFallback
        ? "AUTHORED_FALLBACK"
        : "FORMATIVE_CLASSIFIED",
    });
    if (closed) {
      setOpenResponsePhase("COMPOSE");
      setOpenResponseFeedback([]);
      setOpenResponseFallback(false);
      setOpenResponseRetained(false);
      setOpenResponseCloseEnabled(false);
    }
  }, [
    onFieldEvent,
    openResponseCloseEnabled,
    openResponseFallback,
    openResponsePhase,
    view?.field.activeInterrupt,
  ]);

  // Resume-from-evidence: a save resumed mid-interrupt already carries the
  // committed submission; rebuild the FEEDBACK phase from it instead of
  // asking the player to compose again.
  useEffect(() => {
    const prompt = view?.openResponse.activePrompt;
    if (!prompt || view?.field.activeInterrupt?.kind !== "OPEN_RESPONSE") return;
    const existing = view.openResponse.evidence.find(
      (record) => record.response.promptId === prompt.promptId,
    );
    if (!existing || openResponsePhase === "PENDING") return;
    if (openResponsePhase !== "FEEDBACK") {
      setOpenResponseFeedback(
        existing.resolution.feedbackIds
          .map((feedbackId) => authoredFeedback(feedbackId))
          .filter((line): line is string => Boolean(line)),
      );
      setOpenResponseFallback(
        existing.resolution.status === "AUTHORED_FALLBACK",
      );
      setOpenResponseRetained(
        existing.response.storage === "ENCRYPTED_SERVER",
      );
      setOpenResponsePhase("FEEDBACK");
      setOpenResponseCloseEnabled(false);
      window.clearTimeout(openResponseDwellTimer.current);
      openResponseDwellTimer.current = window.setTimeout(
        () => setOpenResponseCloseEnabled(true),
        profile.onboarding?.reducedMotion ? 700 : 1200,
      );
    }
  }, [
    openResponsePhase,
    profile.onboarding?.reducedMotion,
    view?.field.activeInterrupt,
    view?.openResponse,
  ]);

  return {
    phase: openResponsePhase,
    feedback: openResponseFeedback,
    fallback: openResponseFallback,
    retained: openResponseRetained,
    closeEnabled: openResponseCloseEnabled,
    begin: beginOpenResponse,
    submit: submitActiveOpenResponse,
    close: closeActiveOpenResponse,
  };
}
