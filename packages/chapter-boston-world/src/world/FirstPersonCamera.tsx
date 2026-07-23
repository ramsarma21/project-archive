import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { PlayerApi } from "./Player.js";

// ---------------------------------------------------------------------------
// True head-camera first person (docs/engine/Production.md §2A): during staged first-
// person beats the real player character stays visible playing its authored
// clip, the camera rides its head bone (head hidden so we never see inside
// it, near plane pulled in), and the character's own animated arms are the
// first-person hands. Beats listed in SYNTH_ARM_BEATS keep the legacy
// camera-space arm rig instead — used where the library clip keeps the hands
// out of frame. Street focus-reads (no staged body) are always synthetic and
// never reach headCamBeat.
// ---------------------------------------------------------------------------

// Cue/prompt fragments that read better on the synthetic camera-space arms,
// judged from per-beat screenshots.
// - CATCH_SHEET: the "reach" library clip keeps the hands below the head
//   camera's frame for the whole beat, so the fluttering sheet needs the
//   synthetic rising hands to have anything to settle into.
// - Person-to-person handoffs (Thomas circular, Pike proof, rider bundle,
//   Clarke conceal): the "handoff" clip leans the torso forward over the
//   extended arms, which puts the head camera inside the player's own chest;
//   the synthetic hands + camera-space bundle read cleanly instead, with the
//   receiver framed above the panel.
// - POST_NOTICE (tack the notice): the PLACE cue also stages the handoff
//   clip, so the same forward lean drives the player's shoulder into the
//   bottom of the frame; the synthetic held-notice + nail-tap beat reads
//   cleanly against the board instead.
const SYNTH_ARM_BEATS: string[] = [
  "CATCH_SHEET",
  "THOMAS_CIRCULAR_HANDOFF",
  "PIKE_PROOF_HANDOFF",
  "RIDER_QUICK_HANDOFF",
  "RIDER_GAP_HANDOFF",
  "CONCEAL_HANDBILLS",
  "POST_NOTICE",
  // Compound press work requires the imported ink balls to stay attached to
  // visible first-person hands. The generic work1 head-camera clip keeps its
  // hands behind the eye, so press prompts use the camera-space hand rig.
  "PRESS_PIKE_PROOF",
  "PIKE_REPRINT",
  "FINAL_PRESS_PULL",
];

export function headCamBeat(cueId: string | null, promptId: string): boolean {
  const key = `${cueId ?? ""}|${promptId}`;
  return !SYNTH_ARM_BEATS.some((fragment) => key.includes(fragment));
}

// World-space hand-bone positions, published every frame while the head
// camera is live so the held document can sit in the visible grip.
export interface FirstPersonHands {
  left: THREE.Vector3;
  right: THREE.Vector3;
  updatedAt: number; // performance.now() of the last sample; 0 = never
}

export function createFirstPersonHands(): FirstPersonHands {
  return { left: new THREE.Vector3(), right: new THREE.Vector3(), updatedAt: 0 };
}

const HEAD_NEAR = 0.05;
// Every remaining head-camera beat plays an upright work clip (work1 at the
// press, search over the sort desk); the forward-leaning handoff clips live
// on the synthetic path. The eye sits far enough ahead of the head that the
// clip's raised hands stay BEHIND the camera: with a shorter offset the
// work1 pull raise crossed the near plane and read as giant frame-edge
// claws. Per docs/engine/Production.md §2A the work object carries the visible motion.
const EYE_FORWARD = 0.3;
const EYE_UP = 0.08;

function findBone(root: THREE.Object3D, suffix: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((node) => {
    if (!found && (node as THREE.Bone).isBone && node.name.toLowerCase().endsWith(suffix)) {
      found = node;
    }
  });
  return found;
}

function attachedTo(node: THREE.Object3D, root: THREE.Object3D): boolean {
  let cursor: THREE.Object3D | null = node;
  for (let hops = 0; cursor && hops < 64; hops += 1) {
    if (cursor === root) return true;
    cursor = cursor.parent;
  }
  return false;
}

// The baked clips carry constant scale tracks for every bone, so the mixer
// rewrites head scale each frame and a plain per-frame scale write can lose
// that race. Patching the bone's updateMatrixWorld (which the renderer calls
// after all frame callbacks) collapses the head deterministically.
interface HeadHider {
  bone: THREE.Object3D;
  restore: () => void;
}

function hideHead(bone: THREE.Object3D): HeadHider {
  const original = bone.updateMatrixWorld.bind(bone);
  bone.updateMatrixWorld = function hiddenHeadUpdate(force?: boolean) {
    bone.scale.setScalar(0.0001);
    original(force);
  };
  return {
    bone,
    restore: () => {
      bone.updateMatrixWorld = original;
      bone.scale.setScalar(1);
    },
  };
}

