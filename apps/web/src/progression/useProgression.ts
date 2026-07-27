import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSession, postAbandonMissionAttempt, pullProgression } from "../api.js";
import { cacheProgression, forgetProgression, progressionFor } from "../db.js";
import type { MissionAttemptTally } from "../module/moduleGate.js";
import type { ModuleRunCompletion } from "../module/moduleGate.js";
import type { MissionResult } from "../mission/result.js";
import { authorizeAttempt, type AuthorizationResult } from "./authorize.js";
import { commitForResult } from "./commit.js";
import { deployStanding, type DeployStanding } from "./gate.js";
import { enqueueOutcome, flushOutcomes, outstandingOutcomes } from "./outbox.js";
import { newRunnerView, projectProgression, type ProgressionView } from "./projection.js";

// ---------------------------------------------------------------------------
// The hub's one handle on durable progression.
//
// It owns four things and nothing else: who is signed in, the last snapshot the
// server sent, the durable attempt ids this session has been granted, and the
// queue of outcomes still owed. Everything it reports is either a server value
// or a projection of one — there is no client-side XP, no client-side Level, no
// client-side attempt counter anywhere in this file.
//
// IDENTITY. Discovered here rather than threaded in from App, so wiring the hub
// is one hook call and no new props. The session cookie is httpOnly and
// first-party, so `getSession` is also the only way this layer can learn a
// profile id — it cannot be passed a different one by a caller.
//
// TWO ACCOUNTS ON ONE MACHINE. Two browser contexts already have two cookie
// jars and two IndexedDB databases, so they are separate for free. The case that
// needs care is two Google accounts used in sequence in the SAME context, which
// share one database. Three things keep them apart: every stored row is keyed by
// profile id, every read refuses a row addressed to a different profile, and
// this hook holds no state that outlives a change of profile id — the load
// effect keys on it, so signing in as B discards A's view rather than editing
// it. The outbox is filtered the same way, so B's session never delivers A's
// outcomes and A's outcomes are not lost either; they wait for A.
// ---------------------------------------------------------------------------

/** Where the numbers on screen came from. The hub says so, plainly. */
export type ProgressionSource =
  /** Fetched this page load. Authoritative. */
  | "SERVER"
  /** The last snapshot this device saw. Correct as of then, and labelled. */
  | "CACHE"
  /** Nothing durable: signed out, or a profile the server has never answered for. */
  | "NEW_RUNNER";

export interface ProgressionOptions {
  readonly chapterId: string;
  /**
   * The chapter's own unlock chain. Takes the missions the SERVER says are
   * resolved, so the route is drawn from durable state rather than from what
   * this browser remembers having played.
   */
  isRouteOpen(input: {
    missionId: string;
    resolvedMissionIds: ReadonlySet<string>;
  }): boolean;
}

export interface ProgressionApi {
  readonly loading: boolean;
  readonly source: ProgressionSource;
  /** Always present. The fresh-runner set when there is nothing durable. */
  readonly view: ProgressionView;
  readonly profileId: string | null;
  /** The profile's variation root. Seeds every attempt; null when signed out. */
  readonly profileSeedHex: string | null;
  readonly runnerName: string;
  /** True when nothing will be saved, and the hub must say so. */
  readonly unranked: boolean;
  /** Outcomes earned on this device that the server has not acknowledged. */
  readonly unsyncedOutcomes: number;
  readonly lastError: string | null;
  /**
   * Resolved attempts per mission, in the shape the mission session's gate
   * reads. Server truth, so a session seeded with it cannot be reset by
   * clearing browser storage.
   */
  readonly tallies: Readonly<Record<string, MissionAttemptTally>>;
  /** Hand straight to the mission session. Route open AND attempts remaining. */
  isUnlocked(missionId: string): boolean;
  standing(missionId: string): DeployStanding;
  /** Records the module and opens the attempt server-side. Online-only. */
  authorize(completion: ModuleRunCompletion): Promise<AuthorizationResult>;
  /**
   * Forfeit the interrupted attempt the server still holds open, then refresh.
   * Drains any queued terminal outcome FIRST, so a run that actually finished
   * spends its real outcome rather than being clobbered by a forfeit.
   */
  forfeitInterruptedAttempt(): Promise<void>;
  /** Commits a resolved attempt, or queues it durably. Never throws. */
  recordResult(result: MissionResult): Promise<void>;
  refresh(): Promise<void>;
}

interface Identity {
  readonly profileId: string | null;
  readonly csrfToken: string | null;
  readonly seedHex: string | null;
  readonly displayName: string;
}

const SIGNED_OUT: Identity = {
  profileId: null,
  csrfToken: null,
  seedHex: null,
  displayName: "Runner",
};

