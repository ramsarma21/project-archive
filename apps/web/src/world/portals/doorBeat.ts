import type { MutableRefObject } from "react";
import type { PresenterEvent } from "@pa/contracts";
import type { PlayerApi } from "../Player.js";
import { DOOR_TARGETS } from "../DoorDirector.js";
import {
  doorwayForBuilding,
  thresholdAnchorForLocation,
} from "../doorwayContract.js";
import { EXPLORE_LOCATIONS } from "../manifest.js";
import {
  INTERIORS,
  interiorDef,
  interiorLanding,
} from "../interiorManifest.js";
import { preloadInteriorAssets } from "../InteriorDirector.js";

// ---------------------------------------------------------------------------
// Door-beat choreography: the arrival door swing for errand/runtime doors and
// the presentation-only explore-room threshold crossings. Timer and effect
// SEQUENCING here is load-bearing (feel-audit-1 door landing/camera work) —
// do not reorder the setTimeout nesting, the input-lock windows, or the
// door-target swaps.
//
// The context is built fresh by World3D on every render so each call reads
// exactly the values the old inline closures captured.
// ---------------------------------------------------------------------------

export interface DoorBeatContext {
  apiRef: { current: PlayerApi | null };
  doorTimer: MutableRefObject<number | null>;
  exploreTimer: MutableRefObject<number | null>;
  setDoorTarget: (targetId: string | null) => void;
  setVisualInteriorId: (interiorId: string | null) => void;
  reducedMotion: boolean;
  // The currently-presented interior id (visual space), if any.
  interiorId: string | null;
  activeChase: boolean;
  // Resolves with whether the runtime ACCEPTED the commit (see Play.onEvent).
  onEvent: (ev: PresenterEvent) => void | Promise<boolean>;
}

// Arrival at a quest target. Both handlers resolve with whether the runtime
// ACCEPTED the commit; the arrival tracker retries dropped commits instead of
// latching (P0-6). Door targets play the full swing beat around the commit.
export async function arriveWithDoorBeat(
  ctx: DoorBeatContext,
  targetId: string,
): Promise<boolean> {
  if (ctx.activeChase) return false;
  const crossesDoor =
    DOOR_TARGETS.has(targetId) ||
    (targetId === "STREET" && Boolean(ctx.interiorId));
  if (!crossesDoor) {
    const accepted = await ctx.onEvent({ type: "FREE_ROAM_GOTO", targetId });
    return accepted !== false;
  }
  if (ctx.doorTimer.current !== null) return false;
  if (targetId !== "STREET") {
    const destination = Object.values(INTERIORS).find((def) =>
      doorwayForBuilding(def.buildingId)?.targetIds.includes(targetId),
    );
    if (destination) preloadInteriorAssets(destination);
  }
  ctx.apiRef.current?.setInputLocked(true);
  ctx.apiRef.current?.setInteractionClip(
    targetId === "STREET" ? "doorOpenOutward" : "doorOpenInward",
  );
  ctx.setDoorTarget(targetId);
  const delay = ctx.reducedMotion ? 220 : 1500;
  return new Promise<boolean>((resolveArrival) => {
    ctx.doorTimer.current = window.setTimeout(() => {
      void (async () => {
        const accepted = await ctx.onEvent({ type: "FREE_ROAM_GOTO", targetId });
        if (accepted === false) {
          // The commit was dropped: unwind the door beat so the tracker can
          // retry a full arrival instead of stranding a half-open door.
          ctx.doorTimer.current = null;
          ctx.setDoorTarget(null);
          ctx.apiRef.current?.setInteractionClip(null);
          ctx.apiRef.current?.setInputLocked(false);
          resolveArrival(false);
          return;
        }
        ctx.doorTimer.current = window.setTimeout(() => {
          ctx.doorTimer.current = null;
          ctx.setDoorTarget(null);
          ctx.apiRef.current?.setInteractionClip(null);
          ctx.apiRef.current?.setInputLocked(false);
        }, ctx.reducedMotion ? 0 : 450);
        resolveArrival(true);
      })();
    }, delay);
  });
}

// Explore-room threshold crossings: same door-swing beat as the errand
// interiors, but purely presentational (no runtime event). The teleport is
// deferred one beat past the interior-id swap: the Player's room clamp and
// the exterior colliders trade places on the React commit, and teleporting
// before the swap lands the body under the OLD movement regime (the room
// clamp would drag an exit landing back inside the building's collider and
// wedge it there).
export function crossExploreThresholdBeat(
  ctx: DoorBeatContext,
  locId: string,
  direction: "IN" | "OUT",
): void {
  if (ctx.exploreTimer.current !== null || ctx.doorTimer.current !== null) return;
  const loc = EXPLORE_LOCATIONS[locId];
  if (!loc) return;
  if (direction === "IN") {
    const destination = interiorDef(locId);
    if (destination) preloadInteriorAssets(destination);
  }
  ctx.apiRef.current?.setInputLocked(true);
  ctx.apiRef.current?.setInteractionClip(
    direction === "IN" ? "doorOpenInward" : "doorOpenOutward",
  );
  ctx.setDoorTarget(direction === "IN" ? locId : "STREET");
  const delay = ctx.reducedMotion ? 200 : 1450;
  ctx.exploreTimer.current = window.setTimeout(() => {
    ctx.setVisualInteriorId(direction === "IN" ? locId : null);
    ctx.exploreTimer.current = window.setTimeout(() => {
      if (direction === "IN") {
        ctx.apiRef.current?.teleport(interiorLanding(loc.id), 0);
      } else {
        ctx.apiRef.current?.teleport(
          thresholdAnchorForLocation(loc, "OUTSIDE"),
          Math.PI + loc.faceY,
        );
      }
      ctx.exploreTimer.current = window.setTimeout(() => {
        ctx.exploreTimer.current = null;
        ctx.setDoorTarget(null);
        ctx.apiRef.current?.setInteractionClip(null);
        ctx.apiRef.current?.setInputLocked(false);
      }, ctx.reducedMotion ? 0 : 420);
    }, 90);
  }, delay);
}
