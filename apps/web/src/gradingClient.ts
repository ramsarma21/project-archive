import {
  SessionResponseSchema,
  SubmitOpenResponseResponseSchema,
  type SubmitOpenResponseRequest,
  type SubmitOpenResponseResponse,
} from "@pa/contracts";

export type GradingClientResult =
  | { ok: true; value: SubmitOpenResponseResponse }
  | { ok: false; reason: "OFFLINE" | "POLICY" | "UNAVAILABLE" };

async function csrfToken(): Promise<string | null> {
  try {
    const response = await fetch("/v1/session", { credentials: "include" });
    if (!response.ok) return null;
    const session = SessionResponseSchema.safeParse(await response.json());
    return session.success ? session.data.csrfToken ?? null : null;
  } catch {
    return null;
  }
}

export async function submitOpenResponse(input: {
  profileId: string;
  attemptId: string;
  body: SubmitOpenResponseRequest;
}): Promise<GradingClientResult> {
  const csrf = await csrfToken();
  if (!csrf) return { ok: false, reason: "OFFLINE" };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4_200);
  try {
    const response = await fetch(
      `/v1/profiles/${encodeURIComponent(input.profileId)}/assessments/${encodeURIComponent(input.attemptId)}/responses`,
      {
        method: "POST",
        signal: controller.signal,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-pa-csrf-token": csrf,
        },
        body: JSON.stringify(input.body),
      },
    );
    if (response.status === 400 || response.status === 403) {
      return { ok: false, reason: "POLICY" };
    }
    if (!response.ok) return { ok: false, reason: "UNAVAILABLE" };
    const parsed = SubmitOpenResponseResponseSchema.safeParse(
      await response.json(),
    );
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, reason: "UNAVAILABLE" };
  } catch {
    return { ok: false, reason: "OFFLINE" };
  } finally {
    window.clearTimeout(timer);
  }
}

