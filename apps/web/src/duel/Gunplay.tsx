import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  BULLET_SPEED_MPS,
  DODGE_COOLDOWN_TICKS,
  FIELD_TICK_HZ,
  isDowned,
  type DuelSide,
} from "@pa/duel";
import {
  interpolatedProjectile,
  lerpPose,
  reticleReadout,
  type DuelImpact,
  type DuelRuntime,
} from "./duelRuntime.js";
import {
  contactShadowTexture,
  glowTexture,
  ringTexture,
  softTexture,
  tracerTexture,
} from "./duelTextures.js";
import { AIM_PLANE_Y } from "./duelCamera.js";

// Making the ball the point.
//
// The core sets BULLET_SPEED_MPS to 22 — about a tenth of a real flintlock — and the
// comment on that constant is explicit that the physics yields to the mechanic:
// dodging is only real if a ball can be SEEN and reacted to. Rendering it as a 19mm
// lead sphere would honour the ballistics and destroy the mechanic, because at ten
// metres it is three pixels.
//
// So a ball reads as four things, and each one answers a question the player has:
//
//   the core        where is it, exactly
//   the halo        where is it, from the corner of an eye
//   the tracer      which way is it going, and how fast
//   the ground mark which way do I step
//
// The ground mark is the one that actually makes a dodge possible: height is
// ambiguous from a chase camera, and lateral offset is not.
//
// Nothing here simulates. Positions come from the core's projectile list, and the
// only arithmetic is interpolating between two fixed steps and reconstructing a
// straight line backwards from a known velocity.

const POOL = 12;
const IMPACT_POOL = 8;

/**
 * A ball has to read against a pale sky AND against dark cobbles, and a single
 * treatment cannot do both: additive glow disappears against bright sky, and a dark
 * mass disappears against shadow. So it is drawn twice — an opaque dark core that
 * silhouettes against the sky, and an additive halo that carries it over the ground.
 */
const BALL_CORE_M = 0.2;
const BALL_HALO_M = 0.36;
const TRACER_WIDTH_M = 0.16;
/** Roughly four fixed steps of travel: long enough to read direction and speed. */
const TRACER_LENGTH_M = (BULLET_SPEED_MPS / FIELD_TICK_HZ) * 4;
/**
 * The mark on the cobbles under the ball, and the reason a dodge is possible at all:
 * from a chase camera, height is ambiguous and lateral offset is not, so this is what
 * tells a player which way to step. Dark, not additive — it is a shadow, not a light.
 */
const GROUND_MARK_M = 0.62;

const IMPACT_SECONDS = 0.36;
const FLASH_SECONDS = 0.1;

const IMPACT_COLOUR: Readonly<Record<DuelImpact["kind"], string>> = {
  HIT: "#ff6b6b",
  COVER: "#d8c7a4",
  SPENT: "#8ea6bb",
};

const projectedHead = new THREE.Vector3();
const projectedTail = new THREE.Vector3();

