import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { FittedGlb } from "@pa/engine-world";
import type { DawnRead } from "../mission/dawn.js";
import { dawnSky } from "../mission/dawn.js";
import {
  LANTERN_KINDS,
  LANTERN_POOL,
  M1_LANTERNS,
  flamePoint,
  lanternContribution,
  type Lantern,
  type LanternKind,
} from "./m1LanternPlan.js";

// ---------------------------------------------------------------------------
// The town's own light.
//
// M1 already had a lighting design and had never drawn it. `MissionLevel.light`
// authors eleven rectangles the stealth field reads every tick — Queen Street at
// 0.55, the Shambles at 0.70, Dock Square at 0.95, the elm at 0.85, against the
// Dassett alley at 0.06, the Dock arcade at 0.08 and the ropewalk at 0.10 — and
// the renderer lit every one of them with the same hemisphere. The simulation
// believed in a city of lit squares and dark lanes; the player was shown a
// uniform field of nothing. `m1LanternPlan.ts` holds where the lamps go and why;
// this file is only how they are drawn.
//
// NONE OF THIS IS A SIMULATION INPUT. `visibility` takes `player.lightLevel`,
// which comes from `lightLevelAt` over those rectangles by way of
// `dawnLightLevel`. No term in the stealth field reads a scene light, a colour,
// an intensity, a tone curve or an exposure. Deleting this file would change how
// the mission LOOKS and not one number in how it PLAYS. The single change that
// does reach the field is a light VOLUME rather than a lamp, and it is set out
// on LIGHT_ROPEWALK_NIGHTMAN in packages/mission-m1/src/level/ropewalk.ts.
//
// Cost is bounded by construction rather than by hope. The flames are three
// draw calls of `THREE.Points` for the whole town, the props are static and
// render once, and the pool mounts a fixed eleven point lights forever and
// re-aims them. Nothing casts a shadow: a shadow-casting point light is six
// depth passes, and thirty of them against a thirty-six body crowd is not a
// laptop's budget.
// ---------------------------------------------------------------------------

// --- the flames -------------------------------------------------------------

/**
 * A soft round gradient, built once.
 *
 * A flame is a light effect rather than an object, which is what lets it be
 * procedural at all under the imported-world rule — the lantern itself, the iron
 * and the glass and the pole, is the imported GLB underneath it.
 */
let flameTexture: THREE.CanvasTexture | null = null;
function flameSprite(): THREE.CanvasTexture {
  if (flameTexture) return flameTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, "rgba(255,214,150,0.92)");
  gradient.addColorStop(0.55, "rgba(255,150,60,0.30)");
  gradient.addColorStop(1, "rgba(255,120,30,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  flameTexture = new THREE.CanvasTexture(canvas);
  flameTexture.colorSpace = THREE.SRGBColorSpace;
  return flameTexture;
}

/**
 * Every flame of one kind, as a single additive point cloud.
 *
 * One draw call per kind rather than one per lamp, and it is what makes a lit
 * square legible from a rooftop a hundred metres off: the pools themselves fall
 * off as an inverse square and are gone by twenty metres, but a flame is a
 * visible object at any range. So the town reads as a constellation of places
 * long before any of them is lighting anything, which is the half of this job
 * that is wayfinding rather than visibility.
 *
 * `toneMapped` is off because a flame is a light source rather than a lit
 * surface: rolling its highlight off with the rest of the frame would take the
 * one thing on screen that is supposed to be brighter than the picture and make
 * it the same as the picture.
 */
function Flames(props: { kind: LanternKind; gain: number }) {
  const spec = LANTERN_KINDS[props.kind];

  const geometry = useMemo(() => {
    const flames = M1_LANTERNS.filter((lantern) => lantern.kind === props.kind);
    const array = new Float32Array(flames.length * 3);
    flames.forEach((lantern, index) => {
      const flame = flamePoint(lantern);
      array[index * 3] = flame[0];
      array[index * 3 + 1] = flame[1];
      array[index * 3 + 2] = flame[2];
    });
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(array, 3));
    return buffer;
  }, [props.kind]);

  if (props.gain <= 0) return null;

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={2}>
      <pointsMaterial
        map={flameSprite()}
        color={spec.colour}
        size={spec.flameSize}
        sizeAttenuation
        transparent
        opacity={props.gain}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

// --- the pool ---------------------------------------------------------------

const poolScratch = new THREE.Vector3();

