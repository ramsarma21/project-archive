import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { STAGE_ANCHORS } from "../choreography.js";
import { CarriedClothBolt, useMechanicVisual } from "../MechanicRigs.js";
import { registerMechanicBodyStaging } from "../mechanicBodyStaging.js";
import { ImportedTexturedProp } from "../Character.js";
import { getDocumentTexture } from "../documentTextures.js";

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

// The handbill carried to the effigy during the pin hold (design1 feature 4):
// the player's own printed sheet, held ahead at chest height while the walk-to
// plays out, hidden once the pin commits (the EffigyRig then shows it pinned).
function CarriedHandbill(props: { reducedMotion: boolean }) {
  const vis = useMechanicVisual();
  const ref = useRef<THREE.Group>(null);
  const texture = useMemo(() => getDocumentTexture("ANTI_STAMP_HANDBILL"), []);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const s = vis.current;
    g.visible = !props.reducedMotion && !s.sawCommit && s.progress < 0.999;
  });
  return (
    <group
      ref={ref}
      position={[0.16, 1.12, 0.32]}
      rotation={[-0.7, 0, 0.06]}
      visible={false}
    >
      <ImportedTexturedProp texture={texture} size={[0.24, 0.1, 0.32]} />
    </group>
  );
}

// Pin your handbill at the effigy (design1 feature 4): a real walk-to — the
// staged body crosses from wherever the player stands to the effigy's open
// northwest side as the hold rises, then reaches up to pin. Reduced motion
// keeps the pose-only equivalent (same commit, no travel animation).
registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("PIN_HANDBILL_EFFIGY"),
  stagesOnAnchor: false,
  executionClip: (_promptId, walking) => ({
    clip: walking ? "walk" : "reach",
  }),
  stage: ({ body, progress, active, reducedMotion, playerX, playerZ, heading }) => {
    if (reducedMotion) {
      body.rotation.x -= 0.12 * progress; // the reach-up, pose only
      return { walking: false };
    }
    if (active || progress > 0) {
      // The effigy hangs at [91.9, -20.3]; pin from its open northwest side.
      const pinSpot: [number, number] = [91.15, -19.55];
      const t = Math.min(1, progress / 0.72);
      const eased = t * t * (3 - 2 * t);
      const dx = (pinSpot[0] - playerX) * eased;
      const dz = (pinSpot[1] - playerZ) * eased;
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      body.position.x += dx * cos - dz * sin;
      body.position.z += dx * sin + dz * cos;
      const walkYaw = Math.atan2(91.9 - playerX, -20.3 - playerZ);
      body.rotation.y = walkYaw - heading;
      if (progress > 0.72) {
        // At the effigy: reach up to pin.
        const reach = (progress - 0.72) / 0.28;
        body.rotation.x -= 0.18 * reach;
        body.position.y += reach * 0.08;
      }
    }
    const walking =
      active && progress > 0.01 && progress < 0.72;
    return { walking };
  },
  carriedProp: (_promptId, reducedMotion) => (
    <CarriedHandbill reducedMotion={reducedMotion} />
  ),
});

// Any other Aug-14 event beat stages on its authored anchor without a
// dedicated displacement curve. MUST register after the specific EVENT_*
// stagings above (first match wins).
registerMechanicBodyStaging({
  match: (promptId) => promptId.includes("EVENT_"),
  stagesOnAnchor: true,
});
