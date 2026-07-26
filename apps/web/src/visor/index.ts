// ---------------------------------------------------------------------------
// The visor's public surface.
//
// Two exports for the mission container and nothing else. It mounts one component
// in its BRIEFING branch and asks one question about the attempt; it cannot reach a
// plan, a mark or a camera from here.
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
export {
  registerVisorSource,
  visorHoldsBriefing,
  visorSourceFor,
} from "./visorRegistry.js";
export { buildVisorPlan } from "./visorPlan.js";
export type { VisorPlan, VisorSource } from "./visorPlan.js";