interface Ranked {
  lantern: Lantern;
  flame: [number, number, number];
  /** Linear radiance this lamp would put on a wall at the camera. */
  worth: number;
}

const poolPoint: [number, number, number] = [0, 0, 0];

/**
 * Eleven point lights, spent on the eleven lamps worth most where the player is.
 *
 * Ranked by what each lamp would actually put on a surface — `lanternContribution`,
 * which is three's own falloff including the `distance` window — rather than by
 * raw proximity. The lamps are not interchangeable: a cresset twelve metres off
 * is still throwing light across Dock Square while a sconce eight metres off has
 * already fallen to nothing, and a rank by distance would spend the slot on the
 * sconce. Ranking by worth also means that when there are more lamps in range
 * than slots, the ones dropped are provably the dimmest; the test bounds how dim.
 *
 * Written through refs inside the frame loop: a rig that re-rendered React every
 * time the player walked past a lamp would cost more than the lights it saved.
 */
function LanternPool(props: { gain: number }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const lit = useMemo(
    () => M1_LANTERNS.filter((lantern) => !lantern.glowOnly),
    [],
  );
  const ranked = useRef<Ranked[]>(
    lit.map((lantern) => ({ lantern, flame: flamePoint(lantern), worth: 0 })),
  );

  useFrame(({ camera }) => {
    camera.getWorldPosition(poolScratch);
    poolPoint[0] = poolScratch.x;
    poolPoint[1] = poolScratch.y;
    poolPoint[2] = poolScratch.z;

    const list = ranked.current;
    for (let index = 0; index < lit.length; index += 1) {
      const entry = list[index]!;
      entry.worth = lanternContribution(entry.lantern, poolPoint);
    }
    list.sort((a, b) => b.worth - a.worth);

    for (let slot = 0; slot < LANTERN_POOL; slot += 1) {
      const light = lights.current[slot];
      if (!light) continue;
      const near = list[slot];
      if (!near || near.worth <= 0 || props.gain <= 0) {
        light.intensity = 0;
        continue;
      }
      const spec = LANTERN_KINDS[near.lantern.kind];
      light.position.set(near.flame[0], near.flame[1], near.flame[2]);
      light.color.set(spec.colour);
      light.distance = spec.distance;
      // No extra fade: three's own distance window already takes a lamp to
      // exactly zero at its cut-off, which is the same edge the ranking uses,
      // so a lamp leaving the pool is a lamp that had already gone out.
      light.intensity = spec.intensity * (near.lantern.gain ?? 1) * props.gain;
    }
  });

  return (
    <>
      {Array.from({ length: LANTERN_POOL }, (_, slot) => (
        <pointLight
          key={slot}
          ref={(node) => {
            lights.current[slot] = node;
          }}
          intensity={0}
          decay={2}
          distance={16}
          castShadow={false}
        />
      ))}
    </>
  );
}

// --- the props --------------------------------------------------------------

/** The iron and the glass. Static, so this renders once and never again. */
const LanternProps = memo(function LanternProps() {
  return (
    <group name="m1-lanterns">
      {M1_LANTERNS.map((lantern) => {
        const spec = LANTERN_KINDS[lantern.kind];
        return (
          <group
            key={lantern.id}
            position={[lantern.pos[0], lantern.pos[1], lantern.pos[2]]}
            rotation={[0, lantern.yaw ?? 0, 0]}
          >
            <FittedGlb
              glbKey={spec.asset}
              src={spec.path}
              size={[spec.size[0], spec.size[1], spec.size[2]]}
              fallback={null}
            />
          </group>
        );
      })}
    </group>
  );
});

/**
 * The lit town, as one mount.
 *
 * `dawn` comes from the container because the clock does. As `lift01` rises the
 * lamps lose the picture to the sky — see `lanternGain` on the sky stop — which
 * is the same event the stealth field reports when it lifts the authored light
 * toward daylight, drawn instead of announced.
 */
export const M1Lanterns = memo(function M1Lanterns(props: {
  readonly dawn: DawnRead;
}) {
  const gain = dawnSky(props.dawn.lift01).lanternGain;
  return (
    <>
      <LanternProps />
      <LanternPool gain={gain} />
      <Flames kind="BRACKET" gain={gain} />
      <Flames kind="CRESSET" gain={gain} />
      <Flames kind="SCONCE" gain={gain} />
    </>
  );
});
