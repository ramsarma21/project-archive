import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
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
import { choreographyFor } from "./choreography.js";
import type { ChoiceAnimation } from "./choiceAnimations.js";
import { documentForContext } from "./documentTextures.js";
import { FirstPersonDirector } from "./FirstPersonDirector.js";
import {
  FirstPersonCamera,
  createFirstPersonHands,
  headCamBeat,
} from "./FirstPersonCamera.js";
import { EventDirector } from "./EventDirector.js";
import { StreetEndingDirector } from "./StreetEndingDirector.js";
import { MechanicRigs } from "./MechanicRigs.js";
import { DoorDirector } from "./DoorDirector.js";
import { EntryDirector, useEntryDoorTarget } from "./EntryDirector.js";
import { TraversalDirector } from "./TraversalDirector.js";
import { InteractionDirector } from "./InteractionDirector.js";
import { createInteractionRegistry } from "./interactionRegistry.js";
import { ExchangeInterruptDirector } from "./exchange/ExchangeInterruptDirector.js";
import { INTERIOR_HOTSPOT_MICROS } from "./reactiveManifest.js";
import { traversalBlockerColliders } from "./traversalMarkers.js";
import { LOCATIONS, exteriorColliders } from "./manifest.js";
import { doorAwareBuildingColliders } from "./doorwayContract.js";
import {
  interiorDef,
  type InteriorInspectHotspotDef,
} from "./interiorManifest.js";
import { buildInteriorCollisionWorld } from "./interiorCollision.js";
import { InteriorInspectDirector } from "./InteriorInspectDirector.js";
import { ContextInspectCard } from "../presenter/ContextInspectCard.js";
import { QuestMarkerDirector, type ResolvedQuestMarker } from "./QuestMarkerDirector.js";
import {
  QuestMarkerHud,
  createQuestMarkerHudStore,
} from "./QuestMarkerHud.js";
import { createActorRegistry, type ActorRegistry } from "./actorRegistry.js";
import type { PresenterSpatialState } from "../db.js";
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
import { ChaseVerbDirector } from "./ChaseVerbDirector.js";
import type { ChaseObstacleEvent } from "./chaseModel.js";
import { toppleStackPropKeys } from "./chaseVerbs.js";
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
import { useSmoothedNumber } from "./hooks/useSmoothedNumber.js";
import { PlayerPosProbe } from "./qa/QaProbes.js";
import { useQaDoorHooks } from "./qa/QaDoorHooks.js";
import { ExplorePortals } from "./portals/ExplorePortals.js";
import {
  stepThresholdPlacement,
  type PendingThresholdPlacement,
} from "./portals/thresholdPlacement.js";
import {
  arriveWithDoorBeat,
  crossExploreThresholdBeat,
  type DoorBeatContext,
} from "./portals/doorBeat.js";
import { IdleRedirectTracker } from "./quest/IdleRedirectTracker.js";
import { QuestArrivalTracker } from "./quest/QuestArrivalTracker.js";
import { resolveQuestMarkers } from "./quest/resolveMarkers.js";
import { TIMED_RUN_TARGETS } from "./content/day1Ids.js";
import { FocusReadStaging } from "./content/day1ReadStaging.js";
// Registers the Day-1 mechanic body stagings into the Player's
// MechanicBodyStaging seam (content wiring belongs to the shell).
import "./content/day1MechanicStaging.js";

const ACTOR_STALE_AGE_TICKS = 30;

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

