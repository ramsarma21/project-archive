import { BOSTON_1765_CHAPTER } from "@pa/chapter-boston";
import type { ChapterWorldDefinition } from "@pa/engine-world";
import {
  documentForReadPanel,
  getDocumentImageUrl,
  type ReadPanelArt,
} from "./world/documentTextures.js";
import {
  createStealthStore,
  stealthPatchFromRuntimeField,
  type StealthSnapshot,
  type StealthStore,
} from "./world/stealthStore.js";
import { QA_RUNTIME_ENABLED } from "./world/qaEnvironment.js";
import { World3D } from "./world/World3D.js";
import type { ChoiceAnimation } from "./world/choiceAnimations.js";

export const BOSTON_1765_WORLD = {
  chapterId: BOSTON_1765_CHAPTER.chapterId,
  World: World3D,
  createStealthStore,
  stealthPatchFromRuntimeField,
  documents: {
    forReadPanel: documentForReadPanel,
    imageUrl: getDocumentImageUrl,
  },
  qa: {
    runtimeEnabled: QA_RUNTIME_ENABLED,
  },
} satisfies ChapterWorldDefinition<
  ChoiceAnimation,
  StealthStore,
  Partial<StealthSnapshot>,
  ReadPanelArt
>;

export { World3D } from "./world/World3D.js";
export {
  choiceAnimationFor,
  type ChoiceAnimation,
} from "./world/choiceAnimations.js";
export {
  documentForReadPanel,
  getDocumentImageUrl,
} from "./world/documentTextures.js";
export {
  createStealthStore,
  stealthPatchFromRuntimeField,
} from "./world/stealthStore.js";
export type { StealthStore } from "./world/stealthStore.js";
export { ambientAudio } from "./world/ambientAudio.js";
export { QA_RUNTIME_ENABLED } from "./world/qaEnvironment.js";
export {
  useFieldEventQaHook,
  useQaChaseHook,
} from "./world/qa/PlayQaHooks.js";
export { RiggedCharacter } from "./world/Character.js";
export {
  DAY1_MICRO_DEFINITIONS,
  INTERIOR_HOTSPOT_MICROS,
  THREAD_FIGURES,
} from "./world/reactiveManifest.js";
export type { MicroDefinition } from "./world/reactiveManifest.js";
export type { InteriorInspectHotspotDef } from "./world/interiorManifest.js";
export { INTERIOR_SOURCES } from "./world/interiorSources.js";
