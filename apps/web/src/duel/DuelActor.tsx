import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { STAND_HEIGHT, chooseAvailableClip } from "@pa/engine-world";
import { FIELD_TICK_HZ, isDodging, type DuelSide } from "@pa/duel";
import { GlbGate } from "./GlbGate.js";
import {
  DUEL_CLIP_NAMES,
  DUEL_ONE_SHOT_ROLES,
  authoredSecondsFor,
  duelClipTimeScale,
  type DuelClipRole,
} from "./duelClips.js";
import { selectActorVisual } from "./actorVisual.js";
import {
  PALM_DROP_M,
  SOCKET_OFFSET_M,
  TRIM_EULER_DEG,
  findHandBone,
  gripQuaternion,
  socketInverseScale,
} from "./weaponSocket.js";
import { lerpPose, type DuelRuntime } from "./duelRuntime.js";
import { FACE_OFF_TICKS } from "@pa/duel";

// A fighter: an imported rig, the duel clip set, and a flintlock in its right hand.
//
// WHY THIS IS NOT `RiggedCharacter`. The engine's loader does everything here except
// the one thing the duel needs — it renders `<primitive object={rig.root} />` and
// never exposes the skeleton, so there is no way to reach a bone from outside it. A
// held weapon needs exactly that. Everything else follows the engine's loader
// closely on purpose: same URL and cache-bust token, same skeleton clone, same
// height normalisation, same double-sided material fix, same `chooseAvailableClip`
// fallback. When the engine grows a socket, this file collapses into a call to it.
//
// SCALE IS MEASURED, NEVER ASSUMED. The cast is mid-normalisation: the player rig
// arrives at roughly real size and the officer arrives at 1/100 scale, 1.89cm tall.
// Both are normalised by `height / measuredHeight`, and the weapon socket then
// divides by whatever world scale the hand bone actually ended up with. No constant
// anywhere in this file assumes a character arrives in metres.

const CHARACTER_URL_TOKEN = "production-cast-8";
const PISTOL_URL = "/world/props/flintlock-pistol.glb";

function characterUrl(glbKey: string): string {
  return `/world/characters/${glbKey}.glb?v=${CHARACTER_URL_TOKEN}`;
}

/** Longest crossfade that still lets a one-shot verb read as instant. */
const ACTION_FADE_S = 0.09;
const LOCOMOTION_FADE_S = 0.22;

export interface GripTuning {
  readonly offset: readonly [number, number, number];
  readonly trimEulerDeg: readonly [number, number, number];
  readonly palmDrop: number;
}

export const DEFAULT_GRIP: GripTuning = {
  offset: SOCKET_OFFSET_M,
  trimEulerDeg: TRIM_EULER_DEG,
  palmDrop: PALM_DROP_M,
};

const auditedRigs = new Set<string>();

/** One console line per rig listing duel clips it does not carry. */
function auditDuelClips(glbKey: string, available: readonly string[]): void {
  if (auditedRigs.has(glbKey)) return;
  auditedRigs.add(glbKey);
  const missing = Object.values(DUEL_CLIP_NAMES).filter(
    (name) => !available.includes(name),
  );
  if (missing.length > 0) {
    console.warn(
      `[duel] ${glbKey} carries no ${missing.join(", ")}; those roles fall back.`,
    );
  }
}

