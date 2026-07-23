import type { OnboardingPreferences } from "@pa/contracts";

// ---------------------------------------------------------------------------
// Standardized preferences (design1 kill list, product decision): the
// pre-game calibration interview is DELETED. Every new profile goes straight
// from the profile list into the Archive intake with these defaults, marked
// `calibrated: false`; everything stays changeable in the pause settings
// surface, whose first explicit save flips `calibrated: true`.
//
// - readingSpeed STANDARD: the pace the presentation-timeline constants were
//   authored and QA-tuned against (subtitleDurationMs pace = 1.0 baseline;
//   RELAXED/BRISK are 1.3x / 0.82x multipliers off it, and the timeline unit
//   tests pin STANDARD numbers).
// - captions ON, high contrast OFF, archive assist auto-offer ON.
// - inputMethod auto-detected from pointer capability.
// - reducedMotion snapshots the OS `prefers-reduced-motion` query, and — for
//   as long as the profile stays uncalibrated — the app FOLLOWS the live
//   query (effectiveReducedMotion below), so an OS-level change is honored
//   without the player touching a menu.
//
// Existing saves with explicit preferences (no `calibrated` key = chosen
// through the old interview) keep them verbatim.
// ---------------------------------------------------------------------------

export function osPrefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

function pointerIsFine(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: fine)").matches
    );
  } catch {
    return true;
  }
}

export function standardizedPreferences(): OnboardingPreferences {
  return {
    version: 1,
    readingSpeed: "STANDARD",
    captions: true,
    audioDescription: false,
    inputMethod: pointerIsFine() ? "KEYBOARD_MOUSE" : "KEYBOARD_ONLY",
    archiveAssistAutoOffer: true,
    highContrast: false,
    reducedMotion: osPrefersReducedMotion(),
    chaseAssist: "STANDARD",
    primersSeen: [],
    calibrated: false,
    completedAt: new Date().toISOString(),
  };
}

/**
 * The reduced-motion value the presenter should honor right now. An
 * uncalibrated (standardized-defaults) profile follows the live OS media
 * query; a profile whose preferences were explicitly chosen (old interview
 * or the pause settings surface) uses its stored choice.
 */
export function effectiveReducedMotion(
  preferences: OnboardingPreferences | undefined,
  osReduced: boolean,
): boolean {
  if (!preferences) return osReduced;
  if (preferences.calibrated === false) {
    return preferences.reducedMotion || osReduced;
  }
  return preferences.reducedMotion;
}
