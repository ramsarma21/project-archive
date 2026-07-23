import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { PlayerApi } from "./Player.js";
import type {
  InteractionCandidate,
  InteractionRegistry,
} from "./interactionRegistry.js";
import { resolveInteraction } from "./interactionResolver.js";
import { useWorldServices } from "./WorldServicesContext.js";

export const INTERACTION_TOUCH_EVENT = "pa:interaction";

function editableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function InteractionDirector(props: {
  apiRef: { current: PlayerApi | null };
  registry: InteractionRegistry;
  enabled: boolean;
  busy: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}) {
  const services = useWorldServices();
  const [prompt, setPrompt] = useState<InteractionCandidate | null>(null);
  const promptRef = useRef<InteractionCandidate | null>(null);
  const enabledRef = useRef(props.enabled && !props.busy);
  enabledRef.current = props.enabled && !props.busy;
  const pressed = useRef(false);
  const releasedSinceAction = useRef(true);
  const actionInFlight = useRef(false);

  const activate = () => {
    if (
      !enabledRef.current ||
      actionInFlight.current ||
      !releasedSinceAction.current
    ) {
      return;
    }
    const candidate = promptRef.current;
    if (!candidate) return;
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
    },
    [props.registry],
  );

  useFrame(() => {
    const player = props.apiRef.current;
    if (!player || !enabledRef.current) {
      if (promptRef.current) {
        promptRef.current = null;
        setPrompt(null);
      }
      return;
    }
    const resolved = resolveInteraction({
      candidates: props.registry.list(),
      player: {
        position: player.position,
        facingX: player.motion.facingX,
        facingZ: player.motion.facingZ,
        spaceId: services.spaceId,
      },
      currentId: promptRef.current?.id ?? null,
      segmentClear: services.gameplayWorld.segmentClear,
    });
    const next = resolved?.candidate ?? null;
    if (next?.id === promptRef.current?.id && next?.label === promptRef.current?.label) {
      promptRef.current = next;
      return;
    }
    promptRef.current = next;
    setPrompt(next);
  });

  if (!prompt) return null;
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
      <button
        type="button"
        className={`interaction-glyph interaction-${prompt.kind.toLowerCase()}${
          props.highContrast ? " high-contrast" : ""
        }${props.reducedMotion ? " reduced-motion" : ""}`}
        aria-label={`Interact: ${prompt.label}`}
        onClick={() => {
          releasedSinceAction.current = true;
          activate();
        }}
      >
        <kbd>F</kbd> {prompt.label}
      </button>
    </Html>
  );
}
