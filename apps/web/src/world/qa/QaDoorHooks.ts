import { useEffect, type MutableRefObject } from "react";
import type { PlayerApi } from "../Player.js";
import {
  interiorDef,
  interiorLanding,
  interiorPoint,
} from "../interiorManifest.js";
import { preloadInteriorAssets } from "../InteriorDirector.js";
import { QA_RUNTIME_ENABLED } from "../qaEnvironment.js";

// Installs the QA-only __PA_QA_DOOR__ / __PA_QA_INTERIOR__ window hooks used
// by the browser harnesses to force door/interior states without replaying
// the runtime to them. Gated on QA_RUNTIME_ENABLED; a no-op in production.
export function useQaDoorHooks(params: {
  apiRef: { current: PlayerApi | null };
  doorTimer: MutableRefObject<number | null>;
  exploreTimer: MutableRefObject<number | null>;
  qaInteriorOverride: MutableRefObject<boolean>;
  setDoorTarget: (target: string | null) => void;
  setVisualInteriorId: (interiorId: string | null) => void;
}): void {
  const {
    apiRef,
    doorTimer,
    exploreTimer,
    qaInteriorOverride,
    setDoorTarget,
    setVisualInteriorId,
  } = params;
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type DoorQaWindow = Window & {
      __PA_QA_DOOR__?: (
        targetId: string | null,
        interiorId?: string | null,
      ) => void;
      __PA_QA_INTERIOR__?: (
        interiorId: string,
        view?: "LANDING" | "CENTER",
      ) => void;
    };
    const qaWindow = window as DoorQaWindow;
    // A QA-forced interior/door override must be authoritative: cancel any
    // in-flight presentation threshold beat (door swing / explore transfer)
    // so a previously-queued casual transfer cannot land a frame later and
    // clobber the forced space (e.g. a post-refuge tavern entry bleeding into
    // the next generic-interior transfer). Dev/QA-only.
    const cancelInFlightThresholdBeats = () => {
      if (exploreTimer.current !== null) {
        window.clearTimeout(exploreTimer.current);
        exploreTimer.current = null;
      }
      if (doorTimer.current !== null) {
        window.clearTimeout(doorTimer.current);
        doorTimer.current = null;
      }
      apiRef.current?.setInteractionClip(null);
      apiRef.current?.setInputLocked(false);
    };
    qaWindow.__PA_QA_DOOR__ = (targetId, nextInterior) => {
      cancelInFlightThresholdBeats();
      if (nextInterior !== undefined) {
        qaInteriorOverride.current = true;
        setVisualInteriorId(nextInterior);
      }
      setDoorTarget(targetId);
    };
    qaWindow.__PA_QA_INTERIOR__ = (nextInterior, view = "LANDING") => {
      const def = interiorDef(nextInterior);
      if (!def) throw new Error(`unknown QA interior ${nextInterior}`);
      cancelInFlightThresholdBeats();
      qaInteriorOverride.current = true;
      preloadInteriorAssets(def);
      setDoorTarget(null);
      setVisualInteriorId(nextInterior);
      let attempts = 0;
      const place = () => {
        const api = apiRef.current;
        if (api) {
          const destination =
            view === "CENTER"
              ? interiorPoint(nextInterior, [
                  0,
                  0,
                  Math.min(0, -def.dimensions[2] / 2 + 6),
                ])
              : interiorLanding(nextInterior);
          api.teleport(destination, 0);
          return;
        }
        attempts += 1;
        if (attempts < 40) window.setTimeout(place, 60);
      };
      window.setTimeout(place, 80);
    };
    return () => {
      delete qaWindow.__PA_QA_DOOR__;
      delete qaWindow.__PA_QA_INTERIOR__;
    };
  }, []);
}
