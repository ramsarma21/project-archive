export type PresentationActionSurface = "BLOCKED" | "PRIMER" | "REQUEST";
export type PresentationOwner =
  | "OPEN_RESPONSE"
  | "RELEASE_CINEMATIC"
  | "INTERIOR_INSPECT"
  | "FIELD_INTERRUPT"
  | "RUNTIME_TIMELINE"
  | "ARCHIVE_MODAL"
  | "MANUAL_MODAL"
  | "REPORT_MODAL"
  | "NONE";

export interface GlobalPresentationOwnershipInput {
  openResponse: boolean;
  releaseCinematic: boolean;
  interiorInspect: boolean;
  fieldInterrupt: boolean;
  runtimeTimeline: boolean;
  archiveModal: boolean;
  manualModal: boolean;
  reportModal: boolean;
}

export interface GlobalPresentationLock {
  owner: PresentationOwner;
  blocking: boolean;
  hideUnderlyingControls: boolean;
  disableArchiveAndSaveActions: boolean;
  disableInteractionRegistry: boolean;
  suppressAmbientNotices: boolean;
}

export function resolveGlobalPresentationLock(
  input: GlobalPresentationOwnershipInput,
): GlobalPresentationLock {
  const owner: PresentationOwner = input.openResponse
    ? "OPEN_RESPONSE"
    : input.releaseCinematic
      ? "RELEASE_CINEMATIC"
      : input.interiorInspect
        ? "INTERIOR_INSPECT"
        : input.fieldInterrupt
          ? "FIELD_INTERRUPT"
          : input.runtimeTimeline
            ? "RUNTIME_TIMELINE"
            : input.archiveModal
              ? "ARCHIVE_MODAL"
              : input.manualModal
                ? "MANUAL_MODAL"
                : input.reportModal
                  ? "REPORT_MODAL"
                  : "NONE";
  const blocking = owner !== "NONE";
  return {
    owner,
    blocking,
    hideUnderlyingControls: blocking,
    disableArchiveAndSaveActions: blocking,
    disableInteractionRegistry: blocking,
    suppressAmbientNotices: blocking,
  };
}

export interface PresentationHandoffInput {
  choreographyReady: boolean;
  presentationActive: boolean;
  primerPending: boolean;
}

export function presentationCueReady(
  cueId: string | null | undefined,
  readyCueId: string | null,
): boolean {
  return (
    !cueId ||
    cueId.startsWith("PA.FIELD.INTERRUPT.") ||
    readyCueId === cueId
  );
}

// One semantic handoff owns the central control surface:
// choreography/timeline -> first-use primer -> authored runtime request.
// The presenter never auto-advances a request at these boundaries.
export function presentationActionSurface(
  input: PresentationHandoffInput,
): PresentationActionSurface {
  if (!input.choreographyReady || input.presentationActive) return "BLOCKED";
  return input.primerPending ? "PRIMER" : "REQUEST";
}
