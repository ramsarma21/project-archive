import type {
  MasteryReport,
  OnboardingPreferences,
  PresenterEvent,
  SessionResponse,
} from "@pa/contracts";

// Same-origin: Vite proxies /v1 -> API so session cookies are first-party.
const BASE = "";

// Thin API client. All game logic stays in the runtime worker; the API only
// handles identity and durable cloud saves. If the API is unreachable, the app
// still runs fully on local profiles.
export async function apiStatus(): Promise<{ up: boolean; google: boolean }> {
  try {
    const r = await fetch(`${BASE}/v1/health`, { credentials: "include" });
    if (!r.ok) return { up: false, google: false };
    const j = (await r.json()) as { ok?: boolean; google?: boolean };
    return { up: Boolean(j.ok), google: Boolean(j.google) };
  } catch {
    return { up: false, google: false };
  }
}

export async function getSession(): Promise<SessionResponse | null> {
  try {
    const r = await fetch(`${BASE}/v1/session`, { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()) as SessionResponse;
  } catch {
    return null;
  }
}

export function googleLoginUrl(): string {
  return `${BASE}/v1/auth/google/start`;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/v1/logout`, { method: "POST", credentials: "include" });
  } catch {
    /* offline logout is local-only */
  }
}

export interface RemoteSave {
  profileId: string;
  chapterId: string;
  packageId: string;
  variationRootSeedHex: string;
  flowVersion: number;
  committedEvents: PresenterEvent[];
  revision: number;
  status: "IN_PROGRESS" | "COMPLETE";
  updatedAt: string;
  presenterSpatial?: import("./db.js").PresenterSpatialState;
}

export async function pullSave(profileId: string): Promise<RemoteSave | null> {
  try {
    const r = await fetch(`${BASE}/v1/profiles/${profileId}/save`, { credentials: "include" });
    if (!r.ok) return null;
    const body = (await r.json()) as { save?: Record<string, unknown> | null };
    const raw = body.save;
    if (!raw) return null;
    // Accept the pre-onboarding API's snake_case row long enough for a running
    // dev server to recover and reload instead of leaving the app on Loading.
    const save: RemoteSave = {
      profileId: String(raw.profileId ?? raw.profile_id ?? ""),
      chapterId: String(raw.chapterId ?? raw.chapter_id ?? ""),
      packageId: String(raw.packageId ?? raw.package_id ?? ""),
      variationRootSeedHex: String(raw.variationRootSeedHex ?? raw.variation_root_seed_hex ?? ""),
      flowVersion: Number(raw.flowVersion ?? raw.flow_version ?? 1),
      committedEvents: Array.isArray(raw.committedEvents)
        ? raw.committedEvents as PresenterEvent[]
        : Array.isArray(raw.committed_events)
          ? raw.committed_events as PresenterEvent[]
          : [],
      revision: Number(raw.revision),
      status: raw.status === "COMPLETE" ? "COMPLETE" : "IN_PROGRESS",
      updatedAt: String(raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()),
      presenterSpatial:
        raw.presenterSpatial && typeof raw.presenterSpatial === "object"
          ? (raw.presenterSpatial as RemoteSave["presenterSpatial"])
          : undefined,
    };
    if (
      !save.profileId ||
      !save.chapterId ||
      !save.packageId ||
      !/^[0-9a-f]{64}$/.test(save.variationRootSeedHex) ||
      !Number.isInteger(save.revision)
    ) {
      return null;
    }
    return save;
  } catch {
    return null;
  }
}

export async function saveOnboardingPreferences(
  profileId: string,
  preferences: OnboardingPreferences,
): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/v1/profiles/${profileId}/preferences`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(preferences),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function pullMastery(
  profileId: string,
): Promise<{ report: MasteryReport; saveRevision: number } | null> {
  try {
    const response = await fetch(`${BASE}/v1/profiles/${profileId}/mastery`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      mastery?: MasteryReport | null;
      saveRevision?: number | null;
    };
    if (!body.mastery || !Number.isInteger(body.saveRevision)) return null;
    return { report: body.mastery, saveRevision: body.saveRevision! };
  } catch {
    return null;
  }
}

export async function pushSave(
  profileId: string,
  body: unknown,
): Promise<{ ok: boolean; conflict?: boolean; mastery?: MasteryReport }> {
  try {
    const r = await fetch(`${BASE}/v1/profiles/${profileId}/save`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409) return { ok: false, conflict: true };
    if (!r.ok) return { ok: false };
    const result = (await r.json()) as { mastery?: MasteryReport };
    return { ok: true, mastery: result.mastery };
  } catch {
    return { ok: false };
  }
}
