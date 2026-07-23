// ---------------------------------------------------------------------------
// ExchangeInterruptDirector (refactor wave 2): the single exchange-interrupt
// surface. Composes the unified engine (useExchangeInterrupt), the registered
// content's cast/figure staging, the interaction-candidate hand-off, and the
// one clamped exchange panel. Replaces the engine + staging halves of
// ReactiveNpcDirector (stage A) and M4ContentDirector (stage B).
//
// All authored content (copy, anchors, gating) lives in world/content/
// modules; this file is a generic renderer over that data.
// ---------------------------------------------------------------------------

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { RuntimeView } from "@pa/contracts";
import { FittedGlb, RiggedCharacter } from "../Character.js";
import type { PlayerApi } from "../Player.js";
import { actorRoutePose } from "../actorRoutes.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "../interactionRegistry.js";
import {
  REACTIVE_NAMED_CAST,
  type ReactiveActorDefinition,
} from "../reactiveManifest.js";
import { useWorldServices } from "../WorldServicesContext.js";
import { clampedPanelPosition } from "../panelPlacement.js";
import {
  DAY1_FIGURES,
  day1ExchangeFrame,
  DOCK_BARREL_STAGING,
  type Day1FigureDefinition,
} from "../content/day1Exchanges.js";
import { useExchangeInterrupt } from "./useExchangeInterrupt.js";
import type { ExchangeInterruptApi } from "./useExchangeInterrupt.js";

// Registry grouping key for the figure/side-job candidates below (the named
// cast registers per-rig under REACTIVE:<id>, matching the legacy director).
const FIGURE_CANDIDATE_SOURCE = "REACTIVE_FIGURES";

function figureClip(
  figure: Day1FigureDefinition,
  activeSourceId: string | undefined,
): string {
  return activeSourceId && figure.talkSourceIds.includes(activeSourceId)
    ? "talk"
    : figure.workClip;
}

// Route-posed named-cast rig: owns its actor-registry entry and its own
// per-rig interaction candidate; engagement hands the source id to the
// unified engine.
function ReactiveCastRig(props: {
  definition: ReactiveActorDefinition;
  fieldSeed: number;
  registry: InteractionRegistry;
  enabled: boolean;
  offerEnabled: boolean;
  onEngage: (sourceId: string) => void;
}) {
  const services = useWorldServices();
  const group = useRef<THREE.Group>(null);
  const owner = useRef({});
  const renderPose = actorRoutePose(
    props.definition.id,
    services.spaceId,
    services.fieldTickRef.current,
    props.fieldSeed,
  );
  useEffect(
    () => () => {
      services.actors.remove(props.definition.id);
      props.registry.clearSource(`REACTIVE:${props.definition.id}`);
    },
    [props.definition.id, props.registry, services.actors],
  );
  useFrame(() => {
    const source = `REACTIVE:${props.definition.id}`;
    props.registry.clearSource(source);
    const pose = actorRoutePose(
      props.definition.id,
      services.spaceId,
      services.fieldTickRef.current,
      props.fieldSeed,
    );
    const root = group.current;
    if (!root || !pose || !props.enabled) {
      if (root) root.visible = false;
      services.actors.remove(props.definition.id);
      return;
    }
    root.visible = true;
    root.position.set(...pose.position);
    root.rotation.y = pose.yaw;
    // Reactive ownership is authoritative whenever this director is enabled.
    // Clear a retiring scripted sample from the same render tick before
    // publishing so exterior/interior swaps never expose two owners.
    services.actors.remove(props.definition.id);
    services.actors.publish({
      id: props.definition.id,
      kind: "DIRECTED_NPC",
      spaceId: services.spaceId,
      position: root.position,
      forwardVec: { x: Math.sin(pose.yaw), y: 0, z: Math.cos(pose.yaw) },
      velocity: pose.moving
        ? { x: Math.sin(pose.yaw) * 0.8, y: 0, z: Math.cos(pose.yaw) * 0.8 }
        : null,
      tick: services.fieldTickRef.current,
      owner: owner.current,
    });
    props.registry.upsert({
      id: `NPC:${props.definition.id}`,
      sourceId: source,
      kind: "NPC",
      label: props.definition.prompt,
      priority: INTERACTION_PRIORITIES.STORY_NPC,
      spaceId: services.spaceId,
      position: pose.position,
      radius: 2.15,
      facingDot: -0.1,
      losRequired: true,
      enabled: props.enabled && props.offerEnabled,
      activate: () => {
        props.onEngage(`NPC-${props.definition.id}`);
        return true;
      },
    });
  }, -2);
  return (
    <group ref={group}>
      <RiggedCharacter
        glbKey={props.definition.glb}
        height={props.definition.height}
        clip={renderPose?.moving ? "walk" : "idle"}
      />
    </group>
  );
}

// Generic staged carried-prop rig (the imported dock barrel): rides the
// player through the carry stages, rests at its authored drop point during
// the hand-off stage, hidden otherwise.
function CarriedStagePropRig(props: {
  stage: RuntimeView["field"]["activities"][typeof DOCK_BARREL_STAGING.activityId]["stage"];
  apiRef: { current: PlayerApi | null };
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const root = group.current;
    if (!root) return;
    if (
      (DOCK_BARREL_STAGING.carryStages as readonly string[]).includes(
        props.stage,
      )
    ) {
      const player = props.apiRef.current;
      if (!player) {
        root.visible = false;
        return;
      }
      root.visible = true;
      root.position.set(
        player.position.x +
          player.motion.facingX * DOCK_BARREL_STAGING.carryForwardM,
        player.position.y + DOCK_BARREL_STAGING.carryLiftM,
        player.position.z +
          player.motion.facingZ * DOCK_BARREL_STAGING.carryForwardM,
      );
      root.rotation.y = player.facingY;
      return;
    }
    if (props.stage === DOCK_BARREL_STAGING.restStage) {
      root.visible = true;
      root.position.set(...DOCK_BARREL_STAGING.restPosition);
      return;
    }
    root.visible = false;
  });
  return (
    <group ref={group} visible={false}>
      <FittedGlb
        glbKey={DOCK_BARREL_STAGING.glbKey}
        size={[...DOCK_BARREL_STAGING.size]}
        fallback={null}
      />
    </group>
  );
}

