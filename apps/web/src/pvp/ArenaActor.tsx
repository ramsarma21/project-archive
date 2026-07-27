import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { STAND_HEIGHT, chooseAvailableClip } from "@pa/engine-world";
import { GlbGate } from "../duel/GlbGate.js";
import {
  DUEL_CLIP_NAMES,
  DUEL_ONE_SHOT_ROLES,
  authoredSecondsFor,
  duelClipTimeScale,
  type DuelClipRole,
} from "../duel/duelClips.js";
import {
  createVisualStabilizer,
  stabilizeActorVisual,
  type ActorVisualInput,
} from "../duel/actorVisual.js";
import { levelAimArms } from "../duel/aimPose.js";
import { findHandBone, seatWeaponInHand } from "../duel/weaponSocket.js";
import type { ActorPose } from "../duel/duelRuntime.js";

// A PvP fighter: the duel's rig, the duel's clip set, the duel's flintlock, in the
// duel's own hand socket.
//
// WHY THIS IS NOT `DuelActor`, WHICH IT OTHERWISE MIRRORS LINE FOR LINE. That
// component is handed a `DuelRuntime` and reads a `DuelState` out of it every frame.
// PvP has no DuelState and must not manufacture one: the state is a union of eight
// phase shapes carrying items, grants, verdicts and summaries, and a snapshot carries
// none of them. Building a plausible-looking one to satisfy a type would put
// fabricated question and verdict data one property access away from a screen — which
// is precisely the class of thing this mode is careful about.
//
// So the coupling is inverted instead. Everything that decides how a body LOOKS is
// imported from the duel and unchanged: `selectActorVisual` picks the clip role,
// `duelClips` names it and times it, `weaponSocket` seats the pistol. What is written
// here is only the part that has to differ — where the pose comes from — and it comes
// from a getter the stage refreshes once a frame rather than from a reducer.
//
// The rig itself follows the engine's loader for the same reasons DuelActor does:
// same cache-bust token, same skeleton clone, same measured height normalisation,
// same double-sided fix for generated clothing, same `chooseAvailableClip` fallback.

/**
 * Must match `DuelActor`'s token exactly.
 *
 * Not for correctness but for memory: drei caches by URL, so a different token loads
 * a second copy of a rig that is already in the page when a hub mounts both a mission
 * and the duelling ground.
 */
const CHARACTER_URL_TOKEN = "production-cast-10";
const PISTOL_URL = "/world/props/flintlock-pistol.glb";

function characterUrl(glbKey: string): string {
  return `/world/characters/${glbKey}.glb?v=${CHARACTER_URL_TOKEN}`;
}

const ACTION_FADE_S = 0.09;
const LOCOMOTION_FADE_S = 0.22;

/** What the stage tells an actor each frame. Null hides the body outright. */
export interface ArenaActorFrame {
  readonly pose: ActorPose;
  readonly visual: ActorVisualInput;
  /** 1 for a body the server can see; less for one drawn from memory. */
  readonly opacity: number;
}

export interface ArenaActorProps {
  readonly glbKey: string;
  /** Names the socket, so two rigs in one scene are distinguishable in a debugger. */
  readonly label: string;
  readonly read: () => ArenaActorFrame | null;
  readonly weapon?: boolean;
}

