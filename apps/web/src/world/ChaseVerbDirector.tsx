import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ChaseRecord } from "@pa/contracts";
import type { PlayerApi } from "./Player.js";
import { useWorldServices } from "./WorldServicesContext.js";
import { FittedGlb } from "./Character.js";
import { AnimatedDoor, type RenderDoor } from "./DoorDirector.js";
import {
  DOOR_LEAF_CLEAR_HEIGHT,
  DOOR_LEAF_CLEAR_WIDTH,
} from "./doorwayContract.js";
import {
  CHASE_TOPPLE_STACKS,
  TAVERN_CUT,
  chaseVerbsAvailable,
  eligibleToppleStacks,
  tavernCutEligible,
  tavernCutObstacle,
  toppleObstacle,
  type ChaseToppleStack,
  type ChaseVerbContext,
} from "./chaseVerbs.js";
import type { ChaseObstacleEvent } from "./chaseModel.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "./interactionRegistry.js";
import { dispatchPresentationNotice } from "../presenter/noticeArbiter.js";
import { ambientAudio } from "./ambientAudio.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

const SOURCE_ID = "CHASE_VERB";
const PURSUER_ID = "M1_PURSUER";
const SEEN_RANGE_M = 15;

// ---------------------------------------------------------------------------
// ChaseVerbDirector (design1 feature 1): registers the two mid-chase context
// actions as chase-priority interaction candidates, commits their
// consequences, and renders their imported-asset staging (the tipped stack
// re-render + the tavern back-door kit). The chase sim consumes the committed
// obstacle log via ChaseDirector -> stepChase, so all pursuer behavior stays
// inside the deterministic chase model.
// ---------------------------------------------------------------------------
export function ChaseVerbDirector(props: {
  chase: ChaseRecord | null;
  apiRef: { current: PlayerApi | null };
  interactionRegistry: InteractionRegistry;
  /** Session-durable topple state (owned by World3D; also hides the static prop). */
  toppledStackIds: readonly string[];
  onToppleStack: (stackId: string) => void;
  /** Committed obstacle log the ChaseDirector feeds into stepChase. */
  obstaclesRef: { current: ChaseObstacleEvent[] };
  reducedMotion: boolean;
  qaHostRef: { current: HTMLDivElement | null };
}) {
  const services = useWorldServices();
  const [backDoorOpen, setBackDoorOpen] = useState(false);
  const [transitActive, setTransitActive] = useState(false);
  const usedCutChaseIds = useRef(new Set<string>());
  const transitTimers = useRef<number[]>([]);
  const chaseIdRef = useRef<string | null>(null);

  // The obstacle log is scoped to one chase: stumbles come only from actions
  // committed during the live pursuit.
  useEffect(() => {
    const chaseId = props.chase?.chaseId ?? null;
    if (chaseIdRef.current !== chaseId) {
      chaseIdRef.current = chaseId;
      props.obstaclesRef.current = [];
      setBackDoorOpen(false);
    }
  }, [props.chase, props.obstaclesRef]);

  useEffect(
    () => () => {
      for (const timer of transitTimers.current) window.clearTimeout(timer);
      props.interactionRegistry.clearSource(SOURCE_ID);
    },
    [props.interactionRegistry],
  );

  const toppledSet = useMemo(
    () => new Set(props.toppledStackIds),
    [props.toppledStackIds],
  );

  const verbContext = (): ChaseVerbContext => ({
    chaseActive: props.chase !== null,
    chasePhase: services.stealthStore.getSnapshot().chaseState,
    spaceId: services.spaceId,
    toppledStackIds: toppledSet,
    usedTavernCutChaseIds: usedCutChaseIds.current,
    chaseId: props.chase?.chaseId ?? null,
  });

  const pursuerSeesPlayer = (): boolean => {
    const player = props.apiRef.current;
    const pursuer = services.actors.get(PURSUER_ID);
    if (!player || !pursuer || pursuer.spaceId !== services.spaceId) {
      return false;
    }
    const gap = Math.hypot(
      pursuer.position.x - player.position.x,
      pursuer.position.z - player.position.z,
    );
    if (gap > SEEN_RANGE_M) return false;
    return services.gameplayWorld.segmentClear(
      {
        x: pursuer.position.x,
        y: pursuer.position.y + 1.35,
        z: pursuer.position.z,
      },
      {
        x: player.position.x,
        y: player.position.y + 1.35,
        z: player.position.z,
      },
    );
  };

  const activateTopple = (stack: ChaseToppleStack): boolean => {
    const ctx = verbContext();
    if (!chaseVerbsAvailable(ctx) || toppledSet.has(stack.id)) return false;
    const tick = services.fieldTickRef.current;
    props.obstaclesRef.current = [
      ...props.obstaclesRef.current,
      toppleObstacle(stack, tick),
    ];
    props.onToppleStack(stack.id);
    props.apiRef.current?.setInteractionClip("reach");
    window.setTimeout(
      () => props.apiRef.current?.setInteractionClip(null),
      props.reducedMotion ? 80 : 420,
    );
    dispatchPresentationNotice({
      id: `chase-verb:topple:${stack.id}`,
      kind: "CHASE",
      text:
        stack.glb === "barrel-group"
          ? "You shoulder the barrels over — the street behind you is rolling staves."
          : "You drag the crates down behind you.",
      cooldownMs: 4_000,
      durationMs: 2_000,
      captions: true,
    });
    return true;
  };

  const activateTavernCut = (): boolean => {
    const ctx = verbContext();
    const chase = props.chase;
    const player = props.apiRef.current;
    if (!chase || !player || !tavernCutEligible(ctx) || transitActive) {
      return false;
    }
    usedCutChaseIds.current.add(chase.chaseId);
    const seen = pursuerSeesPlayer();
    const tick = services.fieldTickRef.current;
    props.obstaclesRef.current = [
      ...props.obstaclesRef.current,
      tavernCutObstacle(tick, seen),
    ];
    setTransitActive(true);
    setBackDoorOpen(true);
    player.setInputLocked(true);
    player.setInteractionClip("doorOpenInward");
    ambientAudio.playOneShot("door-creak", 0.55);
    const transitMs = props.reducedMotion
      ? 120
      : TAVERN_CUT.transitSeconds * 1000;
    transitTimers.current.push(
      window.setTimeout(() => {
        // Cross the leaf exactly like every other threshold beat: the
        // teleport hard-places the camera so it never sweeps through the
        // building shell.
        player.teleport(
          [TAVERN_CUT.frontExit[0], 0, TAVERN_CUT.frontExit[2]],
          TAVERN_CUT.frontFaceY,
        );
        ambientAudio.playOneShot("door-creak", 0.4);
        dispatchPresentationNotice({
          id: `chase-verb:tavern-cut:${chase.chaseId}`,
          kind: "CHASE",
              text: seen
            ? "Through the taproom and out the front — but he watched you go in, and the house knows your face now."
            : "Through the taproom and out the front. The street behind you is empty of him.",
          cooldownMs: 8_000,
          durationMs: 2_600,
          captions: true,
        });
        if (seen) {
          // Durable, replay-safe consequence of being watched into the door:
          // the watch remembers the runner, and the taproom talks.
          void services.submitFieldEvent({
            type: "FIELD_IDENTITY_CHANGED",
            eventId: `${chase.chaseId}_TAVERN_CUT_SEEN_IDENTITY`,
            interruptId: chase.interruptId,
            recognized: true,
            reason: "tavern-cut-seen",
          });
          void services.submitFieldEvent({
            type: "FIELD_STANDING_DELTA",
            eventId: `${chase.chaseId}_TAVERN_CUT_SEEN_STANDING`,
            interruptId: chase.interruptId,
            delta: -1,
            causeId: `TAVERN_CUT_SEEN_${chase.chaseId}`,
          });
        }
      }, transitMs),
    );
    transitTimers.current.push(
      window.setTimeout(
        () => {
          player.setInteractionClip(null);
          player.setInputLocked(false);
          setTransitActive(false);
          setBackDoorOpen(false);
        },
        transitMs + (props.reducedMotion ? 60 : 420),
      ),
    );
    if (QA_RUNTIME_ENABLED && props.qaHostRef.current) {
      props.qaHostRef.current.dataset.tavernCut = seen ? "SEEN" : "UNSEEN";
    }
    return true;
  };

  useFrame(() => {
    props.interactionRegistry.clearSource(SOURCE_ID);
    const ctx = verbContext();
    if (QA_RUNTIME_ENABLED && props.qaHostRef.current) {
      const host = props.qaHostRef.current;
      host.dataset.chaseTopples = props.toppledStackIds.join(",");
      host.dataset.chaseVerbState = [
        ctx.chaseActive ? "chase" : "idle",
        ctx.chasePhase,
        ctx.spaceId,
        transitActive ? "transit" : "free",
      ].join("|");
    }
    if (!chaseVerbsAvailable(ctx) || transitActive) return;
    for (const stack of eligibleToppleStacks(ctx)) {
      props.interactionRegistry.upsert({
        id: `${SOURCE_ID}:TOPPLE:${stack.id}`,
        sourceId: SOURCE_ID,
        kind: "CHASE_VERB",
        label:
          stack.glb === "barrel-group"
            ? "Topple the barrels"
            : "Pull the crates down",
        priority: INTERACTION_PRIORITIES.CHASE_VERB,
        spaceId: "EXTERIOR",
        position: stack.pos,
        radius: stack.reachM,
        facingDot: -1,
        losRequired: false,
        enabled: true,
        activate: () => activateTopple(stack),
      });
    }
    if (tavernCutEligible(ctx)) {
      props.interactionRegistry.upsert({
        id: `${SOURCE_ID}:TAVERN_CUT`,
        sourceId: SOURCE_ID,
        kind: "CHASE_VERB",
        label: "Cut through the tavern",
        priority: INTERACTION_PRIORITIES.CHASE_VERB,
        spaceId: "EXTERIOR",
        position: TAVERN_CUT.backEntry,
        radius: TAVERN_CUT.reachM,
        facingDot: -1,
        losRequired: false,
        enabled: true,
        activate: activateTavernCut,
      });
    }
  });

  const backDoor: RenderDoor = useMemo(
    () => ({
      doorId: "CHASE_TAVERN_BACK_DOOR",
      targetIds: [],
      leafCenter: [
        TAVERN_CUT.backDoorLeaf[0],
        TAVERN_CUT.backDoorLeaf[1],
        TAVERN_CUT.backDoorLeaf[2],
      ],
      yaw: TAVERN_CUT.backDoorYaw,
      clearWidth: DOOR_LEAF_CLEAR_WIDTH,
      clearHeight: DOOR_LEAF_CLEAR_HEIGHT,
      trim: "imported-frame",
      direction: "INWARD",
    }),
    [],
  );

  return (
    <group>
      {/* The tavern's alley door is a real imported door-kit leaf, present
          whether or not a chase is live (a door is part of the building, not
          a power-up); it only ANIMATES during the cut. */}
      {services.spaceId === "EXTERIOR" && (
        <AnimatedDoor
          door={backDoor}
          open={backDoorOpen}
          reducedMotion={props.reducedMotion}
        />
      )}
      {services.spaceId === "EXTERIOR" &&
        CHASE_TOPPLE_STACKS.filter((stack) => toppledSet.has(stack.id)).map(
          (stack) => (
            <ToppledStack
              key={stack.id}
              stack={stack}
              reducedMotion={props.reducedMotion}
            />
          ),
        )}
    </group>
  );
}

