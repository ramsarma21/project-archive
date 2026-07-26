// The module: the authored teaching surface, its player, and the pure gate the
// mission session composes its attempt lifecycle on top of.
//
// There is deliberately no hook and no launch surface here. Owning the session
// means owning the attempt lifecycle, and that belongs to src/mission — this
// directory decides what a module IS and whether one has been completed, and
// stops there.
export * from "./moduleFormat.js";
export * from "./moduleGate.js";
export * from "./moduleOrder.js";
export * from "./moduleContent.js";
export * from "./m1Module.js";
export { ModulePlayer } from "./ModulePlayer.js";