// Mirrors the live player transform into the presenter spatial snapshot that
// is persisted with every save (feel-audit-1 P0-11). Presentation-only.
function SpatialSnapshotProbe(props: {
  apiRef: { current: PlayerApi | null };
  sinkRef: MutableRefObject<PresenterSpatialState | null> | undefined;
  interiorId: string | null;
  runtimeLocationId: string;
  enabled: boolean;
}) {
  const lastWriteAt = useRef(0);
  useFrame(() => {
    if (!props.sinkRef || !props.enabled) return;
    const now = performance.now();
    if (now - lastWriteAt.current < 400) return;
    lastWriteAt.current = now;
    const api = props.apiRef.current;
    if (!api) return;
    props.sinkRef.current = {
      pos: [api.position.x, api.position.y, api.position.z],
      yaw: api.facingY,
      interiorId: props.interiorId,
      locationId: props.runtimeLocationId,
    };
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
  // Committed presenter-event count (see WorldServices.committedEventCount).
  committedEventCount?: () => number;
  // True while any DOM overlay owns the center of the screen (primer cards,
  // day-end, debrief): world-anchored HUD labels hide (feel-audit-1 P1-7).
  overlayActive?: boolean;
  // Presenter spatial restore point from the loaded save (feel-audit-1
  // P0-11), applied once at spawn when it matches the resumed context.
  restoreSpatial?: PresenterSpatialState | null;
  // Live snapshot sink persisted with each save.
  spatialSnapshotRef?: MutableRefObject<PresenterSpatialState | null>;
  onChoreographyReady: (cueId: string) => void;
  onWebglStatus: (available: boolean) => void;
  // Returns whether the runtime accepted the event (see Play.onEvent); the
  // arrival tracker retries dropped commits instead of latching.
  onEvent: (ev: PresenterEvent) => void | Promise<boolean>;
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
  // Chase context verbs (design1 feature 1): toppled stacks stay down for the
  // whole session; the committed obstacle log feeds the deterministic chase
  // sim through ChaseDirector.
  const [toppledStackIds, setToppledStackIds] = useState<string[]>([]);
  const chaseObstaclesRef = useRef<ChaseObstacleEvent[]>([]);
  const toppledPropKeys = useMemo(
    () => toppleStackPropKeys(toppledStackIds),
    [toppledStackIds],
  );
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
        toppledPropKeys,
      ),
      ...traversalBlockerColliders(),
    ],
    [activeDoorTarget, dockRouteUnlocked, toppledPropKeys],
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
  useQaDoorHooks({
    apiRef,
    doorTimer,
    exploreTimer,
    qaInteriorOverride,
    setDoorTarget,
    setVisualInteriorId,
  });

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
  // The pending-threshold state machine itself is pure and unit-tested
  // (portals/thresholdPlacement.ts); this effect owns the refs and retry
  // timer and interprets one step per run.
  const pendingThresholdPlacement = useRef<PendingThresholdPlacement | null>(
    null,
  );
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
      const step = stepThresholdPlacement({
        pending: pendingThresholdPlacement.current,
        spawned: spawned.current,
        visualInteriorId,
        runtimeLoc,
        qaInteriorOverride: qaInteriorOverride.current,
        restoreSpatial: props.restoreSpatial,
      });
      pendingThresholdPlacement.current = step.pending;
      spawned.current = step.spawned;
      if (step.action === "TELEPORT") {
        api.teleport(step.position, step.faceY);
      } else if (step.action === "SWAP_INTERIOR") {
        setVisualInteriorId(step.interiorId);
      }
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [archiveTransit, runtimeLoc, visualInteriorId, props.restoreSpatial]);

  // Marker resolution is pure and unit-tested (quest/resolveMarkers.ts); the
  // memo only pins it to the same dependency triple as before.
  const markers: ResolvedQuestMarker[] = useMemo(
    () =>
      resolveQuestMarkers({
        request: props.request,
        hasActiveInterrupt: Boolean(props.view?.field.activeInterrupt),
        interiorId,
      }),
    [props.request, props.view?.field.activeInterrupt, interiorId],
  );

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
      committedEventCount: props.committedEventCount ?? (() => 0),
    }),
    [
      activeSpaceId,
      actorRegistry,
      gameplayWorld,
      props.onFieldEvent,
      props.committedEventCount,
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
  // Head-camera first person (docs/engine/Production.md §2A): the staged player body
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
  // Both arrival handlers resolve with whether the runtime ACCEPTED the
  // commit; the arrival tracker retries dropped commits instead of latching
  // (P0-6). The door-swing/threshold timer choreography lives in
  // portals/doorBeat.ts; the context is rebuilt per render so each call sees
  // exactly the values the old inline closures captured.
  const doorBeatCtx: DoorBeatContext = {
    apiRef,
    doorTimer,
    exploreTimer,
    setDoorTarget,
    setVisualInteriorId,
    reducedMotion: props.reducedMotion,
    interiorId,
    activeChase: Boolean(activeChase),
    onEvent: props.onEvent,
  };
  const onArrive = (targetId: string): Promise<boolean> =>
    arriveWithDoorBeat(doorBeatCtx, targetId);
  const onSelect = async (targetId: string): Promise<boolean> => {
    if (activeChase) return false;
    if (props.request?.kind !== "FREE_ROAM" || props.request.selectedTargetId) {
      return false;
    }
    const accepted = await props.onEvent({ type: "FREE_ROAM_SELECT", targetId });
    return accepted !== false;
  };
  const crossExploreThreshold = (locId: string, direction: "IN" | "OUT") =>
    crossExploreThresholdBeat(doorBeatCtx, locId, direction);
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
              hiddenPropKeys={toppledPropKeys}
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
            <StreetEndingDirector
              view={props.view ?? null}
              interiorId={interiorId}
              present={props.present}
              reducedMotion={props.reducedMotion}
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
              obstaclesRef={chaseObstaclesRef}
              onCameraYaw={setChaseCameraYaw}
              qaHostRef={hostRef}
            />
            <ChaseVerbDirector
              chase={activeChase}
              apiRef={apiRef}
              interactionRegistry={interactionRegistry}
              toppledStackIds={toppledStackIds}
              onToppleStack={(stackId) =>
                setToppledStackIds((ids) =>
                  ids.includes(stackId) ? ids : [...ids, stackId],
                )
              }
              obstaclesRef={chaseObstaclesRef}
              reducedMotion={props.reducedMotion}
              qaHostRef={hostRef}
            />
            <ExchangeInterruptDirector
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
            <SpatialSnapshotProbe
              apiRef={apiRef}
              sinkRef={props.spatialSnapshotRef}
              interiorId={interiorId}
              runtimeLocationId={runtimeLocationId}
              enabled={spawned.current && !archiveTransit}
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
              hunted={
                props.view?.field.heat.band === "HUNTED" ||
                Boolean(activeChase)
              }
              reducedMotion={props.reducedMotion}
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
      {!archiveTransit && (
        <QuestMarkerHud
          store={hudStore}
          hidden={
            props.busy ||
            Boolean(props.overlayActive) ||
            (props.request?.kind !== "FREE_ROAM" &&
              props.request?.kind !== "BREATHER") ||
            Boolean(
              props.view?.field.activeInterrupt &&
                props.view.field.activeInterrupt.kind !== "CHASE",
            )
          }
        />
      )}
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
