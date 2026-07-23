import { test } from "node:test";
import assert from "node:assert/strict";
import { OnboardingPreferencesSchema } from "@pa/contracts";
import {
  effectiveReducedMotion,
  standardizedPreferences,
} from "../../pages/preferences.js";

// Design1 kill list (product decision): the pre-game calibration interview
// is deleted. These tests pin the replacement contract — standardized
// defaults marked `calibrated: false`, schema compatibility for stored
// preference sets authored by the old interview, and the OS-follow rule for
// reduced motion on uncalibrated profiles.

const LEGACY = {
  version: 1 as const,
  readingSpeed: "RELAXED" as const,
  captions: false,
  audioDescription: true,
  inputMethod: "KEYBOARD_ONLY" as const,
  archiveAssistAutoOffer: false,
  highContrast: true,
  reducedMotion: false,
  completedAt: "2026-07-01T00:00:00.000Z",
};

test("legacy interview-authored preferences parse unchanged (no calibrated key)", () => {
  const parsed = OnboardingPreferencesSchema.parse(LEGACY);
  assert.equal(parsed.calibrated, undefined);
  assert.equal(parsed.readingSpeed, "RELAXED");
  // Absent calibrated = explicitly chosen: the stored value governs even
  // when the OS asks for reduced motion.
  assert.equal(effectiveReducedMotion(parsed, true), false);
});

test("standardized defaults are schema-valid and marked uncalibrated", () => {
  const defaults = standardizedPreferences();
  const parsed = OnboardingPreferencesSchema.parse(defaults);
  assert.equal(parsed.calibrated, false);
  // STANDARD is the pace the presentation-timeline constants were QA-tuned
  // against (pace multiplier 1.0 baseline).
  assert.equal(parsed.readingSpeed, "STANDARD");
  assert.equal(parsed.captions, true);
  assert.equal(parsed.highContrast, false);
  assert.equal(parsed.archiveAssistAutoOffer, true);
  assert.deepEqual(parsed.primersSeen, []);
});

test("uncalibrated profiles follow the OS reduced-motion query; calibrated ones do not", () => {
  const uncalibrated = { ...LEGACY, reducedMotion: false, calibrated: false };
  assert.equal(effectiveReducedMotion(uncalibrated, true), true);
  assert.equal(effectiveReducedMotion(uncalibrated, false), false);
  // A stored ON always wins regardless of the OS.
  assert.equal(
    effectiveReducedMotion({ ...uncalibrated, reducedMotion: true }, false),
    true,
  );
  // First pause-surface save calibrates: stored choice governs.
  const calibrated = { ...LEGACY, reducedMotion: false, calibrated: true };
  assert.equal(effectiveReducedMotion(calibrated, true), false);
  // No stored preferences at all (pre-defaults edge): follow the OS.
  assert.equal(effectiveReducedMotion(undefined, true), true);
});
