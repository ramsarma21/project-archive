import type { SessionResponse } from "@pa/contracts";

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

export async function pushSave(profileId: string, body: unknown): Promise<{ ok: boolean; conflict?: boolean }> {
  try {
    const r = await fetch(`${BASE}/v1/profiles/${profileId}/save`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409) return { ok: false, conflict: true };
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}
