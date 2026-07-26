// The queue, as a pure reducer over a snapshot of who is waiting.
//
// Deterministic on purpose: given the same queue and the same clock reading it makes
// the same pairing, so a disputed match is reproducible and a test does not have to
// mock a scheduler. The API layer owns persistence and the clock; this owns policy.
//
// THE FAILURE MODE THIS IS DESIGNED AGAINST is a student pressing "find match" in a
// real classroom and nothing ever happening. That is worse than an imperfect duel, so
// the queue widens with patience and, when it runs out of patience, it OFFERS
// SOMETHING RATHER THAN NOTHING. What it never does is invent a ranked opponent:
// standing that came from beating a machine is not standing.

import {
  QUEUE_PATIENCE_S,
  acceptableRankSpan,
  bracketWidthAfter,
  ranksCompatible,
} from "./brackets.js";
import type { ProfileId } from "./match.js";

export interface QueueEntry {
  readonly profileId: ProfileId;
  readonly handle: string;
  readonly rank: number;
  readonly joinedAtMs: number;
  /** A direct challenge: only pairs with the named profile, ignoring brackets. */
  readonly challengeProfileId?: ProfileId;
}

export interface QueuePair {
  readonly a: QueueEntry;
  readonly b: QueueEntry;
  /** The width that admitted this pair. 0 means same Rank. */
  readonly rankGap: number;
  readonly direct: boolean;
}

/**
 * What the queue offers when it cannot find a person.
 *
 * FRIEND_CODE is first because it is the design's primary case: the owner accepted
 * untimed questions on the grounds that you are playing a friend, and a friend match
 * needs no bracket at all.
 *
 * SPARRING is a real duel against a Rank-calibrated boss through the same reducer,
 * clearly labelled, paying NO standing. It exists for the two structurally lonely
 * populations: Rank 1, which is alone at the bottom because that player cleared
 * nothing, and Rank 4, which holds only the strongest students in the class.
 */
export type QueueOffer = "FRIEND_CODE" | "SPARRING";

export type MatchmakingResult =
  | { readonly kind: "MATCHED"; readonly pair: QueuePair }
  | {
      readonly kind: "WAITING";
      readonly widthNow: number;
      readonly waitedS: number;
      readonly reachableNow: number;
    }
  | {
      readonly kind: "EXHAUSTED";
      readonly waitedS: number;
      readonly offers: readonly QueueOffer[];
    };

const waitedSeconds = (entry: QueueEntry, nowMs: number): number =>
  Math.max(0, (nowMs - entry.joinedAtMs) / 1000);

/**
 * Consider one waiting player against the rest of the queue.
 *
 * Pairing preference, in order: a direct challenge, then the closest Rank, then the
 * player who has waited longest, then profileId. The last tiebreak exists only to
 * make the result total — without it two equally good candidates would resolve by
 * array order, which is a database detail leaking into gameplay.
 */
export function findMatchFor(
  seeker: QueueEntry,
  queue: readonly QueueEntry[],
  nowMs: number,
): MatchmakingResult {
  const waitedS = waitedSeconds(seeker, nowMs);
  const others = queue.filter((entry) => entry.profileId !== seeker.profileId);

  // A direct challenge is honoured in both directions and skips the bracket entirely.
  const challenged = others.find(
    (entry) =>
      seeker.challengeProfileId === entry.profileId ||
      entry.challengeProfileId === seeker.profileId,
  );
  if (challenged) {
    return {
      kind: "MATCHED",
      pair: {
        a: seeker,
        b: challenged,
        rankGap: Math.abs(seeker.rank - challenged.rank),
        direct: true,
      },
    };
  }
  // A player waiting on a specific friend is never auto-paired with a stranger.
  if (seeker.challengeProfileId !== undefined) {
    return waitedS >= QUEUE_PATIENCE_S
      ? { kind: "EXHAUSTED", waitedS, offers: ["FRIEND_CODE", "SPARRING"] }
      : { kind: "WAITING", widthNow: 0, waitedS, reachableNow: 0 };
  }

  // Both sides must accept the gap. Using each player's own patience means a player
  // who just joined is not dragged into a wide match by somebody else's long wait.
  const open = others.filter((entry) => entry.challengeProfileId === undefined);
  const candidates = open.filter((entry) => {
    const seekerWidth = bracketWidthAfter(waitedS);
    const entryWidth = bracketWidthAfter(waitedSeconds(entry, nowMs));
    return (
      ranksCompatible(seeker.rank, entry.rank, seekerWidth) &&
      ranksCompatible(seeker.rank, entry.rank, entryWidth)
    );
  });

  if (candidates.length > 0) {
    const best = [...candidates].sort((left, right) => {
      const gap =
        Math.abs(seeker.rank - left.rank) - Math.abs(seeker.rank - right.rank);
      if (gap !== 0) return gap;
      const wait = left.joinedAtMs - right.joinedAtMs;
      if (wait !== 0) return wait;
      return left.profileId < right.profileId ? -1 : 1;
    })[0]!;
    return {
      kind: "MATCHED",
      pair: {
        a: seeker,
        b: best,
        rankGap: Math.abs(seeker.rank - best.rank),
        direct: false,
      },
    };
  }

  if (waitedS >= QUEUE_PATIENCE_S) {
    return { kind: "EXHAUSTED", waitedS, offers: ["FRIEND_CODE", "SPARRING"] };
  }
  const span = acceptableRankSpan(seeker.rank, waitedS);
  return {
    kind: "WAITING",
    widthNow: bracketWidthAfter(waitedS),
    waitedS,
    reachableNow: open.filter(
      (entry) => entry.rank >= span.min && entry.rank <= span.max,
    ).length,
  };
}

/**
 * Pair off a whole queue in one deterministic pass. The API calls this on a timer so
 * pairing does not depend on who happens to poll first — polling order deciding
 * matches would make the ladder a race between browsers.
 */
export function drainQueue(
  queue: readonly QueueEntry[],
  nowMs: number,
): { readonly pairs: readonly QueuePair[]; readonly remaining: readonly QueueEntry[] } {
  // Longest wait first: the player closest to giving up gets served first.
  const ordered = [...queue].sort(
    (left, right) =>
      left.joinedAtMs - right.joinedAtMs ||
      (left.profileId < right.profileId ? -1 : 1),
  );
  const paired = new Set<ProfileId>();
  const pairs: QueuePair[] = [];

  for (const seeker of ordered) {
    if (paired.has(seeker.profileId)) continue;
    const available = ordered.filter((entry) => !paired.has(entry.profileId));
    const result = findMatchFor(seeker, available, nowMs);
    if (result.kind !== "MATCHED") continue;
    paired.add(result.pair.a.profileId);
    paired.add(result.pair.b.profileId);
    pairs.push(result.pair);
  }

  return {
    pairs,
    remaining: ordered.filter((entry) => !paired.has(entry.profileId)),
  };
}
