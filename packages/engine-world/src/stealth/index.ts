// Stealth field. Public surface for missions, renderers and HUD.
//
// A mission needs `stepStealthField` once per fixed tick, `throwFieldDiversion`
// on the throw input, and `stealthPresentation` for the HUD. It must also
// multiply its render frame delta by the returned `timeScale` before calling
// advanceFieldClock — that is the entire mechanism of reflex time.
//
// AND IT MUST STEP `stepWatcherPursuit` FIRST, handing the poses that comes back
// to `stepStealthField` rather than the level's authored ones. The field moves
// nobody by design; without that call the whole alert ladder resolves against
// men who cannot take a step, which is a light show. See pursuit.ts.

export * from "./alert.js";
export * from "./crowd.js";
export * from "./diversion.js";
export * from "./field.js";
export * from "./hunt.js";
export * from "./invokedAbility.js";
export * from "./noise.js";
export * from "./pursuit.js";
export * from "./readout.js";
export * from "./reflex.js";
export * from "./suppression.js";
export * from "./tuning.js";
export * from "./vision.js";
