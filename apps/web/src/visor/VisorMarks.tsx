import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { holoLabel, type LabelSpec } from "./holoLabel.js";

// ---------------------------------------------------------------------------
// The visor's line work, as world geometry.
//
// Procedural, and allowed to be: the imported-visible-world rule scopes to
// physical production objects and surfaces, and names UI and Archive highlights as
// an exception alongside sky, fog and lighting. Nothing in this file is a thing in
// 1765 Boston. It is a machine from the future drawing over the top of it, and
// there is no GLB that could express a vision cone.
//
// Three properties every mark here holds to.
//
// DEPTH-AWARE, WHERE IT IS GEOMETRY. Every drawn shape is depth-tested against the
// level's own art, so a cone behind the market shed is behind the market shed. That
// is what makes the annotation sit IN the street instead of being pasted on the
// glass, and it is also honest: the visor does not show the player through walls.
// Labels are the deliberate exception, for the reason given at `HoloPin`.
//
// ADDITIVE, NEVER OCCLUDING. Every material is additive with `depthWrite` off, so
// marks brighten what is behind them and never punch a hole in it, and two marks
// crossing get brighter rather than fighting over which is in front.
//
// NOT WEATHER. Every material also opts OUT of the scene's fog, and on this level
// that is the difference between the visor working and the visor not existing. The
// mission is set at full dark and `dawnSky(0)` runs an exponential fog at 0.026,
// which is 37% of the way to flat black at the near field's edge and 98% of the
// way at the elm — so the destination beacon, the visor's whole answer to "where
// am I going", was being drawn eighty metres into a wall of night and arriving as
// nothing. Fog is what the air does to light coming off 1765 Boston. These marks
// are a machine drawing on the inside of the glass; there is no air between them
// and the eye, and behaving as though there were deleted the most important thing
// the hold had to say.
//
// ANIMATED THROUGH REFS. The reveal and the dissolve are one number in a context,
// read inside `useFrame` and written straight onto materials. A hologram that
// faded by re-rendering React sixty times a second would be a hologram that cost
// more than the world behind it.
// ---------------------------------------------------------------------------

/**
 * How far the visor has come up, [0,1], and the stagger every mark reads against.
 *
 * One shared ref rather than a prop: the reveal is a property of the visor, not of
 * any one mark, and a prop would re-render the whole annotation on every frame of
 * it.
 */
export const VisorIntensity = createContext<{ current: number }>({ current: 1 });

/** Smooth 0→1 across a window, so nothing pops. */
function ramp(value: number, from: number, to: number): number {
  if (to <= from) return value >= to ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * A mark's own opacity this frame.
 *
 * `appearAt` staggers the reveal outward from the player — the leads first, the
 * street next, the elm last — which is both how a scan would behave and how a
 * person reads a briefing. It also gives the dissolve its shape for free: running
 * the same number backwards collapses the far marks first, so the last thing to
 * go dark is the ground under the player's feet.
 */
function useMarkAlpha(appearAt: number): { read: () => number } {
  const intensity = useContext(VisorIntensity);
  return useMemo(
    () => ({ read: () => ramp(intensity.current, appearAt, appearAt + 0.22) }),
    [appearAt, intensity],
  );
}

function additive(colour: string, opacity: number): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(colour),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
}

function lineMaterial(
  colour: string,
  opacity: number,
  dashM: number | null,
): THREE.Material {
  const shared = {
    color: new THREE.Color(colour),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  };
  if (dashM === null) return new THREE.LineBasicMaterial(shared);
  return new THREE.LineDashedMaterial({
    ...shared,
    dashSize: dashM,
    gapSize: dashM * 0.85,
  });
}

// Shared with the standing mark, which is drawn outside the hold and outside
// the reveal but has to be drawn by the same machine: additive, unoccluding and
// out of the fog. A second copy of those four flags is how one mark ends up
// behaving like weather while the rest do not.
export { lineMaterial as holoLineMaterial };

/** Drives one material's opacity off the shared reveal. */
function useFade(
  material: THREE.Material | THREE.Material[] | null,
  base: number,
  appearAt: number,
): void {
  const alpha = useMarkAlpha(appearAt);
  useFrame(() => {
    if (!material) return;
    const value = base * alpha.read();
    for (const one of Array.isArray(material) ? material : [material]) {
      one.opacity = value;
      one.visible = value > 0.004;
    }
  });
}

