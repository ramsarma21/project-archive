import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  DAY1_CUES,
  FIELD_REPOSITION_ANCHORS,
  type FieldCommittedEvent,
  type InputRequest,
  type PresentationDirective,
  type PresenterEvent,
  type RuntimeView,
} from "@pa/contracts";
import { District } from "./District.js";
import { AudioDirector } from "./AudioDirector.js";
import { Player, type PlayerApi } from "./Player.js";
import { ChoreographyDirector } from "./ChoreographyDirector.js";
import { choreographyFor, STAGE_ANCHORS } from "./choreography.js";
import type { ChoiceAnimation } from "./choiceAnimations.js";
import {
  documentForContext,
  documentForFocusReadObject,
  getDocumentTexture,
  type DocumentId,
} from "./documentTextures.js";
import { FirstPersonDirector } from "./FirstPersonDirector.js";
import {
  FirstPersonCamera,
  createFirstPersonHands,
  headCamBeat,
} from "./FirstPersonCamera.js";
import { EventDirector } from "./EventDirector.js";
import { MechanicRigs } from "./MechanicRigs.js";
import { DoorDirector, DOOR_TARGETS } from "./DoorDirector.js";
import { EntryDirector, useEntryDoorTarget } from "./EntryDirector.js";
import { TraversalDirector } from "./TraversalDirector.js";
import { InteractionDirector } from "./InteractionDirector.js";
import { createInteractionRegistry } from "./interactionRegistry.js";
import { ReactiveNpcDirector } from "./ReactiveNpcDirector.js";
import { M4ContentDirector } from "./M4ContentDirector.js";
import { INTERIOR_HOTSPOT_MICROS } from "./reactiveManifest.js";
import { traversalBlockerColliders } from "./traversalMarkers.js";
import {
  ALL_INTERIOR_LOCATIONS,
  EXPLORE_LOCATIONS,
  LOCATIONS,
  MARKER_ANCHORS,
  WORLD_BOUNDS,
  exteriorColliders,
} from "./manifest.js";
import {
  doorAwareBuildingColliders,
  doorwayForBuilding,
  thresholdAnchorForLocation,
} from "./doorwayContract.js";
import {
  INTERIORS,
  interiorDef,
  interiorDoorFacade,
  interiorExitSensor,
  interiorLanding,
  interiorPoint,
  type InteriorInspectHotspotDef,
} from "./interiorManifest.js";
import { buildInteriorCollisionWorld } from "./interiorCollision.js";
import { InteriorInspectDirector } from "./InteriorInspectDirector.js";
import { ContextInspectCard } from "../presenter/ContextInspectCard.js";
import { ImportedTexturedProp } from "./Character.js";
import { preloadInteriorAssets } from "./InteriorDirector.js";
import { QuestMarkerDirector, type ResolvedQuestMarker } from "./QuestMarkerDirector.js";
import {
  QuestMarkerHud,
  createQuestMarkerHudStore,
} from "./QuestMarkerHud.js";
import {
  INTERIOR_EXIT_KIND,
  KIND_THRESHOLDS,
  questMarkerMeta,
} from "./questMarkerManifest.js";
import {
  IDLE_PARK_EXTRA_M,
  arrivalReady,
  planarDistance,
} from "./questMarkerResolver.js";
import { createActorRegistry, type ActorRegistry } from "./actorRegistry.js";
import {
  advanceFieldClock,
  createFieldClock,
  pauseFieldClock,
  projectFieldSeed,
  resumeFieldClock,
  type FieldClock,
} from "./fieldSimulation.js";
import {
  buildExteriorGameplayCollision,
  buildGameplayWorld,
  EXTERIOR_GAMEPLAY_SPACE,
  interiorGameplaySpace,
} from "./gameplayWorld.js";
import {
  resolveCameraOwnership,
  type CameraOwnershipState,
} from "./cameraOwnership.js";
import type { StealthStore } from "./stealthStore.js";
import {
  WorldServicesProvider,
  type WorldServices,
} from "./WorldServicesContext.js";
import { ChaseDirector } from "./ChaseDirector.js";
import {
  contextualInteractionsAllowedDuringInterrupt,
  explorePortalsAllowedDuringChase,
} from "./chaseFieldGating.js";
import { ReleaseSceneDirector } from "./ReleaseSceneDirector.js";
import { RouteReminderDirector } from "./RouteReminderDirector.js";
import { WatcherDirector } from "./WatcherDirector.js";
import { ConfrontationInspectionRig } from "./ConfrontationInspectionRig.js";
import { INSPECTOR_OFFICE } from "./stealthManifest.js";
import type { StaminaAssist } from "./stamina.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

const ACTOR_STALE_AGE_TICKS = 30;

// Every leg of the rider errand is part of the same timed run (bell-bounded):
// the board selection plus the authored travel legs of all three routes.
const TIMED_RUN_TARGETS = new Set([
  "RIDER_HANDBILLS",
  "CLARKE_ROUTE",
  "CUSTOMS_ROUTE",
  "RIDER_BACK_LANES",
  "RIDER_DOCK_GATE",
  "RIDER_POST_ROUTE",
]);

function FieldClockDirector(props: {
  clockRef: MutableRefObject<FieldClock>;
  tickRef: MutableRefObject<number>;
  actors: ActorRegistry;
  paused: boolean;
}) {
  useFrame((_, frameDt) => {
    if (props.paused) {
      props.clockRef.current = pauseFieldClock(props.clockRef.current);
      props.tickRef.current = props.clockRef.current.tick;
      return;
    }
    if (props.clockRef.current.paused) {
      // Resume without consuming the first render delta. That delta includes
      // time spent behind a modal/backgrounded and must never enter field time.
      props.clockRef.current = resumeFieldClock(props.clockRef.current);
      props.tickRef.current = props.clockRef.current.tick;
      return;
    }
    const advanced = advanceFieldClock(props.clockRef.current, frameDt);
    props.clockRef.current = advanced.clock;
    props.tickRef.current = advanced.clock.tick;
    if (advanced.steps > 0) {
      props.actors.pruneStale(
        advanced.lastTick,
        ACTOR_STALE_AGE_TICKS,
      );
    }
  }, -100);
  return null;
}

