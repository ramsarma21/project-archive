import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PlayerApi } from "./Player.js";
import type {
  InteriorDef,
  InteriorInspectHotspotDef,
} from "./interiorManifest.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "./interactionRegistry.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

export interface InteriorInspectPrompt {
  hotspot: InteriorInspectHotspotDef;
  worldAnchor: [number, number, number];
}

export function InteriorInspectDirector(props: {
  def: InteriorDef;
  apiRef: { current: PlayerApi | null };
  enabled: boolean;
  open: boolean;
  onOpen: (hotspot: InteriorInspectHotspotDef) => void;
  interactionRegistry: InteractionRegistry;
  spaceId: string;
}) {
  const promptRef = useRef<InteriorInspectPrompt | null>(null);
  const viewed = useRef(new Set<string>());
  const enabledRef = useRef(props.enabled);
  enabledRef.current = props.enabled;
  const openRef = useRef(props.open);
  openRef.current = props.open;
  const onOpenRef = useRef(props.onOpen);
  onOpenRef.current = props.onOpen;

  const activate = () => {
    if (!enabledRef.current || openRef.current) return;
    const prompt = promptRef.current;
    if (!prompt) return;
    viewed.current.add(prompt.hotspot.id);
    onOpenRef.current(prompt.hotspot);
  };

  useEffect(() => {
    viewed.current.clear();
    promptRef.current = null;
    // A new room gets a fresh session-only prompt ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.def.id]);

  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    const target = window as unknown as {
      __PA_QA_INSPECT__?: () => boolean;
    };
    target.__PA_QA_INSPECT__ = () => {
      if (!promptRef.current) return false;
      activate();
      return true;
    };
    return () => {
      delete target.__PA_QA_INSPECT__;
    };
  }, []);

  useFrame(() => {
    props.interactionRegistry.clearSource("INTERIOR_INSPECT");
    const api = props.apiRef.current;
    if (!props.enabled || props.open || !api) {
      if (promptRef.current) {
        promptRef.current = null;
      }
      return;
    }
    let best: InteriorInspectPrompt | null = null;
    let bestDistance = Infinity;
    for (const hotspot of props.def.hotspots) {
      if (viewed.current.has(hotspot.id)) continue;
      const worldAnchor: [number, number, number] = [
        props.def.origin[0] + hotspot.localAnchor[0],
        props.def.origin[1] + hotspot.localAnchor[1],
        props.def.origin[2] + hotspot.localAnchor[2],
      ];
      const dx = worldAnchor[0] - api.position.x;
      const dz = worldAnchor[2] - api.position.z;
      const distance = Math.hypot(dx, dz);
      const inv = distance > 0.001 ? 1 / distance : 1;
      const facing =
        api.motion.facingX * dx * inv +
        api.motion.facingZ * dz * inv;
      if (
        distance <= hotspot.radius + 0.2 &&
        facing >= hotspot.facingDot &&
        distance < bestDistance
      ) {
        bestDistance = distance;
        best = { hotspot, worldAnchor };
      }
      props.interactionRegistry.upsert({
        id: `INTERIOR_INSPECT:${hotspot.id}`,
        sourceId: "INTERIOR_INSPECT",
        kind: "INTERIOR_INSPECT",
        label: `Inspect ${hotspot.title}`,
        displayName: hotspot.title,
        verb: "Inspect",
        discoveryRadius: 7,
        approachRadius: 4,
        importance: "STANDARD",
        priority: INTERACTION_PRIORITIES.KNOWLEDGE,
        spaceId: props.spaceId,
        position: worldAnchor,
        radius: hotspot.radius + 0.2,
        facingDot: hotspot.facingDot,
        losRequired: true,
        losIgnoreIds: [
          hotspot.placementId,
          ...(hotspot.losOwnerPlacementIds ?? []),
        ].map((placementId) => `${props.def.id}:prop:${placementId}`),
        enabled: props.enabled && !props.open,
        activate: () => {
          if (!enabledRef.current || openRef.current) return false;
          viewed.current.add(hotspot.id);
          onOpenRef.current(hotspot);
          return true;
        },
      });
    }
    const previous = promptRef.current;
    promptRef.current = best;
    if (!best) return;
    if (previous?.hotspot.id === best.hotspot.id) return;
  }, -2);

  return null;
}

