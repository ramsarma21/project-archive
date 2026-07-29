import Dexie, { type Table } from "dexie";
import type {
  CommitMissionOutcomeRequest,
  OnboardingPreferences,
  ProgressionSnapshot,
} from "@pa/contracts";
import { snapshotBelongsTo } from "./progression/identity.js";

// Local-first persistence. Each profile has its own 32-byte variation root seed,
// so different accounts get independent games.
export interface LocalProfile {
  profileId: string;
  accountId: string;
  displayName: string;
  variationRootSeedHex: string;
  source: "LOCAL" | "GOOGLE";
  createdAt: string;
  onboarding?: OnboardingPreferences;
}

// ---------------------------------------------------------------------------
// Progression storage.
//
// Three tables, and the difference between them is the whole design:
//
//   `progression` is a CACHE and never an authority. It holds the last snapshot
//   the server sent so a reload draws the hub instantly instead of on a blank
//   panel, and so a student who opens the page on a dead network can still see
//   where they are. Nothing is ever computed from it and nothing in it is ever
//   uploaded. Deleting this table costs a round trip and nothing else — which is
//   the property that makes clearing browser storage worthless as a cheat.
//
//   `progressionOutbox` is DURABLE INTENT. It holds committed mission outcomes
//   that have not been acknowledged yet, so losing the network in the last
//   second of an attempt does not lose the attempt. It deliberately holds only
//   outcomes: see the note on its key below.
//
//   `loadouts` is a PREFERENCE — which four of the unlocked abilities are
//   carried. It is safe on the client because it is a selection, not a grant:
//   resolution intersects it with the server's unlock set, so a hand-edited row
//   can only ever narrow what the player already holds.
//
// Every row in all three is keyed by profileId, and nothing reads a row it did
// not ask for by id. Two accounts sharing one browser therefore share a
// database and no state: see `progressionFor`.
// ---------------------------------------------------------------------------

export interface StoredProgression {
  profileId: string;
  /** Exactly what the server sent, already validated against its schema. */
  snapshot: ProgressionSnapshot;
  /** When this device received it. A staleness label, never an input to truth. */
  fetchedAt: string;
}

/**
 * A resolved attempt whose outcome the server has not acknowledged.
 *
 * Only outcomes are queued, and that is a security decision rather than a
 * scoping one. A module completion is gated by the server onto whatever attempt
 * ordinal is next AT THE MOMENT IT ARRIVES, so a completion queued during
 * attempt 1 and flushed after attempt 1 resolved would silently arm attempt 2
 * with a module the student never re-ran. Completing the module is therefore an
 * online-only act, and an attempt that cannot be opened online is simply not
 * opened. An outcome carries no such hazard: it names the durable attempt it
 * belongs to, and every number it is worth was fixed by the server when that
 * attempt opened.
 */
export interface ProgressionOutboxEntry {
  /** `outcome:<attemptId>`. One attempt can only ever resolve once. */
  key: string;
  profileId: string;
  attemptId: string;
  /** The exact request body. Contracts-valid before it is ever stored. */
  body: CommitMissionOutcomeRequest;
  /** For the result screen, if the player is still looking at it. */
  missionId: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

/** Which four abilities are carried, per scope. PvE is chapter-scoped. */
export interface StoredLoadout {
  profileId: string;
  /** `PVE:<chapterId>` or `PVP`. PvE resets with the chapter; PvP never does. */
  scope: string;
  abilityIds: string[];
  updatedAt: string;
}

/**
 * A one-time teaching hint the player has already seen.
 *
 * This is a PREFERENCE, not progress: it records that a rule was shown once so a
 * non-blocking notice never nags again, and losing it costs the player one extra
 * reminder and nothing else. It is keyed by profile for the same reason the tables
 * above are — two accounts on one machine each learn the game for themselves — but
 * carries no grant, so a hand-edited row can only re-show a hint, never unlock one.
 */
export interface StoredHint {
  /** `<profileId>:<hintId>`. One row per (player, hint). */
  key: string;
  profileId: string;
  hintId: string;
  seenAt: string;
}

class ArchiveDB extends Dexie {
  profiles!: Table<LocalProfile, string>;
  progression!: Table<StoredProgression, string>;
  progressionOutbox!: Table<ProgressionOutboxEntry, string>;
  loadouts!: Table<StoredLoadout, [string, string]>;
  hints!: Table<StoredHint, string>;