function useSmoothedNumber(target: number, durationMs: number): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (durationMs <= 0) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const linear = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - linear, 3);
      current.current = THREE.MathUtils.lerp(from, target, eased);
      setValue(current.current);
      if (linear < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

// ---- Gold-marker redirect (Interaction-Spec §1.2a / Day-1 L11) ----------
// Fires FREE_ROAM_IDLE only on genuine non-progress toward the selected gold
// marker: no distance progress for a lenient grace period AND the player is
// either essentially stationary or has drifted net-away from the marker.
// Walking toward the marker continuously never triggers it.
const REDIRECT_SAMPLE_MS = 500; // distance sampling cadence
const REDIRECT_PROGRESS_EPS_M = 1.5; // closer-than-best-so-far that counts as progress
const REDIRECT_MOVE_EPS_M = 0.08; // per-sample position delta that counts as movement
const REDIRECT_NO_PROGRESS_MS = 11000; // grace with zero progress before the first nudge
const REDIRECT_STATIONARY_MS = 6000; // "essentially AFK" window
const REDIRECT_AWAY_WINDOW_MS = 6000; // net-away comparison window
const REDIRECT_AWAY_EPS_M = 1.5; // net distance gained over the window that reads as moving away
const REDIRECT_COOLDOWN_MS = [22000, 35000] as const; // escalating re-fire spacing

function IdleRedirectTracker(props: {
  markers: ResolvedQuestMarker[];
  apiRef: { current: PlayerApi | null };
  busy: boolean;
  selectedTargetId: string | null;
  trackingKey: string | null; // cueId + selected target; a change resets all state
  onIdle: () => void;
}) {
  const state = useRef({
    lastSampleAt: 0,
    lastPos: null as [number, number] | null,
    bestDist: Infinity,
    lastProgressAt: 0,
    lastMovementAt: 0,
    samples: [] as { t: number; dist: number }[],
    fireCount: 0,
    nextEligibleAt: 0,
    parked: true,
  });
  useEffect(() => {
    const s = state.current;
    s.parked = true;
    s.fireCount = 0;
    s.nextEligibleAt = 0;
  }, [props.trackingKey]);
  useFrame(() => {
    const s = state.current;
    const now = performance.now();
    if (now - s.lastSampleAt < REDIRECT_SAMPLE_MS) return;
    s.lastSampleAt = now;
    const api = props.apiRef.current;
    const marker = props.selectedTargetId
      ? props.markers.find((m) => m.targetId === props.selectedTargetId)
      : undefined;
    const px = api?.position.x ?? 0;
    const pz = api?.position.z ?? 0;
    const dist = marker
      ? planarDistance(px, pz, marker.arrivalAnchor[0], marker.arrivalAnchor[2])
      : Infinity;
    // Parking radius is the marker's own arrival radius plus a small margin, so
    // the nudge never fires while the player is effectively arriving.
    const parkRadius = marker
      ? KIND_THRESHOLDS[marker.kind].arrival + IDLE_PARK_EXTRA_M
      : 0;
    // Park (the grace restarts fresh) while there is no live gold target,
    // while any blocking UI or subtitle is up, or once the player is close
    // enough to be arriving. Escalation state survives a park so the nudge's
    // own Archive line cannot reset its cooldown.
    if (!api || !marker || props.busy || dist <= parkRadius) {
      s.parked = true;
      return;
    }
    if (s.parked) {
      s.parked = false;
      s.lastPos = [px, pz];
      s.bestDist = dist;
      s.lastProgressAt = now;
      s.lastMovementAt = now;
      s.samples = [{ t: now, dist }];
      return;
    }
    if (s.lastPos && Math.hypot(px - s.lastPos[0], pz - s.lastPos[1]) >= REDIRECT_MOVE_EPS_M) {
      s.lastMovementAt = now;
    }
    s.lastPos = [px, pz];
    if (dist <= s.bestDist - REDIRECT_PROGRESS_EPS_M) {
      // Real progress toward the gold marker: full reset, including escalation.
      s.bestDist = dist;
      s.lastProgressAt = now;
      s.fireCount = 0;
      s.nextEligibleAt = 0;
    }
    s.samples.push({ t: now, dist });
    while (
      s.samples.length > 0 &&
      now - s.samples[0]!.t > REDIRECT_AWAY_WINDOW_MS + REDIRECT_SAMPLE_MS * 2
    ) {
      s.samples.shift();
    }
    const oldest = s.samples[0]!;
    const netAway =
      now - oldest.t >= REDIRECT_AWAY_WINDOW_MS - REDIRECT_SAMPLE_MS &&
      dist - oldest.dist >= REDIRECT_AWAY_EPS_M;
    const stationary = now - s.lastMovementAt >= REDIRECT_STATIONARY_MS;
    if (
      now - s.lastProgressAt >= REDIRECT_NO_PROGRESS_MS &&
      (stationary || netAway) &&
      now >= s.nextEligibleAt
    ) {
      s.fireCount += 1;
      s.nextEligibleAt =
        now + REDIRECT_COOLDOWN_MS[Math.min(s.fireCount, REDIRECT_COOLDOWN_MS.length) - 1]!;
      props.onIdle();
    }
  });
  return null;
}

// Mirrors the live player position onto the wrapper element so QA tooling
// (and tests) can observe movement without reaching into the scene graph.
function PlayerPosProbe(props: {
  apiRef: { current: PlayerApi | null };
  hostRef: { current: HTMLDivElement | null };
  actors: ActorRegistry;
  stealthStore: StealthStore;
  field: RuntimeView["field"] | null;
  assist: StaminaAssist;
}) {
  const lastWriteAt = useRef(0);
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type QaWindow = Window & {
      __PA_QA_TELEPORT__?: (x: number, z: number, faceY?: number) => void;
    };
    const qaWindow = window as QaWindow;
    qaWindow.__PA_QA_TELEPORT__ = (x, z, faceY) => {
      props.apiRef.current?.teleport([x, 0, z], faceY);
    };
    return () => {
      delete qaWindow.__PA_QA_TELEPORT__;
    };
  }, [props.apiRef]);
  useFrame(({ scene }) => {
    if (!QA_RUNTIME_ENABLED) return;
    const now = performance.now();
    if (now - lastWriteAt.current < 100) return;
    lastWriteAt.current = now;
    const api = props.apiRef.current;
    const host = props.hostRef.current;
    if (api && host) {
      let objectCount = 0;
      let visibleMeshCount = 0;
      scene.traverse((object) => {
        objectCount += 1;
        if (object.visible && (object as THREE.Mesh).isMesh) {
          visibleMeshCount += 1;
        }
      });
      host.dataset.sceneObjectCount = String(objectCount);
      host.dataset.sceneVisibleMeshCount = String(visibleMeshCount);
      host.dataset.playerPos = `${api.position.x.toFixed(2)},${api.position.z.toFixed(2)}`;
      host.dataset.playerPos3d = `${api.position.x.toFixed(3)},${api.position.y.toFixed(3)},${api.position.z.toFixed(3)}`;
      host.dataset.playerMotion = api.motion.phase;
      host.dataset.playerSpeed = api.motion.speed.toFixed(3);
      host.dataset.playerClip = api.motion.clip;
      host.dataset.playerSprinting = String(api.motion.sprinting);
      host.dataset.playerCrouched = String(api.motion.crouched);
      host.dataset.playerStamina = api.motion.stamina.toFixed(3);
      host.dataset.playerMovementIntent = String(api.motion.movementIntent);
      host.dataset.playerBlocked = String(api.motion.blocked);
      host.dataset.playerFacing = `${api.motion.facingX.toFixed(3)},${api.motion.facingZ.toFixed(3)}`;
      host.dataset.playerActionSerial = String(api.motion.actionSerial);
      host.dataset.playerInputLocked = String(api.motion.inputLocked);
      const stealth = props.stealthStore.getSnapshot();
      host.dataset.chaseActive = String(stealth.chaseActive);
      host.dataset.chaseState = stealth.chaseState;
      host.dataset.chaseStamina = stealth.stamina.toFixed(3);
      host.dataset.chaseConfirmResolve = String(stealth.confirmResolve);
      host.dataset.chaseAssist = props.assist;
      const pursuer = props.actors.get("M1_PURSUER");
      host.dataset.pursuerRegistered = String(Boolean(pursuer));
      host.dataset.pursuerPosition = pursuer
        ? `${pursuer.position.x.toFixed(3)},${pursuer.position.y.toFixed(3)},${pursuer.position.z.toFixed(3)}`
        : "";
      host.dataset.pursuerForward = pursuer
        ? `${pursuer.forwardVec.x.toFixed(3)},${pursuer.forwardVec.y.toFixed(3)},${pursuer.forwardVec.z.toFixed(3)}`
        : "";
      host.dataset.pursuerVelocity = pursuer?.velocity
        ? `${pursuer.velocity.x.toFixed(3)},${pursuer.velocity.y.toFixed(3)},${pursuer.velocity.z.toFixed(3)}`
        : "";
      host.dataset.pursuerSpace = pursuer?.spaceId ?? "";
      host.dataset.chaseOutcome =
        props.field?.chaseHistory.at(-1)?.outcome ?? "";
      const namedIds = [
        "abigail",
        "thomas",
        "pike",
        "clarke",
        "rider",
      ];
      const namedActors = namedIds
        .map((id) => props.actors.get(id))
        .filter((actor) => Boolean(actor));
      host.dataset.namedActorIds = namedActors
        .map((actor) => actor!.id)
        .join(",");
      host.dataset.namedActorPositions = namedActors
        .map(
          (actor) =>
            `${actor!.id}:${actor!.position.x.toFixed(2)},${actor!.position.z.toFixed(2)}`,
        )
        .join(";");
    }
  });
  return null;
}

// ---- Focus-read world objects (tracked reads, Day-1) ------------------------
// A tracked read is offered on a physical object in the world; the legible
// face only ever appears in the post-open holographic panel. These planes
// carry the same authored artwork as that panel (documentTextures), small
// enough to stay unreadable at offer distance.

function PaperPlane(props: {
  documentId: DocumentId;
  width: number;
  position?: [number, number, number];
}) {
  const texture = useMemo(() => getDocumentTexture(props.documentId), [props.documentId]);
  const height = props.width * (4 / 3);
  return (
    <group position={props.position}>
      <ImportedTexturedProp
        texture={texture}
        size={[props.width, 0.16, height]}
      />
    </group>
  );
}

