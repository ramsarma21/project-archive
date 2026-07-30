// The module: the authored teaching surface, its player, and the pure gate the
// mission session composes its attempt lifecycle on top of.
//
// The teaching surface is an ARCHIVE of case files (`ModuleArchive`): the player
// presses play on a file, watches it, answers its one question, and the next
// file unlocks. What happens inside a file reuses the shot director unchanged.
//
// There is deliberately no hook and no launch surface here. Owning the session
// means owning the attempt lifecycle, and that belongs to src/mission — this
// directory decides what a module IS and whether one has been completed, and
// stops there.
export * from "./moduleFormat.js";
export * from "./moduleGate.js";
export * from "./moduleOrder.js";
export * from "./moduleContent.js";
export * from "./moduleTimeline.js";
export * from "./moduleShots.js";
export * from "./archiveLayout.js";
export * from "./moduleVoiceover.js";
export * from "./m1Module.js";
export { ModuleArchive } from "./ModuleArchive.js";
export { ModuleFilePlayer, type FilePlayedResult } from "./ModuleFilePlayer.js";
export { ModuleCheckPanel } from "./ModuleCheckPanel.js";
export { SystemPresenter, PRESENTER_MISSING_QA_MESSAGE } from "./SystemPresenter.js";
