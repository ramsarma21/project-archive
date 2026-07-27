// ---------------------------------------------------------------------------
// The visor's public surface.
//
// A component for the container's BRIEFING branch, a component for its canvas
// during the run, and one question about the attempt. It cannot reach a plan, a
// cone or a camera from here.
//
// Registering M1's source at import time is deliberate. `@pa/mission-m1` is already
// in this route's bundle — `chapter/m1Mission.ts` imports it at module scope to
// register the mission at all — so the visor knowing about it costs nothing, and the
// alternative (a registration call the container or the chapter has to remember to
// make) is a briefing that silently stops existing after a refactor.
// ---------------------------------------------------------------------------

import { M1_MISSION_ID } from "../chapter/m1Mission.js";
import { m1VisorSource } from "./m1VisorSource.js";
import { registerVisorSource } from "./visorRegistry.js";

registerVisorSource(M1_MISSION_ID, m1VisorSource);

export { VisorHold } from "./VisorHold.js";
export type { VisorPhase } from "./VisorHold.js";
// The one mark that outlives the hold. Mounted inside the mission's own canvas
// rather than the visor's, because by then the visor's canvas is gone and the
// thing being annotated is a live run.
export { VisorRunMark } from "./VisorRunMark.js";
export type { RunMarkRead } from "./VisorRunMark.js";
// The catch line: the visor's other survivor, and the one that teaches rather
// than points. Same reason it is mounted in the mission's canvas, and the same
// contract — handed a reader and no way to write.
export { VisorHolds } from "./VisorHolds.js";
export type { HoldMark, HoldsRead, OfferRead } from "./VisorHolds.js";
// The throw's aim, while a throw is being aimed. Procedural, like the marks
// above: it draws where the object would land and says why it would not, and
// the thrown object itself stays undrawn until it has an imported GLB.
export { VisorThrowAim } from "./VisorThrowAim.js";
export type { ThrowAimRead } from "./VisorThrowAim.js";
export {
  registerVisorSource,
  visorHoldsBriefing,
  visorSourceFor,
} from "./visorRegistry.js";
export { buildVisorPlan } from "./visorPlan.js";
export type { VisorPlan, VisorSource } from "./visorPlan.js";
