import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { holoChevron, holoLabel } from "./holoLabel.js";
import { holoLineMaterial } from "./VisorMarks.js";
import { VISOR_INK } from "./visorPalette.js";

// ---------------------------------------------------------------------------
// The one mark the visor keeps after it goes dark.
//
// The hold was designed to dissolve into a bare run: intent up front, execution
// unassisted, nothing surviving the release. That division is right about
// almost everything and wrong about one thing, and the mission was played and
// the one thing is the only thing anybody noticed. A player halfway down the
// Shambles at full dark does not know which way the elm is. Not "cannot plan
// the optimal line" — does not know which way, and no amount of reading the
// architecture answers a question about a tree eighty metres away behind a
// market.
//
// So the visor keeps ONE mark live, and the fiction pays for it without any
// special pleading: the System is a machine on the player's eye, it has already
// been shown scanning the district, and a machine that could annotate the whole
// street and then forgot where the objective was would be the odd behaviour.
//
// WHAT IT SAYS AND WHAT IT REFUSES TO SAY.
//
// It says WHERE: a name at a place, a distance, and how far up or down. When
// the place has left the frame it slides to the edge and grows an arrow, so
// "which way" is answered by a thing the player can turn toward — and because
// that arrow lives in screen space, it answers "up" and "down" in the same
// gesture, which on a route with eight vertical bands is half the question.
//
// It refuses to say HOW. There is no line on the ground, no next node, no
// breadcrumb and no minimap. The route graph is read — the distance is walked
// along the authored links rather than measured through the buildings — but
// what comes back from it is a scalar, and a scalar cannot draw a path. Reading
// the architecture is the thing this mission is for; a mark that solved the
// roofline would be a mark that deleted it.
//
// It also gets out of the way. Inside a few metres the mark is gone: the player
// is standing at the work, the beat's own panel has taken over, and a plate
// across the bough at that moment is noise over the one moment of the run that
// needs no explaining.
//
// COUPLED TO NO CAMERA. Everything here reads the live camera out of the frame
// loop — its matrices, its field of view, the viewport — so it holds under a
// chase camera, a first-person one, or whatever the camera work becomes next.
// There is no orientation of its own to fall out of step.
// ---------------------------------------------------------------------------

export interface RunMarkRead {
  /** The thing itself, in world space. */
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  /** A place, named the way a place is named. */
  readonly title: string;
  readonly detail: string | null;
  /** Metres still to travel. */
  readonly rangeM: number;
  /** False when that figure is the straight line rather than the route. */
  readonly viaRoute: boolean;
  /** How far the mark sits above the player's feet. Negative is below. */
  readonly riseM: number;
  /**
   * The imminent authored move, when the committed leg is a directed action
   * gateway (a climb, a vault, a leap, a directed drop), else null on a run.
   *
   * This is the mark's answer to the one thing that decides a first mission: the
   * foot of a climb. There the plate would ORDINARILY recede into the hold it is
   * pointing at (see RETIRE_M) and leave a wall the player cannot tell from a
   * climb. When an action is armed the mark instead NAMES the move on the
   * take-off — "CLIMB UP", "VAULT", "LEAP" — and stops retiring, so the required
   * verb is unmistakable before the player commits to it. Composed by the
   * mission (markActionOf); drawn dumbly here.
   */
  readonly action?: {
    readonly kind: string;
    readonly label: string;
    readonly direction: "UP" | "OVER" | "ACROSS" | "DOWN";
    readonly phase: "APPROACH" | "RECEIVER";
    readonly riseM: number;
  } | null;
}

/** How far into the half-frame a mark that has left the view is held. */
const EDGE = 0.9;
/** Metres in front of the camera an edge-held mark is placed. */
const CLAMP_DEPTH_M = 6;
/** Drawn heights, in pixels, at any range. The plate's is the hub's BRIGHT tone. */
const PLATE_PX = 44;
const CHEVRON_PX = 24;
/** Pixels between the arrow and the plate it is pulling. */
const CHEVRON_GAP_PX = 26;
/**
 * Where the mark stops being help and starts being clutter.
 *
 * Gone inside the first figure, full by the second. The player is at the work
 * by then and the beat has its own surface; a name over the thing you are
 * standing on is a label on a door you have already opened.
 */
const RETIRE_M = 5;
const RETIRE_FULL_M = 11;
/** How high above the thing itself the plate rides, so it does not cover it. */
const PLATE_LIFT_M = 1.4;
/** Radius of the ring laid at the mark. A place, not a pin. */
const RING_RADIUS_M = 1.5;

