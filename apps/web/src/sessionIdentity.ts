import type { LocalProfile } from "./db.js";

// Who a resolved session belongs to, and what Home may claim about it.
//
// A LOCAL development profile now establishes a real server session (the same
// cookie a Google sign-in produces), so `getSession` reports it authenticated just
// like a Google one. The bug this closes: App used to set the Google sign-in UI —
// the "Signed in with Google" name and the active-Google-profile marker — for EVERY
// authenticated session, so a local-dev session made Home claim a Google sign-in
// that never happened. Source is inferred first, and the Google-only state is set
// only when the source is actually GOOGLE.

export type ProfileSource = LocalProfile["source"];

/**
 * The source to mirror an authenticated session under.
 *
 * A profile this device already knows keeps its source — a LOCAL profile logs in
 * against its own UUID, so the session's profile id matches the IndexedDB row and
 * mirroring must not relabel it GOOGLE. Only a profile the device has never seen is
 * a fresh Google sign-in.
 */
export function mirroredProfileSource(
  existing: Pick<LocalProfile, "source"> | undefined,
): ProfileSource {
  return existing?.source ?? "GOOGLE";
}

export interface GoogleSignInUi {
  readonly googleName: string | null;
  readonly activeGoogleProfileId: string | null;
}

/**
 * The Google-only Home state for a resolved session. Set ONLY for a GOOGLE source;
 * a LOCAL session is authenticated too, but it is not a Google sign-in and Home
 * must not present it as one.
 */
export function googleSignInUi(
  source: ProfileSource,
  profile: { profileId: string; displayName: string },
): GoogleSignInUi {
  if (source !== "GOOGLE") {
    return { googleName: null, activeGoogleProfileId: null };
  }
  return { googleName: profile.displayName, activeGoogleProfileId: profile.profileId };
}
