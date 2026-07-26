import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  BULLET_SPEED_MPS,
  DODGE_COOLDOWN_TICKS,
  FIELD_TICK_HZ,
} from "@pa/duel";
import { CHEST_HEIGHT_FRACTION } from "@pa/engine-world";
import {
  contactShadowTexture,
  glowTexture,
  ringTexture,
  softTexture,
  tracerTexture,
} from "../duel/duelTextures.js";
import type { ArenaSample } from "./arenaFeed.js";

// Balls, flashes and the marks on the cobbles.
//
// The treatments are the duel's and are matched on purpose, because they were
// arrived at by looking at renders: a ball is drawn four times over because each
// answers a different question the player has — an opaque dark core so it exists
// against a pale sky, an additive halo so it exists against dark cobbles, a tracer so
// its direction and speed read, and A MARK ON THE GROUND UNDER IT.
//
// THE GROUND MARK IS THE ONE THAT MAKES A DODGE POSSIBLE and it is not decoration.
// From a chase camera the height of an incoming ball is ambiguous and its lateral
// offset is not, so the mark is what tells a player which way to step. It is dark
// rather than additive: it is a shadow, not a light.
//
// Nothing here simulates. Every position is one the feed produced from a snapshot,
// and the only arithmetic is turning a billboard to face its own travel.

/**
 * Sizes matched to the duel's own gunplay.
 *
 * Restated rather than imported because they are private to that module, and kept
 * identical on purpose: a ball that reads differently in a ranked match than in the
 * boss fight teaches the player two things where there is one mechanic.
 */
const BALL_CORE_M = 0.2;
const BALL_HALO_M = 0.36;
const TRACER_WIDTH_M = 0.16;
/** Roughly four fixed steps of travel: long enough to read direction and speed. */
const TRACER_LENGTH_M = (BULLET_SPEED_MPS / FIELD_TICK_HZ) * 4;
const GROUND_MARK_M = 0.62;

const POOL = 12;
const FLASH_SECONDS = 0.1;
const HIT_SECONDS = 0.34;
const RETICLE_REST_M = 0.72;

const projectedHead = new THREE.Vector3();
const projectedTail = new THREE.Vector3();

export type ReadSample = () => ArenaSample | null;

