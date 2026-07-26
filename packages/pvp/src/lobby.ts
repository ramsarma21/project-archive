// Direct match by code. THE PATH THAT HAS TO WORK.
//
// One person with two browser sessions cannot test a ranked queue — a ladder with a
// population of two is a coin flip on whether the button does anything — but they can
// absolutely test "create a match, read a code, type it into the other window". So this
// is the primary path, and the queue in matchmaking.ts is the secondary one.
//
// The code is short, typable and unambiguous: six characters from an alphabet with no
// 0/O and no 1/I/L, because it is going to be read off one screen and typed into
// another by a human, possibly a thirteen-year-old, possibly out loud.
//
// A lobby is a value. It holds no timers and no sockets, so the API can keep it in a
// map today and in Postgres tomorrow without the policy changing.

import { fieldRandom, projectFieldSeed } from "@pa/duel";
import type { CosmeticLoadout } from "./cosmetics.js";
import type { ProfileId } from "./match.js";

/** No 0/O, no 1/I/L, no U/V confusion. 32 symbols, so 6 chars is ~1e9 codes. */
export const MATCH_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTWXYZ";
export const MATCH_CODE_LENGTH = 6;

/** A lobby nobody joins should not sit in the table forever. */
export const LOBBY_EXPIRY_MS = 15 * 60 * 1000;

export interface LobbyMember {
  readonly profileId: ProfileId;
  readonly handle: string;
  readonly rank: number;
  readonly unlockedAbilityIds: readonly string[];
  readonly selectedAbilityIds?: readonly string[];
  readonly cosmetics: CosmeticLoadout;
  readonly pvpLegalCardIds: readonly string[];
}

export type LobbyStatus =
  /** Created, waiting for a second player. */
  | "OPEN"
  /** Both present; the API may start the authority. */
  | "READY"
  /** Started. The matchId is live. */
  | "STARTED"
  | "CANCELLED"
  | "EXPIRED";

export interface Lobby {
  readonly code: string;
  readonly status: LobbyStatus;
  readonly host: LobbyMember;
  readonly guest: LobbyMember | null;
  readonly createdAtMs: number;
  readonly matchId: string | null;
  /** Match seed, fixed at creation so both clients derive identical content. */
  readonly seed: number;
}

/**
 * Generate a code from the host's identity and the clock. Deterministic given both,
 * which means a retry with the same inputs produces the same code rather than littering
 * the table with abandoned lobbies.
 */
export function matchCodeFor(hostProfileId: ProfileId, createdAtMs: number): string {
  const seed = projectFieldSeed(["PVP_LOBBY", hostProfileId, String(createdAtMs)]);
  let code = "";
  for (let index = 0; index < MATCH_CODE_LENGTH; index++) {
    const draw = Math.floor(fieldRandom(seed, index, 7) * MATCH_CODE_ALPHABET.length);
    code += MATCH_CODE_ALPHABET[Math.min(MATCH_CODE_ALPHABET.length - 1, draw)];
  }
  return code;
}

/** Accept a typed code: upper-cased, spaces and dashes stripped, alphabet-checked. */
export function normaliseMatchCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== MATCH_CODE_LENGTH) return null;
  for (const character of cleaned) {
    if (!MATCH_CODE_ALPHABET.includes(character)) return null;
  }
  return cleaned;
}

export function createLobby(host: LobbyMember, nowMs: number): Lobby {
  const code = matchCodeFor(host.profileId, nowMs);
  return {
    code,
    status: "OPEN",
    host,
    guest: null,
    createdAtMs: nowMs,
    matchId: null,
    seed: projectFieldSeed(["PVP_MATCH", code, String(nowMs)]),
  };
}

export type JoinRefusal =
  | "LOBBY_NOT_FOUND"
  | "LOBBY_NOT_OPEN"
  | "LOBBY_EXPIRED"
  | "ALREADY_IN_LOBBY"
  | "CANNOT_DUEL_YOURSELF";

export type JoinResult =
  | { readonly ok: true; readonly lobby: Lobby }
  | { readonly ok: false; readonly reason: JoinRefusal };

/**
 * Join by code.
 *
 * Refuses self-duelling by profile, which matters for tomorrow specifically: the owner
 * is running two accounts on one machine, and the failure that would waste his evening
 * is a stale cookie quietly joining him to his own lobby and producing a duel that
 * cannot resolve. Two DIFFERENT profiles on one machine are fine and expected.
 */
export function joinLobby(
  lobby: Lobby,
  guest: LobbyMember,
  nowMs: number,
): JoinResult {
  if (nowMs - lobby.createdAtMs > LOBBY_EXPIRY_MS) {
    return { ok: false, reason: "LOBBY_EXPIRED" };
  }
  if (lobby.status !== "OPEN") return { ok: false, reason: "LOBBY_NOT_OPEN" };
  if (guest.profileId === lobby.host.profileId) {
    return { ok: false, reason: "CANNOT_DUEL_YOURSELF" };
  }
  return { ok: true, lobby: { ...lobby, status: "READY", guest } };
}

export function markLobbyStarted(lobby: Lobby, matchId: string): Lobby {
  return { ...lobby, status: "STARTED", matchId };
}

export function cancelLobby(lobby: Lobby): Lobby {
  return { ...lobby, status: "CANCELLED" };
}

export function lobbyExpired(lobby: Lobby, nowMs: number): boolean {
  return (
    lobby.status === "OPEN" && nowMs - lobby.createdAtMs > LOBBY_EXPIRY_MS
  );
}

/** Host is side A, guest is side B. Fixed so a rematch is not a coin flip. */
export function lobbySides(lobby: Lobby): {
  readonly A: LobbyMember;
  readonly B: LobbyMember;
} | null {
  if (!lobby.guest) return null;
  return { A: lobby.host, B: lobby.guest };
}