function ExchangePanel(props: {
  engine: ExchangeInterruptApi;
}) {
  const { exchange, reply, replyChips, committing, finish, dismiss } =
    props.engine;
  if (!exchange) return null;
  return (
    <Html
      position={[
        exchange.position[0],
        exchange.position[1] + 2,
        exchange.position[2],
      ]}
      center
      occlude={false}
      zIndexRange={[...exchange.engine.panelZRange]}
      calculatePosition={clampedPanelPosition}
    >
      <section
        className="reactive-exchange"
        role="dialog"
        aria-label={exchange.title}
      >
        <header>{exchange.title}</header>
        <p>{reply ?? exchange.line}</p>
        {reply && replyChips.length > 0 && (
          <div className="exchange-effect-chips" role="status">
            {replyChips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        )}
        {!reply && (
          <div className="reactive-exchange-choices">
            {exchange.choices.slice(0, 3).map((choice, index) => (
              <button
                key={choice.id}
                type="button"
                disabled={committing}
                onClick={() => void finish(choice)}
              >
                <kbd>{index + 1}</kbd> {choice.label}
              </button>
            ))}
            {exchange.engine.dismissButton && (
              <button
                type="button"
                className="exchange-dismiss"
                disabled={committing}
                onClick={() => void dismiss()}
              >
                <kbd>ESC</kbd> Step away
              </button>
            )}
          </div>
        )}
      </section>
    </Html>
  );
}

export function ExchangeInterruptDirector(props: {
  view: RuntimeView;
  apiRef: { current: PlayerApi | null };
  interactionRegistry: InteractionRegistry;
  enabled: boolean;
  // Exchanges commit field interrupts, which the runtime accepts only during
  // FREE_ROAM. When false the cast renders but offers no exchange prompts.
  exchangesEnabled?: boolean;
  reducedMotion: boolean;
}) {
  const services = useWorldServices();
  const engine = useExchangeInterrupt({
    view: props.view,
    apiRef: props.apiRef,
    enabled: props.enabled,
    exchangesEnabled: props.exchangesEnabled,
    reducedMotion: props.reducedMotion,
  });
  const { exchange, begin } = engine;
  const owner = useRef(new Map<string, object>());
  const figureRefs = useRef(new Map<string, THREE.Group>());

  useEffect(
    () => () => {
      props.interactionRegistry.clearSource(FIGURE_CANDIDATE_SOURCE);
      for (const id of ["ned", "sarah", "dockhand-m3"]) {
        services.actors.remove(id);
      }
    },
    [props.interactionRegistry, services.actors],
  );

  useFrame(() => {
    props.interactionRegistry.clearSource(FIGURE_CANDIDATE_SOURCE);
    const tick = services.fieldTickRef.current;
    if (!props.enabled) return;
    const frame = day1ExchangeFrame(props.view, services.spaceId);
    for (const figure of frame.figures) {
      const group = figureRefs.current.get(figure.id);
      if (!figure.position) {
        if (group) {
          group.visible = false;
          services.actors.remove(figure.id);
        }
        continue;
      }
      if (!group) continue;
      group.visible = true;
      group.position.set(...figure.position);
      let token = owner.current.get(figure.id);
      if (!token) {
        token = {};
        owner.current.set(figure.id, token);
      }
      services.actors.publish({
        id: figure.id,
        kind: figure.kind,
        spaceId: services.spaceId,
        position: group.position,
        forwardVec: { x: 0, y: 0, z: 1 },
        tick,
        owner: token,
      });
    }
    if (engine.offersOpen) {
      for (const candidate of frame.candidates) {
        props.interactionRegistry.upsert({
          id: candidate.id,
          sourceId: FIGURE_CANDIDATE_SOURCE,
          kind: candidate.kind,
          label: candidate.label,
          priority: candidate.priority,
          spaceId: candidate.spaceId,
          position: candidate.position,
          radius: candidate.radius,
          facingDot: candidate.facingDot,
          losRequired: candidate.losRequired,
          enabled: true,
          activate: () => {
            void begin(candidate.sourceId);
            return true;
          },
        });
      }
    }
  }, -2);

  return (
    <group>
      {REACTIVE_NAMED_CAST.map((definition) => (
        <ReactiveCastRig
          key={definition.id}
          definition={definition}
          fieldSeed={engine.fieldSeed}
          registry={props.interactionRegistry}
          enabled={props.enabled && !exchange}
          offerEnabled={props.exchangesEnabled !== false && !exchange}
          onEngage={(sourceId) => void begin(sourceId)}
        />
      ))}
      {DAY1_FIGURES.map((figure) => (
        <group
          key={figure.id}
          ref={(node) => {
            if (node) figureRefs.current.set(figure.id, node);
          }}
          rotation={[0, figure.rotationY ?? 0, 0]}
        >
          <RiggedCharacter
            glbKey={figure.glb}
            height={figure.height}
            clip={figureClip(figure, exchange?.sourceId)}
            tint={figure.tint}
          />
        </group>
      ))}
      <CarriedStagePropRig
        stage={
          props.view.field.activities[DOCK_BARREL_STAGING.activityId].stage
        }
        apiRef={props.apiRef}
      />
      <ExchangePanel engine={engine} />
    </group>
  );
}
