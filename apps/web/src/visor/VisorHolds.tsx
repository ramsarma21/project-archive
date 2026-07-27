import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { holoLabel } from "./holoLabel.js";
import { holoLineMaterial } from "./VisorMarks.js";
import { VISOR_CYAN, VISOR_INK } from "./visorPalette.js";

// ---------------------------------------------------------------------------
// The catch line.
//
// Every edge this draws is an edge the verb ladder has already agreed to catch.
// It is the vocabulary lesson the mission never gave: ten of the twelve verbs
// fire off geometry with no key, which only works if a player can look at a wall
// and know, and nothing in the city distinguished a parapet you can pull onto
// from a wall you cannot.
//
// WHY A LINE ON THE LIP AND NOT A GLOW ON THE OBJECT. The lip is where the hands
// go. Outlining the whole crate says "this crate is special"; a line along its
// top edge says "catch here", which is a different and much more useful
// sentence, and it teaches the player to look at edges — which is the actual
// skill this level wants. It also means the drawing carries the second read for
// free: a line at knee height is obviously a vault and a line at head height is
// obviously a climb, so the height of the thing IS the label, and no legend is
// needed for a language with one mark in it.
//
// DEPTH-TESTED, WHICH IS THE HOUSE RULE. The standing mark's plate may be read
// through a wall because naming a place you cannot see is its whole job; a SHAPE
// drawn through a wall is the visor solving a street it has no business solving.
// So an edge appears as the building stops being in the way, which is exactly
// when it becomes useful, and a player never gets an x-ray of the block.
//
// IT FADES BECAUSE IT IS TEACHING. `read().strength` falls as the player
// performs verbs; see mission/affordance.ts. The first minute is annotated, the
// third is a hairline, and a second run barely shows it.
// ---------------------------------------------------------------------------

/** One drawn edge. Plain data — this file knows no physics and no route. */
export interface HoldMark {
  readonly id: string;
  readonly verb: string;
  readonly a: { readonly x: number; readonly y: number; readonly z: number };
  readonly b: { readonly x: number; readonly y: number; readonly z: number };
  /** Outward normal of the face this edge tops, so the band hangs on it. */
  readonly outX: number;
  readonly outZ: number;
  readonly nearness: number;
}

export interface HoldsRead {
  readonly holds: readonly HoldMark[];
  readonly strength: number;
}

/**
 * The live offer, asked every frame.
 *
 * Separate from the edges, and the separation is load-bearing. The edges change
 * as the player crosses the city, which is slow, and re-surveying them per frame
 * would be work for nothing. The OFFER changes in a tenth of a second — it is
 * the reader saying "the next thing that happens is a vault" — and a caption
 * sampled five times a second misses its own window: measured, the offer stood
 * for about three samples and the first build of this drew nothing at all.
 */
export interface OfferRead {
  /** The verb the reader is offering right now, or "NONE". */
  readonly offered: string;
  /** True while the player has not yet performed that verb. */
  readonly offeredIsNew: boolean;
  /** The caption for it, or null. Composed by the mission, printed here. */
  readonly caption: string | null;
  /** Where the player is, so the caption can be placed near the geometry. */
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  /** Which way they are travelling, for the same reason. */
  readonly dirX: number;
  readonly dirZ: number;
}

/** How often the survey is re-asked. The world is static; the player is not. */
const READ_HZ = 5;
/** Ceiling on drawn segments. Sized so one allocation covers every sample. */
const MAX_SEGMENTS = 16;
/** Lifted off the surface so a line on a roof lip does not z-fight the roof. */
const LIFT_M = 0.035;
/** The brightest an edge is ever drawn, before nearness and strength. */
const EDGE_OPACITY = 0.9;
/**
 * Height of the band painted on the face under the lip.
 *
 * A one-pixel line is what the visor's own route lines learned not to be: at any
 * distance it is a scratch on the glass rather than a thing in the street, and
 * it does not recede. So the lip carries a crisp core line and the face under it
 * carries a short band, which is real geometry and therefore thins with range.
 * It also reads from below — the angle a player actually approaches a wall from,
 * where a line lying flat along the top edge is very nearly edge-on.
 */
const BAND_M = 0.16;
/**
 * Weight of the band relative to the core line.
 *
 * Additive over a torchlit street is a weak blend — the market is already warm
 * and bright, and the first pass at a third of the core's weight disappeared
 * into it. The mark has to survive the one place a player most needs it, which
 * is the lit ground rather than the dark roof.
 */
const BAND_WEIGHT = 0.6;
/** Pushed off the face by this, so the band does not z-fight the wall. */
const BAND_PROUD_M = 0.02;
/** Edges nearer the camera than this are not drawn. See the cull below. */
const NEAR_CAMERA_M = 2.4;