/** Balls in flight, each with the mark it casts on the cobbles. */
export function ArenaBalls(props: { read: ReadSample }) {
  const slots = useRef<(THREE.Group | null)[]>([]);
  const core = softTexture();
  const glow = glowTexture();
  const tracer = tracerTexture();
  const contact = contactShadowTexture();

  useFrame(({ camera }) => {
    const sample = props.read();
    const balls = sample?.balls ?? [];
    for (let index = 0; index < POOL; index++) {
      const group = slots.current[index];
      if (!group) continue;
      const ball = balls[index];
      if (!ball) {
        if (group.visible) group.visible = false;
        continue;
      }
      group.visible = true;
      group.position.set(ball.x, ball.y, ball.z);

      const lead = group.children[0] as THREE.Sprite | undefined;
      const halo = group.children[1] as THREE.Sprite | undefined;
      if (lead) (lead.material as THREE.SpriteMaterial).opacity = 0.98 * ball.fade;
      if (halo) (halo.material as THREE.SpriteMaterial).opacity = 0.9 * ball.fade;

      // The tracer is a billboard, so it has to be turned to the ball's travel
      // direction IN SCREEN SPACE: a quad laid in the ground plane looks right from
      // above and vanishes from the chase camera, which is the only view that matters.
      const trail = group.children[2] as THREE.Sprite | undefined;
      if (trail) {
        // Anchored at the head, so the streak hangs backwards from the ball. Set here
        // because a sprite's centre is a Vector2 and R3F will not take one as a prop.
        if (trail.center.y !== 1) trail.center.set(0.5, 1);
        projectedHead.set(ball.x, ball.y, ball.z).project(camera);
        projectedTail
          .set(ball.x - ball.vx * 0.05, ball.y, ball.z - ball.vz * 0.05)
          .project(camera);
        const perspective = camera as THREE.PerspectiveCamera;
        const aspect = perspective.isPerspectiveCamera ? perspective.aspect : 1;
        const dx = (projectedHead.x - projectedTail.x) * aspect;
        const dy = projectedHead.y - projectedTail.y;
        trail.material.rotation = Math.atan2(-dx, dy);
        trail.material.opacity = 0.6 * ball.fade;
      }

      const mark = group.children[3] as THREE.Mesh | undefined;
      if (mark) {
        mark.position.y = -ball.y + 0.03;
        (mark.material as THREE.MeshBasicMaterial).opacity = 0.75 * ball.fade;
      }
    }
  });

  return (
    <>
      {Array.from({ length: POOL }, (_, index) => (
        <group
          key={index}
          ref={(node) => {
            slots.current[index] = node;
          }}
          visible={false}
        >
          {/* Lead: opaque and dark, so the ball exists against the sky. */}
          <sprite scale={[BALL_CORE_M, BALL_CORE_M, 1]}>
            <spriteMaterial
              map={core}
              color="#120c07"
              transparent
              opacity={0.98}
              depthWrite={false}
            />
          </sprite>
          {/* Heat: additive, so the ball exists against the cobbles. */}
          <sprite scale={[BALL_HALO_M, BALL_HALO_M, 1]}>
            <spriteMaterial
              map={glow}
              color="#ffc27a"
              transparent
              opacity={0.9}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
          <sprite scale={[TRACER_WIDTH_M, TRACER_LENGTH_M, 1]}>
            <spriteMaterial
              map={tracer}
              color="#ffdca8"
              transparent
              opacity={0.6}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
          {/* The dodge cue. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[GROUND_MARK_M, GROUND_MARK_M]} />
            <meshBasicMaterial
              map={contact}
              color="#1a1206"
              transparent
              opacity={0.75}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

/**
 * The flash at the muzzle, from the tick a ball of theirs was first seen.
 *
 * The snapshot has no shot event, so the shot is inferred from the ball: an id the
 * client has not seen before is a shot that was taken, and its first reported
 * position is within a fifth of a metre of the muzzle at these speeds. That is an
 * observation about the projectile list, not a guess about the fight.
 */
export function ArenaMuzzleFlashes(props: { read: ReadSample }) {
  const sides = useMemo(() => ["SELF", "OPPONENT"] as const, []);
  const refs = useRef<Record<string, THREE.Sprite | null>>({});
  const core = glowTexture();

  useFrame(() => {
    const sample = props.read();
    for (const side of sides) {
      const sprite = refs.current[side];
      if (!sprite) continue;
      const cue = sample?.cues[side];
      if (!sample || !cue?.lastFireOrigin || cue.lastFireTick < 0) {
        sprite.visible = false;
        continue;
      }
      const age = (sample.tick - cue.lastFireTick) / FIELD_TICK_HZ;
      if (age < 0 || age > FLASH_SECONDS) {
        sprite.visible = false;
        continue;
      }
      const life = 1 - age / FLASH_SECONDS;
      sprite.visible = true;
      sprite.position.set(...cue.lastFireOrigin);
      const size = 0.34 + (1 - life) * 0.5;
      sprite.scale.set(size, size, 1);
      (sprite.material as THREE.SpriteMaterial).opacity = life;
    }
  });

  return (
    <>
      {sides.map((side) => (
        <sprite
          key={side}
          ref={(node) => {
            refs.current[side] = node;
          }}
          visible={false}
        >
          <spriteMaterial
            map={core}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </>
  );
}

/**
 * Where a hit landed, drawn from the health that changed.
 *
 * This is the one impact PvP can draw honestly. The snapshot carries no impact
 * events, so a ball that stops against cover is not distinguishable from one that
 * expires — but health falling IS in the snapshot, and it is the only impact the
 * player actually needs to see. It is drawn at the chest of whoever lost it, using
 * the engine's own body landmark.
 */
export function ArenaHitFlashes(props: { read: ReadSample }) {
  const sides = useMemo(() => ["SELF", "OPPONENT"] as const, []);
  const refs = useRef<Record<string, THREE.Group | null>>({});
  const soft = softTexture();
  const ring = ringTexture();

  useFrame(() => {
    const sample = props.read();
    for (const side of sides) {
      const group = refs.current[side];
      if (!group) continue;
      const cue = sample?.cues[side];
      const pose =
        side === "SELF"
          ? sample?.self
          : sample?.opponent.kind === "UNPLACED"
            ? undefined
            : sample?.opponent.pose;
      if (!sample || !pose || !cue || cue.lastHitTick < 0) {
        group.visible = false;
        continue;
      }
      const age = (sample.tick - cue.lastHitTick) / FIELD_TICK_HZ;
      if (age < 0 || age > HIT_SECONDS) {
        group.visible = false;
        continue;
      }
      const life = 1 - age / HIT_SECONDS;
      group.visible = true;
      group.position.set(
        pose.x,
        pose.y + pose.capsuleHeight * CHEST_HEIGHT_FRACTION,
        pose.z,
      );
      const puff = group.children[0] as THREE.Sprite | undefined;
      if (puff) {
        const size = 0.34 + (1 - life) * 0.85;
        puff.scale.set(size, size, 1);
        (puff.material as THREE.SpriteMaterial).opacity = life * 0.85;
      }
      const shock = group.children[1] as THREE.Mesh | undefined;
      if (shock) {
        const size = 0.3 + (1 - life) * 1.4;
        shock.scale.set(size, size, size);
        (shock.material as THREE.MeshBasicMaterial).opacity = life * 0.5;
      }
    }
  });

  return (
    <>
      {sides.map((side) => (
        <group
          key={side}
          ref={(node) => {
            refs.current[side] = node;
          }}
          visible={false}
        >
          <sprite>
            <spriteMaterial
              map={soft}
              color="#ff6b6b"
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
          <mesh>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={ring}
              color="#ff8a7a"
              transparent
              depthWrite={false}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Soft contact shadows, so a body is planted on the yard rather than hovering. */
export function ArenaBodyShadows(props: { read: ReadSample }) {
  const sides = useMemo(() => ["SELF", "OPPONENT"] as const, []);
  const refs = useRef<Record<string, THREE.Mesh | null>>({});
  const soft = softTexture();

  useFrame(() => {
    const sample = props.read();
    for (const side of sides) {
      const mesh = refs.current[side];
      if (!mesh) continue;
      const sighting = sample?.opponent;
      const pose =
        side === "SELF"
          ? sample?.self
          : sighting && sighting.kind !== "UNPLACED"
            ? sighting.pose
            : undefined;
      if (!pose) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(pose.x, 0.025, pose.z);
      // Tighter and darker when crouched: the silhouette on the ground is the only
      // cue that a fighter has dropped below an aimed ball.
      const size = pose.crouched ? 0.8 : 1.05;
      mesh.scale.set(size, size, 1);
      const opacity =
        side === "OPPONENT" && sighting?.kind === "LAST_SEEN" ? 0.18 : 0.5;
      (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  });

  return (
    <>
      {sides.map((side) => (
        <mesh
          key={side}
          ref={(node) => {
            refs.current[side] = node;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={soft}
            color="#000000"
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * Whether a roll is available, drawn at the player's feet.
 *
 * The authority emits no refusal for a dodge on cooldown — it would be per-tick spam
 * — so `dodgeReadyAtTick` in the snapshot is the only honest signal, and without it a
 * player who presses Q and gets nothing concludes the key is broken. It reads as a
 * closing arc under the body, in the same glance as an incoming ball's ground mark.
 */
export function ArenaDodgeReadiness(props: { read: ReadSample }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ring = ringTexture();

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const sample = props.read();
    const live = sample?.phase === "ENGAGEMENT_LIVE";
    if (!sample || !live || sample.selfReadout.health <= 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set(sample.self.x, 0.03, sample.self.z);
    const cooling = Math.max(0, sample.selfReadout.dodgeReadyAtTick - sample.tick);
    const ready = 1 - Math.min(1, cooling / DODGE_COOLDOWN_TICKS);
    // Wide and dim while it recharges, tight and bright the instant it is back. The
    // dim end is a floor rather than a fade to nothing: "recharging" has to be a
    // visible state, or pressing Q during it looks like a dead key.
    const size = 1.5 - ready * 0.5;
    mesh.scale.set(size, size, 1);
    (mesh.material as THREE.MeshBasicMaterial).opacity =
      cooling > 0 ? 0.12 + ready * 0.13 : 0.3;
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <planeGeometry args={[1.25, 1.25]} />
      <meshBasicMaterial
        map={ring}
        color="#8ce3a8"
        transparent
        opacity={0.2}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/**
 * Where the last sighting was, once the sighting is all there is.
 *
 * When cover breaks the line of sight the server stops refreshing the opponent's
 * position and says so. The body fades out (see `PvpArenaView`), and what remains is
 * this: a cold ring on the cobbles at the last place they were legitimately seen,
 * widening as it ages. It has to read as a memory. A player who mistakes it for a
 * live position walks into the open, and a player who thinks the opponent vanished
 * because the renderer broke stops trusting the mode.
 */
export function ArenaLastSeenMark(props: { read: ReadSample }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ring = ringTexture();

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const sample = props.read();
    const sighting = sample?.opponent;
    if (!sighting || sighting.kind !== "LAST_SEEN") {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set(sighting.pose.x, 0.035, sighting.pose.z);
    // Spreading with age, because the longer since the sighting the wider the ground
    // they could be standing on.
    const spread = 1 + Math.min(2.2, sighting.ageS * 0.55);
    mesh.scale.set(spread, spread, 1);
    (mesh.material as THREE.MeshBasicMaterial).opacity =
      0.34 / (1 + sighting.ageS * 0.35);
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <planeGeometry args={[1.4, 1.4]} />
      <meshBasicMaterial
        map={ring}
        color="#9fdcff"
        transparent
        opacity={0.3}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/**
 * The reticle, and what it deliberately does NOT claim.
 *
 * The boss duel draws its mark along the core's own assisted solution, because that
 * browser owns the assist and can call it. Here the assist belongs to the authority
 * and is not in the snapshot, so a client that drew an assisted line would be showing
 * a prediction of the server's aim correction — a small lie of exactly the kind this
 * mode exists to avoid. So this is the pointer's own line and nothing more: where you
 * are pointing, at the chest plane a ball travels in.
 */
export function ArenaAimMark(props: {
  read: ReadSample;
  aim: RefObject<THREE.Vector3>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ring = ringTexture();

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const sample = props.read();
    const at = props.aim.current;
    const live =
      sample?.phase === "ENGAGEMENT_LIVE" || sample?.phase === "BULLETS_GRANTED";
    if (!sample || !live || !at) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set(at.x, 0.04, at.z);
    (mesh.material as THREE.MeshBasicMaterial).opacity =
      sample.selfReadout.ammo > 0 ? 0.55 : 0.14;
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <planeGeometry args={[RETICLE_REST_M, RETICLE_REST_M]} />
      <meshBasicMaterial
        map={ring}
        color="#9fdcff"
        transparent
        opacity={0.5}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
