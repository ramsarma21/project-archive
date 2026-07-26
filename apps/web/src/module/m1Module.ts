import m1Envelope from "../../../../content/m1/module.json";
import { M1_MISSION_ID } from "../chapter/m1Mission.js";
import { loadAuthoredModule, type LoadedModule } from "./moduleContent.js";
import type { LearningModuleDefinition } from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The module registry.
//
// Decks are authored content, not code. `content/m1/module.json` is M1's six
// cards, transcribed from Mission-Slate §4.7 and then fitted to a measured
// reading rate, and it is imported rather than fetched so a mission never waits
// on the network for its own mandatory gate.
//
// Three things in the authored file deliberately differ from §4.7, and each is
// an improvement over transcribing the document:
//
//   The windows were re-cut. §4.7 sized six windows before the cards had prose
//   in them; written out at 140 wpm the representation card needs about fifty
//   seconds rather than forty. Windows are presentation targets that gate
//   nothing, so fitting them to real reading time is strictly better than
//   inheriting round numbers.
//
//   Concept ids are canonical. §4.2 wrote `BOS.MD01.CONCEPT.*`; the registry in
//   @pa/curriculum settled on chapter-scoped `BOS.CONCEPT.*` — a concept is not
//   owned by the mission that first teaches it — and keeps the old form as a
//   resolving alias, so §4.2's ids still look up correctly.
//
//   There is a ninth Codex card. §4.9's table lists eight, and the author split
//   `LAWFUL_NOT_CONSENTED` out of `CONSENT_GROUND` for C6. That is a second
//   instance of the gap already reported against B3: a card was named as the
//   sole source for a proposition its prose only implied. Two independent
//   coverage checks — the item-by-item read and the authoring pass — each found
//   one, which is the argument for keeping both rather than trusting either.
// ---------------------------------------------------------------------------

/** The load result, kept so a test or a content tool can read the defects. */
export const M1_CONTENT: LoadedModule = loadAuthoredModule(m1Envelope);

if (!M1_CONTENT.ok) {
  // Undeployable, not fatal. The gate reports MODULE_MISSING for a mission with
  // no registered module, so a bad file costs that one mission and says why.
  console.error(
    "[module] content/m1/module.json is not a usable learning module:\n" +
      M1_CONTENT.defects.map((defect) => `  · ${defect}`).join("\n"),
  );
}

export const M1_MODULE: LearningModuleDefinition | undefined = M1_CONTENT.ok
  ? M1_CONTENT.definition
  : undefined;

// A module is found by string equality against the id the level registered
// under, so an authored id that merely looks right — `m1`, or the `.v1` form the
// retired chapter used — resolves to nothing and the gate blocks the mission it
// was written for. Deploy still fails closed, which is correct and also silent,
// so the mismatch reads as "no module authored yet". Two id mismatches reached a
// playtest this way; this one is checked against the registry's own constant.
if (M1_MODULE !== undefined && M1_MODULE.missionId !== M1_MISSION_ID) {
  console.error(
    `[module] content/m1/module.json declares missionId "${M1_MODULE.missionId}" ` +
      `but the level registers as "${M1_MISSION_ID}", so Deploy will report ` +
      `MODULE_MISSING. The authored id has to match the registered one exactly.`,
  );
}

/**
 * Modules by the mission they gate. Thirteen more are authored into this list as
 * their content lands; a mission absent from it has no module, and the gate
 * treats that as blocked rather than as permission — see `deployDecision`.
 */
export const LEARNING_MODULES: readonly LearningModuleDefinition[] = M1_MODULE
  ? [M1_MODULE]
  : [];

export function moduleForMission(
  missionId: string,
): LearningModuleDefinition | undefined {
  return LEARNING_MODULES.find((entry) => entry.missionId === missionId);
}
