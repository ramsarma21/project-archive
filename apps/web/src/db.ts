import Dexie, { type Table } from "dexie";
import type { PresenterEvent } from "@pa/contracts";

// Local-first persistence. Each profile has its own 32-byte variation root seed
// and its own event-sourced save, so different accounts get different,
// independently-resumable games.
export interface LocalProfile {
  profileId: string;
  accountId: string;
  displayName: string;
  variationRootSeedHex: string;
  source: "LOCAL" | "GOOGLE";
  createdAt: string;
}

export interface LocalSave {
  profileId: string;
  chapterId: string;
  packageId: string;
  committedEvents: PresenterEvent[];
  revision: number;
  status: "IN_PROGRESS" | "COMPLETE";
  updatedAt: string;
}

class ArchiveDB extends Dexie {
  profiles!: Table<LocalProfile, string>;
  saves!: Table<LocalSave, string>;

  constructor() {
    super("project-archive");
    this.version(1).stores({
      profiles: "profileId, accountId, source",
      saves: "profileId, chapterId",
    });
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

export async function getSave(profileId: string): Promise<LocalSave | undefined> {
  return db.saves.get(profileId);
}

export async function putSave(save: LocalSave): Promise<void> {
  await db.saves.put(save);
}
