import type { PresenterEvent } from "./protocol.js";

// Presenter-side spatial snapshot carried alongside the event log. Optional
// and purely presentational: replay/state authority stays with the events.
export interface PresenterSpatialSnapshot {
  pos: [number, number, number];
  yaw: number;
  interiorId: string | null;
  locationId: string;
}

// The authoritative save is event-sourced: the seed plus the ordered list of
// committed presenter events fully determines the run. Everything else
// (world, learner, transcript) is a deterministic projection.
export interface SaveRecord {
  saveId: string;
  profileId: string;
  chapterId: string;
  packageId: string;
  variationRootSeedHex: string;
  flowVersion?: number;
  committedEvents: PresenterEvent[];
  revision: number; // increments per committed transaction (optimistic concurrency)
  status: "IN_PROGRESS" | "COMPLETE";
  updatedAt: string; // ISO
  // Optional spatial restore point (feel-audit-1 P0-11): where the presenter
  // should re-seat the player on resume. Ignored by replay validation.
  presenterSpatial?: PresenterSpatialSnapshot;
}

export interface ProfileSummary {
  profileId: string;
  accountId: string;
  displayName: string;
  createdAt: string;
}