function talliesFrom(view: ProgressionView): Record<string, MissionAttemptTally> {
  const tallies: Record<string, MissionAttemptTally> = {};
  for (const [missionId, standing] of view.missions) {
    tallies[missionId] = {
      missionId,
      attemptsUsed: standing.attemptsUsed,
      outcome: standing.outcome,
    };
  }
  return tallies;
}

export function useProgression(options: ProgressionOptions): ProgressionApi {
  const { chapterId, isRouteOpen } = options;

  const [identity, setIdentity] = useState<Identity>(SIGNED_OUT);
  const [view, setView] = useState<ProgressionView>(() => newRunnerView(chapterId));
  const [source, setSource] = useState<ProgressionSource>("NEW_RUNNER");
  const [loading, setLoading] = useState(true);
  const [unsynced, setUnsynced] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  // Durable attempt ids granted this session, by mission. The commit is
  // addressed to the row the server opened, never to the container's local id.
  const authorizedRef = useRef(new Map<string, string>());
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const routeRef = useRef(isRouteOpen);
  routeRef.current = isRouteOpen;
  // One flush at a time. Two overlapping drains would deliver the same outcome
  // twice, which the server tolerates and the unsynced count would not.
  const flushingRef = useRef(false);

  const countUnsynced = useCallback(async (profileId: string | null) => {
    if (!profileId) {
      setUnsynced(0);
      return;
    }
    setUnsynced((await outstandingOutcomes(profileId)).length);
  }, []);

  const drain = useCallback(async () => {
    const { profileId, csrfToken } = identityRef.current;
    if (!profileId || !csrfToken || flushingRef.current) return;
    flushingRef.current = true;
    try {
      const flushed = await flushOutcomes({ profileId, csrfToken });
      await countUnsynced(profileId);
      if (flushed.settled > 0 || flushed.discarded > 0) {
        // Something moved server-side, so the view on screen is behind.
        const pulled = await pullProgression(profileId);
        if (pulled.status === "OK") {
          setView(projectProgression(pulled.value));
          setSource("SERVER");
          await cacheProgression(profileId, pulled.value, new Date().toISOString());
        }
      }
      setLastError(flushed.pending ? flushed.lastError : null);
    } finally {
      flushingRef.current = false;
    }
  }, [countUnsynced]);

  const load = useCallback(async () => {
    setLoading(true);
    // Grants are never carried across a load. Signing in as a second account
    // on the same machine must not inherit the first one's authorized attempt,
    // and a mid-mission refresh recovers its attempt from the server's own
    // `openAttempt` rather than from a stale entry here.
    authorizedRef.current.clear();
    const session = await getSession();
    const next: Identity =
      session?.authenticated && session.profile
        ? {
            profileId: session.profile.profileId,
            csrfToken: session.csrfToken ?? null,
            seedHex: session.profile.variationRootSeedHex,
            displayName: session.profile.displayName,
          }
        : SIGNED_OUT;
    setIdentity(next);
    identityRef.current = next;

    if (!next.profileId) {
      // Signed out. Nothing durable exists, nothing is fetched, and the hub is
      // told to say so rather than drawing a Level nobody will keep.
      setView(newRunnerView(chapterId));
      setSource("NEW_RUNNER");
      setUnsynced(0);
      setLoading(false);
      return;
    }

    const pulled = await pullProgression(next.profileId);
    if (pulled.status === "OK") {
      setView(projectProgression(pulled.value));
      setSource("SERVER");
      setLastError(null);
      await cacheProgression(next.profileId, pulled.value, new Date().toISOString());
    } else {
      // The cache is a picture of the last time the server answered. It is
      // shown, labelled, and never used to decide anything: an attempt still
      // cannot open without a live authorization.
      const cached = await progressionFor(next.profileId);
      if (cached) {
        setView(projectProgression(cached.snapshot));
        setSource("CACHE");
      } else {
        setView(newRunnerView(chapterId, next.profileId));
        setSource("NEW_RUNNER");
      }
      setLastError(pulled.status === "REFUSED" ? pulled.error : pulled.detail);
    }
    await countUnsynced(next.profileId);
    setLoading(false);
    void drain();
  }, [chapterId, countUnsynced, drain]);

  useEffect(() => {
    void load();
  }, [load]);

  // A school network comes back. Drain then, rather than on a timer: the event
  // is the signal, and polling a dead network from a classroom of twenty-five
  // machines is its own denial of service.
  useEffect(() => {
    const onOnline = () => void drain();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [drain]);

  const unranked = identity.profileId === null;
  // Known: this device holds the profile's durable state, live or cached.
  // Signed in with neither is the one case the gate refuses on principle.
  const known = unranked || source !== "NEW_RUNNER";

  const standing = useCallback(
    (missionId: string): DeployStanding =>
      deployStanding({
        view,
        missionId,
        routeOpen: routeRef.current({
          missionId,
          resolvedMissionIds: view.resolvedMissionIds,
        }),
        known,
        unranked,
      }),
    [known, unranked, view],
  );

  const isUnlocked = useCallback(
    (missionId: string) => standing(missionId).deployable,
    [standing],
  );

  const authorize = useCallback(
    async (completion: ModuleRunCompletion): Promise<AuthorizationResult> => {
      const { profileId, csrfToken } = identityRef.current;
      const result = await authorizeAttempt({
        profileId,
        csrfToken,
        chapterId,
        completion,
      });
      if (result.ok) {
        authorizedRef.current.set(
          completion.missionId,
          result.authorization.attemptId,
        );
        setLastError(null);
      } else {
        setLastError(result.detail);
      }
      return result;
    },
    [chapterId],
  );

  const recordResult = useCallback(
    async (result: MissionResult): Promise<void> => {
      const { profileId, csrfToken } = identityRef.current;
      if (!profileId || !csrfToken) {
        // Unranked practice. The attempt was never opened server-side, so there
        // is nothing to commit and nothing was ever going to be paid.
        return;
      }
      const durableAttemptId =
        authorizedRef.current.get(result.missionId) ??
        (view.openAttempt?.missionId === result.missionId
          ? view.openAttempt.attemptId
          : null);
      if (!durableAttemptId) {
        // Reached a result without an authorized attempt. Nothing is committed
        // — inventing an attempt id is exactly the forgery this layer exists to
        // prevent — and the hub is told, because the run genuinely paid nothing.
        setLastError("ATTEMPT_NOT_AUTHORIZED");
        await load();
        return;
      }
      const payload = commitForResult({ durableAttemptId, result });
      if (!payload.ok) {
        setLastError(payload.reason);
        return;
      }
      if (payload.note) console.warn(`[progression] ${payload.note}`);
      await enqueueOutcome({
        profileId,
        missionId: result.missionId,
        body: payload.body,
        at: result.resolvedAt,
      });
      authorizedRef.current.delete(result.missionId);
      await countUnsynced(profileId);
      await drain();
    },
    [countUnsynced, drain, load, view.openAttempt],
  );

  const forfeitInterruptedAttempt = useCallback(async (): Promise<void> => {
    const { profileId, csrfToken } = identityRef.current;
    if (!profileId || !csrfToken) return;
    const open = view.openAttempt;
    if (!open) return;

    // OUTBOX FIRST. An interrupted attempt whose terminal outcome is sitting in the
    // outbox actually finished — the network dropped before the commit landed — and
    // that real outcome must spend the attempt, not a forfeit. Drain, then re-read:
    // if the queued outcome closed the attempt, there is nothing left to forfeit and
    // the honest result stands.
    await drain();
    const refreshed = await pullProgression(profileId);
    if (refreshed.status === "OK") {
      setView(projectProgression(refreshed.value));
      setSource("SERVER");
      await cacheProgression(profileId, refreshed.value, new Date().toISOString());
    }
    const stillOpen =
      refreshed.status === "OK" ? refreshed.value.openAttempt : open;
    if (!stillOpen) return;

    const result = await postAbandonMissionAttempt(
      profileId,
      { attemptId: stillOpen.attemptId },
      csrfToken,
    );
    if (result.status === "REFUSED") setLastError(result.error);
    else if (result.status === "UNREACHABLE") setLastError(result.detail);
    // Reload so the closed attempt, the advanced ordinal and the re-armed module
    // gate are all the server's current truth. The next Deploy requires the module
    // again because the attempt is spent and a new ordinal needs its own completion.
    await load();
  }, [drain, load, view.openAttempt]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const tallies = useMemo(() => talliesFrom(view), [view]);

  return useMemo<ProgressionApi>(
    () => ({
      loading,
      source,
      view,
      profileId: identity.profileId,
      profileSeedHex: identity.seedHex,
      runnerName: identity.displayName,
      unranked,
      unsyncedOutcomes: unsynced,
      lastError,
      tallies,
      isUnlocked,
      standing,
      authorize,
      forfeitInterruptedAttempt,
      recordResult,
      refresh,
    }),
    [
      authorize,
      forfeitInterruptedAttempt,
      identity.displayName,
      identity.profileId,
      identity.seedHex,
      isUnlocked,
      lastError,
      loading,
      recordResult,
      refresh,
      source,
      standing,
      tallies,
      unranked,
      unsynced,
      view,
    ],
  );
}

/** Signing out drops this profile's cached picture and nobody else's. */
export async function forgetProgressionCache(profileId: string): Promise<void> {
  await forgetProgression(profileId);
}
