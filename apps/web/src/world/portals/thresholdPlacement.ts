import { LOCATIONS, type LocationDef } from "../manifest.js";
import { thresholdAnchorForLocation } from "../doorwayContract.js";
import { interiorLanding } from "../interiorManifest.js";
import { resolveSpatialRestore } from "../spatialRestore.js";
import type { PresenterSpatialState } from "../../db.js";

// ---------------------------------------------------------------------------
// Pending-threshold placement state machine (the "stuck in the wall" logic).
//
// Scene changes do not reposition the player. A location transition may only
// move them across the doorway they physically reached; exterior travel
// always remains at the coordinates produced by player movement.
//
// Threshold placements are carried as explicit pending state and executed on
// the step that runs AFTER the interior-id swap commits. Scheduling them on a
// timer inside the run that swaps the interior id was a race the World3D
// effect lost against itself: the state change re-runs the effect, whose
// cleanup cleared the pending timer, leaving the player stranded in the wall
// void between the exterior facade and the interior room (the reported
// "stuck in the wall" after the Mercer press scene). Deferring across the
// re-run also means the teleport lands under the NEW movement regime, never
// the old one.
//
// This module is PURE: one step maps the current machine state to the next
// state plus at most one side effect for the caller to perform (teleport the
// body, or swap the visual interior id). World3D owns the refs/timers and
// interprets the result.
// ---------------------------------------------------------------------------

export type PendingThresholdPlacement =
  | { kind: "ENTER"; locationId: string }
  | { kind: "EXIT"; anchor: [number, number, number]; faceY: number };

export interface ThresholdStepInput {
  pending: PendingThresholdPlacement | null;
  spawned: boolean;
  visualInteriorId: string | null;
  runtimeLoc: LocationDef;
  qaInteriorOverride: boolean;
  restoreSpatial: PresenterSpatialState | null | undefined;
}

export type ThresholdStepResult = {
  // Next machine state. The caller must write both back to its refs BEFORE
  // performing the action, mirroring the original ref-then-act ordering.
  pending: PendingThresholdPlacement | null;
  spawned: boolean;
} & (
  | { action: "NONE" }
  | { action: "TELEPORT"; position: [number, number, number]; faceY: number }
  | { action: "SWAP_INTERIOR"; interiorId: string | null }
);

export function stepThresholdPlacement(
  input: ThresholdStepInput,
): ThresholdStepResult {
  const pending = input.pending;
  if (pending) {
    if (
      pending.kind === "ENTER" &&
      input.visualInteriorId === pending.locationId
    ) {
      return {
        pending: null,
        spawned: input.spawned,
        action: "TELEPORT",
        position: interiorLanding(pending.locationId),
        faceY: 0,
      };
    }
    if (pending.kind === "EXIT" && input.visualInteriorId === null) {
      return {
        pending: null,
        spawned: input.spawned,
        action: "TELEPORT",
        position: pending.anchor,
        faceY: pending.faceY,
      };
    }
    // Stale placement (the world moved on before the swap committed): drop it
    // and run the normal transition logic below in the same step.
  }
  if (!input.spawned) {
    if (input.runtimeLoc.interior) {
      return {
        pending: { kind: "ENTER", locationId: input.runtimeLoc.id },
        spawned: true,
        action: "SWAP_INTERIOR",
        interiorId: input.runtimeLoc.id,
      };
    }
    // Resume restore (feel-audit-1 P0-11): re-seat the body at the persisted
    // presenter position when it matches the resumed context; the authored
    // scene anchor is the fallback.
    const restored = resolveSpatialRestore(input.restoreSpatial, input.runtimeLoc);
    if (restored) {
      return {
        pending: null,
        spawned: true,
        action: "TELEPORT",
        position: restored.pos,
        faceY: restored.faceY,
      };
    }
    return {
      pending: null,
      spawned: true,
      action: "TELEPORT",
      position: input.runtimeLoc.anchor,
      faceY: input.runtimeLoc.faceY,
    };
  }
  if (
    input.runtimeLoc.interior &&
    input.visualInteriorId !== input.runtimeLoc.id
  ) {
    return {
      pending: { kind: "ENTER", locationId: input.runtimeLoc.id },
      spawned: true,
      action: "SWAP_INTERIOR",
      interiorId: input.runtimeLoc.id,
    };
  }
  if (!input.runtimeLoc.interior && input.visualInteriorId) {
    // Only runtime interiors are evicted by a runtime location change;
    // presentation-only explore rooms are entered and left through their own
    // door portals while the runtime stays on the street.
    const previousInterior = LOCATIONS[input.visualInteriorId];
    if (!previousInterior) {
      return { pending: null, spawned: input.spawned, action: "NONE" };
    }
    if (input.qaInteriorOverride) {
      return { pending: null, spawned: input.spawned, action: "NONE" };
    }
    return {
      pending: {
        kind: "EXIT",
        anchor: thresholdAnchorForLocation(previousInterior, "OUTSIDE"),
        faceY: Math.PI + previousInterior.faceY,
      },
      spawned: input.spawned,
      action: "SWAP_INTERIOR",
      interiorId: null,
    };
  }
  return { pending: null, spawned: input.spawned, action: "NONE" };
}