export function FirstPersonCamera(props: {
  active: boolean;
  lookAt: [number, number, number] | null;
  apiRef: { current: PlayerApi | null };
  reducedMotion: boolean;
  hands?: FirstPersonHands;
}) {
  const camera = useThree((state) => state.camera);
  const bound = useRef<{
    root: THREE.Group | null;
    head: THREE.Object3D | null;
    leftHand: THREE.Object3D | null;
    rightHand: THREE.Object3D | null;
  }>({ root: null, head: null, leftHand: null, rightHand: null });
  const hider = useRef<HeadHider | null>(null);
  const savedNear = useRef<number | null>(null);
  const engaged = useRef(false);
  const eye = useRef(new THREE.Vector3());
  const gaze = useRef(new THREE.Vector3());
  const tmpEye = useRef(new THREE.Vector3());
  const tmpLook = useRef(new THREE.Vector3());
  const tmpDir = useRef(new THREE.Vector3());

  // If this unmounts mid-beat, put the head and the near plane back.
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    return () => {
      hider.current?.restore();
      hider.current = null;
      if (savedNear.current !== null) {
        perspective.near = savedNear.current;
        perspective.updateProjectionMatrix();
      }
    };
  }, [camera]);

  // Runs after CameraDirector (priority -1), so the head position wins the
  // frame; the camera-space paper layer then syncs to the final pose.
  useFrame((_, rawDt) => {
    const perspective = camera as THREE.PerspectiveCamera;
    if (!props.active || !props.lookAt) {
      if (hider.current) {
        hider.current.restore();
        hider.current = null;
      }
      if (savedNear.current !== null) {
        perspective.near = savedNear.current;
        perspective.updateProjectionMatrix();
        savedNear.current = null;
      }
      engaged.current = false;
      return;
    }
    const bodyRoot = props.apiRef.current?.bodyRoot ?? null;
    if (!bodyRoot) return;
    const bind = bound.current;
    if (bind.root !== bodyRoot || (bind.head && !attachedTo(bind.head, bodyRoot))) {
      bind.root = bodyRoot;
      bind.head = null;
      bind.leftHand = null;
      bind.rightHand = null;
    }
    if (!bind.head) {
      // Mixamo naming: "mixamorig:Head" / "mixamorig:LeftHand"; suffix match
      // skips HeadTop_End and the finger chains.
      bind.head = findBone(bodyRoot, "head");
      bind.leftHand = findBone(bodyRoot, "lefthand");
      bind.rightHand = findBone(bodyRoot, "righthand");
    }
    const head = bind.head;
    if (!head) return; // rig still streaming in; the authored shot holds the frame
    if (hider.current && hider.current.bone !== head) {
      hider.current.restore();
      hider.current = null;
    }
    if (!hider.current) hider.current = hideHead(head);
    if (savedNear.current === null) {
      savedNear.current = perspective.near;
      perspective.near = HEAD_NEAR;
      perspective.updateProjectionMatrix();
    }

    tmpLook.current.set(props.lookAt[0], props.lookAt[1], props.lookAt[2]);
    if (props.reducedMotion) {
      // Comfort mode: a fixed eye at head height over the staged body, no bob.
      bodyRoot.getWorldPosition(tmpEye.current);
      tmpEye.current.y += 1.45;
    } else {
      head.getWorldPosition(tmpEye.current);
    }
    tmpDir.current.copy(tmpLook.current).sub(tmpEye.current);
    tmpDir.current.y = 0;
    if (tmpDir.current.lengthSq() < 1e-6) tmpDir.current.set(0, 0, 1);
    tmpDir.current.normalize();
    tmpEye.current.addScaledVector(tmpDir.current, EYE_FORWARD);
    if (!props.reducedMotion) tmpEye.current.y += EYE_UP;

    const dt = Math.min(rawDt, 0.05);
    if (!engaged.current || props.reducedMotion) {
      eye.current.copy(tmpEye.current);
      gaze.current.copy(tmpLook.current);
      engaged.current = true;
    } else {
      // Low-pass the head ride: horizontal follows the body promptly,
      // vertical follows slowly so clip bob never pumps the horizon.
      const horizontal = 1 - Math.exp(-9 * dt);
      const vertical = 1 - Math.exp(-3 * dt);
      eye.current.x += (tmpEye.current.x - eye.current.x) * horizontal;
      eye.current.z += (tmpEye.current.z - eye.current.z) * horizontal;
      eye.current.y += (tmpEye.current.y - eye.current.y) * vertical;
      gaze.current.lerp(tmpLook.current, 1 - Math.exp(-10 * dt));
    }
    camera.position.copy(eye.current);
    camera.lookAt(gaze.current);

    const hands = props.hands;
    if (hands && bind.leftHand && bind.rightHand) {
      bind.leftHand.getWorldPosition(hands.left);
      bind.rightHand.getWorldPosition(hands.right);
      hands.updatedAt = performance.now();
    }
  });

  return null;
}
