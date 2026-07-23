import { test } from "node:test";
import assert from "node:assert/strict";
import type { InputRequest } from "@pa/contracts";
import { resolveQuestMarkers } from "../quest/resolveMarkers.js";
import { MARKER_ANCHORS } from "../manifest.js";
import {
  interiorDoorFacade,
  interiorExitSensor,
} from "../interiorManifest.js";
import {
  INTERIOR_EXIT_KIND,
  questMarkerMeta,
} from "../questMarkerManifest.js";

function freeRoam(
  targets: { targetId: string; label?: string; marker?: "BLUE" | "GOLD" | "HIDDEN" }[],
  selectedTargetId?: string,
): InputRequest {
  return {
    kind: "FREE_ROAM",
    canProceed: false,
    targets: targets.map((t) => ({
      targetId: t.targetId,
      label: t.label ?? t.targetId,
      marker: t.marker ?? "BLUE",
    })),
    ...(selectedTargetId ? { selectedTargetId } : {}),
  };
}

test("non-FREE_ROAM requests and interrupts resolve to no markers", () => {
  assert.deepEqual(
    resolveQuestMarkers({ request: null, hasActiveInterrupt: false, interiorId: null }),
    [],
  );
  assert.deepEqual(
    resolveQuestMarkers({
      request: { kind: "CONTINUE" },
      hasActiveInterrupt: false,
      interiorId: null,
    }),
    [],
  );
  assert.deepEqual(
    resolveQuestMarkers({
      request: freeRoam([{ targetId: "MERCER_PRESS" }]),
      hasActiveInterrupt: true,
      interiorId: null,
    }),
    [],
  );
});

test("manifest-mapped targets resolve with meta anchors; HIDDEN is skipped", () => {
  const markers = resolveQuestMarkers({
    request: freeRoam([
      { targetId: "MERCER_PRESS", marker: "GOLD" },
      { targetId: "TOWN_NOTICE_BOARD", marker: "BLUE" },
      { targetId: "PIKE_PROOF", marker: "HIDDEN" },
    ]),
    hasActiveInterrupt: false,
    interiorId: null,
  });
  assert.deepEqual(
    markers.map((m) => m.targetId),
    ["MERCER_PRESS", "TOWN_NOTICE_BOARD"],
  );
  const mercer = markers[0]!;
  const meta = questMarkerMeta("MERCER_PRESS")!;
  assert.equal(mercer.forcedGold, true); // authored GOLD
  assert.equal(markers[1]!.forcedGold, false);
  assert.deepEqual(mercer.visualAnchor, meta.visualAnchor);
  assert.deepEqual(mercer.arrivalAnchor, meta.arrivalAnchor);
});

test("an unmapped target is skipped entirely (no scene-anchor fallback)", () => {
  const markers = resolveQuestMarkers({
    request: freeRoam([{ targetId: "NOT_A_REAL_TARGET" }]),
    hasActiveInterrupt: false,
    interiorId: null,
  });
  assert.deepEqual(markers, []);
});

test("selection collapses the field to the selected target and forces gold", () => {
  const markers = resolveQuestMarkers({
    request: freeRoam(
      [
        { targetId: "MERCER_PRESS" },
        { targetId: "TOWN_NOTICE_BOARD" },
      ],
      "TOWN_NOTICE_BOARD",
    ),
    hasActiveInterrupt: false,
    interiorId: null,
  });
  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.targetId, "TOWN_NOTICE_BOARD");
  assert.equal(markers[0]!.forcedGold, true);
});

test("timed rider-run legs carry the timed flag", () => {
  const markers = resolveQuestMarkers({
    request: freeRoam([
      { targetId: "RIDER_HANDBILLS" },
      { targetId: "MERCER_PRESS" },
    ]),
    hasActiveInterrupt: false,
    interiorId: null,
  });
  assert.equal(markers.find((m) => m.targetId === "RIDER_HANDBILLS")!.timed, true);
  assert.equal(markers.find((m) => m.targetId === "MERCER_PRESS")!.timed, false);
});

test("dynamic STREET marker: ground anchor while outside", () => {
  const markers = resolveQuestMarkers({
    request: freeRoam([{ targetId: "STREET" }]),
    hasActiveInterrupt: false,
    interiorId: null,
  });
  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.kind, "GROUND");
  assert.deepEqual(markers[0]!.visualAnchor, MARKER_ANCHORS.STREET);
  assert.deepEqual(markers[0]!.arrivalAnchor, MARKER_ANCHORS.STREET);
});

test("dynamic STREET marker: interior exit anchors from the active room", () => {
  const markers = resolveQuestMarkers({
    request: freeRoam([{ targetId: "STREET" }]),
    hasActiveInterrupt: false,
    interiorId: "MERCER_PRESS",
  });
  assert.equal(markers.length, 1);
  const facade = interiorDoorFacade("MERCER_PRESS");
  assert.equal(markers[0]!.kind, INTERIOR_EXIT_KIND);
  assert.deepEqual(markers[0]!.arrivalAnchor, interiorExitSensor("MERCER_PRESS"));
  assert.deepEqual(markers[0]!.visualAnchor, [
    facade[0] + 0.9,
    facade[1],
    facade[2] + 0.18,
  ]);
});

test("isolated explore interiors resolve only the STREET exit marker", () => {
  const markers = resolveQuestMarkers({
    request: freeRoam([
      { targetId: "STREET" },
      { targetId: "MERCER_PRESS", marker: "GOLD" },
      { targetId: "TOWN_NOTICE_BOARD" },
    ]),
    hasActiveInterrupt: false,
    interiorId: "EXPLORE_tavern",
  });
  assert.deepEqual(
    markers.map((m) => m.targetId),
    ["STREET"],
  );
  assert.equal(markers[0]!.kind, INTERIOR_EXIT_KIND);
  assert.deepEqual(
    markers[0]!.arrivalAnchor,
    interiorExitSensor("EXPLORE_tavern"),
  );
});
