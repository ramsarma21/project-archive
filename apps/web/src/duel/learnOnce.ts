import { useCallback, useEffect, useRef, useState } from "react";
import { getSession } from "../api.js";
import { hasSeenHint, markHintSeen } from "../db.js";

// A one-time teaching hint, persisted per player so it survives a reload.
//
// WHY IT USES THE PROGRESSION STORE'S MECHANISM. A mechanic the player must learn
// exactly once is per-player state that must outlive a reload, which is precisely
// what `db.ts` already does for progression — local-first IndexedDB keyed by
// profileId. This adds one small store to it rather than inventing a parallel
// cache, so clearing site data forgets a hint the same worthless way it forgets the
// cached snapshot, and two accounts on one machine each learn the game once.
//
// WHY IDENTITY IS DISCOVERED, NOT THREADED. The duel is mounted several layers below
// the hub and its mission seam carries no profile id (and those files belong to
// other lanes). `useProgression` faced the same wall and resolved it the same way:
// the session cookie is the one thing this layer can always ask about, so
// `getSession` is how it learns whose game this is. A signed-out practice run has no
// profile, so it shares one local "@unsigned" bucket — it still learns the rule once
// on this browser, which is the honest most a practice run can persist.

/** The bucket a run with no signed-in profile records its hints under. */
const UNSIGNED_BUCKET = "@unsigned";

export interface LearnOnce {
  /**
   * True once the persisted state has been read. A caller must not show the hint
   * before this, or a slow identity read would flash a hint the player has already
   * seen. Until it is true the hint is simply held back to the next opportunity.
   */
  readonly ready: boolean;
  /** Whether this player has already been shown the hint. */
  readonly seen: boolean;
  /** Record the hint as seen — for this session immediately, and durably. */
  markSeen: () => void;
}

/**
 * Track whether a named one-time hint has been shown to the current player.
 *
 * `markSeen` flips `seen` in state at once (so the notice hides within this session
 * the instant it is shown) and persists in the background. A failure to read or
 * write storage fails toward TEACHING: `seen` stays false so the rule is still shown,
 * because a rule taught twice is a smaller harm than a rule never taught.
 */
export function useLearnOnce(hintId: string): LearnOnce {
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState(false);
  const profileRef = useRef<string>(UNSIGNED_BUCKET);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let profileId = UNSIGNED_BUCKET;
      try {
        const session = await getSession();
        if (session?.authenticated && session.profile) {
          profileId = session.profile.profileId;
        }
      } catch {
        /* no session reachable: fall back to the unsigned bucket */
      }
      profileRef.current = profileId;
      let already = false;
      try {
        already = await hasSeenHint(profileId, hintId);
      } catch {
        /* storage unreadable: treat as unseen, so the rule is still taught */
      }
      if (cancelled) return;
      setSeen(already);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hintId]);

  const markSeen = useCallback(() => {
    setSeen(true);
    void markHintSeen(profileRef.current, hintId).catch(() => {
      /* a failed write costs one extra reminder next time, nothing more */
    });
  }, [hintId]);

  return { ready, seen, markSeen };
}
