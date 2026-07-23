import { z } from "zod";

export const OnboardingPreferencesSchema = z.object({
  version: z.literal(1),
  readingSpeed: z.enum(["RELAXED", "STANDARD", "BRISK"]),
  captions: z.boolean(),
  audioDescription: z.boolean(),
  inputMethod: z.enum(["KEYBOARD_MOUSE", "KEYBOARD_ONLY"]),
  archiveAssistAutoOffer: z.boolean(),
  highContrast: z.boolean(),
  reducedMotion: z.boolean(),
  // Optional keeps profiles authored before M1 backward-compatible.
  chaseAssist: z
    .enum(["STANDARD", "SLOW_PURSUER", "AUTO_STAMINA", "CONFIRM_RESOLVE"])
    .optional(),
  primersSeen: z.array(z.enum(["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"])).optional(),
  completedAt: z.string(),
});
export type OnboardingPreferences = z.infer<typeof OnboardingPreferencesSchema>;

export const SessionResponseSchema = z.object({
  authenticated: z.boolean(),
  profile: z
    .object({
      profileId: z.string(),
      accountId: z.string(),
      displayName: z.string(),
      variationRootSeedHex: z.string().regex(/^[0-9a-f]{64}$/),
      onboarding: OnboardingPreferencesSchema.nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  csrfToken: z.string().optional(),
}).strict();
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

const PRESENTER_EVENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  CONTINUE: ["type"],
  ACK: ["type"],
  CHOICE_SELECTED: ["type", "promptId", "choiceId"],
  MECHANIC_RESULT: ["type", "promptId", "result"],
  FOCUS_READ_OPENED: ["type", "objectId"],
  FOCUS_READ_SKIPPED: ["type", "objectId"],
  BREATHER_COMPLETE: ["type"],
  FREE_ROAM_SELECT: ["type", "targetId"],
  FREE_ROAM_GOTO: ["type", "targetId"],
  FREE_ROAM_IDLE: ["type"],
  DEBRIEF_FORM_SELECTED: ["type", "checkpointId", "selection"],
  DEBRIEF_ANSWERED: ["type", "checkpointId", "formId", "itemId", "optionId"],
  DEBRIEF_CONTINUED: ["type", "checkpointId", "formId"],
  DEBRIEF_COMMITTED: ["type", "eventId", "checkpointId", "formId", "bankVersion"],
  ACT_TRANSITIONED: ["type", "eventId", "checkpointId", "formId", "targetChapterId"],
  FIELD_HEAT_TRANSITION: ["type", "eventId", "interruptId", "from", "to", "cause"],
  FIELD_HEAT_DECAY_CHECKPOINT: ["type", "eventId", "interruptId", "band", "elapsedSeconds", "paused"],
  FIELD_STANDING_DELTA: ["type", "eventId", "interruptId", "delta", "causeId"],
  FIELD_THREAD_PATCH: ["type", "eventId", "interruptId", "threadId", "flags"],
  FIELD_MICRO_ENGAGED: ["type", "eventId", "interruptId", "record"],
  FIELD_REACTIVE_COMPLETED: ["type", "eventId", "interruptId", "completion"],
  FIELD_REACTIVE_OUTCOME_SELECTED: [
    "type",
    "eventId",
    "interruptId",
    "interactionId",
    "sourceId",
    "outcomeId",
  ],
  FIELD_INTERRUPT_STARTED: ["type", "eventId", "interruptId", "interruptKind", "sourceId"],
  FIELD_OPEN_RESPONSE_STARTED: ["type", "eventId", "interruptId", "promptId"],
  FIELD_OPEN_RESPONSE_SUBMITTED: [
    "type",
    "eventId",
    "interruptId",
    "promptId",
    "response",
    "resolution",
  ],
  FIELD_WATCHER_CHALLENGE: ["type", "eventId", "interruptId", "challengeId", "watcherId", "reason"],
  FIELD_CONFRONTATION_DECISION: ["type", "eventId", "interruptId", "choice"],
  FIELD_CONFRONTATION_RESOLVED: ["type", "eventId", "interruptId", "outcome"],
  FIELD_IDENTITY_CHANGED: ["type", "eventId", "interruptId", "recognized", "clarkeMarked", "reason"],
  FIELD_CHASE_STARTED: ["type", "eventId", "interruptId", "chaseId", "sourceId"],
  FIELD_CHASE_RESOLVED: ["type", "eventId", "interruptId", "chaseId", "outcome"],
  FIELD_INTERRUPT_RESOLVED: ["type", "eventId", "interruptId", "outcome"],
  FIELD_CUSTODY_CHANGED: [
    "type",
    "eventId",
    "interruptId",
    "objectId",
    "custody",
    "condition",
    "concealment",
    "reason",
  ],
  FIELD_CLOCK_ADVANCED: ["type", "eventId", "interruptId", "units", "reason"],
  FIELD_REPOSITION_INTENT: [
    "type",
    "eventId",
    "interruptId",
    "locationId",
    "anchorId",
    "reason",
  ],
  FIELD_REPOSITION_APPLIED: ["type", "eventId", "interruptId", "intentEventId"],
};

const RAW_RESPONSE_KEY = /^(raw(Text|Response)?|responseText|studentResponse|promptText)$/i;

function rejectRawResponseFields(
  value: unknown,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      rejectRawResponseFields(entry, [...path, index], ctx),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (RAW_RESPONSE_KEY.test(key)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, key],
        message: "raw open-response content is forbidden in gameplay events",
      });
    }
    rejectRawResponseFields(entry, [...path, key], ctx);
  }
}

