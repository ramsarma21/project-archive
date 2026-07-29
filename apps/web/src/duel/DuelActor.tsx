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
import { createVisualStabilizer, stabilizeActorVisual } from "./actorVisual.js";
import { levelAimArms } from "./aimPose.js";
import {
  PALM_DROP_M,
  SOCKET_OFFSET_M,
  TRIM_EULER_DEG,
  findHandBone,
  seatWeaponInHand,
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
// SCALE IS MEASURED, NEVER ASSUMED. Every rig is normalised by
// `height / measuredHeight`, and the weapon socket then divides by whatever world
// scale the hand bone actually ended up with, so no constant in this file assumes a
// character arrives in metres.
//
// That defensiveness is kept even though the cast is now uniformly human-scaled,
// because it is also what HID the officer's defect for nine days: he shipped at
// 1/100 scale, 1.9cm tall, and this normalisation silently multiplied him by 92 so
// the duel looked correct on screen while the file was wrong. Measuring is still
// right — a loader should not trust an asset — but it cannot be the only check.
// scripts/check-world-scale.mjs is what refuses the bad file at publish time.

const CHARACTER_URL_TOKEN = "production-cast-10";
const PISTOL_URL = "/world/props/flintlock-pistol.glb";

function characterUrl(glbKey: string): string {
  return `/world/characters/${glbKey}.glb?v=${CHARACTER_URL_TOKEN}`;
}

/** Longest crossfade that still lets a one-shot verb read as instant. */
const ACTION_FADE_S = 0.09;
const LOCOMOTION_FADE_S = 0.22;

// A visual-only "took a hit" recoil, layered on top of the core-driven transform to
// make the flinch read harder — the strengthening the owner asked for.
//
// PURELY PRESENTATION, AND DECOUPLED FROM STUN BY CONSTRUCTION. It offsets the DRAWN
// body a few centimetres away from the shooter and leans it for a sixth of a second,
// then returns; it is never written back to the core, so the authoritative position,
// the capsule hitbox and the fight's timing are all untouched. The owner's caution
// was that a longer flinch can mean a longer stun — here it cannot, because the core
// has NO hit-stun tied to the flinch at all: the flinch clip's length
// (`HIT_FLINCH_SECONDS`) is a presentation constant `selectActorVisual` reads to pick
// a clip, and the reducer never sees it. So a harder-reading reaction changes how the
// hit LOOKS and nothing about how the fight PLAYS.
const FLINCH_JOLT_SECONDS = 0.16;
/** Peak backward offset of the drawn body, metres. */
const FLINCH_JOLT_M = 0.14;
/** Peak downward dip, metres — the body rocks as well as recoils. */
const FLINCH_DIP_M = 0.05;
/** Peak backward lean, radians. */
const FLINCH_LEAN_RAD = 0.16;

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
    // The epsilon only guards a genuinely degenerate mesh; it is deliberately far
    // below any plausible rig so that a mis-scaled one still normalises to a
    // visible body rather than vanishing. Correct SCALE is enforced upstream by
    // scripts/check-world-scale.mjs, not here.
    const scale = size.y > 1e-4 ? props.height / size.y : 1;
    root.scale.setScalar(scale);
    root.position.y -= measure().min.y;
    return { root, skeletons, measuredHeight: size.y };
  }, [gltf.scene, props.height]);

  const mixer = useMemo(() => new THREE.AnimationMixer(rig.root), [rig]);

  // The aim-locomotion and fire clips get their arms levelled to the forward
  // two-handed standoff aim; every other clip is returned untouched.
  const animations = useMemo(() => levelAimArms(gltf.animations), [gltf.animations]);

  const clipNames = useMemo(
    () => animations.map((clip) => clip.name),
    [animations],
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
          ? animations.find((candidate) => candidate.name === name)
          : undefined;
        const action = clip ? mixer.clipAction(clip) : null;
        resolved.set(role, action);
        return action;
      },
    };
  }, [mixer, animations, clipNames, props.glbKey]);

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

    const weapon = pistol.scene.clone(true);
    weapon.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = false;
    });

    // The socket is assembled by the shared mount, so PvE and PvP seat the pistol
    // identically. It puts the asset's measured GRIP POINT in the palm — not the
    // model origin, which sits near the barrel and left the gun floating.
    const socket = seatWeaponInHand({
      bone,
      weapon,
      grip: props.grip,
      name: `duel.socket.${props.side}`,
    });
    bone.add(socket);
    return () => {
      bone.remove(socket);
    };
  }, [rig, pistol.scene, props.weapon, props.side, props.glbKey, props.grip]);

  // ---- one frame -----------------------------------------------------------

  const currentRole = useRef<DuelClipRole | null>(null);
  const currentAction = useRef<THREE.AnimationAction | null>(null);
  const timeScale = useRef(1);
  const stabilizer = useRef(createVisualStabilizer());
  const flinch = useRef<{ tick: number; t: number; dirX: number; dirZ: number } | null>(null);

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

    // Visual-only hit recoil (see FLINCH_* above). Fires once per new authoritative
    // hit on this side and decays; primed on the first frame so a mid-fight remount
    // never jolts on a stale cue, and never written back to the core.
    if (flinch.current === null) {
      flinch.current = { tick: cues.lastHitTick, t: 0, dirX: 0, dirZ: 0 };
    } else if (cues.lastHitTick > flinch.current.tick) {
      const other = state.combat.fighters[props.side === "A" ? "B" : "A"];
      const dx = fighter.motion.pos.x - other.motion.pos.x;
      const dz = fighter.motion.pos.z - other.motion.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      flinch.current = {
        tick: cues.lastHitTick,
        t: FLINCH_JOLT_SECONDS,
        dirX: dx / len,
        dirZ: dz / len,
      };
    }
    if (group && flinch.current.t > 0) {
      flinch.current.t = Math.max(0, flinch.current.t - delta);
      const ease = (flinch.current.t / FLINCH_JOLT_SECONDS) ** 2;
      group.position.x += flinch.current.dirX * FLINCH_JOLT_M * ease;
      group.position.z += flinch.current.dirZ * FLINCH_JOLT_M * ease;
      group.position.y = pose.y - FLINCH_DIP_M * ease;
      group.rotation.x = FLINCH_LEAN_RAD * ease;
    } else if (group) {
      group.rotation.x = 0;
    }

    // Debounced + speed-smoothed so the boss (and the player) do not flicker between
    // aim/aimWalk/aimRun as the interpolated speed grazes a threshold. Position and yaw
    // above are untouched — they are still the core's own interpolated transform.
    const visual = stabilizeActorVisual(
      stabilizer.current,
      {
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
      },
      delta,
    );

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