function ActorRig(props: ArenaActorProps) {
  const gltf = useGLTF(characterUrl(props.glbKey));
  const pistol = useGLTF(PISTOL_URL);
  const groupRef = useRef<THREE.Group>(null);

  const rig = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    const materials: THREE.Material[] = [];
    root.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = false;
      const mesh = node as THREE.SkinnedMesh;
      if (!(node as THREE.Mesh).isMesh) return;
      mesh.frustumCulled = false;
      // Materials are CLONED, unlike the duel's loader, because two bodies in this
      // scene are the same rig and one of them may be drawn as a stale sighting. A
      // shared material would fade both.
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const copies = source.map((material) => {
        const copy = material.clone();
        // Generated clothing carries thin and inconsistently wound surfaces; the
        // engine's loader makes the same fix for the same reason.
        copy.side = THREE.DoubleSide;
        copy.depthWrite = true;
        copy.needsUpdate = true;
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? copies : copies[0]!;
      materials.push(...copies);
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

    // Scale is MEASURED, never assumed: the cast is mid-normalisation and one rig
    // arrives at roughly real size while another arrives at 1/100 of it.
    const size = measure().getSize(new THREE.Vector3());
    const scale = size.y > 1e-4 ? STAND_HEIGHT / size.y : 1;
    root.scale.setScalar(scale);
    root.position.y -= measure().min.y;
    return { root, materials };
  }, [gltf.scene]);

  const mixer = useMemo(() => new THREE.AnimationMixer(rig.root), [rig]);

  // Same aim levelling as the duel, so PvP shows the forward two-handed aim too.
  const animations = useMemo(() => levelAimArms(gltf.animations), [gltf.animations]);

  const clipNames = useMemo(
    () => animations.map((clip) => clip.name),
    [animations],
  );

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
          ? animations.find((candidate) => candidate.name === name)
          : undefined;
        const action = clip ? mixer.clipAction(clip) : null;
        resolved.set(role, action);
        return action;
      },
    };
  }, [mixer, animations, clipNames, props.glbKey]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.root);
    },
    [mixer, rig],
  );

  // ---- the weapon socket ---------------------------------------------------

  useEffect(() => {
    if (props.weapon === false) return undefined;
    const bone = findHandBone(rig.root);
    if (!bone) {
      console.warn(
        `[pvp] ${props.glbKey} has no resolvable right-hand bone; the flintlock is not attached.`,
      );
      return undefined;
    }
    rig.root.updateMatrixWorld(true);

    const weapon = pistol.scene.clone(true);
    weapon.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = false;
    });

    // Seated by the SAME shared mount the duel uses, so the pistol sits in the palm
    // here exactly as it does in PvE.
    const socket = seatWeaponInHand({
      bone,
      weapon,
      name: `pvp.socket.${props.label}`,
    });
    bone.add(socket);
    return () => {
      bone.remove(socket);
    };
  }, [rig, pistol.scene, props.weapon, props.label, props.glbKey]);

  // ---- one frame -----------------------------------------------------------

  const currentRole = useRef<DuelClipRole | null>(null);
  const currentAction = useRef<THREE.AnimationAction | null>(null);
  const opacity = useRef(1);
  const stabilizer = useRef(createVisualStabilizer());

  useFrame((_, delta) => {
    const group = groupRef.current;
    const frame = props.read();
    if (!group) return;
    if (!frame) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(frame.pose.x, frame.pose.y, frame.pose.z);
    group.rotation.y = frame.pose.yaw;

    if (frame.opacity !== opacity.current) {
      opacity.current = frame.opacity;
      const transparent = frame.opacity < 1;
      for (const material of rig.materials) {
        material.transparent = transparent;
        material.opacity = frame.opacity;
        material.depthWrite = !transparent;
      }
    }

    // Debounced + speed-smoothed: the opponent's speed is a discrete per-snapshot
    // velocity, so selecting the clip from it raw made the body twitch between
    // aim/aimWalk/aimRun. The drawn position and yaw are still the feed's interpolated
    // transform (set above); only the animation state is stabilized here.
    const visual = stabilizeActorVisual(stabilizer.current, frame.visual, delta);
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
      }
      currentRole.current = visual.role;
    }

    const action = currentAction.current;
    if (action) {
      action.timeScale = duelClipTimeScale({
        role: visual.role,
        authoredSeconds: authoredSecondsFor(visual.role, action.getClip().duration),
        speedMps: visual.speedMps,
        backpedalling: visual.backpedalling,
      });
    }
    mixer.update(delta);
  });

  return (
    <group ref={groupRef}>
      <primitive object={rig.root} />
    </group>
  );
}

export function ArenaActor(props: ArenaActorProps) {
  return (
    <GlbGate
      label={`pvp fighter ${props.label} (${props.glbKey})`}
      onRetry={() => useGLTF.clear(characterUrl(props.glbKey))}
    >
      <ActorRig {...props} />
    </GlbGate>
  );
}

useGLTF.preload(PISTOL_URL);
