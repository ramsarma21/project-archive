import type { InputRequest } from "@pa/contracts";
import type { ResolvedQuestMarker } from "../QuestMarkerDirector.js";
import {
  ALL_INTERIOR_LOCATIONS,
  EXPLORE_LOCATIONS,
  MARKER_ANCHORS,
} from "../manifest.js";
import {
  interiorDoorFacade,
  interiorExitSensor,
} from "../interiorManifest.js";
import {
  INTERIOR_EXIT_KIND,
  questMarkerMeta,
} from "../questMarkerManifest.js";
import { TIMED_RUN_TARGETS } from "../content/day1Ids.js";

// Resolve each eligible FREE_ROAM target into an explicit quest marker with
// an independent VISUAL anchor (where the imported kit is drawn) and ARRIVAL
// anchor (where proximity is measured). No silent fallback to the authored
// scene location: an unmapped target is skipped (and warned in dev). Only the
// dynamic STREET marker derives its anchors from the active interior.
//
// Pure function of (request, interrupt flag, active interior id) plus the
// static manifests; unit-tested under node.
export interface ResolveMarkersInput {
  request: InputRequest | null;
  // Truthiness of view.field.activeInterrupt: any live interrupt suppresses
  // the whole marker field.
  hasActiveInterrupt: boolean;
  interiorId: string | null;
}

function devWarn(message: string): void {
  // Vite injects import.meta.env.DEV; node test runner leaves it undefined, so
  // guard defensively and stay silent outside a browser dev build.
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (env?.DEV) console.warn(message);
}

export function resolveQuestMarkers(
  input: ResolveMarkersInput,
): ResolvedQuestMarker[] {
  const request = input.request;
  if (input.hasActiveInterrupt) return [];
  if (request?.kind !== "FREE_ROAM") return [];
  const interiorId = input.interiorId;
  const activeInterior = interiorId ? ALL_INTERIOR_LOCATIONS[interiorId] : null;
  // Inside a presentation-only explore interior the player stands in an
  // ISOLATED coordinate slot: exterior target anchors are meaningless from
  // here (the audited "exit marker reports 1098m", feel-audit-1 P1-16).
  // Only the dynamic STREET/exit marker resolves in the active space.
  const isolatedExplore = Boolean(
    interiorId && EXPLORE_LOCATIONS[interiorId],
  );
  const out: ResolvedQuestMarker[] = [];
  for (const target of request.targets) {
    if (target.marker === "HIDDEN") continue;
    if (isolatedExplore && target.targetId !== "STREET") continue;
    if (request.selectedTargetId && target.targetId !== request.selectedTargetId) continue;
    const forcedGold =
      request.selectedTargetId === target.targetId || target.marker === "GOLD";
    if (target.targetId === "STREET") {
      if (activeInterior) {
        const inside = interiorExitSensor(activeInterior.id);
        const facade = interiorDoorFacade(activeInterior.id);
        const visual: [number, number, number] = [
          facade[0] + 0.9,
          facade[1],
          facade[2] + 0.18,
        ];
        out.push({
          targetId: "STREET",
          label: target.label,
          kind: INTERIOR_EXIT_KIND,
          forcedGold,
          timed: false,
          visualAnchor: visual,
          arrivalAnchor: inside,
        });
      } else {
        // Street ground spot when already outside (return-to-street).
        const anchor = MARKER_ANCHORS.STREET ?? [0, 0, 1.5];
        out.push({
          targetId: "STREET",
          label: target.label,
          kind: "GROUND",
          forcedGold,
          timed: false,
          visualAnchor: anchor,
          arrivalAnchor: anchor,
        });
      }
      continue;
    }
    const meta = questMarkerMeta(target.targetId);
    if (!meta) {
      devWarn(
        `[quest-marker] no manifest metadata for target "${target.targetId}"; not rendered`,
      );
      continue;
    }
    out.push({
      targetId: target.targetId,
      label: target.label,
      kind: meta.kind,
      forcedGold,
      timed: TIMED_RUN_TARGETS.has(target.targetId),
      visualAnchor: meta.visualAnchor,
      arrivalAnchor: meta.arrivalAnchor,
    });
  }
  return out;
}