// The same imported stack GLB, re-rendered tipped onto its side. The static
// batched instance is hidden (District Props3D filter) the moment the stack
// topples, so exactly one copy of the asset is ever visible. The visual mass
// settles toward the row wall (away from the lane centre) while the gameplay
// spill — passable, stumble-inducing — covers the lane itself.
function ToppledStack(props: {
  stack: ChaseToppleStack;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const startedAt = useRef<number | null>(null);
  const TIP_SECONDS = 0.45;
  const TIP_ANGLE = 1.28;
  // Tip away from the lane centre: for street stacks (|z| < 12) that is
  // toward the nearer row; for alley stacks toward the alley back wall.
  const wallward = props.stack.pos[2] >= 0 ? 1 : -1;
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    if (startedAt.current === null) startedAt.current = clock.elapsedTime;
    const raw = props.reducedMotion
      ? 1
      : Math.min(1, (clock.elapsedTime - startedAt.current) / TIP_SECONDS);
    const eased = 1 - (1 - raw) * (1 - raw);
    g.rotation.x = TIP_ANGLE * eased * wallward;
    g.position.y = Math.sin(eased * Math.PI) * 0.12 - eased * 0.5;
    g.position.z = eased * 0.75 * wallward;
  });
  return (
    <group position={[props.stack.pos[0], 0, props.stack.pos[2]]}>
      {/* world-space tip/settle wrapper; the imported asset keeps its
          authored yaw inside */}
      <group ref={group}>
        <group rotation={[0, props.stack.rotY, 0]}>
          <FittedGlb
            glbKey={props.stack.glb}
            size={[2.6, 2.6, 2.6]}
            fallback={null}
          />
        </group>
      </group>
    </group>
  );
}