// The King's revenue proclamation pinned to the Custom House notice board
// ("There's a proclamation on the wall."). Same board convention as the
// tacked notice in MechanicRigs; offset along the board so the two never
// overlap once the notice is posted.
function CustomHouseProclamation() {
  // Board center is [50.6, -, 16.8] rotY 0.35; the sheet hangs on the upper
  // right of its south face, proud of the slats (the GLB face sits ~0.26m
  // from center), clear of the tack-mechanic notice spot at board center.
  const board = STAGE_ANCHORS.CUSTOMHOUSE_BOARD ?? [50.6, 1.25, 16.7];
  return (
    <group
      position={[board[0] + 0.25, board[1] + 0.18, board[2] - 0.04]}
      rotation={[0, Math.PI, 0]}
    >
      <PaperPlane documentId="REVENUE_PROCLAMATION" width={0.34} />
    </group>
  );
}

// Standing broadside board on the elm approach ("Right in your path. A
// single line."). Fixed dressing in the pocket, clear of the crowd ring.
function CrowdBoard() {
  const anchor = STAGE_ANCHORS.CROWD_BOARD_POST ?? [86.9, 0, -19.4];
  // Faces the player's stand spot, oblique to the offer camera: the runner
  // can read it in-fiction, the shot only shows a foreshortened bill.
  return (
    <group position={anchor} rotation={[0, 2.0, 0]}>
      {[-0.34, 0.34].map((x) => (
        <mesh key={x} position={[x, 0.85, -0.045]} castShadow>
          <boxGeometry args={[0.07, 1.7, 0.07]} />
          <meshStandardMaterial color="#4a3826" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.92, 0.98, 0.045]} />
        <meshStandardMaterial color="#5d4930" roughness={0.95} />
      </mesh>
      <PaperPlane documentId="CROWD_BOARD" width={0.32} position={[0.08, 1.28, 0.028]} />
    </group>
  );
}

// A freestanding posting post carrying an offered street bill ("nailed by
// the door", "the paste is still wet"), planted just ahead of wherever the
// runner stopped, facing them. Placed once per offer.
function StreetReadPost(props: {
  documentId: DocumentId;
  apiRef: { current: PlayerApi | null };
}) {
  const group = useRef<THREE.Group>(null);
  const placed = useRef(false);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g || placed.current) return;
    const player = props.apiRef.current?.position;
    if (!player) return;
    // Forward = camera->player on the ground plane (the follow camera sits
    // behind the runner). The post plants ahead, a half-step right; the bill
    // hangs high on a tall posting post so the centered offer panel sits
    // below it, not over it.
    let dx = player.x - camera.position.x;
    let dz = player.z - camera.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    dx /= len;
    dz /= len;
    const rightX = -dz;
    const rightZ = dx;
    const px = THREE.MathUtils.clamp(
      player.x + dx * 1.9 + rightX * 0.55,
      WORLD_BOUNDS.minX + 1.5,
      WORLD_BOUNDS.maxX - 1.5,
    );
    // Stop short of the building facades on the street spine (fronts at |z|>=11).
    const rawZ = player.z + dz * 1.9 + rightZ * 0.55;
    const pz = Math.abs(player.z) < 12 ? THREE.MathUtils.clamp(rawZ, -10.5, 10.5) : rawZ;
    g.position.set(px, 0, pz);
    g.rotation.y = Math.atan2(player.x - px, player.z - pz);
    g.visible = true;
    placed.current = true;
  });
  return (
    <group ref={group} visible={false}>
      <mesh position={[0, 1.3, -0.05]} castShadow>
        <boxGeometry args={[0.1, 2.6, 0.1]} />
        <meshStandardMaterial color="#4a3826" roughness={0.95} />
      </mesh>
      <mesh position={[0, 2.42, -0.05]} castShadow>
        <boxGeometry args={[0.62, 0.07, 0.09]} />
        <meshStandardMaterial color="#4a3826" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.86, -0.02]} castShadow>
        <boxGeometry args={[0.56, 0.76, 0.035]} />
        <meshStandardMaterial color="#5d4930" roughness={0.95} />
      </mesh>
      <PaperPlane documentId={props.documentId} width={0.42} position={[0, 1.86, 0.002]} />
    </group>
  );
}

function FocusReadStaging(props: {
  request: InputRequest | null;
  interiorId: string | null;
  apiRef: { current: PlayerApi | null };
}) {
  const objectId = props.request?.kind === "FOCUS_READ" ? props.request.objectId : null;
  const streetDoc =
    objectId === "TOWN_STAMP_NOTICE" || objectId === "FRESH_BROADSIDE"
      ? documentForFocusReadObject(objectId)
      : null;
  return (
    <group>
      {props.interiorId === "CUSTOM_HOUSE" && <CustomHouseProclamation />}
      {!props.interiorId && <CrowdBoard />}
      {streetDoc && !props.interiorId && (
        <StreetReadPost key={objectId} documentId={streetDoc} apiRef={props.apiRef} />
      )}
    </group>
  );
}

// ---- Explore interiors (Bible §4: every building enterable) -----------------
// Presentation-only portals: the runtime never leaves its exterior location;
// walking into any non-errand door crosses the same kind of threshold the
// hero interiors use (door swing, short beat, teleport across the leaf).
const EXPLORE_PORTALS = Object.values(EXPLORE_LOCATIONS).map((loc) => ({
  loc,
  outside: thresholdAnchorForLocation(loc, "OUTSIDE"),
  inside: interiorExitSensor(loc.id),
}));

function ExplorePortals(props: {
  apiRef: { current: PlayerApi | null };
  interiorId: string | null;
  enabled: boolean;
  onEnter: (locId: string) => void;
  onExit: (locId: string) => void;
}) {
  // Disarm after every threshold crossing until the player steps away, so a
  // teleport landing beside the sensor never ping-pongs back through it.
  const armed = useRef(false);
  useEffect(() => {
    armed.current = false;
  }, [props.interiorId]);
  useFrame(() => {
    if (!props.enabled) return;
    const api = props.apiRef.current;
    if (!api) return;
    if (props.interiorId) {
      const portal = EXPLORE_PORTALS.find((p) => p.loc.id === props.interiorId);
      if (!portal) return; // hero interiors exit through their runtime flow
      const dx = api.position.x - portal.inside[0];
      const dz = api.position.z - portal.inside[2];
      const d2 = dx * dx + dz * dz;
      if (!armed.current) {
        if (d2 > 1.6 * 1.6) armed.current = true;
        return;
      }
      if (d2 < 0.95 * 0.95) props.onExit(portal.loc.id);
      return;
    }
    let nearest: (typeof EXPLORE_PORTALS)[number] | null = null;
    let nearestD2 = Infinity;
    for (const portal of EXPLORE_PORTALS) {
      const dx = api.position.x - portal.outside[0];
      const dz = api.position.z - portal.outside[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearest = portal;
      }
    }
    if (!armed.current) {
      if (nearestD2 > 1.6 * 1.6) armed.current = true;
      return;
    }
    if (nearest && nearestD2 < 0.95 * 0.95) props.onEnter(nearest.loc.id);
  });
  return null;
}