/** Frees geometry and material when the annotation goes away. */
function useDisposal(items: Array<{ dispose(): void } | null | undefined>): void {
  useEffect(
    () => () => {
      for (const item of items) item?.dispose();
    },
    // The list is built once per mount alongside the objects it owns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

/** One point every this far, so a Catmull-Rom through them stays on the polyline. */
const RESAMPLE_M = 0.4;

function densify(points: readonly (readonly [number, number, number])[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const a = new THREE.Vector3(...points[index]!);
    const b = new THREE.Vector3(...points[index + 1]!);
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / RESAMPLE_M));
    for (let step = 0; step < steps; step++) {
      out.push(a.clone().lerp(b, step / steps));
    }
  }
  out.push(new THREE.Vector3(...points[points.length - 1]!));
  return out;
}

/**
 * A route line: a bright hairline core inside a soft tube of the same colour.
 *
 * Two passes because one does not work. A pure line is one pixel wide at any
 * distance, which is elegant at four metres and invisible at twenty; a pure tube
 * is a sausage with no edge to follow. The core carries the shape and the tube
 * carries the presence, and because the tube is real geometry it thins with
 * distance — so the line recedes down the street the way a thing in the world does.
 */
export function HoloPath(props: {
  points: readonly (readonly [number, number, number])[];
  colour: string;
  opacity: number;
  glowRadiusM: number;
  dashM: number | null;
  appearAt: number;
}) {
  const { core, tube, coreMaterial, tubeMaterial } = useMemo(() => {
    const dense = densify(props.points);
    const coreGeometry = new THREE.BufferGeometry().setFromPoints(dense);
    const coreMaterialLocal = lineMaterial(props.colour, props.opacity, props.dashM);
    const coreLine = new THREE.Line(coreGeometry, coreMaterialLocal);
    // Dashes are measured along the line, so the distances have to exist before
    // the material can space anything against them.
    coreLine.computeLineDistances();

    const curve = new THREE.CatmullRomCurve3(dense, false, "catmullrom", 0.02);
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      Math.max(8, dense.length),
      props.glowRadiusM,
      6,
      false,
    );
    const tubeMaterialLocal = additive(props.colour, props.opacity * 0.3);
    return {
      core: coreLine,
      tube: new THREE.Mesh(tubeGeometry, tubeMaterialLocal),
      coreMaterial: coreMaterialLocal,
      tubeMaterial: tubeMaterialLocal,
    };
  }, [props.colour, props.dashM, props.glowRadiusM, props.opacity, props.points]);

  useFade(coreMaterial, props.opacity, props.appearAt);
  useFade(tubeMaterial, props.opacity * 0.3, props.appearAt);
  useDisposal([core.geometry, coreMaterial, tube.geometry, tubeMaterial]);

  return (
    <>
      <primitive object={core} />
      <primitive object={tube} />
    </>
  );
}

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

/** How tall a label is drawn, in pixels, whatever its range. */
const LABEL_PX: Record<"BRIGHT" | "NORMAL" | "DIM", number> = {
  BRIGHT: 46,
  NORMAL: 40,
  DIM: 33,
};

/**
 * Labels draw last of everything.
 *
 * Refusing the depth test is not sufficient on its own, and it took a screenshot
 * to see why: the level's transparent art — foliage, contact shadows — is in the
 * same pass as the plate and sorts by distance, so the elm's own leaves were
 * drawn over the plate naming the elm. Order beats depth here. Anything above the
 * scene's default of zero does it; labels still sort back to front among
 * themselves, so a near plate covers a far one.
 */
const LABEL_RENDER_ORDER = 10;

/**
 * A label pinned to a world point at constant screen size.
 *
 * The scale is solved from the camera every frame rather than set once, because
 * the only thing that makes this readable at eighty metres is that it does not
 * shrink — and a sprite with `sizeAttenuation` off is sized in units the
 * projection then divides by, so the conversion depends on the live field of view.
 * Doing it per frame means a camera change cannot leave the text the wrong size.
 *
 * THE ONE MARK THAT IS NOT DEPTH-TESTED, and the exception proves the rule. Every
 * piece of GEOMETRY here is depth-tested, because a cone the player can see
 * through a wall is the visor solving a street it should not solve. A NAME is a
 * different act: `visorPlan` draws the near field and merely NAMES the range, and
 * naming the elm you cannot yet see is the whole job of a briefing. Depth-testing
 * the plate did not withhold the name, it bisected it — a roof between the leads
 * and the tree cut "THE LIBERTY ELM · nail the handbill" in half and left the two
 * ends legible, which is worse than either showing it or not.
 *
 * Draw order still resolves labels against each other: transparent objects sort
 * back to front, so a near plate covers a far one, which is the right way round.
 */
