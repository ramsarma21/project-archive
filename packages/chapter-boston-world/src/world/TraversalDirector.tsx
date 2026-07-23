import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { AuthoredRequest, PlayerApi } from "./Player.js";
import {
  TRAVERSAL_SET,
  type TraversalDressing,
  type TraversalMarker,
} from "./traversalMarkers.js";
import {
  type PlayerKinematics,
  type PromptTarget,
  selectPrompt,
  promptKey,
  COOLDOWN_MS,
} from "./traversalResolver.js";
import {
  buildTraversalEndpoints,
  duckRequestFor,
} from "./traversalRegistration.js";
import {
  buildDensityTraversalRegistrations,
  alignDensityActionStart,
  densityActionRequest,
  mergeDensityTraversalEndpoints,
  resolveDensityDynamicEndpoints,
} from "./densityTraversalAdapter.js";
import type { VaultApproachPlan } from "./traversalClassifier.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "./interactionRegistry.js";

// ---------------------------------------------------------------------------
// Traversal & parkour director (World-Design-Bible §5): contextual one-button
// (F) verbs on authored markers. The director resolves the nearest affordance,
// shows a gold glyph with hysteresis, and on F SUBMITS an action request to the
// Player — which is the sole owner of its transform (position / yaw / velocity
// / collision). F never falls back to free jump; Player owns Space/Shift/C.
// Seats and flavor interactions are one-shot poses (never per-frame tweens).
// ---------------------------------------------------------------------------

type GlyphTarget = PromptTarget;

function fireFlavor(marker: TraversalMarker) {
  if (!marker.flavor) return;
  window.dispatchEvent(
    new CustomEvent("pa:flavor", { detail: { id: marker.flavor.event, markerId: marker.id } }),
  );
}

