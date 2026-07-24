import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { PlayerApi } from "./Player.js";
import type {
  InteractionCandidate,
  InteractionRegistry,
} from "./interactionRegistry.js";
import { interactionPresentationMetadata } from "./interactionRegistry.js";
import {
  resolveInteractionAffordance,
  type ResolvedInteraction,
} from "./interactionResolver.js";
import { useWorldServices } from "./WorldServicesContext.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

export const INTERACTION_TOUCH_EVENT = "pa:interaction";

function editableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function InteractionActionPrompt(props: {
  affordance: ResolvedInteraction | null;
  reducedMotion: boolean;
  highContrast: boolean;
}) {
  const resolved = props.affordance;
  if (!resolved || resolved.phase !== "ACTION") return null;
  const prompt = resolved.candidate;
  const metadata = interactionPresentationMetadata(prompt);
  const classes = `${props.highContrast ? " high-contrast" : ""}${
    props.reducedMotion ? " reduced-motion" : ""
  } importance-${metadata.importance.toLowerCase()}`;
  return (
    <div
      className={`interaction-action-layer${classes}`}
      data-interaction-id={prompt.id}
      data-interaction-phase="ACTION"
      data-interaction-verb={metadata.verb}
    >
      <button
        type="button"
        className={`interaction-glyph interaction-action interaction-${prompt.kind.toLowerCase()}`}
        aria-label={`${metadata.verb}: ${metadata.displayName}`}
        onClick={() =>
          window.dispatchEvent(new CustomEvent(INTERACTION_TOUCH_EVENT))
        }
      >
        <span>{metadata.displayName}</span>
        <strong>
          <kbd>F</kbd>
          <b aria-hidden="true"> — </b>
          {metadata.verb}
        </strong>
      </button>
    </div>
  );
}

export function InteractionDirector(props: {
  apiRef: { current: PlayerApi | null };
  registry: InteractionRegistry;
  enabled: boolean;
  busy: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  onActionAffordance: (affordance: ResolvedInteraction | null) => void;
}) {
  const services = useWorldServices();
  const [affordance, setAffordance] = useState<ResolvedInteraction | null>(null);
  const affordanceRef = useRef<ResolvedInteraction | null>(null);
  const enabledRef = useRef(props.enabled && !props.busy);
  enabledRef.current = props.enabled && !props.busy;
  const pressed = useRef(false);
  const releasedSinceAction = useRef(true);
  const actionInFlight = useRef(false);

  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    const target = window as unknown as {
      __PA_QA_INTERACTIONS__?: () => unknown;
    };
    target.__PA_QA_INTERACTIONS__ = () => {
      const player = props.apiRef.current;
      return {
        spaceId: services.spaceId,
        player: player
          ? {
              x: player.position.x,
              y: player.position.y,
              z: player.position.z,
              facingX: player.motion.facingX,
              facingZ: player.motion.facingZ,
            }
          : null,
        candidates: props.registry.list().map((candidate) => ({
          id: candidate.id,
          enabled: candidate.enabled,
          position: candidate.position,
          radius: candidate.radius,
          losIgnoreIds: candidate.losIgnoreIds ?? [],
          occluders: player
            ? services.gameplayWorld.segmentOccluderIds(
                {
                  x: player.position.x,
                  y: player.position.y + 1.05,
                  z: player.position.z,
                },
                {
                  x: candidate.position[0],
                  y: candidate.position[1] + 1.05,
                  z: candidate.position[2],
                },
                candidate.losIgnoreIds
                  ? new Set(candidate.losIgnoreIds)
                  : undefined,
              )
            : [],
        })),
      };
    };
    return () => {
      delete target.__PA_QA_INTERACTIONS__;
    };
  }, [props.apiRef, props.registry, services]);

  const activate = () => {
    if (
      !enabledRef.current ||
      actionInFlight.current ||
      !releasedSinceAction.current
    ) {
      return;
    }
    const resolved = affordanceRef.current;
    if (!resolved || resolved.phase !== "ACTION") return;
    const candidate = resolved.candidate;
    releasedSinceAction.current = false;
    actionInFlight.current = true;
    void Promise.resolve(candidate.activate())
      .catch((error) => {
        console.error("[interaction] activation failed", candidate.id, error);
        return false;
      })
      .finally(() => {
        actionInFlight.current = false;
      });
  };

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (
        event.code !== "KeyF" ||
        event.repeat ||
        event.defaultPrevented ||
        editableTarget(event.target)
      ) {
        return;
      }
      pressed.current = true;
      activate();
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== "KeyF") return;
      pressed.current = false;
      releasedSinceAction.current = true;
    };
    const onTouch = () => {
      releasedSinceAction.current = true;
      activate();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener(INTERACTION_TOUCH_EVENT, onTouch);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener(INTERACTION_TOUCH_EVENT, onTouch);
    };
  }, []);

  useEffect(
    () => () => {
      props.registry.clear();
      props.onActionAffordance(null);
    },
    [props.onActionAffordance, props.registry],
  );

  useFrame(() => {
    const player = props.apiRef.current;
    if (!player || !enabledRef.current) {
      if (affordanceRef.current) {
        affordanceRef.current = null;
        setAffordance(null);
        props.onActionAffordance(null);
      }
      return;
    }
    const resolved = resolveInteractionAffordance({
      candidates: props.registry.list(),
      player: {
        position: player.position,
        facingX: player.motion.facingX,
        facingZ: player.motion.facingZ,
        spaceId: services.spaceId,
      },
      currentId: affordanceRef.current?.candidate.id ?? null,
      segmentClear: services.gameplayWorld.segmentClear,
    });
    if (
      resolved?.candidate.id === affordanceRef.current?.candidate.id &&
      resolved?.candidate.label === affordanceRef.current?.candidate.label &&
      resolved?.phase === affordanceRef.current?.phase
    ) {
      affordanceRef.current = resolved;
      return;
    }
    affordanceRef.current = resolved;
    setAffordance(resolved);
    props.onActionAffordance(
      resolved?.phase === "ACTION" ? resolved : null,
    );
  });

  if (!affordance) return null;
  const prompt = affordance.candidate;
  const metadata = interactionPresentationMetadata(prompt);
  const classes = `${props.highContrast ? " high-contrast" : ""}${
    props.reducedMotion ? " reduced-motion" : ""
  } importance-${metadata.importance.toLowerCase()}`;
  if (affordance.phase === "ACTION") return null;
  return (
    <Html
      position={[
        prompt.position[0],
        prompt.position[1] + 1.32,
        prompt.position[2],
      ]}
      center
      occlude={false}
      zIndexRange={[4, 0]}
    >
      <div
        className={`interaction-affordance interaction-${affordance.phase.toLowerCase()} interaction-${prompt.kind.toLowerCase()}${classes}`}
        role="status"
        aria-label={`${metadata.category}: ${metadata.displayName}. ${metadata.verb} when closer.`}
        data-interaction-id={prompt.id}
        data-interaction-phase={affordance.phase}
        data-interaction-verb={metadata.verb}
      >
        <small>{metadata.category}</small>
        <span>{metadata.displayName}</span>
        {affordance.phase === "APPROACH" && <strong>{metadata.verb}</strong>}
      </div>
    </Html>
  );
}
