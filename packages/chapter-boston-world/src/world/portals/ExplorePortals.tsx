import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PlayerApi } from "../Player.js";
import { EXPLORE_LOCATIONS } from "../manifest.js";
import { thresholdAnchorForLocation } from "../doorwayContract.js";
import { interiorExitSensor } from "../interiorManifest.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "../interactionRegistry.js";

const EXPLORE_EXIT_SOURCE = "EXPLORE_EXIT_PORTAL";

// ---- Explore interiors (Bible §4: every building enterable) -----------------
// Presentation-only portals: the runtime never leaves its exterior location;
// walking into any non-errand door crosses the same kind of threshold the
// hero interiors use (door swing, short beat, teleport across the leaf).
// NOTE(wave-4): portal placement data stays colocated with the component for
// now; a later content wave may move it with the rest of the chapter data.
const EXPLORE_PORTALS = Object.values(EXPLORE_LOCATIONS).map((loc) => ({
  loc,
  outside: thresholdAnchorForLocation(loc, "OUTSIDE"),
  inside: interiorExitSensor(loc.id),
}));

export function ExplorePortals(props: {
  apiRef: { current: PlayerApi | null };
  interiorId: string | null;
  enabled: boolean;
  interactionRegistry: InteractionRegistry;
  onEnter: (locId: string) => void;
  onExit: (locId: string) => void;
}) {
  // Disarm after every threshold crossing until the player steps away, so a
  // teleport landing beside the sensor never ping-pongs back through it.
  const armed = useRef(false);
  useEffect(() => {
    armed.current = false;
  }, [props.interiorId]);
  useEffect(
    () => () => props.interactionRegistry.clearSource(EXPLORE_EXIT_SOURCE),
    [props.interactionRegistry],
  );
  useFrame(() => {
    props.interactionRegistry.clearSource(EXPLORE_EXIT_SOURCE);
    if (!props.enabled) return;
    const api = props.apiRef.current;
    if (!api) return;
    if (props.interiorId) {
      const portal = EXPLORE_PORTALS.find((p) => p.loc.id === props.interiorId);
      if (!portal) return; // hero interiors exit through their runtime flow
      props.interactionRegistry.upsert({
        id: `PORTAL:EXIT:${portal.loc.id}`,
        sourceId: EXPLORE_EXIT_SOURCE,
        kind: "PORTAL",
        label: "Open the street door",
        priority: INTERACTION_PRIORITIES.SAFETY_TRAVERSAL,
        spaceId: portal.loc.id,
        position: portal.inside,
        radius: 2.4,
        facingDot: -0.35,
        losRequired: false,
        enabled: true,
        activate: () => {
          armed.current = false;
          props.onExit(portal.loc.id);
          return true;
        },
      });
      const dx = api.position.x - portal.inside[0];
      const dz = api.position.z - portal.inside[2];
      const d2 = dx * dx + dz * dz;
      if (!armed.current) {
        if (d2 > 1.6 * 1.6) armed.current = true;
        return;
      }
      if (d2 < 0.95 * 0.95) props.onExit(portal.loc.id);
      return;
    }
    let nearest: (typeof EXPLORE_PORTALS)[number] | null = null;
    let nearestD2 = Infinity;
    for (const portal of EXPLORE_PORTALS) {
      const dx = api.position.x - portal.outside[0];
      const dz = api.position.z - portal.outside[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearest = portal;
      }
    }
    if (!armed.current) {
      if (nearestD2 > 1.6 * 1.6) armed.current = true;
      return;
    }
    if (nearest && nearestD2 < 0.95 * 0.95) props.onEnter(nearest.loc.id);
  });
  return null;
}