export function TraversalDirector(props: {
  apiRef: { current: PlayerApi | null };
  // Marker/zone mechanics allowed: FREE_ROAM or BREATHER request, exterior,
  // no choreography camera. Beats always win (§ "never break beats").
  active: boolean;
  // Any blocking UI/dialogue: hides glyphs and ignores the interact key.
  busy: boolean;
  reducedMotion: boolean;
  interactionRegistry: InteractionRegistry;
  spaceId: string;
}) {
  const markers = TRAVERSAL_SET.markers;
  const densityRegistrations = useMemo(
    () => buildDensityTraversalRegistrations(),
    [],
  );
  const densityById = useMemo(
    () =>
      new Map(
        densityRegistrations.map((registration) => [
          registration.record.id,
          registration,
        ]),
      ),
    [densityRegistrations],
  );
  const endpoints = useMemo(
    () =>
      mergeDensityTraversalEndpoints(
        buildTraversalEndpoints(markers),
        densityRegistrations,
      ),
    [markers, densityRegistrations],
  );
  const seated = useRef<TraversalMarker | null>(null);
  const glyphRef = useRef<GlyphTarget | null>(null);
  const [fx, setFx] = useState<{ seq: number; pos: [number, number, number] } | null>(null);
  const fxSeq = useRef(0);

  const interactEnabled = props.active && !props.busy;
  const enabledRef = useRef(interactEnabled);
  enabledRef.current = interactEnabled;
  const activeRef = useRef(props.active);
  activeRef.current = props.active;
  const cooldownUntil = useRef(0);
  const completionCooldownMs = useRef(0);
  const actionWasActive = useRef(false);

  const pulseFx = (marker: TraversalMarker) => {
    if (!marker.flavor?.fxPos) return;
    fxSeq.current += 1;
    setFx({ seq: fxSeq.current, pos: marker.flavor.fxPos });
  };

  const sit = (api: PlayerApi, marker: TraversalMarker) => {
    const seat = marker.seat!;
    api.setPose(seat.pose.pos, seat.pose.faceY);
    api.setInputLocked(true);
    api.setInteractionClip(marker.anim.clip);
    seated.current = marker;
  };

  const stand = (api: PlayerApi) => {
    const marker = seated.current;
    if (!marker?.seat) return;
    api.setInteractionClip(null);
    api.setInputLocked(false);
    api.setPose(marker.seat.stand.pos, marker.seat.stand.faceY);
    seated.current = null;
  };

  // Translate a resolved affordance into a Player action request (or a
  // one-shot seat/flavor pose).
  const submit = (
    api: PlayerApi,
    affordanceId: string,
    dir: 1 | -1,
    vaultPlan?: VaultApproachPlan,
  ): boolean => {
    const density = densityById.get(affordanceId);
    if (density) {
      const request = densityActionRequest(density, dir, vaultPlan);
      const aligned = request
        ? alignDensityActionStart(request, api.position)
        : null;
      return aligned ? api.requestAuthored(aligned) : false;
    }
    const marker = markers.find((mm) => mm.id === affordanceId);
    if (!marker) return false;

    if (marker.seat) {
      sit(api, marker);
      fireFlavor(marker);
      return true;
    }
    if (marker.kind === "INTERACT_FLAVOR") {
      const pose = marker.path[0];
      const faceY = pose?.faceY ?? marker.facing ?? api.facingY;
      api.setPose([api.position.x, api.position.y, api.position.z], faceY);
      fireFlavor(marker);
      pulseFx(marker);
      return true;
    }
    if (marker.zone) {
      return submitDuck(api, marker, dir);
    }

    const poses = dir === 1 ? marker.path : [...marker.path].reverse();
    if (poses.length < 2) return false;
    const anchors = poses.map((p) => ({ x: p.pos[0], y: p.pos[1], z: p.pos[2], yaw: p.faceY }));
    const kind: AuthoredRequest["kind"] =
      marker.kind === "VAULT" || marker.kind === "JUMP"
        ? "VAULT"
        : dir === -1
          ? "CLIMB_DOWN"
          : "CLIMB_UP";
    const req: AuthoredRequest = {
      kind,
      affordanceId: marker.id,
      anchors,
      durationMs: Math.max(120, marker.durationMs),
      arcHeight: marker.anim.arcHeight,
    };
    return api.requestAuthored(req);
  };

  // Synthesize a validated crouch path across a duck/squeeze zone in the
  // player's current heading direction.
  const submitDuck = (api: PlayerApi, marker: TraversalMarker, dir: 1 | -1): boolean => {
    const request = duckRequestFor(marker, dir);
    return request ? api.requestAuthored(request) : false;
  };

  useFrame(() => {
    props.interactionRegistry.clearSource("TRAVERSAL");
    const api = props.apiRef.current;
    if (!api) return;
    const now = performance.now();
    const pos = api.position;
    if (actionWasActive.current && !api.motion.actionActive) {
      cooldownUntil.current = Math.max(
        cooldownUntil.current,
        now + completionCooldownMs.current,
      );
      completionCooldownMs.current = 0;
    }
    actionWasActive.current = api.motion.actionActive;

    // ---- beats always win: stand up, cancel any motion action, clear glyph.
    if (!activeRef.current) {
      if (seated.current) stand(api);
      if (api.motion.actionActive) api.cancelMotionAction();
      if (glyphRef.current) {
        glyphRef.current = null;
      }
      return;
    }

    // The unified director owns F. A seated stand-up remains the highest
    // traversal candidate and uses the authored safe stand pose.
    if (seated.current) {
      const marker = seated.current;
      props.interactionRegistry.upsert({
        id: `TRAVERSAL:STAND:${marker.id}`,
        sourceId: "TRAVERSAL",
        kind: "TRAVERSAL",
        label: "Stand",
        priority: INTERACTION_PRIORITIES.SAFETY_TRAVERSAL,
        spaceId: props.spaceId,
        position: marker.seat!.pose.pos,
        radius: 2,
        facingDot: -1,
        losRequired: false,
        enabled: true,
        activate: () => {
          if (performance.now() < cooldownUntil.current) return false;
          stand(api);
          cooldownUntil.current = performance.now() + COOLDOWN_MS;
          return true;
        },
      });
      glyphRef.current = null;
      return;
    }

    const player: PlayerKinematics = {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      facingX: api.motion.facingX,
      facingZ: api.motion.facingZ,
      speed: api.motion.speed,
      velX: api.motion.velX,
      velZ: api.motion.velZ,
      grounded: api.motion.grounded,
      airtimeMs: api.motion.airtimeMs,
    };
    const dynamicEndpoints = resolveDensityDynamicEndpoints(
      densityRegistrations,
      player.x,
      player.z,
    );
    const frameEndpoints = [...dynamicEndpoints, ...endpoints];
    const reachableEndpoints = frameEndpoints.filter((endpoint) =>
      api.canReachInteraction(endpoint.pos, endpoint.obstacleId),
    );

    // ---- nearest eligible affordance for the glyph (with hysteresis) -------
    const prompt = selectPrompt(reachableEndpoints, player, promptKey(glyphRef.current), {
      enabled: enabledRef.current,
      actionActive: api.motion.actionActive,
    });
    if (promptKey(prompt) !== promptKey(glyphRef.current)) {
      glyphRef.current = prompt;
    }
    if (!prompt) return;
    const marker = markers.find(
      (candidate) => candidate.id === prompt.affordanceId,
    );
    props.interactionRegistry.upsert({
      id: `TRAVERSAL:${prompt.affordanceId}:${prompt.dir}`,
      sourceId: "TRAVERSAL",
      kind:
        marker?.kind === "INTERACT_FLAVOR" ? "FLAVOR" : "TRAVERSAL",
      label: prompt.label,
      priority:
        marker?.kind === "INTERACT_FLAVOR"
          ? INTERACTION_PRIORITIES.FLAVOR
          : INTERACTION_PRIORITIES.SAFETY_TRAVERSAL,
      spaceId: props.spaceId,
      position: prompt.pos,
      radius: 1.7,
      facingDot: -0.2,
      losRequired: marker?.kind !== "INTERACT_FLAVOR",
      enabled:
        enabledRef.current &&
        !api.motion.actionActive &&
        now >= cooldownUntil.current,
      activate: () => {
        if (
          !enabledRef.current ||
          api.motion.actionActive ||
          performance.now() < cooldownUntil.current
        ) {
          return false;
        }
        const acted = submit(
          api,
          prompt.affordanceId,
          prompt.dir,
          prompt.vaultPlan,
        );
        if (acted) {
          completionCooldownMs.current =
            prompt.cooldownMs ?? COOLDOWN_MS;
          actionWasActive.current = api.motion.actionActive;
          cooldownUntil.current = performance.now() + COOLDOWN_MS;
        }
        return acted;
      },
    });
  }, -2);

  return (
    <group>
      {fx && <PulseFx key={fx.seq} pos={fx.pos} reducedMotion={props.reducedMotion} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Flavor pulse: a splash/clang burst at the interaction point (pump water,
// bell ring). Pure presentation, self-fading.
// ---------------------------------------------------------------------------

function PulseFx(props: { pos: [number, number, number]; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const drops = useRef<THREE.Group>(null);
  const bornAt = useRef<number | null>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    if (bornAt.current === null) bornAt.current = performance.now();
    const t = (performance.now() - bornAt.current) / 900;
    if (t >= 1 || props.reducedMotion) {
      g.visible = false;
      return;
    }
    g.visible = true;
    if (ring.current) {
      ring.current.scale.setScalar(0.25 + t * 1.4);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
    }
    if (drops.current) {
      drops.current.children.forEach((child, i) => {
        const a = (i / drops.current!.children.length) * Math.PI * 2;
        const r = 0.12 + t * 0.55;
        child.position.set(Math.cos(a) * r, t * 0.55 - t * t * 0.8, Math.sin(a) * r);
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = 0.9 * (1 - t);
      });
    }
  });
  return (
    <group ref={group} position={props.pos} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.72, 24]} />
        <meshBasicMaterial color="#cfe3ec" transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={drops}>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.035, 6, 5]} />
            <meshBasicMaterial color="#d8ecf4" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Placeholder dressing rigs. Cheap primitives, mostly unshadowed (Bible §12);
// the overnight asset passes replace these with generated GLBs.
// ---------------------------------------------------------------------------

const WOOD = "#5d4a33";
const WOOD_DARK = "#46351f";
const CLOTHS = ["#b7a98c", "#8d7f6a", "#a3927a"];

function Dressing(props: { d: TraversalDressing }) {
  const d = props.d;
  switch (d.type) {
    case "LAUNDRY": {
      const half = d.spanZ / 2;
      return (
        <group position={d.pos}>
          {[-half, half].map((z) => (
            <mesh key={z} position={[0, 1.05, z]} castShadow>
              <cylinderGeometry args={[0.05, 0.06, 2.1, 6]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={1} />
            </mesh>
          ))}
          <mesh position={[0, 1.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.015, 0.015, d.spanZ, 5]} />
            <meshStandardMaterial color="#3d372c" roughness={1} />
          </mesh>
          {CLOTHS.map((color, i) => {
            const z = -half + (d.spanZ / (CLOTHS.length + 1)) * (i + 1);
            return (
              <mesh key={i} position={[0, 1.16, z]} rotation={[0, Math.PI / 2, 0]}>
                <planeGeometry args={[0.62, 0.5]} />
                <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} />
              </mesh>
            );
          })}
        </group>
      );
    }
    case "CRATE_ROW": {
      const zs = [-1.2, 0, 1.2].filter((z) => Math.abs(z) <= d.spanZ / 2 + 0.2);
      return (
        <group position={d.pos}>
          {zs.map((z, i) => (
            <mesh key={z} position={[i % 2 === 0 ? 0.06 : -0.06, 0.36, z]} rotation={[0, i * 0.16, 0]} castShadow>
              <boxGeometry args={[0.8, 0.72, 1.1]} />
              <meshStandardMaterial color={i % 2 === 0 ? WOOD : WOOD_DARK} roughness={1} />
            </mesh>
          ))}
        </group>
      );
    }
    case "BOX":
      return (
        <mesh
          position={[d.pos[0], d.pos[1] + d.size[1] / 2, d.pos[2]]}
          rotation={[0, d.rotY ?? 0, 0]}
          castShadow
        >
          <boxGeometry args={d.size} />
          <meshStandardMaterial color={d.tone ?? WOOD} roughness={1} />
        </mesh>
      );
    case "CART":
      return (
        <group position={d.pos} rotation={[0, d.rotY, 0]}>
          <mesh position={[0, 1.08, 0]} castShadow>
            <boxGeometry args={[1.7, 0.24, 1.15]} />
            <meshStandardMaterial color={WOOD} roughness={1} />
          </mesh>
          {[-0.62, 0.62].map((x) => (
            <mesh key={x} position={[x, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.42, 0.42, 0.09, 12]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={1} />
            </mesh>
          ))}
          <mesh position={[0, 0.72, 0]} castShadow>
            <boxGeometry args={[1.5, 0.5, 0.9]} />
            <meshStandardMaterial color={WOOD_DARK} roughness={1} />
          </mesh>
        </group>
      );
    case "SHED": {
      const [w, h, depth] = d.size;
      return (
        <group position={d.pos}>
          <mesh position={[0, (h - 0.12) / 2, 0]} castShadow>
            <boxGeometry args={[w - 0.18, h - 0.12, depth - 0.18]} />
            <meshStandardMaterial color="#6b5a44" roughness={1} />
          </mesh>
          <mesh position={[0, h - 0.06, 0]} castShadow>
            <boxGeometry args={[w, 0.12, depth]} />
            <meshStandardMaterial color={WOOD_DARK} roughness={1} />
          </mesh>
        </group>
      );
    }
    case "SCAFFOLD": {
      const y = d.platformY;
      return (
        <group position={d.pos}>
          {[-1.4, 1.4].flatMap((x) =>
            [-0.65, 0.65].map((z) => (
              <mesh key={`${x}${z}`} position={[x, (y + 0.45) / 2, z]} castShadow>
                <cylinderGeometry args={[0.05, 0.055, y + 0.45, 6]} />
                <meshStandardMaterial color={WOOD_DARK} roughness={1} />
              </mesh>
            )),
          )}
          <mesh position={[0, y - 0.05, 0]} castShadow>
            <boxGeometry args={[3.05, 0.1, 1.5]} />
            <meshStandardMaterial color={WOOD} roughness={1} />
          </mesh>
          <mesh position={[0, y / 2, 0.62]} rotation={[0, 0, 0.75]}>
            <boxGeometry args={[y * 1.15, 0.07, 0.05]} />
            <meshStandardMaterial color={WOOD} roughness={1} />
          </mesh>
          <mesh position={[0, y * 0.52, 0]} castShadow>
            <boxGeometry args={[2.9, 0.08, 1.3]} />
            <meshStandardMaterial color={WOOD_DARK} roughness={1} />
          </mesh>
        </group>
      );
    }
    case "PLATFORM":
      return (
        <mesh position={[d.pos[0], d.pos[1] - 0.05, d.pos[2]]} castShadow>
          <boxGeometry args={[d.size[0], 0.1, d.size[1]]} />
          <meshStandardMaterial color={WOOD} roughness={1} />
        </mesh>
      );
    case "LADDER": {
      const h = d.topY + 0.35;
      return (
        <group position={d.pos} rotation={[0.12, d.rotY, 0]}>
          {[-0.26, 0.26].map((x) => (
            <mesh key={x} position={[x, h / 2, 0]} castShadow>
              <cylinderGeometry args={[0.035, 0.04, h, 6]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={1} />
            </mesh>
          ))}
          {Array.from({ length: Math.floor(h / 0.34) }).map((_, i) => (
            <mesh key={i} position={[0, 0.3 + i * 0.34, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.022, 0.022, 0.52, 5]} />
              <meshStandardMaterial color={WOOD} roughness={1} />
            </mesh>
          ))}
        </group>
      );
    }
    case "BEAM": {
      const len = Math.hypot(d.to[0] - d.from[0], d.to[2] - d.from[2]);
      const cx = (d.from[0] + d.to[0]) / 2;
      const cz = (d.from[2] + d.to[2]) / 2;
      const yaw = Math.atan2(d.to[0] - d.from[0], d.to[2] - d.from[2]);
      return (
        <group position={[cx, 0, cz]} rotation={[0, yaw, 0]}>
          <mesh position={[0, 0.24, 0]} castShadow>
            <boxGeometry args={[0.26, 0.14, len]} />
            <meshStandardMaterial color={WOOD} roughness={1} />
          </mesh>
          {[-len / 2 + 0.3, len / 2 - 0.3].map((z) => (
            <mesh key={z} position={[0, 0.09, z]}>
              <boxGeometry args={[0.4, 0.18, 0.4]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={1} />
            </mesh>
          ))}
        </group>
      );
    }
    case "BELL_POST":
      return (
        <group position={d.pos} rotation={[0, d.rotY, 0]}>
          <mesh position={[0, 1.4, 0]} castShadow>
            <boxGeometry args={[0.16, 2.8, 0.16]} />
            <meshStandardMaterial color={WOOD_DARK} roughness={1} />
          </mesh>
          <mesh position={[0.34, 2.62, 0]} castShadow>
            <boxGeometry args={[0.85, 0.12, 0.12]} />
            <meshStandardMaterial color={WOOD_DARK} roughness={1} />
          </mesh>
          {/* the bell */}
          <mesh position={[0.62, 2.36, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.28, 0.32, 10]} />
            <meshStandardMaterial color="#7a6a3d" metalness={0.55} roughness={0.45} />
          </mesh>
          {/* the pull rope */}
          <mesh position={[0.62, 1.6, 0]}>
            <cylinderGeometry args={[0.016, 0.016, 1.2, 5]} />
            <meshStandardMaterial color="#4a4033" roughness={1} />
          </mesh>
          <mesh position={[0.62, 0.98, 0]}>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshStandardMaterial color="#3a3228" roughness={1} />
          </mesh>
        </group>
      );
    case "PUDDLE":
      return (
        <mesh position={[d.pos[0], 0.035, d.pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[d.radius, 22]} />
          <meshStandardMaterial color="#2f3a40" roughness={0.25} metalness={0.15} />
        </mesh>
      );
    case "BENCH":
      return (
        <group position={d.pos} rotation={[0, d.rotY, 0]}>
          <mesh position={[0, 0.4, 0]} castShadow>
            <boxGeometry args={[1.65, 0.09, 0.48]} />
            <meshStandardMaterial color={WOOD} roughness={1} />
          </mesh>
          {[-0.68, 0.68].map((x) => (
            <mesh key={x} position={[x, 0.19, 0]} castShadow>
              <boxGeometry args={[0.09, 0.38, 0.42]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={1} />
            </mesh>
          ))}
          <mesh position={[0, 0.78, -0.21]} castShadow>
            <boxGeometry args={[1.65, 0.5, 0.07]} />
            <meshStandardMaterial color={WOOD_DARK} roughness={1} />
          </mesh>
        </group>
      );
  }
}
