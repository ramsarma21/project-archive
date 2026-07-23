import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ActorChoreography } from "@pa/contracts";
import { ContactShadow, RiggedCharacter } from "./Character.js";
import { STAGE_ANCHORS } from "./choreography.js";
import { applyProceduralMotion } from "./ActorDirector.js";
import { clipForMotion, PLAYER_ACTION_CLIPS } from "./animationManifest.js";
import { mechanicStageOffset } from "./MechanicRigs.js";
import { mechanicBodyStagingFor } from "./mechanicBodyStaging.js";
import {
  type CollisionWorld,
  supportBelow,
  sweepXZ,
  depenetrateXZ,
  positionClear,
  CAPSULE_RADIUS,
} from "./collision.js";
import type { GameplayWorldService } from "./gameplayWorld.js";
import {
  cameraTransition,
  movementYawForPolicy,
  type CameraOwner,
  type CameraOwnershipState,
  type MovementYawPolicy,
} from "./cameraOwnership.js";
import {
  type MotionState,
  type MotionPhase,
  type AuthoredAnchor,
  createGroundedState,
  stepMotion,
  beginStandingJump,
  beginRunningJump,
  beginAuthored,
  cancelAction,
  toggleFreeCrouch,
  simulateBallistic,
  WALK_SPEED,
  RUN_SPEED,
  RUNNING_JUMP_VY,
  AIRBORNE_PHASES,
  AUTHORED_PHASES,
} from "./playerMotion.js";
import {
  resolveFreeJump,
  FREE_ACTION_COOLDOWN_MS,
  FREE_INPUT_BUFFER_MS,
  FREE_JUMP_COYOTE_MS,
  freeMoveSpeed,
  freeLocomotionClip,
} from "./playerInput.js";
import {
  acceptTraversalStamina,
  createStamina,
  stepStamina,
  type StaminaAssist,
  type StaminaState,
} from "./stamina.js";
import {
  isLegacyDensityBarrierCollider,
  isLegacyPropCollider,
  isLegacyTraversalCollider,
} from "./outdoorCollisionAdapter.js";
import { usePlayerQaHooks } from "./qa/playerQaHooks.js";

// Authored affordance the traversal layer asks the player to execute. The
// player is the sole owner of the transform, so the director submits a request
// and the physics/motion layer runs it (or rejects it on a failed preflight).
export interface AuthoredRequest {
  kind: "VAULT" | "CLIMB_UP" | "CLIMB_DOWN" | "DUCK_UNDER";
  affordanceId?: string;
  anchors: AuthoredAnchor[];
  durationMs: number;
  ignore?: string[];
  arcHeight?: number;
}

export interface PlayerMotionStatus {
  phase: MotionPhase;
  grounded: boolean;
  airtimeMs: number;
  speed: number;
  velX: number;
  velZ: number;
  facingX: number;
  facingZ: number;
  actionActive: boolean;
  sprinting: boolean;
  crouched: boolean;
  stamina: number;
  resourceActive: boolean;
  movementIntent: boolean;
  blocked: boolean;
  actionSerial: number;
  inputLocked: boolean;
  clip: string;
}

export interface PlayerApi {
  position: THREE.Vector3;
  // Current body yaw (radians), updated every frame. Read by the traversal
  // layer for its facing checks.
  facingY: number;
  teleport: (pos: [number, number, number], faceY?: number) => void;
  // One-shot pose driver for beats/mechanics (seat, flavor, staging): places
  // the body like teleport but WITHOUT the camera snap. Never called per-frame
  // by the traversal layer any more — authored traversal runs through the
  // motion action requests below so the player owns its transform.
  setPose: (pos: [number, number, number], faceY?: number) => void;
  // Live scene-graph root of the visible body (the group wrapping the skinned
  // rig). Lets the first-person head camera find the head/hand bones without
  // reaching into React internals. Null until the rig mounts.
  bodyRoot: THREE.Group | null;
  // ---- read-only motion status (consumed by TraversalDirector) ----
  readonly motion: PlayerMotionStatus;
  // ---- action requests: return true if accepted after preflight ----
  requestStandingJump: () => boolean;
  requestRunningJump: () => boolean;
  requestCrouchToggle: () => boolean;
  requestAuthored: (req: AuthoredRequest) => boolean;
  cancelMotionAction: () => void;
  setInputLocked: (locked: boolean) => void;
  setInteractionClip: (clip: string | null) => void;
  canReachInteraction: (
    pos: [number, number, number],
    obstacleId?: string,
  ) => boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof HTMLElement
      ? target
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  return Boolean(
    element &&
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLButtonElement ||
        element.isContentEditable),
  );
}

function rayRectEntry(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  maxDistance: number,
): number | null {
  let near = 0;
  let far = maxDistance;
  for (const [origin, direction, min, max] of [
    [ox, dx, minX, maxX],
    [oz, dz, minZ, maxZ],
  ] as const) {
    if (Math.abs(direction) < 1e-6) {
      if (origin < min || origin > max) return null;
      continue;
    }
    let entry = (min - origin) / direction;
    let exit = (max - origin) / direction;
    if (entry > exit) [entry, exit] = [exit, entry];
    near = Math.max(near, entry);
    far = Math.min(far, exit);
    if (near > far) return null;
  }
  return near;
}

