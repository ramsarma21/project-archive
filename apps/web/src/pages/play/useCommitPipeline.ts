import { useCallback } from "react";
import type {
  FieldCommittedEvent,
  PresenterEvent,
} from "@pa/contracts";
import { PACKAGE_ID } from "@pa/chapter-boston";
import {
  getSave,
  putSave,
  upsertProfile,
  type LocalProfile,
} from "../../db.js";
import { pushSave } from "../../api.js";
import {
  choiceAnimationFor,
  type ChoiceAnimation,
} from "../../world/choiceAnimations.js";
import {
  createOnEvent,
  createOnFieldEvent,
  createPersist,
} from "./commitPipeline.js";
import { DAY1_FLOW_VERSION, type RuntimeSession } from "./useRuntimeSession.js";

// Binds the pure commit pipeline (commitPipeline.ts) to the live session and
// profile. onEvent/persist/persistAndExit are rebuilt each render so their
// closures read exactly the values the old inline Play functions captured;
// onFieldEvent keeps its original useCallback dependency list.
export function useCommitPipeline(args: {
  session: RuntimeSession;
  profile: LocalProfile;
  chapterId: string;
  apiUp: boolean;
  readyCueId: string | null;
  setChoiceAnimation: (animation: ChoiceAnimation | null) => void;
  onExit: () => void;
}): {
  onEvent: (ev: PresenterEvent) => Promise<boolean>;
  onFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>;
  persistAndExit: () => Promise<void>;
  committedEventCount: () => number;
} {
  const { session, profile, chapterId } = args;

  const persist = createPersist({
    profileId: profile.profileId,
    chapterId,
    packageId: PACKAGE_ID,
    flowVersion: DAY1_FLOW_VERSION,
    variationRootSeedHex: profile.variationRootSeedHex,
    cloudEnabled: args.apiUp && profile.source === "GOOGLE",
    eventsRef: session.eventsRef,
    revisionRef: session.revisionRef,
    cloudRevisionRef: session.cloudRevisionRef,
    presenterSpatialRef: session.presenterSpatialRef,
    putSave,
    pushSave,
    updateProfileCloudRevision: async (revision) => {
      await upsertProfile({ ...profile, cloudRevision: revision });
    },
    setReport: session.setReport,
  });

  const commitDeps = {
    clientRef: session.clientRef,
    inFlightRef: session.runtimeCommitInFlightRef,
    eventsRef: session.eventsRef,
    busy: session.busy,
    error: session.error,
    plan: session.plan,
    readyCueId: args.readyCueId,
    presentationLocationId: session.presentationLocationId,
    viewLocationId: session.view?.locationId ?? null,
    activeInterruptKind: session.view?.field.activeInterrupt?.kind,
    reducedMotion: Boolean(profile.onboarding?.reducedMotion),
    choiceAnimationFor,
    waitMs: (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
    setChoiceAnimation: args.setChoiceAnimation,
    setBusy: session.setBusy,
    setError: session.setError,
    setTranscript: session.setTranscript,
    setView: session.setView,
    setPresentationOriginLocation: session.setPresentationOriginLocation,
    setPresentationLocationId: session.setPresentationLocationId,
    setPlan: session.setPlan,
    setReport: session.setReport,
    setDone: session.setDone,
    persist,
  };

  const onEvent = createOnEvent(commitDeps);

  // Same dependency list as the original Play.tsx useCallback: the callback
  // identity feeds the __PA_FIELD_EVENT__ QA hook effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onFieldEvent = useCallback(
    createOnFieldEvent(commitDeps),
    [
      session.busy,
      session.error,
      session.plan,
      session.presentationLocationId,
      args.readyCueId,
      session.view?.field.activeInterrupt?.kind,
      session.view?.locationId,
    ],
  );

  // Save & exit refreshes the LOCAL save's presenter spatial snapshot so it
  // captures WHERE the player left, not just where the last runtime event
  // committed (feel-audit-1 P0-11: walking commits nothing, so exiting at
  // the wharf used to leave the snapshot back at the previous exchange).
  // The event log and revision are untouched (revision must always equal the
  // committed event count for cloud replay validation), so this never
  // affects determinism or cloud consistency.
  async function persistAndExit() {
    try {
      const spatial = session.presenterSpatialRef.current;
      if (spatial && session.view) {
        const existing = await getSave(profile.profileId);
        if (
          existing &&
          existing.flowVersion === DAY1_FLOW_VERSION &&
          existing.committedEvents.length === session.eventsRef.current.length
        ) {
          await putSave({ ...existing, presenterSpatial: spatial });
        }
      }
    } catch (cause) {
      console.error("Exit-time save failed; the last committed save stands", cause);
    }
    args.onExit();
  }

  const committedEventCount = useCallback(
    () => session.eventsRef.current.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { onEvent, onFieldEvent, persistAndExit, committedEventCount };
}
