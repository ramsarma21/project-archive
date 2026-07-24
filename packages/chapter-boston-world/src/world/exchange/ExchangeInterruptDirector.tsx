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

import { Html, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { RuntimeView } from "@pa/contracts";
import {
  FittedGlb,
  ImportedTexturedProp,
  RiggedCharacter,
} from "../Character.js";
import type { PlayerApi } from "../Player.js";
import { actorRoutePose } from "../actorRoutes.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "../interactionRegistry.js";
import {
  M4_EAVESDROPS,
  M4_KNOWLEDGE,
  type EavesdropScene,
  type KnowledgePlacement,
} from "../m4ContentManifest.js";
import {
  REACTIVE_NAMED_CAST,
  type ReactiveActorDefinition,
} from "../reactiveManifest.js";
import { useWorldServices } from "../WorldServicesContext.js";
import { clampedPanelPosition } from "../panelPlacement.js";
import { dispatchPresentationNotice } from "@pa/engine-world";
import {
  DAY1_FIGURES,
  day1ExchangeFrame,
  dockBarrelPresentation,
  DOCK_BARREL_STAGING,
  type Day1FigureDefinition,
} from "../content/day1Exchanges.js";
import {
  day1M4Frame,
  knowledgeWorldPosition,
  M4_FLAVOR_ECHOES,
  M4_FLAVOR_VERBS,
  M4_STATIC_CAST,
} from "../content/day1M4Content.js";
import { useExchangeInterrupt } from "./useExchangeInterrupt.js";
import type { ExchangeInterruptApi } from "./useExchangeInterrupt.js";

// Registry grouping keys, matching the legacy directors: the named cast
// registers per-rig under REACTIVE:<id>, figure/side-job candidates under
// REACTIVE_FIGURES, and the M4 knowledge/activity/flavor/info candidates
// under M4_CONTENT.
const FIGURE_CANDIDATE_SOURCE = "REACTIVE_FIGURES";
const M4_CANDIDATE_SOURCE = "M4_CONTENT";

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

// Generic staged carried-prop rig (the imported dock barrel): one physical
// instance moves from pickup -> both hand sockets -> ship deck. The prior
// facing-offset approximation floated beside the hip and teleported to a
// second deck copy before the player actually set it down.
function CarriedStagePropRig(props: {
  stage: RuntimeView["field"]["activities"][typeof DOCK_BARREL_STAGING.activityId]["stage"];
  apiRef: { current: PlayerApi | null };
}) {
  const group = useRef<THREE.Group>(null);
  const leftHandPosition = useRef(new THREE.Vector3());
  const rightHandPosition = useRef(new THREE.Vector3());
  useFrame(() => {
    const root = group.current;
    if (!root) return;
    const presentation = dockBarrelPresentation(props.stage);
    if (presentation === "CARRIED") {
      const player = props.apiRef.current;
      const leftHand =
        player?.bodyRoot?.getObjectByName("mixamorigLeftHand");
      const rightHand =
        player?.bodyRoot?.getObjectByName("mixamorigRightHand");
      if (!player || !leftHand || !rightHand) {
        root.visible = false;
        return;
      }
      leftHand.getWorldPosition(leftHandPosition.current);
      rightHand.getWorldPosition(rightHandPosition.current);
      root.visible = true;
      root.position.set(
        (leftHandPosition.current.x + rightHandPosition.current.x) * 0.5 +
          player.motion.facingX * DOCK_BARREL_STAGING.socketForwardM,
        (leftHandPosition.current.y + rightHandPosition.current.y) * 0.5 -
          DOCK_BARREL_STAGING.socketDropM,
        (leftHandPosition.current.z + rightHandPosition.current.z) * 0.5 +
          player.motion.facingZ * DOCK_BARREL_STAGING.socketForwardM,
      );
      root.rotation.set(0, player.facingY, 0);
      return;
    }
    root.visible = true;
    const authoredPosition =
      presentation === "PICKUP"
        ? DOCK_BARREL_STAGING.pickupPosition
        : DOCK_BARREL_STAGING.restPosition;
    root.position.set(
      authoredPosition[0],
      authoredPosition[1],
      authoredPosition[2],
    );
    root.rotation.set(0, 0, 0);
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

// Imported knowledge carriers (posters, hanging signs, the coin set) — the
// visible surface a KN- read anchors to. Ported verbatim from the legacy
// M4ContentDirector; every visible body is an imported GLB/texture.
function KnowledgeVisual({ placement }: { placement: KnowledgePlacement }) {
  const texture = useTexture(`/world/posters/${placement.texture}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  const position = knowledgeWorldPosition(placement);
  if (placement.carrier === "PAPER") {
    return (
      <group position={position} rotation={[0, placement.rotY, 0]}>
        <group rotation={[Math.PI / 2, 0, 0]}>
          <ImportedTexturedProp
            texture={texture}
            size={[...placement.size]}
          />
        </group>
      </group>
    );
  }
  if (placement.carrier === "HANGING_SIGN") {
    return (
      <group position={position} rotation={[0, placement.rotY, 0]}>
        <ImportedTexturedProp
          glbKey="printshop-hanging-sign"
          texture={texture}
          size={[...placement.size]}
        />
      </group>
    );
  }
  return (
    <group position={position} rotation={[0, placement.rotY, 0]}>
      <FittedGlb
        glbKey="coin-paper-set"
        size={[...placement.size]}
        fallback={null}
      />
      <group position={[0, 0.08, 0.28]} rotation={[-Math.PI / 2, 0, 0]}>
        <ImportedTexturedProp
          texture={texture}
          size={[0.48, 0.15, 0.34]}
        />
      </group>
    </group>
  );
}

function Eavesdrop(props: {
  scene: EavesdropScene;
  apiRef: { current: PlayerApi | null };
  active: boolean;
  reducedMotion: boolean;
}) {
  const [line, setLine] = useState<number | null>(null);
  const lastLine = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const player = props.apiRef.current;
    const near =
      props.active &&
      player &&
      Math.hypot(
        player.position.x - props.scene.position[0],
        player.position.z - props.scene.position[2],
      ) <= 5.5;
    const next = near ? (Math.floor(clock.elapsedTime / 4) % 2) : null;
    if (next !== lastLine.current) {
      lastLine.current = next;
      setLine(next);
    }
  });
  useEffect(() => {
    if (line === null) return;
    dispatchPresentationNotice({
      id: `${props.scene.id}:${line}`,
      kind: "EAVESDROP",
      speaker: props.scene.speakers[line],
      text: props.scene.lines[line]!,
      dedupeKey: `${props.scene.id}:${line}`,
      cooldownMs: 9_000,
      durationMs: props.reducedMotion ? 1_800 : 3_200,
      captions: true,
    });
  }, [line, props.reducedMotion, props.scene]);
  const skipFirst = props.scene.id === "EAV-customs";
  return (
    <group>
      {!skipFirst && (
        <group
          position={[
            props.scene.position[0] - 0.65,
            props.scene.position[1],
            props.scene.position[2],
          ]}
          rotation={[0, 1.2, 0]}
        >
          <RiggedCharacter
            glbKey={props.scene.rigs[0]}
            height={1.68}
            clip={props.reducedMotion ? "idle" : line === 0 ? "argu1" : "idle"}
            castShadow={false}
            showFallback={false}
            distanceAnimThrottle
            cullBeyondM={34}
            probeId={`${props.scene.id}:a`}
          />
        </group>
      )}
      <group
        position={[
          props.scene.position[0] + 0.65,
          props.scene.position[1],
          props.scene.position[2],
        ]}
        rotation={[0, -1.2, 0]}
      >
        <RiggedCharacter
          glbKey={props.scene.rigs[1]}
          height={1.66}
          clip={props.reducedMotion ? "idle" : line === 1 ? "talk" : "idle"}
          castShadow={false}
          showFallback={false}
          distanceAnimThrottle
          cullBeyondM={34}
          probeId={`${props.scene.id}:b`}
        />
      </group>
    </group>
  );
}

// Ambient flavor verbs: audio + a world event + a captioned notice. No field
// events; ported verbatim from the legacy playFlavor.
function playFlavor(flavorId: string) {
  const verb = M4_FLAVOR_VERBS.find((entry) => entry.id === flavorId);
  if (!verb) return;
  const audio = new Audio(verb.audio);
  audio.volume = 0.62;
  void audio.play().catch(() => {});
  window.dispatchEvent(
    new CustomEvent("pa:flavor", { detail: { id: verb.eventId } }),
  );
  dispatchPresentationNotice({
    id: verb.notice.id,
    kind: "FLAVOR",
    text: verb.notice.text,
    cooldownMs: 3_000,
    durationMs: 2_800,
    captions: true,
  });
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
      props.interactionRegistry.clearSource(M4_CANDIDATE_SOURCE);
      for (const id of ["ned", "notice-reader", "sarah", "dockhand-m3", "ropemaker"]) {
        services.actors.remove(id);
      }
    },
    [props.interactionRegistry, services.actors],
  );

  // World flavor echoes (church bell, pump splash, bench sit) dispatched by
  // gameplay systems through the "pa:flavor" window event.
  useEffect(() => {
    const onFlavor = (raw: Event) => {
      const id = (raw as CustomEvent<{ id?: string }>).detail?.id;
      const content = id ? M4_FLAVOR_ECHOES[id] : undefined;
      if (!content) return;
      if (content.audio) {
        const audio = new Audio(content.audio);
        audio.volume = 0.58;
        void audio.play().catch(() => {});
      }
      dispatchPresentationNotice({
        id: `flavor:${id}`,
        kind: "FLAVOR",
        text: content.text,
        cooldownMs: 3_000,
        durationMs: 2_800,
        captions: true,
      });
    };
    window.addEventListener("pa:flavor", onFlavor);
    return () => window.removeEventListener("pa:flavor", onFlavor);
  }, []);

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

  // M4 candidates (knowledge reads, optional jobs/challenges, flavor verbs,
  // info figures) at the legacy M4ContentDirector's default frame priority.
  // Presence requires an idle engine; exchange availability gates the
  // enabled flag per candidate while flavor verbs stay usable in BREATHER.
  useFrame(() => {
    props.interactionRegistry.clearSource(M4_CANDIDATE_SOURCE);
    if (!props.enabled || exchange || engine.committing) return;
    const offersEnabled = props.exchangesEnabled !== false;
    for (const candidate of day1M4Frame(props.view, services.spaceId)) {
      props.interactionRegistry.upsert({
        id: candidate.id,
        sourceId: M4_CANDIDATE_SOURCE,
        kind: candidate.kind,
        label: candidate.label,
        priority: candidate.priority,
        spaceId: candidate.spaceId,
        position: candidate.position,
        radius: candidate.radius,
        facingDot: candidate.facingDot,
        losRequired: candidate.losRequired,
        enabled: candidate.enabledWithOffers ? offersEnabled : true,
        activate: () => {
          if (candidate.activate.kind === "FLAVOR") {
            playFlavor(candidate.activate.flavorId);
          } else {
            void begin(candidate.activate.sourceId);
          }
          return true;
        },
      });
    }
  });

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
          props.view.field.activities[DOCK_BARREL_STAGING.activityId]!.stage
        }
        apiRef={props.apiRef}
      />
      {M4_KNOWLEDGE.filter(
        (knowledge) =>
          knowledge.texture &&
          knowledge.carrier !== "EVENT_PROP" &&
          knowledge.carrier !== "EXISTING",
      ).map((knowledge) => (
        <group
          key={knowledge.id}
          visible={knowledge.spaceId === services.spaceId}
        >
          <KnowledgeVisual placement={knowledge} />
        </group>
      ))}
      {M4_STATIC_CAST.filter(
        (placement) =>
          placement.spaceId === services.spaceId &&
          (placement.visible?.(props.view) ?? true),
      ).map((placement) => (
        <group
          key={placement.key}
          position={[...placement.position]}
          rotation={[0, placement.rotY, 0]}
        >
          <RiggedCharacter
            glbKey={placement.glb}
            height={placement.height}
            clip={placement.clip}
            tint={placement.tint}
            showFallback={false}
          />
        </group>
      ))}
      {services.spaceId === "EXTERIOR" &&
        M4_EAVESDROPS.map((scene) => (
          <Eavesdrop
            key={scene.id}
            scene={scene}
            apiRef={props.apiRef}
            active={props.enabled}
            reducedMotion={props.reducedMotion}
          />
        ))}
      <ExchangePanel engine={engine} />
    </group>
  );
}
