import * as THREE from "three";
import { STAGE_ANCHORS } from "../choreography.js";
import { CarriedClothBolt } from "../MechanicRigs.js";
import { registerMechanicBodyStaging } from "../mechanicBodyStaging.js";

// ---------------------------------------------------------------------------
// Day-1 mechanic body stagings (CONTENT). Exact clips, anchors, and
// displacement curves ported verbatim from Player.tsx — these must stay
// pixel-identical to the audited beats. Registration order matters: specific
// EVENT_* stagings precede the generic EVENT_ catch-all.
//
// World3D imports this module for its registration side effects.
// ---------------------------------------------------------------------------

// Mount the crate perch: rise to its top as the hold progresses, stepping
// slightly toward the faced crowd. This is authored beat displacement (the
// clip itself is root-neutral).
registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("EVENT_CLIMB"),
  stagesOnAnchor: true,
  executionClip: () => ({ clip: "climbUp", loopOnce: true }),
  stage: ({ body, progress }) => {
    body.position.y += progress * 0.68;
    body.position.z += progress * 0.24;
  },
});

// Shove-steps: forward drive with a push cadence and a lean.
registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("EVENT_PUSH"),
  stagesOnAnchor: true,
  stage: ({ body, progress }) => {
    body.position.z += progress * 0.85 + Math.sin(progress * Math.PI * 5) * 0.06;
    body.rotation.x += 0.13 + Math.max(0, Math.sin(progress * Math.PI * 5)) * 0.05;
  },
});

registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("EVENT_CHANT"),
  stagesOnAnchor: true,
  executionClip: () => ({ clip: "cheer1" }),
  stage: ({ body, progress, elapsedTime }) => {
    body.position.y += Math.max(0, Math.sin(elapsedTime * 7)) * 0.06 * progress;
    body.rotation.z += Math.sin(elapsedTime * 3.5) * 0.04 * progress;
  },
});

// Weave through the crossing traffic: a wide crouched arc past the officer's
// line rather than a shoulder lean.
registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("CUSTOMS_SLIP"),
  stagesOnAnchor: true,
  executionClip: () => ({ clip: "crouchWalk" }),
  stage: ({ body, progress }) => {
    body.position.x += Math.sin(progress * Math.PI) * 1.05;
    body.position.z += progress * 0.6;
    body.rotation.z -= 0.09 * progress;
  },
});

// Shuttle run: walk from wherever the player stands to the cloth stack, then
// carry the bolt across to the counter as the hold rises. Completion leaves
// the carrier at the counter for the beat.
registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("THOMAS_HAUL"),
  stagesOnAnchor: false,
  executionClip: (_promptId, walking) => ({
    clip: walking ? "carryWalk" : "carry",
  }),
  stage: ({ body, progress, active, reducedMotion, playerX, playerZ, heading }) => {
    if (reducedMotion) {
      body.rotation.x += 0.08 * progress;
    } else if (active || progress > 0) {
      const haulStack = STAGE_ANCHORS.THOMAS_WORK ?? [-70.55, 0.85, -14.5];
      const haulCounter = STAGE_ANCHORS.THOMAS_COUNTER ?? [-69.55, 1.05, -15.7];
      let fromX: number;
      let fromZ: number;
      let toX: number;
      let toZ: number;
      let t: number;
      if (progress < 0.3) {
        t = progress / 0.3;
        fromX = 0;
        fromZ = 0;
        toX = haulStack[0] - playerX;
        toZ = haulStack[2] - playerZ;
      } else {
        t = (progress - 0.3) / 0.7;
        fromX = haulStack[0] - playerX;
        fromZ = haulStack[2] - playerZ;
        toX = haulCounter[0] - playerX;
        toZ = haulCounter[2] - playerZ;
      }
      const eased = t * t * (3 - 2 * t);
      const dx = THREE.MathUtils.lerp(fromX, toX, eased);
      const dz = THREE.MathUtils.lerp(fromZ, toZ, eased);
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      body.position.x += dx * cos - dz * sin;
      body.position.z += dx * sin + dz * cos;
      const walkYaw = Math.atan2(toX - fromX, toZ - fromZ);
      body.rotation.y = walkYaw - heading;
      body.rotation.x += 0.05;
    }
    const walking =
      !reducedMotion && active && progress > 0.01 && progress < 0.99;
    return { walking };
  },
  carriedProp: (_promptId, reducedMotion) => (
    <CarriedClothBolt reducedMotion={reducedMotion} />
  ),
});

// Any other Aug-14 event beat stages on its authored anchor without a
// dedicated displacement curve. MUST register after the specific EVENT_*
// stagings above (first match wins).
registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("EVENT_"),
  stagesOnAnchor: true,
});