// Proximity arrival + walk-in selection with kind-specific radii, arrival
// dwell, and selection-confirmation hysteresis (Interaction-Spec marker
// replacement). Selecting never moves the player: entering an unselected
// marker only emits FREE_ROAM_SELECT; the subsequently-selected marker must
// then be dwelt on (past the confirmation window) before FREE_ROAM_GOTO fires.
// The one-shot key is cueId|targetId so each objective arrives exactly once.
function QuestArrivalTracker(props: {
  markers: ResolvedQuestMarker[];
  apiRef: { current: PlayerApi | null };
  busy: boolean;
  selectedTargetId: string | null;
  cueId: string | null;
  onArrive: (targetId: string) => void;
  onSelect: (targetId: string) => void;
}) {
  const state = useRef({
    selectFired: null as string | null,
    arriveFiredKey: null as string | null,
    dwellEnter: null as number | null,
    selectedAt: 0,
  });
  useEffect(() => {
    const s = state.current;
    s.selectFired = null;
    s.arriveFiredKey = null;
    s.dwellEnter = null;
    s.selectedAt = performance.now();
  }, [props.selectedTargetId, props.cueId]);
  useFrame(() => {
    const s = state.current;
    const api = props.apiRef.current;
    if (props.busy || !api) {
      s.dwellEnter = null;
      return;
    }
    const px = api.position.x;
    const pz = api.position.z;
    if (!props.selectedTargetId) {
      // No selection yet: walking into any available marker's arrival radius
      // selects it (one-shot per target). Selection collapses the field.
      for (const m of props.markers) {
        const th = KIND_THRESHOLDS[m.kind];
        const d = planarDistance(px, pz, m.arrivalAnchor[0], m.arrivalAnchor[2]);
        if (d <= th.arrival) {
          if (s.selectFired !== m.targetId) {
            s.selectFired = m.targetId;
            props.onSelect(m.targetId);
          }
          return;
        }
      }
      s.selectFired = null;
      return;
    }
    const marker = props.markers.find((m) => m.targetId === props.selectedTargetId);
    if (!marker) {
      s.dwellEnter = null;
      return;
    }
    const th = KIND_THRESHOLDS[marker.kind];
    const d = planarDistance(px, pz, marker.arrivalAnchor[0], marker.arrivalAnchor[2]);
    const now = performance.now();
    const inside = d <= th.arrival;
    if (inside) {
      if (s.dwellEnter === null) s.dwellEnter = now;
    } else {
      s.dwellEnter = null;
    }
    const dwellMs = s.dwellEnter === null ? 0 : now - s.dwellEnter;
    const key = `${props.cueId ?? ""}|${marker.targetId}`;
    if (
      s.arriveFiredKey !== key &&
      arrivalReady({
        insideArrival: inside,
        dwellMs,
        msSinceSelection: now - s.selectedAt,
      })
    ) {
      s.arriveFiredKey = key;
      props.onArrive(marker.targetId);
    }
  });
  return null;
}