export function HoloPin(props: {
  at: readonly [number, number, number];
  spec: LabelSpec;
  appearAt: number;
  /** A hairline stem down to the thing being named. */
  leaderToY?: number;
}) {
  const label = useMemo(() => holoLabel(props.spec), [props.spec]);
  const sprite = useRef<THREE.Sprite>(null);
  const size = useThree((state) => state.size);
  const alpha = useMarkAlpha(props.appearAt);

  const targetPx = LABEL_PX[props.spec.tone ?? "NORMAL"];
  const aspect = label.widthPx / label.heightPx;

  useFrame(({ camera }) => {
    const node = sprite.current;
    if (!node) return;
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = ((perspective.fov ?? 50) * Math.PI) / 180;
    const height = (targetPx / Math.max(1, size.height)) * 2 * Math.tan(fov / 2);
    node.scale.set(height * aspect, height, 1);
    const value = alpha.read();
    node.material.opacity = value;
    node.visible = value > 0.01;
  });

  const leader = useMemo(() => {
    if (props.leaderToY === undefined) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(props.at[0], props.at[1], props.at[2]),
      new THREE.Vector3(props.at[0], props.leaderToY, props.at[2]),
    ]);
    const material = lineMaterial(props.spec.accent, 0.5, null);
    return { line: new THREE.Line(geometry, material), material };
  }, [props.at, props.leaderToY, props.spec.accent]);

  useFade(leader?.material ?? null, 0.5, props.appearAt);
  useDisposal([label, leader?.line.geometry, leader?.material]);

  return (
    <>
      <sprite
        ref={sprite}
        position={props.at as unknown as THREE.Vector3Tuple}
        renderOrder={LABEL_RENDER_ORDER}
      >
        <spriteMaterial
          map={label.texture}
          transparent
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
          sizeAttenuation={false}
          fog={false}
        />
      </sprite>
      {leader && <primitive object={leader.line} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// watchers
// ---------------------------------------------------------------------------

/** Ground clearance for anything lying flat, so paving cannot z-fight with it. */
const GROUND_LIFT_M = 0.14;

/**
 * A watcher's cone, on the ground, as the field itself defines it.
 *
 * Half-angle and range come straight off the `WatcherPose` the stealth field is
 * handed, so this is the actual denied area rather than an artist's impression of
 * one. Drawn flat because flat is what a player needs: the question a cone answers
 * is "may I walk there", and that question is asked about the floor.
 */
export function HoloCone(props: {
  at: readonly [number, number, number];
  yaw: number;
  halfAngleRad: number;
  rangeM: number;
  colour: string;
  appearAt: number;
}) {
  const built = useMemo(() => {
    const segments = 30;
    const positions: number[] = [0, 0, 0];
    for (let index = 0; index <= segments; index++) {
      const angle =
        props.yaw - props.halfAngleRad +
        (props.halfAngleRad * 2 * index) / segments;
      positions.push(Math.sin(angle) * props.rangeM, 0, Math.cos(angle) * props.rangeM);
    }
    const indices: number[] = [];
    for (let index = 1; index <= segments; index++) indices.push(0, index, index + 1);

    const fan = new THREE.BufferGeometry();
    fan.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    fan.setIndex(indices);
    fan.computeVertexNormals();
    const fanMaterial = additive(props.colour, 0.14);

    // The rim and the two edges, brighter than the fill, so the boundary of the
    // denied area is a line the player can aim at rather than a gradient.
    const rim: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
    for (let index = 0; index <= segments; index++) {
      const angle =
        props.yaw - props.halfAngleRad +
        (props.halfAngleRad * 2 * index) / segments;
      rim.push(
        new THREE.Vector3(
          Math.sin(angle) * props.rangeM,
          0,
          Math.cos(angle) * props.rangeM,
        ),
      );
    }
    rim.push(new THREE.Vector3(0, 0, 0));
    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(rim);
    const edgeMaterial = lineMaterial(props.colour, 0.72, null);

    return {
      fan: new THREE.Mesh(fan, fanMaterial),
      fanMaterial,
      edge: new THREE.Line(edgeGeometry, edgeMaterial),
      edgeMaterial,
    };
  }, [props.colour, props.halfAngleRad, props.rangeM, props.yaw]);

  useFade(built.fanMaterial, 0.14, props.appearAt);
  useFade(built.edgeMaterial, 0.72, props.appearAt);
  useDisposal([
    built.fan.geometry,
    built.fanMaterial,
    built.edge.geometry,
    built.edgeMaterial,
  ]);

  return (
    <group position={[props.at[0], props.at[1] + GROUND_LIFT_M, props.at[2]]}>
      <primitive object={built.fan} />
      <primitive object={built.edge} />
    </group>
  );
}

/**
 * A watcher, as a body: a stem from his feet and a diamond over his head.
 *
 * Used for every watcher, cone or no cone. What it is really for is the ones
 * without a cone — the visor says how many there are and marks where, and declines
 * to solve the whole street in advance.
 */
export function HoloWatcherMark(props: {
  at: readonly [number, number, number];
  colour: string;
  headroomM: number;
  appearAt: number;
}) {
  const built = useMemo(() => {
    const top = props.headroomM;
    const size = 0.34;
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, top - size * 1.6, 0),
    ];
    const stem = new THREE.BufferGeometry().setFromPoints(points);
    const diamond = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, top - size, 0),
      new THREE.Vector3(size * 0.72, top, 0),
      new THREE.Vector3(0, top + size, 0),
      new THREE.Vector3(-size * 0.72, top, 0),
      new THREE.Vector3(0, top - size, 0),
    ]);
    const stemMaterial = lineMaterial(props.colour, 0.4, null);
    const diamondMaterial = lineMaterial(props.colour, 0.9, null);
    return {
      stem: new THREE.Line(stem, stemMaterial),
      stemMaterial,
      diamond: new THREE.Line(diamond, diamondMaterial),
      diamondMaterial,
    };
  }, [props.colour, props.headroomM]);

  useFade(built.stemMaterial, 0.4, props.appearAt);
  useFade(built.diamondMaterial, 0.9, props.appearAt);
  useDisposal([
    built.stem.geometry,
    built.stemMaterial,
    built.diamond.geometry,
    built.diamondMaterial,
  ]);

  return (
    <group position={props.at as unknown as THREE.Vector3Tuple}>
      <primitive object={built.stem} />
      <primitive object={built.diamond} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// areas
// ---------------------------------------------------------------------------

/** A crowd, as the ring its blend actually holds over. */
export function HoloDisc(props: {
  at: readonly [number, number, number];
  radiusM: number;
  colour: string;
  appearAt: number;
}) {
  const built = useMemo(() => {
    const segments = 56;
    const ring = (radius: number): THREE.Vector3[] => {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index <= segments; index++) {
        const angle = (index / segments) * Math.PI * 2;
        points.push(
          new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
        );
      }
      return points;
    };
    const rim = new THREE.BufferGeometry().setFromPoints(ring(props.radiusM));
    const inner = new THREE.BufferGeometry().setFromPoints(
      ring(props.radiusM * 0.62),
    );
    const rimMaterial = lineMaterial(props.colour, 0.8, null);
    const innerMaterial = lineMaterial(props.colour, 0.34, null);
    const fill = new THREE.CircleGeometry(props.radiusM, segments);
    fill.rotateX(-Math.PI / 2);
    const fillMaterial = additive(props.colour, 0.09);
    return {
      rim: new THREE.Line(rim, rimMaterial),
      rimMaterial,
      inner: new THREE.Line(inner, innerMaterial),
      innerMaterial,
      fill: new THREE.Mesh(fill, fillMaterial),
      fillMaterial,
    };
  }, [props.colour, props.radiusM]);

  useFade(built.rimMaterial, 0.8, props.appearAt);
  useFade(built.innerMaterial, 0.34, props.appearAt);
  useFade(built.fillMaterial, 0.09, props.appearAt);
  useDisposal([
    built.rim.geometry,
    built.rimMaterial,
    built.inner.geometry,
    built.innerMaterial,
    built.fill.geometry,
    built.fillMaterial,
  ]);

  return (
    <group position={[props.at[0], props.at[1] + GROUND_LIFT_M, props.at[2]]}>
      <primitive object={built.fill} />
      <primitive object={built.rim} />
      <primitive object={built.inner} />
    </group>
  );
}

