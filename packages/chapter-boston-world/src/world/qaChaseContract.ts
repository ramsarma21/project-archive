import type {
  FieldCommittedEvent,
  FieldRuntimeView,
  InputRequest,
} from "@pa/contracts";

export const M1_QA_CONTRACT = {
  playRootSelector: '[data-game-root="play"]',
  worldRootSelector: '[data-game-root="world"]',
  startEvent: "pa:qa-chase-start",
  resultEvent: "pa:qa-chase-result",
  confirmEvent: "pa:chase-confirm",
  shortcutCode: "KeyL",
} as const;

export type QaChaseStatus =
  | "STARTED"
  | "ALREADY_ACTIVE"
  | "NOT_FREE_ROAM"
  | "BUSY"
  | "UNAVAILABLE"
  | "COMMIT_REJECTED";

export interface QaChaseResult {
  ok: boolean;
  status: QaChaseStatus;
  reason: string;
  interruptId?: string;
  chaseId?: string;
}

export function qaChaseEligibility(input: {
  request: InputRequest | null;
  field: FieldRuntimeView | null;
  busy: boolean;
  error: string | null;
  choreographyReady: boolean;
}): QaChaseResult | null {
  if (input.field?.activeChase) {
    return {
      ok: true,
      status: "ALREADY_ACTIVE",
      reason: "A chase is already active.",
      interruptId: input.field.activeChase.interruptId,
      chaseId: input.field.activeChase.chaseId,
    };
  }
  if (!input.request || !input.field) {
    return {
      ok: false,
      status: "UNAVAILABLE",
      reason: "The runtime field is not ready.",
    };
  }
  if (input.request.kind !== "FREE_ROAM") {
    return {
      ok: false,
      status: "NOT_FREE_ROAM",
      reason: `QA chase requires FREE_ROAM; current request is ${input.request.kind}.`,
    };
  }
  if (input.busy || input.error || !input.choreographyReady) {
    return {
      ok: false,
      status: "BUSY",
      reason: input.error
        ? `The game has an active error: ${input.error}`
        : "The presentation layer is still busy.",
    };
  }
  if (input.field.activeInterrupt) {
    return {
      ok: false,
      status: "BUSY",
      reason: `Field interrupt ${input.field.activeInterrupt.interruptId} is already active.`,
    };
  }
  return null;
}

export function qaChaseStartEvents(input: {
  suffix: string;
  heatBand: FieldRuntimeView["heat"]["band"];
}): {
  interruptId: string;
  chaseId: string;
  events: FieldCommittedEvent[];
} {
  const interruptId = `M1_QA_INTERRUPT_${input.suffix}`;
  const chaseId = `M1_QA_CHASE_${input.suffix}`;
  const events: FieldCommittedEvent[] = [
    {
      type: "FIELD_WATCHER_CHALLENGE",
      eventId: `${interruptId}_CHALLENGE`,
      interruptId,
      challengeId: `M1_QA_VERTICAL_SLICE_${input.suffix}`,
      watcherId: "M1_QA_OFFICER",
      reason: "SUSPICION",
    },
    {
      type: "FIELD_CHASE_STARTED",
      eventId: `${chaseId}_START`,
      interruptId,
      chaseId,
      sourceId: "M1_QA_OFFICER",
    },
  ];
  if (input.heatBand !== "HUNTED") {
    events.push({
      type: "FIELD_HEAT_TRANSITION",
      eventId: `${chaseId}_HEAT`,
      interruptId,
      from: input.heatBand,
      to: "HUNTED",
      cause: "RUN",
    });
  }
  return { interruptId, chaseId, events };
}
