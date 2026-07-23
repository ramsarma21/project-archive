import test from "node:test";
import assert from "node:assert/strict";
import { MICRO_CONCEPT_IDS } from "@pa/chapter-boston";
import {
  DAY1_MICRO_DEFINITIONS,
  INTERIOR_HOTSPOT_MICROS,
  REACTIVE_NAMED_CAST,
  THREAD_FIGURES,
} from "../reactiveManifest.js";

test("curated day-one registry contains exactly the 14 durable micro ids", () => {
  assert.equal(DAY1_MICRO_DEFINITIONS.length, 14);
  assert.deepEqual(
    new Set(DAY1_MICRO_DEFINITIONS.map((definition) => definition.id)),
    new Set(Object.values(MICRO_CONCEPT_IDS)),
  );
  for (const definition of DAY1_MICRO_DEFINITIONS) {
    assert.ok(definition.sourceLinks.length > 0);
  }
});

test("reactive cast remains the fixed named five", () => {
  assert.deepEqual(
    REACTIVE_NAMED_CAST.map((actor) => actor.id),
    ["abigail", "thomas", "pike", "clarke", "rider"],
  );
});

test("Ned and Sarah are identity-stable lightweight Thread figures", () => {
  assert.equal(THREAD_FIGURES.NED.id, "ned");
  assert.equal(THREAD_FIGURES.SARAH.id, "sarah");
  assert.notEqual(THREAD_FIGURES.NED.glb, "abigail-rigged");
  assert.equal(THREAD_FIGURES.SARAH.glb, "goodwife-rigged");
});

test("only deliberate interior hotspot completions have micro mappings", () => {
  assert.ok(INTERIOR_HOTSPOT_MICROS["mercer-type"]?.includes(MICRO_CONCEPT_IDS.PRINTERS_ROLE));
  assert.ok(INTERIOR_HOTSPOT_MICROS["custom-counter"]?.includes(MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE));
  for (const sourceId of Object.keys(INTERIOR_HOTSPOT_MICROS)) {
    assert.equal(sourceId.startsWith("EAV-"), false, "eavesdrop must never log a micro");
    assert.equal(sourceId.includes("ambient"), false, "ambient content must never log a micro");
  }
});