function ActorRig(props: {
  runtime: DuelRuntime;
  side: DuelSide;
  glbKey: string;
  height: number;
  grip: GripTuning;
  weapon: boolean;
}) {
  const gltf = useGLTF(characterUrl(props.glbKey));
  const pistol = useGLTF(PISTOL_URL);
  const groupRef = useRef<THREE.Group>(null);

  const rig = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    const skeletons = new Set<THREE.Skeleton>();
    root.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = false;
      const mesh = node as THREE.SkinnedMesh;
      if (!(node as THREE.Mesh).isMesh) return;
      if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        // Generated clothing carries thin and inconsistently wound surfaces; the
        // engine's loader makes the same fix for the same reason.
        material.side = THREE.DoubleSide;
        material.depthWrite = true;
        material.needsUpdate = true;
      }
    });

    const measure = (): THREE.Box3 => {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const scratch = new THREE.Box3();
      let any = false;
      root.traverse((node) => {
        const skinned = node as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) {
          skinned.computeBoundingBox();
          if (!skinned.boundingBox) return;
          scratch.copy(skinned.boundingBox).applyMatrix4(skinned.matrixWorld);
        } else if ((node as THREE.Mesh).isMesh) {
          scratch.setFromObject(node);
        } else return;
        any ? box.union(scratch) : box.copy(scratch);
        any = true;
      });
      return box;
    };

    const size = measure().getSize(new THREE.Vector3());
    // The cast is not yet normalised to real units: one rig measures 1.7m and
    // another 1.9cm. Both are legal input, so the epsilon only guards a genuinely
    // degenerate mesh.
    const scale = size.y > 1e-4 ? props.height / size.y : 1;
    root.scale.setScalar(scale);
    root.position.y -= measure().min.y;
    return { root, skeletons, measuredHeight: size.y };
  }, [gltf.scene, props.height]);

  const mixer = useMemo(() => new THREE.AnimationMixer(rig.root), [rig]);

  const clipNames = useMemo(
    () => gltf.animations.map((clip) => clip.name),
    [gltf.animations],
  );

  useEffect(() => {
    auditDuelClips(props.glbKey, clipNames);
  }, [props.glbKey, clipNames]);

  /** Role to action, resolved on demand through the engine's fallback. */
  const actions = useMemo(() => {
    const resolved = new Map<DuelClipRole, THREE.AnimationAction | null>();
    return {
      get(role: DuelClipRole): THREE.AnimationAction | null {
        if (resolved.has(role)) return resolved.get(role) ?? null;
        const name = chooseAvailableClip(
          props.glbKey,
          DUEL_CLIP_NAMES[role],
          clipNames,
        );
        const clip = name
          ? gltf.animations.find((candidate) => candidate.name === name)
          : undefined;
        const action = clip ? mixer.clipAction(clip) : null;
        resolved.set(role, action);
        return action;
      },
    };
  }, [mixer, gltf.animations, clipNames, props.glbKey]);

  useEffect(() => () => {
    mixer.stopAllAction();
    mixer.uncacheRoot(rig.root);
  }, [mixer, rig]);

  // ---- the weapon socket ---------------------------------------------------

  useEffect(() => {
    if (!props.weapon) return undefined;
    const bone = findHandBone(rig.root);
    if (!bone) {
      console.warn(
        `[duel] ${props.glbKey} has no resolvable right-hand bone; the flintlock is not attached.`,
      );
      return undefined;
    }
    rig.root.updateMatrixWorld(true);
    const boneScale = bone.getWorldScale(new THREE.Vector3()).x;

    const socket = new THREE.Group();
    socket.name = `duel.socket.${props.side}`;
    // Undo the bone's inherited scale so everything below is in metres, whatever
    // units the rig happens to be authored in this week.
    socket.scale.setScalar(socketInverseScale(boneScale));

    const hold = new THREE.Group();
    hold.name = "duel.socket.hold";
    hold.position.set(props.grip.offset[0], props.grip.offset[1], props.grip.offset[2]);
    hold.quaternion.copy(gripQuaternion(props.grip.trimEulerDeg));

    const weapon = pistol.scene.clone(true);
    weapon.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = false;
    });
    // In the weapon's own frame: slide it up its grip so the palm closes around the
    // middle of the grip rather than its top.
    weapon.position.set(0, props.grip.palmDrop, 0);

    hold.add(weapon);
    socket.add(hold);
    bone.add(socket);
    return () => {
      bone.remove(socket);
    };
  }, [rig, pistol.scene, props.weapon, props.side, props.glbKey, props.grip]);

  // ---- one frame -----------------------------------------------------------

  const currentRole = useRef<DuelClipRole | null>(null);
  const currentAction = useRef<THREE.AnimationAction | null>(null);
  const timeScale = useRef(1);

  useFrame((_, delta) => {
    const runtime = props.runtime;
    const state = runtime.getState();
    const poses = runtime.getPoses();
    const fighter = state.combat.fighters[props.side];
    const pose = lerpPose(poses.prev[props.side], poses.next[props.side], poses.alpha);

    const group = groupRef.current;
    if (group) {
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.y = pose.yaw;
    }

    const cues = runtime.getCues()[props.side];
    const visual = selectActorVisual({
      phase: state.phase,
      faceOffElapsedS:
        state.phase === "FACE_OFF"
          ? (FACE_OFF_TICKS - (state.endsAtTick - state.clock.tick)) / FIELD_TICK_HZ
          : 0,
      tick: state.combat.tick,
      downed: fighter.health <= 0,
      crouched: pose.crouched,
      speedMps: pose.speedMps,
      travelOffFacing: pose.travelOffFacing,
      dashing: isDodging(fighter),
      lastFireTick: cues.lastFireTick,
      lastHitTick: cues.lastHitTick,
    });

    if (visual.role !== currentRole.current) {
      const action = actions.get(visual.role);
      if (action) {
        const previous = currentAction.current;
        const loopOnce = DUEL_ONE_SHOT_ROLES.has(visual.role);
        action.reset();
        action.enabled = true;
        action.setLoop(
          loopOnce ? THREE.LoopOnce : THREE.LoopRepeat,
          loopOnce ? 1 : Infinity,
        );
        action.clampWhenFinished = loopOnce;
        action.play();
        if (previous && previous !== action) {
          action.crossFadeFrom(
            previous,
            loopOnce ? ACTION_FADE_S : LOCOMOTION_FADE_S,
            true,
          );
        }
        currentAction.current = action;
        currentRole.current = visual.role;
      } else {
        currentRole.current = visual.role;
      }
    }

    const action = currentAction.current;
    if (action) {
      const authored = authoredSecondsFor(visual.role, action.getClip().duration);
      timeScale.current = duelClipTimeScale({
        role: visual.role,
        authoredSeconds: authored,
        speedMps: visual.speedMps,
        backpedalling: visual.backpedalling,
      });
      action.timeScale = timeScale.current;
    }
    mixer.update(delta);
  });

  return (
    <group ref={groupRef}>
      <primitive object={rig.root} />
    </group>
  );
}

export function DuelActor(props: {
  runtime: DuelRuntime;
  side: DuelSide;
  glbKey: string;
  /** Visible height. Defaults to the collision capsule, so silhouette == hitbox. */
  height?: number;
  grip?: Partial<GripTuning>;
  weapon?: boolean;
}) {
  const grip = useMemo<GripTuning>(() => ({ ...DEFAULT_GRIP, ...props.grip }), [props.grip]);
  return (
    <GlbGate
      label={`fighter ${props.side} (${props.glbKey})`}
      onRetry={() => useGLTF.clear(characterUrl(props.glbKey))}
    >
      <ActorRig
        runtime={props.runtime}
        side={props.side}
        glbKey={props.glbKey}
        height={props.height ?? STAND_HEIGHT}
        grip={grip}
        weapon={props.weapon ?? true}
      />
    </GlbGate>
  );
}

useGLTF.preload(PISTOL_URL);
