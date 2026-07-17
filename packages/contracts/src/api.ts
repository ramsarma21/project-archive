import { z } from "zod";

export const SessionResponseSchema = z.object({
  authenticated: z.boolean(),
  profile: z
    .object({
      profileId: z.string(),
      accountId: z.string(),
      displayName: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const PresenterEventSchema: z.ZodType<unknown> = z.any();

export const SaveRecordSchema = z.object({
  saveId: z.string(),
  profileId: z.string(),
  chapterId: z.string(),
  packageId: z.string(),
  variationRootSeedHex: z.string(),
  committedEvents: z.array(z.any()),
  revision: z.number().int().nonnegative(),
  status: z.enum(["IN_PROGRESS", "COMPLETE"]),
  updatedAt: z.string(),
});

export const PutSaveRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  record: SaveRecordSchema,
});
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
  ]),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