/** Balls in flight. One pooled rig per slot; unused slots are hidden. */
export function Projectiles(props: { runtime: DuelRuntime }) {
  const slots = useRef<(THREE.Group | null)[]>([]);
  const core = softTexture();
  const glow = glowTexture();
  const tracer = tracerTexture();
  const contact = contactShadowTexture();

  useFrame(({ camera }) => {
    const state = props.runtime.getState();
    const poses = props.runtime.getPoses();
    const projectiles = state.combat.projectiles;
    for (let index = 0; index < POOL; index++) {
      const group = slots.current[index];
      if (!group) continue;
      const projectile = projectiles[index];
      if (!projectile) {
        if (group.visible) group.visible = false;
        continue;
      }
      const at = interpolatedProjectile(projectile, poses.alpha);
      group.visible = true;
      group.position.set(at.x, at.y, at.z);

      // The tracer is a billboard, so it has to be turned to the ball's travel
      // direction IN SCREEN SPACE. A quad laid in the ground plane looked right from
      // above and vanished from the chase camera, which is the only view that matters.
      const trail = group.children[2] as THREE.Sprite | undefined;
      if (trail) {
        // Anchor the streak at its head, so the quad hangs backwards from the ball
        // rather than straddling it. Set here because a sprite's centre is a Vector2
        // and R3F will not take one as a literal.
        if (trail.center.y !== 1) trail.center.set(0.5, 1);
        projectedHead.set(at.x, at.y, at.z).project(camera);
        projectedTail
          .set(at.x - projectile.vx * 0.05, at.y, at.z - projectile.vz * 0.05)
          .project(camera);
        const perspective = camera as THREE.PerspectiveCamera;
        const aspect = perspective.isPerspectiveCamera ? perspective.aspect : 1;
        const dx = (projectedHead.x - projectedTail.x) * aspect;
        const dy = projectedHead.y - projectedTail.y;
        // A sprite's rotation turns its +Y towards (-sin, cos), and the quad is
        // anchored at that end, so this points the streak's head at the ball and
        // lays its tail back along the way the ball came.
        trail.material.rotation = Math.atan2(-dx, dy);
      }

      const mark = group.children[3];
      if (mark) mark.position.y = -at.y + 0.03;
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
            <spriteMaterial map={core} color="#120c07" transparent opacity={0.98} depthWrite={false} />
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
          {/* Tracer, trailing the ball and turned to its screen-space travel. The
              anchor is the streak's head, so the quad hangs backwards from the ball. */}
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
          {/* The shadow on the cobbles: the dodge cue. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[GROUND_MARK_M, GROUND_MARK_M]} />
            <meshBasicMaterial map={contact} color="#1a1206" transparent opacity={0.75} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** The flash at the muzzle, from the tick the core says the shot left. */
export function MuzzleFlashes(props: { runtime: DuelRuntime }) {
  const sides: readonly DuelSide[] = useMemo(() => ["A", "B"], []);
  const refs = useRef<Record<string, THREE.Sprite | null>>({});
  const core = glowTexture();

  useFrame(() => {
    const state = props.runtime.getState();
    const cues = props.runtime.getCues();
    for (const side of sides) {
      const sprite = refs.current[side];
      if (!sprite) continue;
      const cue = cues[side];
      const age = (state.combat.tick - cue.lastFireTick) / FIELD_TICK_HZ;
      if (!cue.lastFireOrigin || cue.lastFireTick < 0 || age > FLASH_SECONDS || age < 0) {
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
 * Where balls stopped: a body, a piece of cover, or nothing.
 *
 * The three read differently on purpose, because the difference is information the
 * player needs. A hit flashes red, cover throws pale dust — that is the cover read,
 * and it is the moment a player learns which crates are chest-high — and a spent
 * ball fades cold.
 */
export function Impacts(props: { runtime: DuelRuntime }) {
  const slots = useRef<(THREE.Group | null)[]>([]);
  const soft = softTexture();
  const ring = ringTexture();

  useFrame(() => {
    const state = props.runtime.getState();
    const impacts = props.runtime.getImpacts();
    const recent = impacts.slice(-IMPACT_POOL);
    for (let index = 0; index < IMPACT_POOL; index++) {
      const group = slots.current[index];
      if (!group) continue;
      const impact = recent[recent.length - 1 - index];
      if (!impact) {
        group.visible = false;
        continue;
      }
      const age = (state.combat.tick - impact.tick) / FIELD_TICK_HZ;
      if (age < 0 || age > IMPACT_SECONDS) {
        group.visible = false;
        continue;
      }
      const life = 1 - age / IMPACT_SECONDS;
      group.visible = true;
      group.position.set(impact.x, impact.y, impact.z);
      group.rotation.y = Math.atan2(impact.dirX, impact.dirZ);
      const colour = IMPACT_COLOUR[impact.kind];
      const puff = group.children[0] as THREE.Sprite | undefined;
      if (puff) {
        const size = 0.3 + (1 - life) * 0.9;
        puff.scale.set(size, size, 1);
        const material = puff.material as THREE.SpriteMaterial;
        material.opacity = life * 0.85;
        material.color.set(colour);
      }
      const shock = group.children[1] as THREE.Mesh | undefined;
      if (shock) {
        const size = 0.25 + (1 - life) * 1.5;
        shock.scale.set(size, size, size);
        const material = shock.material as THREE.MeshBasicMaterial;
        material.opacity = life * 0.55;
        material.color.set(colour);
      }
    }
  });

  return (
    <>
      {Array.from({ length: IMPACT_POOL }, (_, index) => (
        <group
          key={index}
          ref={(node) => {
            slots.current[index] = node;
          }}
          visible={false}
        >
          <sprite>
            <spriteMaterial
              map={soft}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
          {/* Shock ring, standing across the ball's path. */}
          <mesh rotation={[0, 0, 0]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={ring}
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

/**
 * The aim mark. The core spawns a ball along the aim vector, so the player has to be
 * able to see where that vector points; without it a pointer-aimed duel is guesswork.
 */
/**
 * The reticle, drawn where the ball will actually go.
 *
 * IT IS NOT THE POINTER RAY. The core corrects a shot toward the intercept solution
 * whenever the raw aim falls inside a cone around it, so on a moving target the ball
 * leaves along a different line from the one under the cursor. A reticle showing the
 * raw ray would therefore be wrong exactly when it matters most — the player aims at
 * the officer, the ball leads him, and the assist reads as the gun misfiring. So the
 * mark is placed along `assistedAim`'s own output, called here with the same
 * arguments `resolveFiring` will pass it: same shooter, same target, same profile,
 * same line-of-sight test. Nothing is reimplemented, and the two cannot disagree.
 *
 * It also carries the two cooldowns, because the core deliberately emits no refusal
 * events for either — they would be per-tick spam — which leaves state as the only
 * channel. A press during reload has to look like a mechanic rather than a dropped
 * input, and the reticle is where the eye already is:
 *
 *   reloading      the ring sits wide and dim, and closes to its resting size as
 *                  `fireReadyAtTick` approaches. Closing means ready.
 *   out of balls   faint, and it stays faint: no amount of waiting reloads it.
 *   assist engaged warmer colour, so the snap is legible as a lock rather than drift.
 */
const RETICLE_REST_M = 0.72;
const RETICLE_RELOAD_SPREAD = 1.1;

export function AimMark(props: { runtime: DuelRuntime; aim: RefObject<THREE.Vector3> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ring = ringTexture();
  const snapped = useMemo(() => new THREE.Color("#ffd98a"), []);
  const free = useMemo(() => new THREE.Color("#9fdcff"), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const state = props.runtime.getState();
    const live = state.phase === "ENGAGEMENT_LIVE" || state.phase === "BULLETS_GRANTED";
    const at = props.aim.current;
    if (!live || !at) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    const readout = reticleReadout(state, at.x, at.z);
    mesh.position.set(readout.x, 0.04, readout.z);
    const spread = 1 + (1 - readout.reloaded) * RETICLE_RELOAD_SPREAD;
    mesh.scale.set(spread, spread, 1);

    const material = mesh.material as THREE.MeshBasicMaterial;
    material.color.copy(readout.snapped ? snapped : free);
    material.opacity = !readout.hasAmmo
      ? 0.14
      : readout.reloaded < 1
        ? 0.18 + readout.reloaded * 0.32
        : 0.55;
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

/**
 * Whether a roll is available, drawn at the player's feet.
 *
 * The cooldown is 2 seconds now, which is long enough that a player who presses Q
 * and gets nothing will conclude the key is broken rather than that the roll is
 * recharging. Like the reload, the core emits no refusal, so the only honest signal
 * is `dodge.readyAtTick`. It reads as a closing arc under the body — visible in the
 * same glance as the incoming ball's ground mark, which is the moment it is needed.
 */
export function DodgeReadiness(props: { runtime: DuelRuntime }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ring = ringTexture();

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const state = props.runtime.getState();
    const live = state.phase === "ENGAGEMENT_LIVE";
    const fighter = state.combat.fighters.A;
    const cooling = Math.max(0, fighter.dodge.readyAtTick - state.combat.tick);
    if (!live || isDowned(fighter)) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    const poses = props.runtime.getPoses();
    const pose = lerpPose(poses.prev.A, poses.next.A, poses.alpha);
    mesh.position.set(pose.x, 0.03, pose.z);

    const ready = 1 - Math.min(1, cooling / DODGE_COOLDOWN_TICKS);
    // Wide and dim while it recharges, tight and bright the instant it is back. The
    // dim end is a floor rather than a fade to nothing: "recharging" has to be a
    // visible state, or pressing Q during it looks like a dead key.
    const size = 1.5 - ready * 0.5;
    mesh.scale.set(size, size, 1);
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = cooling > 0 ? 0.12 + ready * 0.13 : 0.3;
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

/** Soft contact shadow under a fighter, so a body is planted on the yard. */
export function FighterShadows(props: { runtime: DuelRuntime }) {
  const refs = useRef<Record<string, THREE.Mesh | null>>({});
  const soft = softTexture();
  const sides: readonly DuelSide[] = useMemo(() => ["A", "B"], []);

  useFrame(() => {
    const poses = props.runtime.getPoses();
    for (const side of sides) {
      const mesh = refs.current[side];
      if (!mesh) continue;
      const pose = lerpPose(poses.prev[side], poses.next[side], poses.alpha);
      mesh.position.set(pose.x, 0.025, pose.z);
      // Tighter and darker when crouched: the silhouette on the ground is the only
      // cue that a fighter has dropped below an aimed ball.
      const size = pose.crouched ? 0.8 : 1.05;
      mesh.scale.set(size, size, 1);
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
          <meshBasicMaterial map={soft} color="#000000" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** Height the aim plane sits at, re-exported so the stage and camera agree. */
export const AIM_HEIGHT = AIM_PLANE_Y;
