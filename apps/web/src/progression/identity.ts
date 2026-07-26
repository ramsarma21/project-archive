import type { ProgressionSnapshot } from "@pa/contracts";

// ---------------------------------------------------------------------------
// Whose progression is this?
//
// One predicate, asked on every read and every write of a stored snapshot.
//
// Two accounts on one machine is the case it exists for, and the dangerous half
// of that case is not two browser windows — those have separate cookie jars and
// separate IndexedDB databases and are apart for free. It is two Google accounts
// used in sequence in the SAME browser profile, which share one database. If a
// snapshot could be read back under a key it was not written for, the second
// student would open the hub on the first one's Rank, and on a Rank-bracketed
// ladder that is not a display bug.
//
// So a snapshot carries the profile it describes, and it is only ever trusted
// when it says the profile that was asked for. Cheap, total, and it fails to
// "show nothing" rather than to "show somebody else".
// ---------------------------------------------------------------------------

export function snapshotBelongsTo(
  snapshot: Pick<ProgressionSnapshot, "campaign"> | null | undefined,
  profileId: string,
): boolean {
  if (!snapshot || profileId === "") return false;
  return snapshot.campaign?.profileId === profileId;
}
