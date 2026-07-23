import { CONCEPTS, type ConceptId } from "@pa/contracts";

// CP1 (Boston Act 1) checkpoint identity and assessment-content maps.
// SINGLE SOURCE: the chapter definition, the checkpoint flow, the question
// bank, and the validator CLI all read these; no local copies anywhere.

export const CP1_CHECKPOINT_ID = "BOS.ACT01.CP1.v1" as const;

export const CP1_REQUIRED_MACROS = [
  "RCC.DEBT_POLICY_INTRO",
  "RCC.STAMP_INTERNAL_INTRO",
  "RCC.REPRESENTATION_CAUSE",
] as const;

export const CP1_FORM_ID_PREFIX = "BOS.ACT01.CP1.FORM." as const;

// CP1 assessment concept ids (RCC.*) -> Day-1 learner ConceptIds, so the
// memory cue and the penalty curve can read the student's own provenance log.
export const CP1_ASSESSMENT_TO_LEARNER: Readonly<Record<string, ConceptId>> = {
  [CP1_REQUIRED_MACROS[0]]: CONCEPTS.POSTWAR_REVENUE,
  [CP1_REQUIRED_MACROS[1]]: CONCEPTS.STAMP_SCOPE,
  [CP1_REQUIRED_MACROS[2]]: CONCEPTS.REPRESENTATION,
};

// Recall-cue labels for the tracked world sources that flip micros engaged.
// Keys are the stable sourceIds used by the web content manifests
// (m4ContentManifest / reactiveManifest) — the same ids logged into
// MicroEngagementRecord.sourceId. Authored copy; final pass = text slice.
export const CP1_MICRO_SOURCE_LABELS: Readonly<Record<string, string>> = {
  "KN-noticeboard-revenue": "the revenue proclamation on the notice board",
  "KN-noticeboard-stamp": "the stamp schedule on the notice board",
  "KN-liberty-bill": "the Liberty Tree bill nailed by the elm",
  "KN-nonimport": "the merchants' non-importation agreement on the west street",
  "KN-townmeeting": "the town-meeting call posted by the tavern",
  "KN-wharfage": "the wharfage schedule at the docks",
  "KN-sign-printer": "the printer's press-and-ball sign",
  "KN-sign-tavern": "the Bunch of Grapes tavern sign",
  "KN-sign-baker": "the baker's sheaf sign",
  "KN-sign-chandler": "the chandler's anchor sign",
  "KN-watchhouse": "the Watch House sign across from the Custom House",
  "KN-coinpaper": "the box of thin coin and paper promises at Mercer's",
  "KN-typecase": "the type cases in Mercer's shop",
  "KN-effigy": "the placard on the figure hung in the elm",
  "KN-fishflakes": "the half-empty fish flakes on the wharf",
  "KN-cargomark": "the collector's chalk marks on the London crates",
  "KN-ropewalk-front": "the long ropewalk hall off the west street",
  "KN-elm": "the great elm at the crossroads",
  "SJ-ropewalk": "the strand you walked down the ropewalk",
  "SJ-ropewalk-close": "the lay you closed at the ropewalk rig",
  "NPC-abigail": "what Abigail told you at the press",
  "NPC-thomas": "what Thomas said at his counting house",
  "NPC-pike": "what Pike said over his desk",
  "NPC-clarke": "what Clarke warned you at his door",
  "NPC-rider": "what the rider told you at the post",
  "SJ-tavern-note": "the note you carried to the Bunch of Grapes",
  "SJ-dock-haul": "the barrel you hauled on the wharf",
  "THR-ned": "the type you fetched for Ned",
  "THR-sarah": "Goodwife Sarah's stall in the market",
};
