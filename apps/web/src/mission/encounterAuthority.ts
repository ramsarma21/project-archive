// Getting an encounter verdict, without ever deciding one.
//
// The sibling of duel/duelGrading.ts, and the same discipline: the client holds
// no rubric and no acceptable answers, so it cannot grade. It posts the player's
// text to the encounter authority and reads back a minted verdict kind. The
// server binds that verdict to the profile's own open attempt and picks the item
// from the stored seed, so a client claim of which item this is cannot move it.
//
// EVERY FAILURE IS THE GENEROUS OUTCOME. An encounter is REQUIRED for traversal,
// so an unreachable authority, a timeout or a malformed reply must never trap the
// player at a stop — all of them resolve to GRANTED, which the runtime treats as
// a reprieve exactly like a correct answer. That is the design's rule (§1.7): a
// player is never punished for infrastructure.
//
// ANSWER TEXT LIVES IN EXACTLY ONE PLACE: the request body. It is never logged,
// never stored, and the verdict that comes back carries only a kind.

import type { EncounterVerdictKind } from "@pa/mission-m1";
import { withDevSessionHeader } from "../devSession.js";

/** Mission-Slate §1.7. A game rule with a number, not a network timeout. */
export const ENCOUNTER_GRADING_CAP_MS = 1500;

/** The header the route sets when the verdict was the generous infra grant. */
const GRANTED_HEADER = "x-pa-encounter-granted";

export type EncounterVerdictOrigin =
  | "AUTHORITY"
  | "AUTHORITY_GRANTED"
  | "AUTHORITY_UNREACHABLE"
  | "STAND_IN";

export interface EncounterVerdictResult {
  readonly kind: EncounterVerdictKind;
  readonly origin: EncounterVerdictOrigin;
}

export interface EncounterVerdictRequest {
  readonly encounterId: string;
  /** The client's copy of the item id. A claim; the server recomputes its own. */
  readonly itemId: string;
  /** The player's own words. Goes to the authority and nowhere else. */
  readonly answer: string;
  /** Aborts the request when the attempt tears down mid-grade. */
  readonly signal?: AbortSignal;
}

export type EncounterAuthority = (
  request: EncounterVerdictRequest,
) => Promise<EncounterVerdictResult>;

function endpoint(encounterId: string): string {
  return `/v1/encounters/${encodeURIComponent(encounterId)}/verdict`;
}

async function csrfToken(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch("/v1/session", {
      credentials: "include",
      signal,
      headers: withDevSessionHeader(),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { csrfToken?: unknown };
    return typeof body.csrfToken === "string" ? body.csrfToken : null;
  } catch {
    return null;
  }
}

/**
 * The real path: ask the server with an authenticated CSRF POST, parse the
 * verdict strictly, and grant on any failure so a stop is never a trap.
 */
export const httpEncounterAuthority: EncounterAuthority = async (request) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ENCOUNTER_GRADING_CAP_MS);
  const onOuterAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onOuterAbort);
  const granted = (origin: EncounterVerdictOrigin): EncounterVerdictResult => ({
    kind: "GRANTED",
    origin,
  });
  try {
    const csrf = await csrfToken(controller.signal);
    const response = await fetch(endpoint(request.encounterId), {
      method: "POST",
      signal: controller.signal,
      credentials: "include",
      headers: withDevSessionHeader({
        "content-type": "application/json",
        ...(csrf ? { "x-pa-csrf-token": csrf } : {}),
      }),
      // Only the answer and an item CLAIM. The server grades its own item.
      body: JSON.stringify({ answer: request.answer, itemId: request.itemId }),
    });
    // Every non-2xx is the generous grant: the client treats a refusal as
    // unreachable, which is the most permissive outcome and the one that keeps a
    // required stop from soft-locking the route.
    if (!response.ok) return granted("AUTHORITY_UNREACHABLE");
    const wasGranted = response.headers.get(GRANTED_HEADER) === "true";
    const body = (await response.json()) as {
      kind?: unknown;
      source?: unknown;
    };
    // Strict parse: only the two real verdict kinds are admitted; anything else
    // is treated as a failed grade and granted.
    if (body.kind !== "CORRECT" && body.kind !== "WRONG") {
      return granted("AUTHORITY_UNREACHABLE");
    }
    if (wasGranted || body.source === "GRADING_TIMEOUT") {
      return granted("AUTHORITY_GRANTED");
    }
    return { kind: body.kind, origin: "AUTHORITY" };
  } catch {
    return granted("AUTHORITY_UNREACHABLE");
  } finally {
    window.clearTimeout(timer);
    request.signal?.removeEventListener("abort", onOuterAbort);
  }
};

/**
 * A deterministic dev stand-in. It does NOT read the answer; it returns a
 * scripted kind after a short latency so the real overlay, world and runtime can
 * be exercised without a grading credential. Injected by the floor harness via
 * `?encounterVerdict=`; production never reaches for it.
 */
export function createDevEncounterAuthority(
  kind: EncounterVerdictKind,
  latencyMs = 350,
): EncounterAuthority {
  return async (request) => {
    await new Promise<void>((resolve) => {
      const handle = window.setTimeout(resolve, latencyMs);
      request.signal?.addEventListener("abort", () => {
        window.clearTimeout(handle);
        resolve();
      });
    });
    return { kind, origin: "STAND_IN" };
  };
}

/**
 * The dev authority a query string asks for, or null for the real HTTP one.
 * `?encounterVerdict=correct|wrong|granted`.
 */
export function encounterAuthorityFromQuery(search: string): EncounterAuthority | null {
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get("encounterVerdict");
  } catch {
    return null;
  }
  if (value === "correct") return createDevEncounterAuthority("CORRECT");
  if (value === "wrong") return createDevEncounterAuthority("WRONG");
  if (value === "granted") return createDevEncounterAuthority("GRANTED");
  return null;
}
