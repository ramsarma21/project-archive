import type { PresenterEvent } from "./protocol.js";

// The authoritative save is event-sourced: the seed plus the ordered list of
// committed presenter events fully determines the run. Everything else
// (world, learner, transcript) is a deterministic projection.
export interface SaveRecord {
  saveId: string;
  profileId: string;
  chapterId: string;
  packageId: string;
  variationRootSeedHex: string;
  committedEvents: PresenterEvent[];
  revision: number; // increments per committed transaction (optimistic concurrency)
  status: "IN_PROGRESS" | "COMPLETE";
  updatedAt: string; // ISO
}

export interface ProfileSummary {
  profileId: string;
  accountId: string;
  displayName: string;
  createdAt: string;
}