/** Drawn height of the caption, in pixels, at any range. */
const CAPTION_PX = 34;
/** Metres in front of the player the caption is planted. */
const CAPTION_AHEAD_M = 1.9;
/** How far above the footing it rides. Head height, so it is read at a glance. */
const CAPTION_RISE_M = 1.75;
/**
 * Seconds a caption stays up once the offer that raised it has gone.
 *
 * Longer than it looks like it should be, and measured rather than guessed. The
 * probe reads 2.2m ahead, so at sprint speed the offer itself stands for about a
 * quarter of a second — traced at 244ms on the approach to the gaol barrels —
 * and a word on screen for 244ms is a flicker nobody reads. Since the caption is
 * raised at most once per verb per run, dwelling on it costs nothing and is the
 * difference between teaching and blinking.
 */
const CAPTION_HOLD_S = 1.4;
/** Seconds it takes to fade out after that. */
const CAPTION_FADE_S = 0.5;

function pxToWorld(px: number, fovRad: number, viewportH: number): number {
  return (px / Math.max(1, viewportH)) * 2 * Math.tan(fovRad / 2);
}

export function VisorHolds(props: {
  /**
   * The cue, as it stands. Called at `READ_HZ` rather than per frame: the survey
   * is cached against a static world and what changes between frames is only
   * which edges are in range, which does not move in a sixtieth of a second.
   */
  read: () => HoldsRead | null;
  /** The live offer. Called every frame; see `OfferRead`. */
  offer: () => OfferRead | null;
}) {
  const viewport = useThree((state) => state.size);

  // ---- the edges ----------------------------------------------------------
  //
  // One geometry with a fixed vertex budget, rewritten in place. A fresh
  // BufferGeometry per sample is five uploads a second and a steady drip of
  // GPU garbage for a run that lasts three minutes.
  const edges = useMemo(() => {
    const linePositions = new Float32Array(MAX_SEGMENTS * 2 * 3);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(linePositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    lineGeometry.setDrawRange(0, 0);
    const lineMaterial = holoLineMaterial(VISOR_INK, EDGE_OPACITY, null);
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);

    // Two triangles per hold. The vertex buffer is written in place every
    // sample, so the bounding sphere three would compute is always the previous
    // sample's — culling against it drops edges that are on screen. Turning the
    // cull off is the correct answer for geometry that moves: the budget is
    // sixteen quads and testing them is cheaper than maintaining a sphere.
    const bandPositions = new Float32Array(MAX_SEGMENTS * 6 * 3);
    const bandGeometry = new THREE.BufferGeometry();
    bandGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(bandPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    bandGeometry.setDrawRange(0, 0);
    const bandMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(VISOR_CYAN),
      transparent: true,
      opacity: EDGE_OPACITY * BAND_WEIGHT,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const bands = new THREE.Mesh(bandGeometry, bandMaterial);
    lines.frustumCulled = false;
    bands.frustumCulled = false;

    return {
      linePositions,
      lineGeometry,
      lineMaterial,
      lines,
      bandPositions,
      bandGeometry,
      bandMaterial,
      bands,
    };
  }, []);

  // ---- the caption --------------------------------------------------------
  const caption = useRef<THREE.Sprite>(null);
  const label = useRef<ReturnType<typeof holoLabel> | null>(null);
  const labelKey = useRef("");
  const labelAspect = useRef(4);
  /** Where the caption was planted, so it stays put while the player runs on. */
  const plantedAt = useRef(new THREE.Vector3());
  /** Seconds since the offer that raised it stopped being offered. */
  const sinceOffer = useRef(Number.POSITIVE_INFINITY);

  useEffect(
    () => () => {
      label.current?.dispose();
      edges.lineMaterial.dispose();
      edges.lineGeometry.dispose();
      edges.bandMaterial.dispose();
      edges.bandGeometry.dispose();
    },
    [edges],
  );

  const held = useRef<HoldsRead | null>(null);
  const askedAt = useRef(-1);

  useFrame(({ camera, clock }, delta) => {
    const slice = Math.floor(clock.elapsedTime * READ_HZ);
    if (slice !== askedAt.current) {
      askedAt.current = slice;
      held.current = props.read();
    }
    const read = held.current;
    const captionNode = caption.current;

    if (!read || read.strength <= 0.01) {
      edges.lines.visible = false;
      edges.bands.visible = false;
      if (captionNode) captionNode.visible = false;
      return;
    }

    // ---- edges ------------------------------------------------------------
    let lineVertex = 0;
    let bandVertex = 0;
    let brightest = 0;
    for (const hold of read.holds) {
      if (lineVertex >= MAX_SEGMENTS * 2) break;
      // An edge a hand's breadth from the eye is a pale slab across a quarter of
      // the frame, and it happens constantly: the chase camera sits three metres
      // behind the player, so running past a crate puts that crate's near face
      // between the camera and everything. The cue is about what is AHEAD, so an
      // edge the camera has already gone past is dropped rather than drawn very
      // large.
      const cameraRange = Math.hypot(
        (hold.a.x + hold.b.x) / 2 - camera.position.x,
        (hold.a.y + hold.b.y) / 2 - camera.position.y,
        (hold.a.z + hold.b.z) / 2 - camera.position.z,
      );
      if (cameraRange < NEAR_CAMERA_M) continue;

      const topY = hold.a.y + LIFT_M;

      const at = lineVertex * 3;
      edges.linePositions[at] = hold.a.x;
      edges.linePositions[at + 1] = topY;
      edges.linePositions[at + 2] = hold.a.z;
      edges.linePositions[at + 3] = hold.b.x;
      edges.linePositions[at + 4] = topY;
      edges.linePositions[at + 5] = hold.b.z;
      lineVertex += 2;

      // The band hangs off the lip on the face the body approaches from, which
      // is the face whose outward normal the survey recorded.
      const ax = hold.a.x + hold.outX * BAND_PROUD_M;
      const az = hold.a.z + hold.outZ * BAND_PROUD_M;
      const bx = hold.b.x + hold.outX * BAND_PROUD_M;
      const bz = hold.b.z + hold.outZ * BAND_PROUD_M;
      const lowY = topY - BAND_M;
      const quad = [
        ax, topY, az,
        bx, topY, bz,
        bx, lowY, bz,
        ax, topY, az,
        bx, lowY, bz,
        ax, lowY, az,
      ];
      edges.bandPositions.set(quad, bandVertex * 3);
      bandVertex += 6;

      brightest = Math.max(brightest, hold.nearness);
    }
    edges.lineGeometry.attributes.position!.needsUpdate = true;
    edges.lineGeometry.setDrawRange(0, lineVertex);
    edges.bandGeometry.attributes.position!.needsUpdate = true;
    edges.bandGeometry.setDrawRange(0, bandVertex);
    edges.lines.visible = lineVertex > 0;
    edges.bands.visible = bandVertex > 0;
    // The whole set is drawn at one opacity rather than per-edge, because each
    // of the two objects has one material — and the nearest edge's weight is the
    // right one to use: it is the edge the next second is about, and the far
    // ones riding along with it is what makes the set read as one language
    // rather than as ten separate notifications.
    const weight = read.strength * (0.35 + 0.65 * brightest);
    edges.lineMaterial.opacity = EDGE_OPACITY * weight;
    edges.bandMaterial.opacity = EDGE_OPACITY * BAND_WEIGHT * weight;

    // ---- the caption ------------------------------------------------------
    //
    // Raised the first time the reader offers a verb the player has never
    // performed, planted in the world at the geometry, and never raised for
    // that verb again. It is the one moment a word is worth more than a line:
    // the player is looking at the thing, the thing is about to do something,
    // and naming it once is the difference between a vault that felt like a
    // move and a vault that felt like the game glitching.
    if (!captionNode) return;

    const offer = props.offer();
    const wants = offer !== null && offer.offeredIsNew && offer.caption !== null;
    if (wants && offer) {
      sinceOffer.current = 0;
      const key = offer.caption!;
      if (key !== labelKey.current) {
        labelKey.current = key;
        const next = holoLabel({ title: key, accent: VISOR_INK, tone: "BRIGHT" });
        label.current?.dispose();
        label.current = next;
        labelAspect.current = next.widthPx / next.heightPx;
        captionNode.material.map = next.texture;
        captionNode.material.needsUpdate = true;
      }
      // Planted where the body is heading rather than on the body, so the words
      // sit against the thing they are about and do not ride along on the
      // player's shoulder like a HUD sticker that happened to be in the scene.
      plantedAt.current.set(
        offer.at.x + offer.dirX * CAPTION_AHEAD_M,
        offer.at.y + CAPTION_RISE_M,
        offer.at.z + offer.dirZ * CAPTION_AHEAD_M,
      );
    } else {
      sinceOffer.current += delta;
    }

    const age = sinceOffer.current;
    const alpha =
      age <= CAPTION_HOLD_S
        ? 1
        : Math.max(0, 1 - (age - CAPTION_HOLD_S) / CAPTION_FADE_S);
    if (alpha <= 0.01 || !label.current) {
      captionNode.visible = false;
      return;
    }

    const perspective = camera as THREE.PerspectiveCamera;
    const fov = ((perspective.fov ?? 50) * Math.PI) / 180;
    const height = pxToWorld(CAPTION_PX, fov, viewport.height);
    captionNode.visible = true;
    captionNode.position.copy(plantedAt.current);
    captionNode.scale.set(height * labelAspect.current, height, 1);
    captionNode.material.opacity = alpha;
  });

  return (
    <group name="visor-holds">
      <primitive object={edges.lines} />
      <primitive object={edges.bands} />
      {/* Not depth-tested, unlike the edges: a caption is a NAME, and the
          house rule is that names may be read through the world while shapes
          may not. It is also on screen for under a second. */}
      <sprite ref={caption} renderOrder={12} visible={false}>
        <spriteMaterial
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