export function Player(props: {
  apiRef: { current: PlayerApi | null };
  colliders: [number, number, number, number][];
  gameplayWorld: GameplayWorldService;
  interiorCamera: {
    maxBoom: number;
    minY: number;
    maxY: number;
    inset: number;
  } | null;
  disabled: boolean;
  keyboardOnly: boolean;
  reducedMotion: boolean;
  cameraOwner: CameraOwner;
  cameraControlledExternally: boolean;
  inputLocked: boolean;
  externalMovementYaw: MovementYawPolicy;
  chaseActive: boolean;
  timedDash: boolean;
  staminaAssist: StaminaAssist;
  stealthStore: import("./stealthStore.js").StealthStore;
  actorCue: ActorChoreography | null;
  mechanicPromptId: string | null;
  hidden: boolean;
  // Head-camera first person: the body stays visible and eases onto the
  // staged anchor so the first-person framing is deterministic wherever the
  // walk-up ended (FirstPersonCamera rides the head bone).
  headCam: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const groundShadow = useRef<THREE.Group>(null);
  const keys = useRef<Record<string, boolean>>({});
  const heading = useRef(Math.PI / 2);
  const camYaw = useRef(Math.PI / 2);
  const [locomotion, setLocomotion] = useState<"idle" | "walk" | "run">("idle");
  const locomotionRef = useRef<"idle" | "walk" | "run">("idle");
  const [actionClip, setActionClip] = useState<string | null>(null);
  const actionClipRef = useRef<string | null>(null);
  const [interactionClip, setInteractionClip] = useState<string | null>(null);
  const interactionClipRef = useRef<string | null>(null);
  const animRateRef = useRef(1);
  const camera = useThree((s) => s.camera);
  const mechanicProgress = useRef(0);
  const mechanicActive = useRef(false);
  const mechanicStage = useRef<string | null>(null);
  const mechanicCommitted = useRef(false);
  const [mechanicArmed, setMechanicArmed] = useState(false);
  const [haulWalking, setHaulWalking] = useState(false);
  const haulWalkingRef = useRef(false);
  const stageBlend = useRef(0);

  const snapCam = useRef(true);
  const cameraDistance = useRef(5.2);

  // The player's authoritative motion state. Position/yaw/velocity/collision
  // all live here; api.position mirrors motion.pos for the rest of the scene.
  const motionRef = useRef<MotionState>(createGroundedState({ x: -6, y: 0, z: 1.5 }, Math.PI / 2));
  const safeHistoryRef = useRef<Array<{ x: number; y: number; z: number }>>([
    { x: -6, y: 0, z: 1.5 },
  ]);
  const staminaRef = useRef<StaminaState>(createStamina());
  const staminaModeWasActive = useRef(false);
  const actionSerialRef = useRef(0);
  const staminaContextRef = useRef({
    resourceActive: props.chaseActive || props.timedDash,
    assist: props.staminaAssist,
  });
  staminaContextRef.current = {
    resourceActive: props.chaseActive || props.timedDash,
    assist: props.staminaAssist,
  };
  const externalInputLocked = useRef(false);
  const spacePressedAt = useRef<number | null>(null);
  const spaceReleasedSinceJump = useRef(true);
  const jumpCooldownUntil = useRef(0);
  const crouchPressedAt = useRef<number | null>(null);
  const controlEnabledRef = useRef(false);
  controlEnabledRef.current =
    !props.disabled && !props.inputLocked && !props.actorCue && !externalInputLocked.current;
  // Latest collision world, kept in a ref so action requests fired from the
  // traversal director's event handlers can run their preflight.
  const collisionWorld = props.gameplayWorld.collision;
  const worldRef = useRef<CollisionWorld>(collisionWorld);
  worldRef.current = collisionWorld;

  const api = useMemo<PlayerApi>(() => {
    const status: PlayerMotionStatus = {
      phase: "GROUNDED",
      grounded: true,
      airtimeMs: 0,
      speed: 0,
      velX: 0,
      velZ: 0,
      facingX: 0,
      facingZ: 1,
      actionActive: false,
      sprinting: false,
      crouched: false,
      stamina: 1,
      resourceActive: false,
      movementIntent: false,
      blocked: false,
      actionSerial: 0,
      inputLocked: false,
      clip: "idle",
    };
    return {
      position: new THREE.Vector3(-6, 0, 1.5),
      facingY: Math.PI / 2,
      bodyRoot: null,
      motion: status,
      teleport(pos, faceY) {
        this.position.set(pos[0], pos[1], pos[2]);
        if (faceY !== undefined) {
          heading.current = faceY;
          camYaw.current = faceY;
        }
        motionRef.current = createGroundedState({ x: pos[0], y: pos[1], z: pos[2] }, heading.current);
        safeHistoryRef.current = [{ x: pos[0], y: pos[1], z: pos[2] }];
        if (group.current) {
          group.current.position.copy(this.position);
          group.current.rotation.y = heading.current;
        }
        snapCam.current = true;
      },
      setPose(pos, faceY) {
        this.position.set(pos[0], pos[1], pos[2]);
        // Body-only turn: the camera yaw (movement frame) stays put so the
        // follow camera never whips during a staged beat.
        if (faceY !== undefined) heading.current = faceY;
        motionRef.current = createGroundedState({ x: pos[0], y: pos[1], z: pos[2] }, heading.current);
        safeHistoryRef.current = [{ x: pos[0], y: pos[1], z: pos[2] }];
        if (group.current) {
          group.current.position.copy(this.position);
          group.current.rotation.y = heading.current;
        }
      },
      requestStandingJump() {
        const m = motionRef.current;
        const coyote =
          m.phase === "FALLING" && m.airtimeMs <= FREE_JUMP_COYOTE_MS;
        if (
          (!m.grounded && !coyote) ||
          AUTHORED_PHASES.has(m.phase) ||
          m.phase === "STANDING_JUMP" ||
          m.phase === "RUNNING_JUMP" ||
          m.phase === "CROUCH"
        ) return false;
        motionRef.current = beginStandingJump(m);
        return true;
      },
      requestRunningJump() {
        const m = motionRef.current;
        const coyote =
          m.phase === "FALLING" && m.airtimeMs <= FREE_JUMP_COYOTE_MS;
        if (
          (!m.grounded && !coyote) ||
          AUTHORED_PHASES.has(m.phase) ||
          m.phase === "STANDING_JUMP" ||
          m.phase === "RUNNING_JUMP" ||
          m.phase === "CROUCH"
        ) return false;
        // Preflight the arc: reject if it cannot resolve a solvable landing.
        const pred = simulateBallistic(
          worldRef.current,
          m.pos,
          { x: m.vel.x, y: RUNNING_JUMP_VY, z: m.vel.z },
          undefined,
        );
        if (!pred.valid) return false;
        motionRef.current = beginRunningJump(m);
        return true;
      },
      requestCrouchToggle() {
        const result = toggleFreeCrouch(worldRef.current, motionRef.current);
        motionRef.current = result.state;
        return result.changed;
      },
      requestAuthored(req) {
        const m = motionRef.current;
        if (AIRBORNE_PHASES.has(m.phase) || AUTHORED_PHASES.has(m.phase)) return false;
        const target = req.affordanceId
          ? worldRef.current.blockers.find((blocker) =>
              blocker.tags.has(`affordance:${req.affordanceId}`),
            )
          : undefined;
        let ignore = req.ignore;
        if (req.kind === "VAULT") {
          // A vault must bind to one finite, low tagged obstacle. Validate its
          // height/depth before granting target-only collision ignore.
          if (!target || !Number.isFinite(target.topY)) return false;
          const first = req.anchors[0];
          const last = req.anchors[req.anchors.length - 1];
          if (!first || !last) return false;
          const alongX = Math.abs(last.x - first.x) >= Math.abs(last.z - first.z);
          const depth = alongX
            ? target.maxX - target.minX
            : target.maxZ - target.minZ;
          if (target.topY < 0.45 || target.topY > 1.15 || depth > 1.2 + 1e-3) {
            return false;
          }
          ignore = [target.id];
        } else if (
          (req.kind === "CLIMB_UP" || req.kind === "CLIMB_DOWN") &&
          target
        ) {
          ignore = [target.id];
        }
        const staminaAction = acceptTraversalStamina(staminaRef.current, {
          resourceActive: staminaContextRef.current.resourceActive,
          debitEligible:
            req.kind === "VAULT" ||
            req.kind === "CLIMB_UP" ||
            req.kind === "CLIMB_DOWN",
          assist: staminaContextRef.current.assist,
        });
        const next = beginAuthored(worldRef.current, m, {
          kind: req.kind,
          anchors: req.anchors,
          durationMs: req.durationMs * staminaAction.durationMultiplier,
          ignore,
          arcHeight: req.arcHeight,
        });
        if (!next) return false;
        motionRef.current = next;
        staminaRef.current = staminaAction.state;
        actionSerialRef.current += 1;
        return true;
      },
      cancelMotionAction() {
        const m = motionRef.current;
        if (AUTHORED_PHASES.has(m.phase) || AIRBORNE_PHASES.has(m.phase)) {
          motionRef.current = cancelAction(worldRef.current, m).state;
        }
      },
      setInputLocked(locked) {
        externalInputLocked.current = locked;
        if (locked) {
          spacePressedAt.current = null;
          crouchPressedAt.current = null;
          keys.current = {};
        }
      },
      setInteractionClip(clip) {
        interactionClipRef.current = clip;
        setInteractionClip(clip);
      },
      canReachInteraction(pos, obstacleId) {
        const state = motionRef.current;
        const ignore = obstacleId ? new Set([obstacleId]) : undefined;
        let from = { ...state.pos };
        const steps = Math.max(
          1,
          Math.ceil(Math.hypot(pos[0] - from.x, pos[2] - from.z) / 0.1),
        );
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          const to = {
            x: state.pos.x + (pos[0] - state.pos.x) * t,
            z: state.pos.z + (pos[2] - state.pos.z) * t,
          };
          const swept = sweepXZ(
            worldRef.current,
            from,
            to,
            CAPSULE_RADIUS,
            state.capsuleHeight,
            ignore,
          );
          if (swept.blockedX || swept.blockedZ) return false;
          from = { x: swept.x, y: state.pos.y, z: swept.z };
        }
        return true;
      },
    };
  }, []);
  // Publish only from commit/frame time: assigning during render leaked a
  // pre-commit api instance whenever Suspense discarded the pass, so spawn
  // teleports landed on a throwaway object while the mounted player stayed
  // at the initial position.
  useEffect(() => {
    props.apiRef.current = api;
  });
  usePlayerQaHooks({
    api,
    motionRef,
    worldRef,
    safeHistoryRef,
    staminaRef,
    colliders: props.colliders,
  });

  const drag = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
  const camPitch = useRef(0);
  // Interior framing preset (feel-audit-1 P0-8): entering any interior snaps
  // the boom to a pitched-down establishing frame before control is handed
  // over. Without it the follow camera spawned at scalp height (base height
  // 1.7 on a 1.58m rig, pitch carried over from the street, boom collapsed
  // against the door wall directly behind the landing) and the room was
  // unreadable until the player manually dragged pitch.
  const interiorCameraActivePrev = useRef(Boolean(props.interiorCamera));
  useEffect(() => {
    const active = Boolean(props.interiorCamera);
    if (active && !interiorCameraActivePrev.current) {
      camPitch.current = Math.max(camPitch.current, 0.3);
      snapCam.current = true;
    } else if (!active && interiorCameraActivePrev.current) {
      // Back on the street: restore a neutral follow pitch.
      camPitch.current = Math.min(camPitch.current, 0.08);
      snapCam.current = true;
    }
    interiorCameraActivePrev.current = active;
  }, [props.interiorCamera]);
  const previousCameraOwnership = useRef<CameraOwnershipState>({
    owner: props.cameraOwner,
    cameraControlledExternally: props.cameraControlledExternally,
    inputLocked: props.inputLocked,
    externalMovementYaw: props.externalMovementYaw,
  });

  useEffect(() => {
    const next: CameraOwnershipState = {
      owner: props.cameraOwner,
      cameraControlledExternally: props.cameraControlledExternally,
      inputLocked: props.inputLocked,
      externalMovementYaw: props.externalMovementYaw,
    };
    const transition = cameraTransition(previousCameraOwnership.current, next);
    if (transition.cancelPointerDrag) drag.current.active = false;
    if (transition.resetFollowCamera) snapCam.current = true;
    previousCameraOwnership.current = next;
  }, [
    props.cameraOwner,
    props.cameraControlledExternally,
    props.inputLocked,
    props.externalMovementYaw,
  ]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      keys.current[e.code] = true;
      if (controlEnabledRef.current && !e.repeat) {
        if (e.code === "Space" && spaceReleasedSinceJump.current) {
          spacePressedAt.current = performance.now();
        } else if (e.code === "KeyC") {
          crouchPressedAt.current = performance.now();
        }
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
      if (e.code === "Space") spaceReleasedSinceJump.current = true;
    };
    // Drag anywhere on the canvas to orbit the camera (GTA-style look-around).
    const pdown = (e: PointerEvent) => {
      if (props.keyboardOnly || props.cameraControlledExternally) return;
      const el = e.target as HTMLElement;
      if (el.tagName !== "CANVAS") return;
      drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    };
    const pmove = (e: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = e.clientX - drag.current.lastX;
      const dy = e.clientY - drag.current.lastY;
      drag.current.lastX = e.clientX;
      drag.current.lastY = e.clientY;
      camYaw.current -= dx * 0.006;
      camPitch.current = THREE.MathUtils.clamp(camPitch.current + dy * 0.004, -0.32, 0.5);
    };
    const pup = () => {
      drag.current.active = false;
    };
    const resetInput = () => {
      keys.current = {};
      spacePressedAt.current = null;
      crouchPressedAt.current = null;
      spaceReleasedSinceJump.current = true;
      drag.current.active = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", pdown);
    window.addEventListener("pointermove", pmove);
    window.addEventListener("pointerup", pup);
    window.addEventListener("pointercancel", pup);
    window.addEventListener("blur", resetInput);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", pdown);
      window.removeEventListener("pointermove", pmove);
      window.removeEventListener("pointerup", pup);
      window.removeEventListener("pointercancel", pup);
      window.removeEventListener("blur", resetInput);
    };
  }, [props.keyboardOnly, props.cameraControlledExternally]);

  useEffect(() => {
    const onVisual = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind?: string;
        stage?: string;
        progress?: number;
        active?: boolean;
        phase?: string;
      }>).detail;
      mechanicStage.current = detail?.stage ?? null;
      const stageProgress = detail?.progress ?? 0;
      mechanicProgress.current =
        detail?.kind === "HAUL_JOB"
          ? detail.stage === "LOAD"
            ? stageProgress * 0.3
            : detail.stage === "BALANCE"
              ? 0.3 + stageProgress * 0.35
              : detail.stage === "THREAD"
                ? 0.65 + stageProgress * 0.35
                : 0
          : stageProgress;
      mechanicActive.current = Boolean(detail?.active);
      if (detail?.active) setMechanicArmed(true);
      if (detail?.phase === "COMMIT" || detail?.phase === "COMPLETE") {
        mechanicCommitted.current = true;
      }
    };
    window.addEventListener("pa:mechanic-visual", onVisual);
    return () => window.removeEventListener("pa:mechanic-visual", onVisual);
  }, []);

  // Each new mechanic starts from the generic pose again.
  useEffect(() => {
    setMechanicArmed(false);
    setHaulWalking(false);
    haulWalkingRef.current = false;
    mechanicCommitted.current = false;
    mechanicProgress.current = 0;
    mechanicActive.current = false;
    mechanicStage.current = null;
    stageBlend.current = 0;
  }, [props.mechanicPromptId]);

  const lookTarget = useRef(new THREE.Vector3());
  useEffect(() => {
    if (!props.disabled) return;
    keys.current = {};
    spacePressedAt.current = null;
    crouchPressedAt.current = null;
    const m = motionRef.current;
    motionRef.current = createGroundedState(m.pos, heading.current);
  }, [props.disabled]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    api.bodyRoot = body.current;
    const resourceActive = props.chaseActive || props.timedDash;
    if (resourceActive && !staminaModeWasActive.current) {
      staminaRef.current = createStamina();
    }
    staminaModeWasActive.current = resourceActive;

    let m = motionRef.current;
    if (
      !positionClear(
        collisionWorld,
        m.pos,
        CAPSULE_RADIUS,
        m.capsuleHeight,
      )
    ) {
      const local = depenetrateXZ(
        collisionWorld,
        m.pos,
        CAPSULE_RADIUS,
        m.capsuleHeight,
      );
      const rollback = [...safeHistoryRef.current]
        .reverse()
        .find((candidate) =>
          positionClear(
            collisionWorld,
            candidate,
            CAPSULE_RADIUS,
            m.capsuleHeight,
          ),
        );
      const safe = local ?? rollback;
      if (safe) {
        m = createGroundedState(safe, m.yaw);
        motionRef.current = m;
        api.position.set(safe.x, safe.y, safe.z);
      }
    }
    // Beats / mechanics / authored cameras own the body via setPose+staging.
    const freeControl =
      !props.disabled &&
      !props.inputLocked &&
      !props.actorCue &&
      !externalInputLocked.current;

    const k = keys.current;
    let fwd = 0;
    let strafe = 0;
    let actionActive = AIRBORNE_PHASES.has(m.phase) || AUTHORED_PHASES.has(m.phase);
    if (freeControl && !actionActive) {
      if (k.KeyW || k.ArrowUp) fwd += 1;
      if (k.KeyS || k.ArrowDown) fwd -= 1;
      if (k.KeyA || k.ArrowLeft) strafe += 1;
      if (k.KeyD || k.ArrowRight) strafe -= 1;
    }
    const shiftHeld = Boolean(k.ShiftLeft || k.ShiftRight);
    const moving = fwd !== 0 || strafe !== 0;
    let crouched = m.phase === "CROUCH" || m.phase === "DUCK_UNDER";
    let sprintingThisFrame = false;

    if (freeControl) {
      const now = performance.now();
      if (crouchPressedAt.current !== null) {
        if (
          now - crouchPressedAt.current <= FREE_INPUT_BUFFER_MS &&
          !actionActive
        ) {
          api.requestCrouchToggle();
          m = motionRef.current;
        }
        crouchPressedAt.current = null;
      }

      const jumpDecision = resolveFreeJump({
        nowMs: now,
        pressedAtMs: spacePressedAt.current,
        releasedSinceAction: spaceReleasedSinceJump.current,
        cooldownUntilMs: jumpCooldownUntil.current,
        enabled: true,
        uiFocused: isEditableTarget(document.activeElement),
        actionActive:
          AUTHORED_PHASES.has(m.phase) ||
          m.phase === "STANDING_JUMP" ||
          m.phase === "RUNNING_JUMP",
        grounded: m.grounded,
        falling: m.phase === "FALLING",
        airtimeMs: m.airtimeMs,
        shiftHeld,
        forwardInput: fwd > 0,
        crouched: m.phase === "CROUCH",
        speed: Math.hypot(m.vel.x, m.vel.z),
        velX: m.vel.x,
        velZ: m.vel.z,
        facingX: Math.sin(m.yaw),
        facingZ: Math.cos(m.yaw),
      });
      if (jumpDecision !== "NONE") {
        const accepted =
          jumpDecision === "RUNNING_JUMP"
            ? api.requestRunningJump()
            : api.requestStandingJump();
        spacePressedAt.current = null;
        if (accepted) {
          // A very quick tap may have released before this render frame.
          spaceReleasedSinceJump.current = !keys.current.Space;
          jumpCooldownUntil.current = now + FREE_ACTION_COOLDOWN_MS;
          m = motionRef.current;
        }
      } else if (
        spacePressedAt.current !== null &&
        now - spacePressedAt.current > FREE_INPUT_BUFFER_MS
      ) {
        spacePressedAt.current = null;
      }

      actionActive = AIRBORNE_PHASES.has(m.phase) || AUTHORED_PHASES.has(m.phase);
      crouched = m.phase === "CROUCH" || m.phase === "DUCK_UNDER";
      sprintingThisFrame =
        shiftHeld &&
        moving &&
        !crouched &&
        !actionActive &&
        (!resourceActive ||
          props.staminaAssist === "AUTO_STAMINA" ||
          staminaRef.current.value > 0);

      // Camera-relative target velocity; the motion layer applies accel/decel,
      // sweeps collisions and owns vertical physics.
      let targetVelX = 0;
      let targetVelZ = 0;
      if (moving && !actionActive) {
        const speed = freeMoveSpeed({
          shiftHeld,
          moving,
          crouched,
          actionActive,
          resourceActive,
          stamina: staminaRef.current.value,
          staminaAssist: props.staminaAssist,
        });
        const movementYaw =
          movementYawForPolicy(props.externalMovementYaw, camYaw.current) ??
          camYaw.current;
        let vx = Math.sin(movementYaw) * fwd + Math.sin(movementYaw + Math.PI / 2) * strafe;
        let vz = Math.cos(movementYaw) * fwd + Math.cos(movementYaw + Math.PI / 2) * strafe;
        const len = Math.hypot(vx, vz) || 1;
        vx = (vx / len) * speed;
        vz = (vz / len) * speed;
        targetVelX = vx;
        targetVelZ = vz;
      }
      const beforeStepX = m.pos.x;
      const beforeStepZ = m.pos.z;
      const intendedSpeed = Math.hypot(targetVelX, targetVelZ);
      const result = stepMotion(collisionWorld, m, {
        dt,
        targetVelX,
        targetVelZ,
        reducedMotion: props.reducedMotion,
      });
      m = result.state;
      motionRef.current = m;
      const movedThisStep = Math.hypot(
        m.pos.x - beforeStepX,
        m.pos.z - beforeStepZ,
      );
      const movementBlocked =
        intendedSpeed > 0.1 &&
        movedThisStep < Math.min(0.008, intendedSpeed * dt * 0.1);
      staminaRef.current = stepStamina(staminaRef.current, {
        dt,
        resourceActive,
        sprinting: sprintingThisFrame,
        moving,
        actionActive,
        assist: props.staminaAssist,
      });
      if (
        positionClear(
          collisionWorld,
          m.pos,
          CAPSULE_RADIUS,
          m.capsuleHeight,
        )
      ) {
        const history = safeHistoryRef.current;
        const previous = history[history.length - 1];
        if (
          !previous ||
          Math.hypot(m.pos.x - previous.x, m.pos.z - previous.z) >= 0.2
        ) {
          history.push({ ...m.pos });
          if (history.length > 48) history.shift();
        }
      }
      heading.current = m.yaw;
      api.position.set(m.pos.x, m.pos.y, m.pos.z);
      const status = api.motion as PlayerMotionStatus;
      status.movementIntent = moving;
      status.blocked = movementBlocked;
    } else {
      // Staged: keep the motion snapshot grounded at the posed position.
      const status = api.motion as PlayerMotionStatus;
      status.movementIntent = false;
      status.blocked = false;
      if (m.phase !== "GROUNDED") {
        m = createGroundedState({ x: api.position.x, y: api.position.y, z: api.position.z }, heading.current);
        motionRef.current = m;
      } else {
        m.pos.x = api.position.x;
        m.pos.y = api.position.y;
        m.pos.z = api.position.z;
      }
    }

    // ---- locomotion + action clip state (state-boundary changes only) ------
    const speed = Math.hypot(m.vel.x, m.vel.z);
    const nextLocomotion = freeLocomotionClip({
      speed,
      shiftHeld,
      moving,
      crouched,
      actionActive,
    });
    if (nextLocomotion !== locomotionRef.current) {
      locomotionRef.current = nextLocomotion;
      setLocomotion(nextLocomotion);
    }
    animRateRef.current =
      nextLocomotion === "walk"
        ? THREE.MathUtils.clamp(speed / WALK_SPEED, 0.65, 1.45)
        : nextLocomotion === "run"
          ? THREE.MathUtils.clamp(speed / RUN_SPEED, 0.75, 1.25)
          : 1;
    if (m.phase === "STANDING_JUMP") {
      // The supplied 2.40s performance includes anticipation/recovery; fit it
      // to the ~0.96s ballistic flight (2*vY/g) so its landing beat meets
      // physics touchdown (2.40 / 0.963 ≈ 2.48).
      animRateRef.current = 2.48;
    } else if (m.phase === "RUNNING_JUMP") {
      animRateRef.current = 0.97;
    } else if (m.action) {
      const sourceDuration =
        m.phase === "VAULT"
          ? 3.57
          : m.phase === "CLIMB_UP"
            ? 3
            : m.phase === "CLIMB_DOWN"
              ? 2.03
              : m.action.durationMs / 1000;
      animRateRef.current = sourceDuration / (m.action.durationMs / 1000);
    }

    const phaseClip = clipForPhase(m.phase, nextLocomotion);
    if (phaseClip !== actionClipRef.current) {
      actionClipRef.current = phaseClip;
      setActionClip(phaseClip);
    }

    // ---- publish read-only motion status ----------------------------------
    const status = api.motion as PlayerMotionStatus;
    status.phase = m.phase;
    status.grounded = m.grounded;
    status.airtimeMs = m.airtimeMs;
    status.speed = speed;
    status.velX = m.vel.x;
    status.velZ = m.vel.z;
    status.facingX = Math.sin(m.yaw);
    status.facingZ = Math.cos(m.yaw);
    status.actionActive = AIRBORNE_PHASES.has(m.phase) || AUTHORED_PHASES.has(m.phase);
    status.sprinting = sprintingThisFrame;
    status.crouched = m.phase === "CROUCH" || m.phase === "DUCK_UNDER";
    status.stamina = staminaRef.current.value;
    status.resourceActive = resourceActive;
    status.actionSerial = actionSerialRef.current;
    status.inputLocked = !freeControl;
    status.clip = interactionClipRef.current ?? phaseClip ?? nextLocomotion;
    props.stealthStore.patch({
      stamina: staminaRef.current.value,
      chaseActive: props.chaseActive,
      timedDash: props.timedDash,
    });

    if (props.actorCue) {
      if (props.actorCue.faceAnchorId) {
        const face = STAGE_ANCHORS[props.actorCue.faceAnchorId];
        if (face) {
          // Aim from where the body is STAGED (see the mechanic stage offset
          // below), not from where the walk-up ended, so staged executions
          // (climb, push, chant, slip) face and drive the right direction.
          const promptId = props.mechanicPromptId ?? "";
          const staged =
            (Boolean(mechanicBodyStagingFor(promptId)?.stagesOnAnchor) ||
              props.headCam) &&
            STAGE_ANCHORS[props.actorCue.anchorId];
          const [offX, offZ] = mechanicStageOffset(promptId);
          const fromX = staged ? staged[0] + offX : api.position.x;
          const fromZ = staged ? staged[2] + offZ : api.position.z;
          heading.current = Math.atan2(face[0] - fromX, face[2] - fromZ);
        }
      }
      const stagedLocomotion = props.actorCue.motion === "WALK" ? "walk" : "idle";
      if (locomotionRef.current !== stagedLocomotion) {
        locomotionRef.current = stagedLocomotion;
        setLocomotion(stagedLocomotion);
      }
      animRateRef.current = stagedLocomotion === "walk" ? 0.85 : 1;
    }
    if (interactionClipRef.current) {
      // Door/knock clips are baked at authored duration (v6). Staging owns
      // translation, so never inherit locomotion or actor-cue playback rates.
      animRateRef.current = 1;
    }

    if (body.current) {
      applyProceduralMotion(
        body.current,
        props.actorCue?.motion ?? "IDLE",
        props.reducedMotion ? 0 : clock.elapsedTime,
      );
      body.current.rotation.y = 0;
      const promptId = props.mechanicPromptId ?? "";
      const progress = mechanicProgress.current;
      const staging = mechanicBodyStagingFor(promptId);
      // Third-person executions are staged for the authored anchor: the
      // event shots frame CROWD_PLAYER and the checkpoint shot frames
      // CUSTOMS_PLAYER. Ease the visible body onto the anchor so the action
      // happens where those cameras look, wherever the walk-up ended.
      // Head-camera first-person beats stage the same way so the eye camera
      // and the work object line up deterministically.
      if (staging?.stagesOnAnchor || props.headCam) {
        const anchor = props.actorCue ? STAGE_ANCHORS[props.actorCue.anchorId] : undefined;
        if (anchor) {
          stageBlend.current = props.reducedMotion
            ? 1
            : Math.min(1, stageBlend.current + dt * 1.4);
          const s = stageBlend.current;
          const eased = s * s * (3 - 2 * s);
          const [offX, offZ] = mechanicStageOffset(promptId);
          const wx = (anchor[0] + offX - api.position.x) * eased;
          const wz = (anchor[2] + offZ - api.position.z) * eased;
          const cos = Math.cos(heading.current);
          const sin = Math.sin(heading.current);
          body.current.position.x += wx * cos - wz * sin;
          body.current.position.z += wx * sin + wz * cos;
        }
      }
      // Authored per-mechanic displacement curve (registered content; the
      // Day-1 set lives in content/day1MechanicStaging.tsx).
      const stageResult = staging?.stage?.({
        body: body.current,
        promptId,
        progress,
        active: mechanicActive.current,
        elapsedTime: clock.elapsedTime,
        reducedMotion: props.reducedMotion,
        playerX: api.position.x,
        playerZ: api.position.z,
        heading: heading.current,
      });
      if (stageResult && stageResult.walking !== undefined) {
        if (stageResult.walking !== haulWalkingRef.current) {
          haulWalkingRef.current = stageResult.walking;
          setHaulWalking(stageResult.walking);
        }
      }
      if (!props.headCam && !mechanicActive.current && progress === 0) {
        body.current.position.x = 0;
        body.current.position.z = 0;
      }
    }

    if (group.current) {
      group.current.position.copy(api.position);
      group.current.rotation.y = heading.current;
    }
    if (groundShadow.current) {
      const support = supportBelow(
        collisionWorld,
        api.position.x,
        api.position.z,
        api.position.y,
      );
      groundShadow.current.position.set(
        api.position.x,
        support?.y ?? 0,
        api.position.z,
      );
    }
    api.facingY = heading.current;
    if (props.cameraControlledExternally) return;

    // Movement is camera-relative, so camera yaw must not chase the character's
    // heading: doing so changes the input frame while backward/strafe is held.
    // Shorten the boom at the first wall crossed, then ease its length to avoid
    // popping as the player moves past collider corners.
    const interiorActive =
      props.gameplayWorld.activeSpace.kind === "INTERIOR" &&
      Boolean(props.interiorCamera);
    const maxDist = props.interiorCamera?.maxBoom ?? 5.2;
    let desiredDist = maxDist;
    if (interiorActive) {
      // Keep the boom INSIDE the room by construction: limit it to the ray
      // exit against the room bounds (minus the inset) instead of letting the
      // position clamp slam an escaped camera back onto the player's head
      // through the door gap (feel-audit-1 P0-8).
      const bounds = collisionWorld.bounds;
      const inset = props.interiorCamera!.inset;
      const dirX = -Math.sin(camYaw.current);
      const dirZ = -Math.cos(camYaw.current);
      let exit = maxDist;
      if (Math.abs(dirX) > 1e-6) {
        const tx =
          ((dirX > 0 ? bounds.maxX - inset : bounds.minX + inset) - api.position.x) / dirX;
        if (tx > 0) exit = Math.min(exit, tx);
      }
      if (Math.abs(dirZ) > 1e-6) {
        const tz =
          ((dirZ > 0 ? bounds.maxZ - inset : bounds.minZ + inset) - api.position.z) / dirZ;
        if (tz > 0) exit = Math.min(exit, tz);
      }
      desiredDist = Math.max(0.8, exit);
    }
    // On the ground plane only: the boom-shortening ray uses the ground-plan
    // colliders, which no longer describe walls once the player is elevated on
    // a roof/platform or airborne (skip the ray so the crane/warehouse
    // footprints do not force a face close-up).
    if (m.grounded && api.position.y <= 0.45) {
      const dx = -Math.sin(camYaw.current);
      const dz = -Math.cos(camYaw.current);
      const margin = 0.4;
      const cameraRects: [number, number, number, number][] = interiorActive
        ? collisionWorld.blockers
            .filter((blocker) => blocker.baseY < 2.8 && blocker.topY > 0.7)
            .map((blocker) => [
              (blocker.minX + blocker.maxX) / 2,
              (blocker.minZ + blocker.maxZ) / 2,
              (blocker.maxX - blocker.minX) / 2,
              (blocker.maxZ - blocker.minZ) / 2,
            ])
        : props.colliders.filter(
            (collider) =>
              !isLegacyPropCollider(collider) &&
              !isLegacyDensityBarrierCollider(collider) &&
              !isLegacyTraversalCollider(collider),
          );
      for (const [bx, bz, hx, hz] of cameraRects) {
        const hit = rayRectEntry(
          api.position.x,
          api.position.z,
          dx,
          dz,
          bx - hx - margin,
          bx + hx + margin,
          bz - hz - margin,
          bz + hz + margin,
          maxDist,
        );
        if (hit !== null) desiredDist = Math.min(desiredDist, Math.max(0.8, hit - 0.2));
      }
    }
    if (snapCam.current) {
      cameraDistance.current = desiredDist;
    } else if (props.reducedMotion) {
      cameraDistance.current = desiredDist;
    } else {
      const boomRate = desiredDist < cameraDistance.current ? 18 : 5;
      cameraDistance.current = THREE.MathUtils.lerp(
        cameraDistance.current,
        desiredDist,
        1 - Math.exp(-boomRate * dt),
      );
    }
    const dist = cameraDistance.current;
    const height = (interiorActive ? 1.7 : 2.0 + 0.5 * (dist / maxDist)) + camPitch.current * dist;
    const camPos = new THREE.Vector3(
      api.position.x - Math.sin(camYaw.current) * dist,
      api.position.y + height,
      api.position.z - Math.cos(camYaw.current) * dist,
    );
    // Never let orbit pitch or follow smoothing place the near plane below the
    // walkable surface. Exterior terrain and every current room floor are y=0.
    const cameraFloor = api.position.y + (interiorActive ? props.interiorCamera!.minY : 0.75);
    camPos.y = Math.max(camPos.y, cameraFloor);
    if (interiorActive) {
      const inset = props.interiorCamera!.inset;
      camPos.x = THREE.MathUtils.clamp(
        camPos.x,
        collisionWorld.bounds.minX + inset,
        collisionWorld.bounds.maxX - inset,
      );
      camPos.z = THREE.MathUtils.clamp(
        camPos.z,
        collisionWorld.bounds.minZ + inset,
        collisionWorld.bounds.maxZ - inset,
      );
      camPos.y = Math.min(camPos.y, props.interiorCamera!.maxY);
    }
    if (snapCam.current || props.reducedMotion) {
      // Hard-place the camera on spawn/teleport so it never eases in from a
      // stale position (which read as "first person" on load).
      camera.position.copy(camPos);
      lookTarget.current.copy(api.position).add(new THREE.Vector3(0, 1.35, 0));
      snapCam.current = false;
    } else {
      // Critically-damped style follow: position eases harder than the look
      // point, giving the slight camera lag that reads as weight.
      camera.position.lerp(camPos, 1 - Math.exp(-6 * dt));
      const lookGoal = api.position
        .clone()
        .add(new THREE.Vector3(0, 1.35, 0))
        .add(new THREE.Vector3(m.vel.x, 0, m.vel.z).multiplyScalar(0.12));
      lookTarget.current.lerp(lookGoal, 1 - Math.exp(-10 * dt));
    }
    camera.position.y = Math.max(camera.position.y, cameraFloor);
    camera.lookAt(lookTarget.current);
  });

  // Execution clips per mechanic (Interaction-Spec §6): once the player has
  // engaged the hold at least once, the rig plays the authored action clip
  // instead of the generic pose. Purely presentational; clip choice comes
  // from the registered mechanic staging.
  const renderStaging = mechanicBodyStagingFor(props.mechanicPromptId);
  const mechanicClip = mechanicArmed
    ? renderStaging?.executionClip?.(props.mechanicPromptId ?? "", haulWalking) ?? null
    : null;
  // Traversal/free-jump action clips (jump/runJump/vault/climb/duck) outrank
  // the free-walk locomotion set while a motion action runs; beats and
  // mechanics still win over everything.
  const clip =
    mechanicClip?.clip ??
    interactionClip ??
    (props.actorCue
      ? clipForMotion("playerboy-rigged", props.actorCue.motion)
      : actionClip ?? locomotion);
  const actionLoopOnce = ACTION_LOOP_ONCE.has(actionClip ?? "");
  const interactionLoopOnce = PLAYER_ACTION_CLIPS.has(interactionClip ?? "");
  return (
    <>
      <group ref={groundShadow} visible={!props.hidden}>
        <ContactShadow radius={0.55} />
      </group>
      <group ref={group} visible={!props.hidden}>
        <group ref={body}>
          <RiggedCharacter
            glbKey="playerboy-rigged"
            height={1.58}
            clip={clip}
            timeScaleRef={animRateRef}
            loopOnce={
              mechanicClip?.loopOnce ??
              (interactionClip
                ? interactionLoopOnce
                : props.actorCue
                ? props.actorCue.motion === "CATCH" || props.actorCue.motion === "HANDOFF"
                : actionLoopOnce)
            }
            coat="#4a4237"
            contactShadow={false}
          />
          {renderStaging?.carriedProp?.(
            props.mechanicPromptId ?? "",
            props.reducedMotion,
          ) ?? null}
        </group>
      </group>
    </>
  );
}

// Action clips that should play once and clamp (physics/motion drives the
// underlying displacement; the mixer only owns the visible recovery).
const ACTION_LOOP_ONCE = new Set(["jump", "runJump", "vault", "climbUp", "climbDown"]);

// Map the motion phase to the rig clip. Jump/fall use the supplied ballistic
// clips; authored affordances use their dedicated clips. MANTLE never resolves
// to a clip because it is disabled and must not borrow another animation.
function clipForPhase(phase: MotionPhase, locomotion: "idle" | "walk" | "run"): string | null {
  switch (phase) {
    case "STANDING_JUMP":
      return "jump";
    case "RUNNING_JUMP":
      return "runJump";
    case "FALLING":
      return "jump"; // held airborne pose until a dedicated fall clip lands
    case "VAULT":
      return "vault";
    case "CLIMB_UP":
      return "climbUp";
    case "CLIMB_DOWN":
      return "climbDown";
    case "DUCK_UNDER":
      return "crouchWalk";
    case "CROUCH":
      return locomotion === "idle" ? "crouchIdle" : "crouchWalk";
    case "MANTLE":
      return null; // disabled affordance: no fallback clip
    case "GROUNDED":
    default:
      return null; // fall through to the free-walk locomotion clip
  }
}