export function World3D(props: {
  view: RuntimeView | null;
  presentationLocationId: string | null;
  request: InputRequest | null;
  present: PresentationDirective[];
  busy: boolean;
  // Movement-only lock: like busy, but excludes archive-only nudge subtitles
  // and the brief runtime advance roundtrip, so the player keeps walking
  // while the Archive redirect line plays (Interaction-Spec §1.2a).
  movementLocked: boolean;
  keyboardOnly: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  chaseAssist: StaminaAssist;
  // True while the holographic read panel is on screen: parks the
  // first-person hands/paper so nothing duplicates the hologram beneath it.
  readPanelActive: boolean;
  cueId: string | null;
  choreographyReady: boolean;
  choiceAnimation: ChoiceAnimation | null;
  stealthStore: StealthStore;
  onChoreographyReady: (cueId: string) => void;
  onWebglStatus: (available: boolean) => void;
  onEvent: (ev: PresenterEvent) => void;
  onFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>;
}) {
  const apiRef = useRef<PlayerApi | null>(null);
  const onFieldEventRef = useRef(props.onFieldEvent);
  onFieldEventRef.current = props.onFieldEvent;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const actorRegistry = useMemo(() => createActorRegistry(), []);
  const interactionRegistry = useMemo(() => createInteractionRegistry(), []);
  const fieldTickRef = useRef(0);
  const doorTimer = useRef<number | null>(null);
  const exploreTimer = useRef<number | null>(null);
  const spawned = useRef(false);
  const qaInteriorOverride = useRef(false);
  const [doorTarget, setDoorTarget] = useState<string | null>(null);
  const [visualInteriorId, setVisualInteriorId] = useState<string | null>(null);
  const [inspectOpen, setInspectOpen] = useState<InteriorInspectHotspotDef | null>(null);
  const [chaseCameraYaw, setChaseCameraYaw] = useState(Math.PI / 2);
  const appliedRepositionRef = useRef<string | null>(null);
  const [releaseSceneActive, setReleaseSceneActive] = useState(false);
  // The DOM layer (Play) hides the center controls while the chewed-out beat
  // plays so the constable's line is never buried under the task board.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("pa:cinematic-beat", {
        detail: {
          active: releaseSceneActive || Boolean(inspectOpen),
          owner: releaseSceneActive ? "RELEASE_CINEMATIC" : "INTERIOR_INSPECT",
        },
      }),
    );
  }, [inspectOpen, releaseSceneActive]);
  const entryDoorTarget = useEntryDoorTarget(
    props.choiceAnimation,
    props.reducedMotion,
  );
  const activeDoorTarget = doorTarget ?? entryDoorTarget;
  const dockRouteUnlocked = props.view?.routes.THOMAS_DOCK_ROUTE === "UNLOCKED";
  const colliders = useMemo(
    () => [
      ...exteriorColliders(
        dockRouteUnlocked ? { THOMAS_DOCK_ROUTE: "UNLOCKED" } : {},
        doorAwareBuildingColliders(activeDoorTarget),
      ),
      ...traversalBlockerColliders(),
    ],
    [activeDoorTarget, dockRouteUnlocked],
  );
  const includeDensityCollision = useMemo(
    () =>
      !import.meta.env.DEV ||
      (new URLSearchParams(window.location.search).get("density") !== "0" &&
        window.localStorage.getItem("pa-density-disabled") !== "1"),
    [],
  );
  const exteriorGameplayCollision = useMemo(
    () =>
      buildExteriorGameplayCollision({
        colliders,
        includeDensity: includeDensityCollision,
      }),
    [colliders, includeDensityCollision],
  );
  const projectedFieldSeed = useMemo(
    () => projectFieldSeed([props.view?.field.seedHex ?? "FIELD_PENDING"]),
    [props.view?.field.seedHex],
  );
  const fieldClockRef = useRef<FieldClock>(
    createFieldClock(projectedFieldSeed),
  );
  const fieldSeedRef = useRef(projectedFieldSeed);
  if (fieldSeedRef.current !== projectedFieldSeed) {
    fieldSeedRef.current = projectedFieldSeed;
    fieldClockRef.current = createFieldClock(projectedFieldSeed);
    fieldTickRef.current = 0;
  }
  const [documentHidden, setDocumentHidden] = useState(
    () => document.visibilityState === "hidden",
  );
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      if (hidden) {
        fieldClockRef.current = pauseFieldClock(fieldClockRef.current);
      }
      setDocumentHidden(hidden);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const [webglOk] = useState(() => {
    try {
      const c = document.createElement("canvas");
      return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      return false;
    }
  });
  useEffect(() => {
    props.onWebglStatus(webglOk);
  }, [webglOk, props.onWebglStatus]);
  useEffect(() => () => {
    if (doorTimer.current !== null) window.clearTimeout(doorTimer.current);
    if (exploreTimer.current !== null) window.clearTimeout(exploreTimer.current);
  }, []);
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type DoorQaWindow = Window & {
      __PA_QA_DOOR__?: (
        targetId: string | null,
        interiorId?: string | null,
      ) => void;
      __PA_QA_INTERIOR__?: (
        interiorId: string,
        view?: "LANDING" | "CENTER",
      ) => void;
    };
    const qaWindow = window as DoorQaWindow;
    // A QA-forced interior/door override must be authoritative: cancel any
    // in-flight presentation threshold beat (door swing / explore transfer)
    // so a previously-queued casual transfer cannot land a frame later and
    // clobber the forced space (e.g. a post-refuge tavern entry bleeding into
    // the next generic-interior transfer). Dev/QA-only.
    const cancelInFlightThresholdBeats = () => {
      if (exploreTimer.current !== null) {
        window.clearTimeout(exploreTimer.current);
        exploreTimer.current = null;
      }
      if (doorTimer.current !== null) {
        window.clearTimeout(doorTimer.current);
        doorTimer.current = null;
      }
      apiRef.current?.setInteractionClip(null);
      apiRef.current?.setInputLocked(false);
    };
    qaWindow.__PA_QA_DOOR__ = (targetId, nextInterior) => {
      cancelInFlightThresholdBeats();
      if (nextInterior !== undefined) {
        qaInteriorOverride.current = true;
        setVisualInteriorId(nextInterior);
      }
      setDoorTarget(targetId);
    };
    qaWindow.__PA_QA_INTERIOR__ = (nextInterior, view = "LANDING") => {
      const def = interiorDef(nextInterior);
      if (!def) throw new Error(`unknown QA interior ${nextInterior}`);
      cancelInFlightThresholdBeats();
      qaInteriorOverride.current = true;
      preloadInteriorAssets(def);
      setDoorTarget(null);
      setVisualInteriorId(nextInterior);
      let attempts = 0;
      const place = () => {
        const api = apiRef.current;
        if (api) {
          const destination =
            view === "CENTER"
              ? interiorPoint(nextInterior, [
                  0,
                  0,
                  Math.min(0, -def.dimensions[2] / 2 + 6),
                ])
              : interiorLanding(nextInterior);
          api.teleport(destination, 0);
          return;
        }
        attempts += 1;
        if (attempts < 40) window.setTimeout(place, 60);
      };
      window.setTimeout(place, 80);
    };
    return () => {
      delete qaWindow.__PA_QA_DOOR__;
      delete qaWindow.__PA_QA_INTERIOR__;
    };
  }, []);

  const runtimeLocationId = props.view?.locationId ?? "ARCHIVE_TRANSIT";
  const locationId = props.presentationLocationId ?? runtimeLocationId;
  const archiveTransit =
    locationId === "ARCHIVE_TRANSIT" && !qaInteriorOverride.current;
  const runtimeLoc = LOCATIONS[runtimeLocationId] ?? LOCATIONS.BOSTON_STREET!;
  const interiorId = visualInteriorId;
  const activeInterior = interiorDef(interiorId);
  const interiorWorld = useMemo(
    () => (activeInterior ? buildInteriorCollisionWorld(activeInterior) : null),
    [activeInterior],
  );
  const activeGameplaySpace = useMemo(
    () =>
      interiorId
        ? interiorGameplaySpace(interiorId)
        : EXTERIOR_GAMEPLAY_SPACE,
    [interiorId],
  );
  const gameplayWorld = useMemo(
    () =>
      buildGameplayWorld({
        exterior: exteriorGameplayCollision,
        activeSpace: activeGameplaySpace,
        interiors:
          interiorId && interiorWorld
            ? { [interiorId]: interiorWorld }
            : undefined,
      }),
    [
      activeGameplaySpace,
      exteriorGameplayCollision,
      interiorId,
      interiorWorld,
    ],
  );
  const activeSpaceId = interiorId ?? "EXTERIOR";
  useEffect(() => {
    actorRegistry.clear();
  }, [actorRegistry, activeSpaceId]);

  useEffect(() => {
    setInspectOpen(null);
  }, [interiorId]);
  const completeInteriorInspect = (hotspot: InteriorInspectHotspotDef) => {
    setInspectOpen(null);
    const micros = INTERIOR_HOTSPOT_MICROS[hotspot.id] ?? [];
    if (micros.length === 0) return;
    const ordinal = (props.view?.field.interactionOrdinal ?? 0) + 1;
    void (async () => {
      for (const microConceptId of micros) {
        await onFieldEventRef.current({
          type: "FIELD_MICRO_ENGAGED",
          eventId: `M3_INSPECT_${hotspot.id}_${ordinal}_${microConceptId}`,
          record: {
            recordId: `INTERIOR:${hotspot.id}:${microConceptId}`,
            microConceptId,
            sourceId: `INTERIOR:${hotspot.id}`,
            interactionOrdinal: ordinal,
          },
        });
      }
    })();
  };
  useEffect(() => {
    if (!inspectOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      completeInteriorInspect(inspectOpen);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [inspectOpen]);

  // Scene changes do not reposition the player. A location transition may
  // only move them across the doorway they physically reached; exterior travel
  // always remains at the coordinates produced by player movement. The player
  // rig mounts asynchronously inside the Canvas, so this transition retries
  // until it exists; otherwise a resume inside a shop would leave the camera
  // floating in the raw building shell.
  //
  // Threshold placements are carried in a ref and executed on the effect run
  // AFTER the interior-id swap commits. Scheduling them on a timer inside the
  // run that calls setVisualInteriorId was a race this effect lost against
  // itself: the state change re-runs the effect, whose cleanup cleared the
  // pending timer, leaving the player stranded in the wall void between the
  // exterior facade and the interior room (the reported "stuck in the wall"
  // after the Mercer press scene). Deferring across the re-run also means the
  // teleport lands under the NEW movement regime, never the old one.
  const pendingThresholdPlacement = useRef<
    | { kind: "ENTER"; locationId: string }
    | { kind: "EXIT"; anchor: [number, number, number]; faceY: number }
    | null
  >(null);
  useEffect(() => {
    if (archiveTransit) return;
    let cancelled = false;
    let timer: number | null = null;
    const attempt = () => {
      if (cancelled) return;
      const api = apiRef.current;
      if (!api) {
        timer = window.setTimeout(attempt, 60);
        return;
      }
      const pending = pendingThresholdPlacement.current;
      if (pending) {
        if (pending.kind === "ENTER" && visualInteriorId === pending.locationId) {
          pendingThresholdPlacement.current = null;
          api.teleport(interiorLanding(pending.locationId), 0);
          return;
        }
        if (pending.kind === "EXIT" && visualInteriorId === null) {
          pendingThresholdPlacement.current = null;
          api.teleport(pending.anchor, pending.faceY);
          return;
        }
        // Stale placement (the world moved on before the swap committed).
        pendingThresholdPlacement.current = null;
      }
      if (!spawned.current) {
        spawned.current = true;
        if (runtimeLoc.interior) {
          pendingThresholdPlacement.current = {
            kind: "ENTER",
            locationId: runtimeLoc.id,
          };
          setVisualInteriorId(runtimeLoc.id);
        } else {
          api.teleport(runtimeLoc.anchor, runtimeLoc.faceY);
        }
        return;
      }
      if (runtimeLoc.interior && visualInteriorId !== runtimeLoc.id) {
        pendingThresholdPlacement.current = {
          kind: "ENTER",
          locationId: runtimeLoc.id,
        };
        setVisualInteriorId(runtimeLoc.id);
        return;
      }
      if (!runtimeLoc.interior && visualInteriorId) {
        // Only runtime interiors are evicted by a runtime location change;
        // presentation-only explore rooms are entered and left through their
        // own door portals while the runtime stays on the street.
        const previousInterior = LOCATIONS[visualInteriorId];
        if (!previousInterior) return;
        if (qaInteriorOverride.current) return;
        pendingThresholdPlacement.current = {
          kind: "EXIT",
          anchor: thresholdAnchorForLocation(previousInterior, "OUTSIDE"),
          faceY: Math.PI + previousInterior.faceY,
        };
        setVisualInteriorId(null);
      }
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [archiveTransit, runtimeLoc, visualInteriorId]);

  // Resolve each eligible FREE_ROAM target into an explicit quest marker with
  // an independent VISUAL anchor (where the imported kit is drawn) and ARRIVAL
  // anchor (where proximity is measured). No silent fallback to the authored
  // scene location: an unmapped target is skipped (and warned in dev). Only the
  // dynamic STREET marker derives its anchors from the active interior.
  const markers: ResolvedQuestMarker[] = useMemo(() => {
    const request = props.request;
    if (props.view?.field.activeInterrupt) return [];
    if (request?.kind !== "FREE_ROAM") return [];
    const activeInterior = interiorId ? ALL_INTERIOR_LOCATIONS[interiorId] : null;
    const out: ResolvedQuestMarker[] = [];
    for (const target of request.targets) {
      if (target.marker === "HIDDEN") continue;
      if (request.selectedTargetId && target.targetId !== request.selectedTargetId) continue;
      const forcedGold =
        request.selectedTargetId === target.targetId || target.marker === "GOLD";
      if (target.targetId === "STREET") {
        if (activeInterior) {
          const inside = interiorExitSensor(activeInterior.id);
          const facade = interiorDoorFacade(activeInterior.id);
          const visual: [number, number, number] = [
            facade[0] + 0.9,
            facade[1],
            facade[2] + 0.18,
          ];
          out.push({
            targetId: "STREET",
            label: target.label,
            kind: INTERIOR_EXIT_KIND,
            forcedGold,
            timed: false,
            visualAnchor: visual,
            arrivalAnchor: inside,
          });
        } else {
          // Street ground spot when already outside (return-to-street).
          const anchor = MARKER_ANCHORS.STREET ?? [0, 0, 1.5];
          out.push({
            targetId: "STREET",
            label: target.label,
            kind: "GROUND",
            forcedGold,
            timed: false,
            visualAnchor: anchor,
            arrivalAnchor: anchor,
          });
        }
        continue;
      }
      const meta = questMarkerMeta(target.targetId);
      if (!meta) {
        if (import.meta.env.DEV) {
          console.warn(
            `[quest-marker] no manifest metadata for target "${target.targetId}"; not rendered`,
          );
        }
        continue;
      }
      out.push({
        targetId: target.targetId,
        label: target.label,
        kind: meta.kind,
        forcedGold,
        timed: TIMED_RUN_TARGETS.has(target.targetId),
        visualAnchor: meta.visualAnchor,
        arrivalAnchor: meta.arrivalAnchor,
      });
    }
    return out;
  }, [props.request, props.view?.field.activeInterrupt, interiorId]);

  const hudStore = useMemo(() => createQuestMarkerHudStore(), []);

  const clock = props.view?.clock;
  const displayedSpentUnits = useSmoothedNumber(
    clock?.spentUnits ?? 0,
    props.reducedMotion ? 0 : 1800,
  );
  // Dev-only atmosphere override so visual QA can shoot any phase of day
  // without replaying to it (?atmoT=0..1&atmoDusk=1&atmoNight=1).
  const atmoOverride = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const q = new URLSearchParams(window.location.search);
    if (!q.has("atmoT") && !q.has("atmoDusk") && !q.has("atmoNight")) return null;
    return {
      t: q.has("atmoT") ? Math.min(1, Math.max(0, Number(q.get("atmoT")))) : null,
      dusk: q.get("atmoDusk") === "1",
      night: q.get("atmoNight") === "1",
    };
  }, []);
  const t =
    atmoOverride?.t != null
      ? atmoOverride.t
      : clock
        ? Math.min(1, displayedSpentUnits / Math.max(1, clock.fixedEventBoundary))
        : 0;
  const dusk =
    Boolean(atmoOverride?.dusk) ||
    clock?.phase === "DUSK" ||
    locationId === "LIBERTY_TREE_APPROACH";
  const districtClock =
    atmoOverride?.night && clock
      ? { ...clock, spentUnits: clock.fixedEventBoundary }
      : clock ?? null;
  const choreography = choreographyFor(props.cueId, {
    locationId,
    request: props.request,
    present: props.present,
  });
  const choreographyActive = Boolean(props.cueId) && !props.choreographyReady;
  const choreographyCameraActive =
    choreographyActive || Boolean(choreography?.camera?.holdUntilInput);
  const firstPersonActive =
    choreographyCameraActive && Boolean(choreography?.camera?.firstPerson);
  const activeChase = props.view?.field.activeChase ?? null;
  const reactiveInterrupt =
    props.view?.field.activeInterrupt?.kind === "REACTIVE_EXCHANGE";
  const reactiveActorsActive =
    !choreographyCameraActive &&
    (Boolean(reactiveInterrupt) ||
      ((props.request?.kind === "FREE_ROAM" ||
        props.request?.kind === "BREATHER") &&
        !activeChase &&
        !props.view?.field.activeConfrontation));
  // Field interrupts (reactive exchanges) may only START during FREE_ROAM —
  // the runtime driver rejects them elsewhere. During BREATHER the cast stays
  // visible and alive but exchange prompts are withheld; flavor verbs (no
  // field events) remain available.
  const exchangesEnabled =
    reactiveActorsActive && props.request?.kind === "FREE_ROAM";
  // The rider run is timed from selection through every travel leg — stamina
  // stays live across the whole corridor, not just while the board target is
  // literally "RIDER_HANDBILLS" (it switches to leg ids once a route commits).
  const timedDash =
    props.request?.kind === "FREE_ROAM" &&
    TIMED_RUN_TARGETS.has(props.request.selectedTargetId ?? "");
  const externalCameraDebug = useMemo(() => {
    if (!import.meta.env.DEV) return { active: false, yaw: 0 };
    const query = new URLSearchParams(window.location.search);
    const yaw = Number(query.get("m0CameraYaw") ?? 0);
    return {
      active: query.get("m0ExternalCamera") === "1",
      yaw: Number.isFinite(yaw) ? yaw : 0,
    };
  }, []);
  const cameraOwnership: CameraOwnershipState = useMemo(
    () =>
      resolveCameraOwnership({
        firstPerson: firstPersonActive,
        choreography: choreographyCameraActive,
        chase: Boolean(activeChase) || externalCameraDebug.active,
        chaseCameraYaw: activeChase
          ? chaseCameraYaw
          : externalCameraDebug.yaw,
      }),
    [
      choreographyCameraActive,
      activeChase,
      chaseCameraYaw,
      externalCameraDebug.active,
      externalCameraDebug.yaw,
      firstPersonActive,
    ],
  );
  const fieldPaused =
    archiveTransit ||
    documentHidden ||
    props.busy ||
    props.movementLocked ||
    Boolean(inspectOpen);
  const worldServices: WorldServices = useMemo(
    () => ({
      gameplayWorld,
      actors: actorRegistry,
      spaceId: activeSpaceId,
      fieldTickRef,
      stealthStore: props.stealthStore,
      submitFieldEvent: props.onFieldEvent,
    }),
    [
      activeSpaceId,
      actorRegistry,
      gameplayWorld,
      props.onFieldEvent,
      props.stealthStore,
    ],
  );
  // The comply inspection is a visible beat: the player raises the satchel
  // (search clip) while the officer looks through it, instead of standing
  // idle while a timer runs.
  const confrontationPhase = props.view?.field.activeConfrontation?.phase ?? null;
  useEffect(() => {
    if (confrontationPhase === "INSPECTING") {
      apiRef.current?.setInteractionClip("search");
      return () => apiRef.current?.setInteractionClip(null);
    }
    return undefined;
  }, [confrontationPhase]);
  useEffect(() => {
    const intent = props.view?.field.pendingReposition;
    if (!intent || appliedRepositionRef.current === intent.eventId) return;
    const contract =
      FIELD_REPOSITION_ANCHORS[
        intent.anchorId as keyof typeof FIELD_REPOSITION_ANCHORS
      ];
    if (
      !contract ||
      contract.locationId !== intent.locationId ||
      intent.anchorId !== INSPECTOR_OFFICE.releaseAnchorId
    ) {
      console.error("[field] rejected unknown reposition directive", intent);
      return;
    }
    appliedRepositionRef.current = intent.eventId;
    setVisualInteriorId(null);
    setDoorTarget(null);
    // The reappearance carries the chewed-out beat: constable scolding at the
    // Watch House release point (presentation over committed consequences).
    setReleaseSceneActive(true);
    const place = () => {
      apiRef.current?.teleport(
        [...INSPECTOR_OFFICE.releaseAnchor],
        INSPECTOR_OFFICE.releaseFacingY,
      );
    };
    window.setTimeout(place, 0);
    const acknowledge = async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const ok = await onFieldEventRef.current({
          type: "FIELD_REPOSITION_APPLIED",
          eventId: `${intent.eventId}_APPLIED`,
          intentEventId: intent.eventId,
        });
        if (ok) return;
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
    };
    void acknowledge();
  }, [props.view?.field.pendingReposition]);
  // A FOCUS_READ offer never puts the document (or hands) up: the player is
  // still deciding whether to read. The offer shows the object in the world;
  // the legible face belongs to the post-open holographic read panel. The
  // hands rig is likewise parked while that panel is on screen so no 3D
  // paper duplicates the hologram underneath it.
  const firstPersonRigActive =
    firstPersonActive &&
    props.request?.kind !== "FOCUS_READ" &&
    !props.readPanelActive;
  const firstPersonMechanicId =
    props.request?.kind === "MECHANIC" ? props.request.promptId : "";
  // Head-camera first person (Production.md §2A): the staged player body
  // stays visible playing its authored clip and the camera rides its head
  // bone; the synthetic camera-space arms mount only for beats that opted
  // back into them (SYNTH_ARM_BEATS in FirstPersonCamera.tsx).
  const headCamActive =
    firstPersonActive && headCamBeat(props.cueId, firstPersonMechanicId);
  const fpHands = useMemo(() => createFirstPersonHands(), []);
  const handoffPaper =
    firstPersonMechanicId.includes("HANDOFF") ||
    firstPersonMechanicId.includes("CIRCULAR") ||
    firstPersonMechanicId.includes("PROOF_HANDOFF") ||
    firstPersonMechanicId.includes("CONCEAL_HANDBILLS") ||
    firstPersonMechanicId.includes("FINAL_PRESS_PULL");
  const firstPersonPaper = documentForContext(props.request, props.cueId);
  const firstPersonPaperMode =
    props.cueId === DAY1_CUES.CATCH_SHEET ||
    (props.request?.kind === "MECHANIC" &&
      props.request.params.kind === "PRINT_JOB")
      ? "CATCH"
      : props.request?.kind === "MECHANIC" && props.request.params.kind === "SORT"
        ? "READ"
        : handoffPaper
          ? "PLACE"
        : props.request?.kind === "MECHANIC" &&
            (props.request.params.kind === "PLACE" ||
              props.request.params.kind === "POST_JOB")
          ? "PLACE"
          : "NONE";
  const basePlayerActorCue =
    choreography?.actors.find((actor) => actor.actorId === "PLAYER") ?? null;
  const holdPlayerAction =
    choreographyActive ||
    Boolean(props.choiceAnimation) ||
    props.request?.kind === "MECHANIC" ||
    props.request?.kind === "FOCUS_READ";
  const playerActorCue = holdPlayerAction && basePlayerActorCue
    ? {
        ...basePlayerActorCue,
        motion: props.choiceAnimation?.motion ?? basePlayerActorCue.motion,
      }
    : null;
  const onArrive = (targetId: string) => {
    if (activeChase) return;
    const crossesDoor =
      DOOR_TARGETS.has(targetId) ||
      (targetId === "STREET" && Boolean(interiorId));
    if (!crossesDoor) {
      props.onEvent({ type: "FREE_ROAM_GOTO", targetId });
      return;
    }
    if (doorTimer.current !== null) return;
    if (targetId !== "STREET") {
      const destination = Object.values(INTERIORS).find((def) =>
        doorwayForBuilding(def.buildingId)?.targetIds.includes(targetId),
      );
      if (destination) preloadInteriorAssets(destination);
    }
    apiRef.current?.setInputLocked(true);
    apiRef.current?.setInteractionClip(
      targetId === "STREET" ? "doorOpenOutward" : "doorOpenInward",
    );
    setDoorTarget(targetId);
    const delay = props.reducedMotion ? 220 : 1500;
    doorTimer.current = window.setTimeout(() => {
      props.onEvent({ type: "FREE_ROAM_GOTO", targetId });
      doorTimer.current = window.setTimeout(() => {
        doorTimer.current = null;
        setDoorTarget(null);
        apiRef.current?.setInteractionClip(null);
        apiRef.current?.setInputLocked(false);
      }, props.reducedMotion ? 0 : 450);
    }, delay);
  };
  const onSelect = (targetId: string) => {
    if (activeChase) return;
    if (props.request?.kind !== "FREE_ROAM" || props.request.selectedTargetId) return;
    props.onEvent({ type: "FREE_ROAM_SELECT", targetId });
  };
  // Explore-room threshold crossings: same door-swing beat as the errand
  // interiors, but purely presentational (no runtime event). The teleport is
  // deferred one beat past the interior-id swap: the Player's room clamp and
  // the exterior colliders trade places on the React commit, and teleporting
  // before the swap lands the body under the OLD movement regime (the room
  // clamp would drag an exit landing back inside the building's collider and
  // wedge it there).
  const crossExploreThreshold = (locId: string, direction: "IN" | "OUT") => {
    if (exploreTimer.current !== null || doorTimer.current !== null) return;
    const loc = EXPLORE_LOCATIONS[locId];
    if (!loc) return;
    if (direction === "IN") {
      const destination = interiorDef(locId);
      if (destination) preloadInteriorAssets(destination);
    }
    apiRef.current?.setInputLocked(true);
    apiRef.current?.setInteractionClip(
      direction === "IN" ? "doorOpenInward" : "doorOpenOutward",
    );
    setDoorTarget(direction === "IN" ? locId : "STREET");
    const delay = props.reducedMotion ? 200 : 1450;
    exploreTimer.current = window.setTimeout(() => {
      setVisualInteriorId(direction === "IN" ? locId : null);
      exploreTimer.current = window.setTimeout(() => {
        if (direction === "IN") {
          apiRef.current?.teleport(interiorLanding(loc.id), 0);
        } else {
          apiRef.current?.teleport(
            thresholdAnchorForLocation(loc, "OUTSIDE"),
            Math.PI + loc.faceY,
          );
        }
        exploreTimer.current = window.setTimeout(() => {
          exploreTimer.current = null;
          setDoorTarget(null);
          apiRef.current?.setInteractionClip(null);
          apiRef.current?.setInputLocked(false);
        }, props.reducedMotion ? 0 : 420);
      }, 90);
    }, delay);
  };
  const roamSelectedTargetId =
    props.request?.kind === "FREE_ROAM" ? props.request.selectedTargetId ?? null : null;
  useEffect(() => {
    if (!webglOk && props.cueId) props.onChoreographyReady(props.cueId);
  }, [webglOk, props.cueId, props.onChoreographyReady]);

  if (!webglOk) {
    return <div className="world-fallback">3D view unavailable on this device. Use the controls below to play.</div>;
  }

  return (
    <div
      ref={hostRef}
      className="world3d"
      data-game-root="world"
      data-qa-observability="m1-v1"
      data-location-id={locationId}
      data-interior-id={interiorId ?? ""}
      data-cue-id={props.cueId ?? ""}
      data-door-target={activeDoorTarget ?? ""}
      data-camera-shot={choreography?.camera?.shotId ?? ""}
      data-camera-active={choreographyCameraActive ? "true" : "false"}
      data-camera-owner={cameraOwnership.owner}
      data-camera-input-locked={String(cameraOwnership.inputLocked)}
      data-choreography-ready={props.choreographyReady ? "true" : "false"}
      data-field-space={activeSpaceId}
      data-movement-active={
        !props.movementLocked &&
        !cameraOwnership.inputLocked &&
        (props.request?.kind === "FREE_ROAM" || props.request?.kind === "BREATHER")
          ? "true"
          : "false"
      }
      data-traversal-active={
        !props.busy &&
        !props.movementLocked &&
        !interiorId &&
        !choreographyCameraActive &&
        (props.request?.kind === "FREE_ROAM" || props.request?.kind === "BREATHER")
          ? "true"
          : "false"
      }
    >
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ fov: 55, near: 0.1, far: 400, position: [-11, 2.6, 1.5] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <WorldServicesProvider value={worldServices}>
          <FieldClockDirector
            clockRef={fieldClockRef}
            tickRef={fieldTickRef}
            actors={actorRegistry}
            paused={fieldPaused}
          />
          {archiveTransit ? (
          <>
            <color attach="background" args={["#04090e"]} />
            <ambientLight intensity={0.15} color="#7ee3d8" />
          </>
        ) : (
          <>
            {/* scene fog is managed per-frame by SkyDirector's FogRig */}
            <District
              interiorId={interiorId}
              t={t}
              dusk={dusk}
              dockRouteUnlocked={dockRouteUnlocked}
              reducedMotion={props.reducedMotion}
              choreography={choreography}
              clock={districtClock}
              reactiveActorsActive={reactiveActorsActive}
            />
            <EventDirector
              cueId={props.cueId}
              interiorId={interiorId}
              dusk={dusk}
              lateDay={props.cueId === "BOS.MD01.CUE.WALK_TO_LIBERTY_TREE.v1"}
              reducedMotion={props.reducedMotion}
              present={props.present}
              postEvent={
                props.view?.objectives?.RETURN_TO_PRESS === "SELECTED" ||
                props.view?.objectives?.RETURN_TO_PRESS === "COMPLETED"
              }
            />
            <Player
              apiRef={apiRef}
              colliders={colliders}
              gameplayWorld={gameplayWorld}
              interiorCamera={activeInterior?.camera ?? null}
              disabled={
                Boolean(inspectOpen) ||
                props.movementLocked ||
                (props.request?.kind !== "FREE_ROAM" && props.request?.kind !== "BREATHER")
              }
              keyboardOnly={props.keyboardOnly}
              reducedMotion={props.reducedMotion}
              cameraOwner={cameraOwnership.owner}
              cameraControlledExternally={
                cameraOwnership.cameraControlledExternally
              }
              inputLocked={cameraOwnership.inputLocked}
              externalMovementYaw={cameraOwnership.externalMovementYaw}
              chaseActive={Boolean(activeChase)}
              timedDash={Boolean(timedDash)}
              staminaAssist={props.chaseAssist}
              stealthStore={props.stealthStore}
              actorCue={playerActorCue}
              mechanicPromptId={
                props.request?.kind === "MECHANIC" ? props.request.promptId : null
              }
              hidden={firstPersonActive && !headCamActive}
              headCam={headCamActive}
            />
            <WatcherDirector
              field={props.view!.field}
              apiRef={apiRef}
              active={
                props.request?.kind === "FREE_ROAM" &&
                !Boolean(activeChase) &&
                !Boolean(props.view?.field.activeInterrupt)
              }
              dayProgress={t}
              suspended={fieldPaused || choreographyCameraActive}
              qaHostRef={hostRef}
            />
            <ConfrontationInspectionRig
              active={
                props.view?.field.activeConfrontation?.phase === "INSPECTING"
              }
              reducedMotion={props.reducedMotion}
            />
            <ReleaseSceneDirector
              active={releaseSceneActive}
              apiRef={apiRef}
              reducedMotion={props.reducedMotion}
              onDone={() => setReleaseSceneActive(false)}
            />
            <RouteReminderDirector
              view={props.view ?? null}
              apiRef={apiRef}
              enabled={reactiveActorsActive && !releaseSceneActive}
            />
            <ChaseDirector
              chase={activeChase}
              field={props.view!.field}
              apiRef={apiRef}
              assist={props.chaseAssist}
              reducedMotion={props.reducedMotion}
              ownsCamera={cameraOwnership.owner === "CHASE"}
              suspended={
                choreographyCameraActive ||
                fieldPaused ||
                Boolean(
                  activeDoorTarget &&
                    activeDoorTarget !== "EXPLORE_tavern",
                )
              }
              onCameraYaw={setChaseCameraYaw}
              qaHostRef={hostRef}
            />
            <ReactiveNpcDirector
              view={props.view!}
              apiRef={apiRef}
              interactionRegistry={interactionRegistry}
              enabled={reactiveActorsActive}
              exchangesEnabled={exchangesEnabled}
              reducedMotion={props.reducedMotion}
            />
            <M4ContentDirector
              view={props.view!}
              apiRef={apiRef}
              interactionRegistry={interactionRegistry}
              enabled={reactiveActorsActive}
              exchangesEnabled={exchangesEnabled}
              reducedMotion={props.reducedMotion}
            />
            <TraversalDirector
              apiRef={apiRef}
              active={
                (props.request?.kind === "FREE_ROAM" || props.request?.kind === "BREATHER") &&
                !interiorId &&
                !inspectOpen &&
                !choreographyCameraActive
              }
              busy={props.busy || props.movementLocked}
              reducedMotion={props.reducedMotion}
              interactionRegistry={interactionRegistry}
              spaceId={activeSpaceId}
            />
            <InteractionDirector
              apiRef={apiRef}
              registry={interactionRegistry}
              enabled={
                // Traversal (climb/vault/duck) stays available during a chase;
                // other interrupts suppress contextual interactions. See
                // chaseFieldGating for the invariant + its regression test.
                contextualInteractionsAllowedDuringInterrupt(
                  props.view?.field.activeInterrupt?.kind,
                ) &&
                !inspectOpen &&
                !choreographyCameraActive &&
                (props.request?.kind === "FREE_ROAM" ||
                  props.request?.kind === "BREATHER")
              }
              busy={props.busy || props.movementLocked}
              reducedMotion={props.reducedMotion}
              highContrast={props.highContrast}
            />
            <FirstPersonCamera
              active={headCamActive}
              lookAt={choreography?.camera?.lookAt ?? null}
              apiRef={apiRef}
              reducedMotion={props.reducedMotion}
              hands={fpHands}
            />
            <FirstPersonDirector
              active={firstPersonRigActive}
              introActive={choreographyActive}
              motion={props.choiceAnimation?.motion ?? basePlayerActorCue?.motion ?? "IDLE"}
              paperMode={firstPersonPaperMode}
              paper={firstPersonPaper}
              reducedMotion={props.reducedMotion}
              headCam={headCamActive}
              hands={fpHands}
            />
            <MechanicRigs
              request={props.request}
              cueId={props.cueId}
              interiorId={interiorId}
              reducedMotion={props.reducedMotion}
              objectives={props.view?.objectives ?? null}
              playerApiRef={apiRef}
            />
            <FocusReadStaging
              request={props.request}
              interiorId={interiorId}
              apiRef={apiRef}
            />
            <DoorDirector
              activeTargetId={
                activeDoorTarget ??
                (props.cueId === DAY1_CUES.LEAVE_MERCER && !props.choreographyReady ? "STREET" : null)
              }
              interiorId={interiorId}
              reducedMotion={props.reducedMotion}
            />
            <EntryDirector
              animation={props.choiceAnimation}
              reducedMotion={props.reducedMotion}
              playerApiRef={apiRef}
              suspended={Boolean(interiorId)}
            />
            <QuestMarkerDirector
              markers={markers}
              selectedTargetId={roamSelectedTargetId}
              apiRef={apiRef}
              reducedMotion={props.reducedMotion}
              highContrast={props.highContrast}
              dusk={dusk}
              hudStore={hudStore}
              hostRef={hostRef}
              onSelect={onSelect}
            />
            <ExplorePortals
              apiRef={apiRef}
              interiorId={interiorId}
              enabled={
                !archiveTransit &&
                !runtimeLoc.interior &&
                !props.movementLocked &&
                !inspectOpen &&
                !doorTarget &&
                // A refuge door resolves the pursuit during a chase, so the
                // casual presentation portal must not fire then. See
                // chaseFieldGating for the invariant + its regression test.
                explorePortalsAllowedDuringChase(Boolean(activeChase)) &&
                (props.request?.kind === "FREE_ROAM" || props.request?.kind === "BREATHER")
              }
              onEnter={(locId) => crossExploreThreshold(locId, "IN")}
              onExit={(locId) => crossExploreThreshold(locId, "OUT")}
            />
            <QuestArrivalTracker
              markers={markers}
              apiRef={apiRef}
              busy={
                props.movementLocked ||
                Boolean(doorTarget) ||
                Boolean(activeChase)
              }
              selectedTargetId={roamSelectedTargetId}
              cueId={props.cueId}
              onArrive={onArrive}
              onSelect={onSelect}
            />
            <IdleRedirectTracker
              markers={markers}
              apiRef={apiRef}
              busy={
                props.busy ||
                Boolean(doorTarget) ||
                Boolean(activeChase)
              }
              selectedTargetId={roamSelectedTargetId}
              trackingKey={
                roamSelectedTargetId ? `${props.cueId ?? ""}|${roamSelectedTargetId}` : null
              }
              onIdle={() => props.onEvent({ type: "FREE_ROAM_IDLE" })}
            />
            <PlayerPosProbe
              apiRef={apiRef}
              hostRef={hostRef}
              actors={actorRegistry}
              stealthStore={props.stealthStore}
              field={props.view?.field ?? null}
              assist={props.chaseAssist}
            />
            {activeInterior && (
              <InteriorInspectDirector
                def={activeInterior}
                apiRef={apiRef}
                enabled={
                  qaInteriorOverride.current ||
                  (
                    !props.busy &&
                    !props.movementLocked &&
                    !doorTarget &&
                    !choreographyCameraActive &&
                    (props.request?.kind === "FREE_ROAM" ||
                      props.request?.kind === "BREATHER")
                  )
                }
                open={Boolean(inspectOpen)}
                onOpen={setInspectOpen}
                interactionRegistry={interactionRegistry}
                spaceId={activeSpaceId}
              />
            )}
            <AudioDirector
              apiRef={apiRef}
              clock={districtClock}
              interiorId={interiorId}
              dusk={dusk}
            />
          </>
        )}
          <ChoreographyDirector
            cueId={props.cueId}
            cue={choreography}
            cameraActive={choreographyCameraActive}
            reducedMotion={props.reducedMotion}
            onReady={props.onChoreographyReady}
          />
        </WorldServicesProvider>
      </Canvas>
      {!archiveTransit && <QuestMarkerHud store={hudStore} />}
      {inspectOpen && (
        <ContextInspectCard
          hotspot={inspectOpen}
          onClose={() => completeInteriorInspect(inspectOpen)}
        />
      )}
      {!archiveTransit && (
        <div className="world-hint">
          WASD / arrows walk · Shift sprint · Space jump · Shift+Space running jump · C crouch · F interact
          {props.keyboardOnly ? " · use the action controls to choose" : " · drag to look · walk into a marker to choose"}
        </div>
      )}
      <div className="scene-transition" aria-hidden="true" />
    </div>
  );
}