  constructor() {
    super("project-archive");
    this.version(1).stores({
      profiles: "profileId, accountId, source",
      saves: "profileId, chapterId",
    });
    this.version(2).stores({
      progression: "profileId",
      progressionOutbox: "key, profileId",
      loadouts: "[profileId+scope], profileId",
    });
    // The old game's event-sourced save table. Dropped rather than left
    // orphaned: a device that played the retired chapter is carrying a replay
    // log for a world that no longer exists, and `null` is how Dexie is told to
    // delete a store instead of silently keeping it out of the schema.
    this.version(3).stores({ saves: null });
    // Seen-once teaching hints, keyed by (profile, hint). A new store, not a new
    // mechanism: it is per-profile local-first storage exactly like the three above.
    this.version(4).stores({ hints: "key, profileId" });
  }
}

export const db = new ArchiveDB();

export function randomSeedHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function listProfiles(): Promise<LocalProfile[]> {
  return db.profiles.toArray();
}

export async function createLocalProfile(displayName: string): Promise<LocalProfile> {
  const id = crypto.randomUUID();
  const profile: LocalProfile = {
    profileId: id,
    accountId: `local:${id}`,
    displayName,
    variationRootSeedHex: randomSeedHex(),
    source: "LOCAL",
    createdAt: new Date().toISOString(),
  };
  await db.profiles.put(profile);
  return profile;
}

export async function upsertProfile(p: LocalProfile): Promise<void> {
  await db.profiles.put(p);
}

export async function deleteAllLocalProfiles(): Promise<number> {
  return db.transaction(
    "rw",
    db.profiles,
    db.progression,
    db.progressionOutbox,
    db.hints,
    async () => {
      const localProfiles = await db.profiles.where("source").equals("LOCAL").toArray();
      const profileIds = localProfiles.map((profile) => profile.profileId);
      // Progression goes with the profile. Leaving a cached snapshot or an
      // unflushed outcome behind would let a recreated local profile inherit the
      // deleted one's standing the moment it reused an id.
      await db.progression.bulkDelete(profileIds);
      for (const profileId of profileIds) {
        await db.progressionOutbox.where("profileId").equals(profileId).delete();
        // Seen-once hints go with the profile too, so a recreated local id relearns
        // the game from scratch rather than inheriting the deleted player's hints.
        await db.hints.where("profileId").equals(profileId).delete();
      }
      await db.profiles.bulkDelete(profileIds);
      return profileIds.length;
    },
  );
}

// ---------------------------------------------------------------------------
// Progression accessors
//
// Every one of these takes a profileId and refuses to answer about any other
// profile. That is the entire mechanism keeping two accounts apart on a shared
// machine, and it is deliberately enforced on the READ as well as the write:
// separate cookie jars already keep two browser contexts apart, but two Google
// accounts used in sequence in the SAME context share this database, and the
// second one must not inherit the first one's Rank.
// ---------------------------------------------------------------------------

/**
 * The cached snapshot for a profile, or undefined.
 *
 * A row whose snapshot belongs to someone else is discarded rather than
 * returned. That can only happen through a corrupted write or a hand-edited
 * database, and both are exactly the cases where answering is worse than not.
 */
export async function progressionFor(
  profileId: string,
): Promise<StoredProgression | undefined> {
  const row = await db.progression.get(profileId);
  if (!row || row.profileId !== profileId) return undefined;
  return snapshotBelongsTo(row.snapshot, profileId) ? row : undefined;
}

export async function cacheProgression(
  profileId: string,
  snapshot: ProgressionSnapshot,
  fetchedAt: string,
): Promise<void> {
  // The server addressed this snapshot to somebody. Caching it under a
  // different key would make a later read a lie, so it is dropped instead.
  if (!snapshotBelongsTo(snapshot, profileId)) return;
  await db.progression.put({ profileId, snapshot, fetchedAt });
}

/** Drops one profile's cache. Signing out must not touch anyone else's. */
export async function forgetProgression(profileId: string): Promise<void> {
  await db.progression.delete(profileId);
}

export async function queueMissionOutcome(
  entry: Omit<ProgressionOutboxEntry, "key" | "attempts" | "lastError">,
): Promise<void> {
  const key = `outcome:${entry.attemptId}`;
  // An attempt resolves once. A second queue for the same attempt is the same
  // fact arriving twice — a double-fired effect, a re-mounted result screen —
  // and it must not become two commits.
  const existing = await db.progressionOutbox.get(key);
  if (existing) return;
  await db.progressionOutbox.put({ ...entry, key, attempts: 0, lastError: null });
}

/** Oldest first: outcomes are flushed in the order they were earned. */
export async function pendingOutcomes(
  profileId: string,
): Promise<ProgressionOutboxEntry[]> {
  const rows = await db.progressionOutbox.where("profileId").equals(profileId).toArray();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function dropOutcome(key: string): Promise<void> {
  await db.progressionOutbox.delete(key);
}

export async function noteOutcomeAttempt(key: string, error: string): Promise<void> {
  const row = await db.progressionOutbox.get(key);
  if (!row) return;
  await db.progressionOutbox.put({
    ...row,
    attempts: row.attempts + 1,
    lastError: error,
  });
}

export async function readLoadout(
  profileId: string,
  scope: string,
): Promise<StoredLoadout | undefined> {
  const row = await db.loadouts.get([profileId, scope]);
  return row?.profileId === profileId ? row : undefined;
}

export async function writeLoadout(row: StoredLoadout): Promise<void> {
  await db.loadouts.put(row);
}

// ---------------------------------------------------------------------------
// Seen-once hints
//
// Keyed by (profile, hint) so the same read-refuses-a-foreign-row discipline the
// progression accessors use holds here too: a hint learned by one profile is not
// answered for another on a shared machine.
// ---------------------------------------------------------------------------

function hintKey(profileId: string, hintId: string): string {
  return `${profileId}:${hintId}`;
}

/** Whether this profile has already been shown the named one-time hint. */
export async function hasSeenHint(
  profileId: string,
  hintId: string,
): Promise<boolean> {
  const row = await db.hints.get(hintKey(profileId, hintId));
  return row?.profileId === profileId;
}

/** Record that this profile has now seen the hint. Idempotent. */
export async function markHintSeen(
  profileId: string,
  hintId: string,
): Promise<void> {
  await db.hints.put({
    key: hintKey(profileId, hintId),
    profileId,
    hintId,
    seenAt: new Date().toISOString(),
  });
}