/**
 * How coarsely the printed figures move.
 *
 * The plate is a canvas texture, so every distinct string is an upload. Metres
 * to five and height to two keeps a whole run inside a few dozen rebuilds while
 * staying finer than a player can perceive their own progress — and it stops
 * the plate flickering through three values a second while they run.
 */
const RANGE_STEP_M = 5;
const RISE_STEP_M = 2;

/** How often the objective is re-asked. Its position moves once or twice a run. */
const READ_HZ = 8;

function quantise(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function riseLabel(riseM: number): string {
  const rounded = quantise(riseM, RISE_STEP_M);
  if (rounded === 0) return "level with you";
  return `${Math.abs(rounded)} m ${rounded > 0 ? "up" : "down"}`;
}

/** A geometric glyph for the way the move goes, prepended to the verb. */
const DIRECTION_GLYPH: Record<
  NonNullable<RunMarkRead["action"]>["direction"],
  string
> = {
  UP: "\u25B2 ", // ▲
  DOWN: "\u25BC ", // ▼
  OVER: "\u25B6 ", // ▶
  ACROSS: "\u25B6 ", // ▶
};

function plateSpec(read: RunMarkRead) {
  const range = Math.max(1, quantise(read.rangeM, RANGE_STEP_M));
  const rangeStr = `${read.viaRoute ? "" : "~"}${range} m`;
  // An armed action reframes the plate as an INSTRUCTION on the take-off: the
  // verb is the headline, and the objective and its distance drop to the line
  // below so "where" is still on the plate but "what your body does next" is the
  // thing the eye lands on. This is the whole wayfinding fix for mission one —
  // at the foot of a climb the plate says CLIMB UP, not a distance to a tree it
  // is standing in front of.
  if (read.action) {
    const glyph = DIRECTION_GLYPH[read.action.direction];
    const isLeap = read.action.kind === "LEAP_OF_FAITH";
    return {
      title: `${glyph}${read.action.label}`,
      // The elm's name and how far is left, kept as the subtitle so the plate
      // never stops answering "where". The leap gets its promise instead of a
      // distance-to-a-tree-you-are-about-to-fly-into.
      detail: isLeap
        ? `${read.title} · it catches you`
        : `${read.title} · ${rangeStr}`,
      accent: VISOR_INK,
      tone: "BRIGHT" as const,
    };
  }
  return {
    title: read.title,
    // The tilde is the whole of the honesty about the number. A walked route
    // distance is a measurement; a straight line across a town is an estimate,
    // and the two must not print identically.
    range: rangeStr,
    detail: read.detail
      ? `${read.detail} · ${riseLabel(read.riseM)}`
      : riseLabel(read.riseM),
    accent: VISOR_INK,
    tone: "BRIGHT" as const,
  };
}

/** The key a rebuild is keyed on. Same key, same plate, no upload. */
function plateKey(read: RunMarkRead): string {
  return [
    read.title,
    read.detail ?? "",
    read.viaRoute,
    Math.max(1, quantise(read.rangeM, RANGE_STEP_M)),
    quantise(read.riseM, RISE_STEP_M),
    // The verb reframes the whole plate, so a change of imminent action is a
    // rebuild. Null between actions, which is most of the run.
    read.action?.label ?? "",
  ].join("|");
}

/** World size that subtends `px` pixels at `distance`, for this camera. */
function pxToWorld(
  px: number,
  distance: number,
  fovRad: number,
  viewportH: number,
): number {
  return (px / Math.max(1, viewportH)) * 2 * Math.tan(fovRad / 2) * distance;
}

export function VisorRunMark(props: {
  /**
   * The objective, as it stands right now, or null when there is nothing to
   * point at. Called at `READ_HZ` rather than per frame: what it returns moves
   * once or twice in a run, and the projection that has to be per-frame is done
   * here from the position it last gave.
   */
  read: () => RunMarkRead | null;
}) {
  const viewport = useThree((state) => state.size);

  // ---- the plate and the arrow, as sprites ---------------------------------
  const plate = useRef<THREE.Sprite>(null);
  const arrow = useRef<THREE.Sprite>(null);
  const chevron = useMemo(() => holoChevron(VISOR_INK), []);
  const label = useRef<ReturnType<typeof holoLabel> | null>(null);
  const labelKey = useRef("");
  const labelAspect = useRef(1);

  // ---- the ring and its stem, in the street --------------------------------
  //
  // Depth-tested, unlike the plate. That asymmetry is the hold's own rule and it
  // holds for the same reason: a NAME may be read through a wall, because
  // naming a place you cannot see is the entire job, but a shape drawn through
  // a wall is the visor solving a street it has no business solving. So the
  // ring appears as the building stops being in the way, which is exactly when
  // it starts being useful.
  const place = useRef<THREE.Group>(null);
  const street = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= 48; index += 1) {
      const angle = (index / 48) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * RING_RADIUS_M,
          0,
          Math.sin(angle) * RING_RADIUS_M,
        ),
      );
    }
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const ringMaterial = holoLineMaterial(VISOR_INK, 0.85, null);
    // A unit stem, scaled in Y each frame to reach whatever is under the mark.
    const stemGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1, 0),
    ]);
    const stemMaterial = holoLineMaterial(VISOR_INK, 0.32, null);
    return {
      ring: new THREE.Line(ringGeometry, ringMaterial),
      ringMaterial,
      stem: new THREE.Line(stemGeometry, stemMaterial),
      stemMaterial,
      geometries: [ringGeometry, stemGeometry],
    };
  }, []);

  useEffect(
    () => () => {
      chevron.dispose();
      label.current?.dispose();
      street.ringMaterial.dispose();
      street.stemMaterial.dispose();
      for (const geometry of street.geometries) geometry.dispose();
    },
    [chevron, street],
  );

  // Scratch vectors, reused: this runs every frame and three allocations a frame
  // is ten thousand short-lived vectors a run.
  const scratch = useMemo(
    () => ({
      world: new THREE.Vector3(),
      view: new THREE.Vector3(),
      ndc: new THREE.Vector3(),
      ray: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      // Only ever the third out-parameter of `extractBasis`. Its own vector
      // rather than a borrowed one, because the obvious vector to borrow is the
      // view-space position, which is still being read at that point.
      back: new THREE.Vector3(),
    }),
    [],
  );
  const held = useRef<RunMarkRead | null>(null);
  const askedAt = useRef(-1);

  useFrame(({ camera, clock }) => {
    const slice = Math.floor(clock.elapsedTime * READ_HZ);
    if (slice !== askedAt.current) {
      askedAt.current = slice;
      held.current = props.read();
    }
    const mark = held.current;

    const plateNode = plate.current;
    const arrowNode = arrow.current;
    const placeNode = place.current;
    if (!plateNode || !arrowNode || !placeNode) return;

    if (!mark) {
      plateNode.visible = false;
      arrowNode.visible = false;
      placeNode.visible = false;
      return;
    }

    // Rebuilt only when the words change, which is a few dozen times a run.
    const key = plateKey(mark);
    if (key !== labelKey.current) {
      labelKey.current = key;
      const next = holoLabel(plateSpec(mark));
      label.current?.dispose();
      label.current = next;
      labelAspect.current = next.widthPx / next.heightPx;
      plateNode.material.map = next.texture;
      plateNode.material.needsUpdate = true;
    }

    scratch.world.set(mark.pos.x, mark.pos.y, mark.pos.z);
    const distance = camera.position.distanceTo(scratch.world);
    // The retirement ramp, and the only thing that ever hides the mark while an
    // objective is open.
    //
    // SUSPENDED WHILE AN ACTION IS ARMED. The ramp exists so a name over the
    // thing you are already standing on does not become noise — right for the
    // stroll into the elm, wrong at the foot of a climb, which is exactly where
    // the mark is close enough to retire AND where the player most needs to be
    // told the wall is a climb. So while the guidance is holding a directed
    // action gateway the mark stays full: it has stopped being a label on a
    // place and become an instruction for a move, and an instruction that fades
    // as you reach the thing it is instructing is the bug this fixes.
    const alpha = mark.action
      ? 1
      : THREE.MathUtils.clamp(
          (distance - RETIRE_M) / Math.max(0.001, RETIRE_FULL_M - RETIRE_M),
          0,
          1,
        );
    if (alpha <= 0.01) {
      plateNode.visible = false;
      arrowNode.visible = false;
      placeNode.visible = false;
      return;
    }

    // ---- the ring, in the street ------------------------------------------
    placeNode.visible = true;
    placeNode.position.copy(scratch.world);
    // Down to whatever is beneath: the ground plane is the honest floor of this
    // level and the stem is a hairline, so it costs nothing to run it the whole
    // way rather than raycasting for a roof.
    street.stem.scale.y = Math.max(0.01, mark.pos.y);
    street.ringMaterial.opacity = 0.85 * alpha;
    street.stemMaterial.opacity = 0.32 * alpha;

    // ---- where the plate goes ---------------------------------------------
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = ((perspective.fov ?? 50) * Math.PI) / 180;
    const plateHeight = pxToWorld(PLATE_PX, 1, fov, viewport.height);
    plateNode.scale.set(plateHeight * labelAspect.current, plateHeight, 1);
    plateNode.material.opacity = alpha;

    scratch.view.copy(scratch.world).applyMatrix4(camera.matrixWorldInverse);
    const behind = scratch.view.z > -0.05;
    scratch.ndc.copy(scratch.world).project(camera);
    // A point behind the eye projects to the OPPOSITE side of the frame, which
    // is how an arrow comes to point away from the thing it is pointing at.
    // Flipping it is what makes turning around behave.
    if (behind) {
      scratch.ndc.x = -scratch.ndc.x;
      scratch.ndc.y = -scratch.ndc.y;
    }

    const outside =
      behind ||
      Math.abs(scratch.ndc.x) > EDGE ||
      Math.abs(scratch.ndc.y) > EDGE;

    if (!outside) {
      plateNode.visible = true;
      arrowNode.visible = false;
      plateNode.position.set(
        mark.pos.x,
        mark.pos.y + PLATE_LIFT_M,
        mark.pos.z,
      );
      return;
    }

    // Held at the edge, on the line from the middle of the frame toward the
    // thing. Scaled onto the rectangle rather than the circle so the mark rides
    // the actual border of a widescreen frame instead of an inscribed oval.
    const ax = Math.abs(scratch.ndc.x);
    const ay = Math.abs(scratch.ndc.y);
    const scale = EDGE / Math.max(ax, ay, 1e-4);
    const cx = scratch.ndc.x * scale;
    const cy = scratch.ndc.y * scale;

    scratch.ray.set(cx, cy, 0.5).unproject(camera).sub(camera.position);
    if (scratch.ray.lengthSq() < 1e-8) return;
    scratch.ray.normalize();
    camera.matrixWorld.extractBasis(scratch.right, scratch.up, scratch.back);

    const anchorX = camera.position.x + scratch.ray.x * CLAMP_DEPTH_M;
    const anchorY = camera.position.y + scratch.ray.y * CLAMP_DEPTH_M;
    const anchorZ = camera.position.z + scratch.ray.z * CLAMP_DEPTH_M;

    // The arrow sits on the border and the plate hangs inboard of it, so the
    // words are never the thing clipped by the edge of the screen. The offset
    // clears the plate's own half-extent ALONG the heading rather than a fixed
    // distance — a plate is four times wider than it is tall, so one number
    // either buries the arrow under a mark leaving sideways or strands it half
    // a frame away from one leaving over the top.
    const length = Math.hypot(cx, cy) || 1;
    const inX = -(cx / length);
    const inY = -(cy / length);
    const clearancePx =
      Math.abs(inX) * ((PLATE_PX * labelAspect.current) / 2) +
      Math.abs(inY) * (PLATE_PX / 2) +
      CHEVRON_GAP_PX;
    const gap = pxToWorld(clearancePx, CLAMP_DEPTH_M, fov, viewport.height);

    arrowNode.visible = true;
    arrowNode.position.set(anchorX, anchorY, anchorZ);
    const chevronHeight = pxToWorld(CHEVRON_PX, 1, fov, viewport.height);
    arrowNode.scale.set(chevronHeight, chevronHeight, 1);
    arrowNode.material.opacity = alpha;
    // The glyph points up in its own texture and a sprite rotates CCW, so this
    // is the turn that lands its point on the heading.
    arrowNode.material.rotation = Math.atan2(-(cx / length), cy / length);

    plateNode.visible = true;
    plateNode.position.set(
      anchorX + scratch.right.x * inX * gap + scratch.up.x * inY * gap,
      anchorY + scratch.right.y * inX * gap + scratch.up.y * inY * gap,
      anchorZ + scratch.right.z * inX * gap + scratch.up.z * inY * gap,
    );
  });

  return (
    // Everything starts hidden. The first frame has not projected anything yet,
    // and a plate with no texture at the world origin is a white square in the
    // middle of the harbour for one sixtieth of a second.
    <group name="visor-run-mark">
      <group ref={place} visible={false}>
        <primitive object={street.ring} />
        <primitive object={street.stem} />
      </group>
      <sprite ref={plate} renderOrder={12} visible={false}>
        <spriteMaterial
          transparent
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
          sizeAttenuation={false}
          fog={false}
        />
      </sprite>
      <sprite ref={arrow} renderOrder={12} visible={false}>
        <spriteMaterial
          map={chevron.texture}
          transparent
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
          sizeAttenuation={false}
          fog={false}
        />
      </sprite>
    </group>
  );
}