/** A light volume, as the rectangle it was authored as. Hatched, so it reads flat. */
export function HoloField(props: {
  at: readonly [number, number, number];
  halfX: number;
  halfZ: number;
  colour: string;
  appearAt: number;
  /** Hatch spacing. Wide for exposure, tight for cover. */
  hatchM: number;
}) {
  const built = useMemo(() => {
    const { halfX, halfZ } = props;
    const outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfX, 0, -halfZ),
      new THREE.Vector3(halfX, 0, -halfZ),
      new THREE.Vector3(halfX, 0, halfZ),
      new THREE.Vector3(-halfX, 0, halfZ),
      new THREE.Vector3(-halfX, 0, -halfZ),
    ]);
    const hatch: THREE.Vector3[] = [];
    for (let z = -halfZ + props.hatchM; z < halfZ; z += props.hatchM) {
      hatch.push(new THREE.Vector3(-halfX, 0, z), new THREE.Vector3(halfX, 0, z));
    }
    const hatchGeometry = new THREE.BufferGeometry().setFromPoints(hatch);
    const outlineMaterial = lineMaterial(props.colour, 0.62, null);
    const hatchMaterial = lineMaterial(props.colour, 0.2, null);
    return {
      outline: new THREE.Line(outline, outlineMaterial),
      outlineMaterial,
      hatch: new THREE.LineSegments(hatchGeometry, hatchMaterial),
      hatchMaterial,
    };
  }, [props.colour, props.halfX, props.halfZ, props.hatchM]);

  useFade(built.outlineMaterial, 0.62, props.appearAt);
  useFade(built.hatchMaterial, 0.2, props.appearAt);
  useDisposal([
    built.outline.geometry,
    built.outlineMaterial,
    built.hatch.geometry,
    built.hatchMaterial,
  ]);

  return (
    <group position={[props.at[0], props.at[1] + GROUND_LIFT_M, props.at[2]]}>
      <primitive object={built.outline} />
      <primitive object={built.hatch} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// the destination
// ---------------------------------------------------------------------------

/**
 * The destination, as a column of light standing on it.
 *
 * This is the visor's answer to its one hard problem. The elm is eighty metres
 * east of the spawn with a town in between, so the tree itself is a few pixels of
 * foliage behind a roofline — but a shaft that rises to thirty-four metres clears
 * every roof in the level, which means the player standing on the printshop leads
 * can SEE where they are going without the visor having to cheat and draw through
 * a building. The information arrives by honest line of sight.
 *
 * Built as stacked rings rather than a gradient cylinder because rings are what a
 * machine would draw: they read as a scale, they thin out with height, and they
 * give the eye something to climb. The bright ring is at the work — the nail
 * height, eight metres up the trunk — so the column also says the objective is up
 * the tree rather than under it.
 */
export function HoloBeacon(props: {
  at: readonly [number, number, number];
  groundY: number;
  topY: number;
  workY: number;
  colour: string;
  accent: string;
  appearAt: number;
}) {
  const built = useMemo(() => {
    const ringPoints = (radius: number, y: number): THREE.Vector3[] => {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index <= 40; index++) {
        const angle = (index / 40) * Math.PI * 2;
        points.push(
          new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
        );
      }
      return points;
    };

    const span = props.topY - props.groundY;
    const rings: THREE.Line[] = [];
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const STEPS = 13;
    for (let step = 0; step < STEPS; step++) {
      const t = step / (STEPS - 1);
      const y = props.groundY + span * t;
      const radius = 2.4 * (1 - t * 0.72);
      const geometry = new THREE.BufferGeometry().setFromPoints(ringPoints(radius, y));
      const material = lineMaterial(props.colour, 0.5 * (1 - t * 0.8) + 0.06, null);
      geometries.push(geometry);
      materials.push(material);
      rings.push(new THREE.Line(geometry, material));
    }

    // The core: thin, vertical, unmistakably a marker rather than weather.
    const core = new THREE.CylinderGeometry(0.07, 0.07, span, 7, 1, true);
    const coreMaterial = additive(props.colour, 0.3);
    const coreMesh = new THREE.Mesh(core, coreMaterial);
    coreMesh.position.y = props.groundY + span / 2;

    // The work ring, and four ticks on it. Brightest thing the visor draws.
    const workGeometry = new THREE.BufferGeometry().setFromPoints(
      ringPoints(2.1, props.workY),
    );
    const workMaterial = lineMaterial(props.accent, 1, null);
    const ticks: THREE.Vector3[] = [];
    for (let index = 0; index < 4; index++) {
      const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
      ticks.push(
        new THREE.Vector3(Math.cos(angle) * 1.7, props.workY, Math.sin(angle) * 1.7),
        new THREE.Vector3(Math.cos(angle) * 2.6, props.workY, Math.sin(angle) * 2.6),
      );
    }
    const tickGeometry = new THREE.BufferGeometry().setFromPoints(ticks);
    const tickMaterial = lineMaterial(props.accent, 0.85, null);

    // A footprint on the ground, so the base of the column is a place.
    const footGeometry = new THREE.BufferGeometry().setFromPoints(
      ringPoints(3.4, props.groundY + GROUND_LIFT_M),
    );
    const footMaterial = lineMaterial(props.colour, 0.55, null);

    return {
      rings,
      ringMaterials: materials,
      ringGeometries: geometries,
      coreMesh,
      core,
      coreMaterial,
      work: new THREE.Line(workGeometry, workMaterial),
      workGeometry,
      workMaterial,
      tick: new THREE.LineSegments(tickGeometry, tickMaterial),
      tickGeometry,
      tickMaterial,
      foot: new THREE.Line(footGeometry, footMaterial),
      footGeometry,
      footMaterial,
    };
  }, [props.accent, props.colour, props.groundY, props.topY, props.workY]);

  const alpha = useMarkAlpha(props.appearAt);
  const bases = useMemo(
    () => built.ringMaterials.map((material) => material.opacity),
    [built.ringMaterials],
  );

  useFrame(({ clock }) => {
    const value = alpha.read();
    built.ringMaterials.forEach((material, index) => {
      // One slow pulse travelling up the column. The only motion the visor keeps
      // once it has finished coming up, and it is what makes the beacon read as
      // live rather than as a decal on the sky.
      const wave =
        0.72 +
        0.42 *
          Math.sin(clock.elapsedTime * 1.6 - index * 0.55);
      material.opacity = bases[index]! * value * wave;
      material.visible = material.opacity > 0.004;
    });
  });

  useFade(built.coreMaterial, 0.3, props.appearAt);
  useFade(built.workMaterial, 1, props.appearAt);
  useFade(built.tickMaterial, 0.85, props.appearAt);
  useFade(built.footMaterial, 0.55, props.appearAt);
  useDisposal([
    ...built.ringGeometries,
    ...built.ringMaterials,
    built.core,
    built.coreMaterial,
    built.workGeometry,
    built.workMaterial,
    built.tickGeometry,
    built.tickMaterial,
    built.footGeometry,
    built.footMaterial,
  ]);

  return (
    <group position={[props.at[0], 0, props.at[2]]}>
      {built.rings.map((ring, index) => (
        <primitive key={index} object={ring} />
      ))}
      <primitive object={built.coreMesh} />
      <primitive object={built.work} />
      <primitive object={built.tick} />
      <primitive object={built.foot} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------

/**
 * The ring that goes out when the visor comes up.
 *
 * Not decoration: it is the sentence "the System is looking at this district",
 * said in one gesture and never repeated. It also carries the reveal — the marks'
 * `appearAt` stagger is tuned so each one lights as the ring reaches it, which is
 * what makes a screen filling with twelve annotations read as one event instead of
 * twelve.
 */
export function HoloSweep(props: {
  at: readonly [number, number, number];
  maxRadiusM: number;
  colour: string;
}) {
  const intensity = useContext(VisorIntensity);
  const group = useRef<THREE.Group>(null);
  const built = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= 72; index++) {
      const angle = (index / 72) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = lineMaterial(props.colour, 0.9, null);
    return { line: new THREE.Line(geometry, material), material };
  }, [props.colour]);

  useFrame(() => {
    const node = group.current;
    if (!node) return;
    // Tracks the reveal directly, so it runs out on the way up and does not come
    // back on the way down.
    const t = Math.min(1, intensity.current / 0.85);
    const radius = Math.max(0.001, t * props.maxRadiusM);
    node.scale.set(radius, 1, radius);
    const fade = t <= 0 || t >= 1 ? 0 : Math.sin(t * Math.PI) * 0.85;
    built.material.opacity = fade;
    node.visible = fade > 0.01;
  });

  useDisposal([built.line.geometry, built.material]);

  return (
    <group
      ref={group}
      position={[props.at[0], props.at[1] + GROUND_LIFT_M, props.at[2]]}
    >
      <primitive object={built.line} />
    </group>
  );
}