export const PresenterEventSchema: z.ZodType<unknown> = z
  .unknown()
  .superRefine((value, ctx) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      ctx.addIssue({ code: "custom", message: "presenter event must be an object" });
      return;
    }
    const event = value as Record<string, unknown>;
    const type = event.type;
    if (typeof type !== "string" || !PRESENTER_EVENT_KEYS[type]) {
      ctx.addIssue({ code: "custom", path: ["type"], message: "unknown presenter event type" });
      return;
    }
    const allowed = new Set(PRESENTER_EVENT_KEYS[type]);
    for (const key of Object.keys(event)) {
      if (!allowed.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `unknown field for ${type}`,
        });
      }
    }
    rejectRawResponseFields(event, [], ctx);
  });

export const SaveRecordSchema = z.object({
  saveId: z.string(),
  profileId: z.string(),
  chapterId: z.string(),
  packageId: z.string(),
  variationRootSeedHex: z.string(),
  flowVersion: z.number().int().positive().optional(),
  committedEvents: z.array(PresenterEventSchema),
  revision: z.number().int().nonnegative(),
  status: z.enum(["IN_PROGRESS", "COMPLETE"]),
  updatedAt: z.string(),
}).strict();

export const PutSaveRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  record: SaveRecordSchema,
}).strict();
export type PutSaveRequest = z.infer<typeof PutSaveRequestSchema>;

export const ApiErrorSchema = z.object({
  error: z.enum([
    "AUTH_REQUIRED",
    "AUTH_CALLBACK_FAILED",
    "PROFILE_FORBIDDEN",
    "SAVE_CONFLICT",
    "PACKAGE_MISSING",
    "PACKAGE_INVALID",
    "SAVE_INVALID",
    "RUNTIME_DEADLOCK",
    "PRESENTER_PROTOCOL_ERROR",
    "BAD_REQUEST",
    "CONSENT_REQUIRED",
    "POLICY_REQUIRED",
    "GRADING_UNAVAILABLE",
    "RATE_LIMITED",
    "CSRF_INVALID",
    "RESPONSE_FORBIDDEN",
    "RESPONSE_NOT_FOUND",
  ]),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
