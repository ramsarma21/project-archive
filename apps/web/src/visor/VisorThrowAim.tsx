import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { holoLabel } from "./holoLabel.js";
import { holoLineMaterial } from "./VisorMarks.js";
import { VISOR_CYAN, VISOR_INK } from "./visorPalette.js";

// ---------------------------------------------------------------------------
// The throw's aim, before it is thrown.
//
// The diversion is aim-and-release: the object cannot miss in a way the player
// can learn from unless they can see where it will land before they commit, and
// three charges is far too few to learn a lottery from. So while the throw key
// is held this draws where the bottle would come to rest and how far its landing
// carries — the SAME solve the live object will run, through `previewThrow`, so
// what is shown is what will happen, including a wall short of where they aimed.
//
// PROCEDURAL, AND ALLOWED TO BE. Nothing here is a physical production object:
// it is an aim cue, the same class of annotation as the standing mark's ring and
// the catch line, both of which are drawn from THREE primitives. The thrown
// OBJECT itself is a different matter — it has no imported GLB yet and so is not
// drawn at all; see the note in MissionStage.
//
// IT SAYS WHY, WHEN IT CANNOT. A refused throw — no charges, out of range, no
// room to release — draws no arc and no ring, because a landing ring for a throw
// that will not happen is a lie. It raises the reason instead, in a word, so the
// player learns the difference between "I threw and missed" and "it never left
// my hand".
// ---------------------------------------------------------------------------

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ThrowAimRead {
  /** Where the throw is released from — the player. */
  readonly from: Point3;
  /** Where the player is pointing, at the clamped range. */
  readonly aim: Point3;
  /** True when a throw from here would be accepted. */
  readonly ok: boolean;
  /** Where the object would settle, or null when it never does. */
  readonly restsAt: Point3 | null;
  /** Audible radius of the landing, for the ground ring. */
  readonly radiusM: number;
  /**
   * The object's position at each simulated tick, release point first.
   *
   * The ACTUAL flight the release will produce — the same `stepDiversion`
   * against the same bodies — so the drawn arc bends around the same wall and
   * stops at the same civilian. Empty when there is no throw to draw.
   */
  readonly samples: readonly Point3[];
  /** Why a throw would be refused, as one line, or null when it would be taken. */
  readonly message: string | null;
}

/** The most trajectory points the arc will draw; long flights are strided onto it. */
const ARC_MAX = 128;
const RING_SEGMENTS = 48;
/** Lifted off the ground so the ring does not z-fight the street. */
const RING_LIFT_M = 0.04;
/** Drawn height of the refusal word, in pixels, at any range. */
const REFUSAL_PX = 30;
/** How high above the player the refusal word rides. */
const REFUSAL_RISE_M = 1.9;

function pxToWorld(px: number, fovRad: number, viewportH: number): number {
  return (px / Math.max(1, viewportH)) * 2 * Math.tan(fovRad / 2);
}

export function VisorThrowAim(props: {
  /**
   * The aim, as it stands, or null when the player is not aiming a throw. Read
   * every frame: the look moves continuously and the arc must track it, and the
   * solve behind it is bounded and cheap enough to run while a key is held.
   */
  read: () => ThrowAimRead | null;
}) {
  const viewport = useThree((state) => state.size);

  const parts = useMemo(() => {
    // The arc: a line strip rewritten in place every frame it is visible.
    const arcPositions = new Float32Array(ARC_MAX * 3);
    const arcGeometry = new THREE.BufferGeometry();
    arcGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(arcPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    arcGeometry.setDrawRange(0, 0);
    const arcMaterial = holoLineMaterial(VISOR_INK, 0.85, null);
    const arc = new THREE.Line(arcGeometry, arcMaterial);
    arc.frustumCulled = false;

    // The landing ring: a unit circle in the ground plane, scaled to the
    // audible radius each frame.
    const ringPoints: THREE.Vector3[] = [];
    for (let index = 0; index <= RING_SEGMENTS; index += 1) {
      const angle = (index / RING_SEGMENTS) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    }
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMaterial = holoLineMaterial(VISOR_CYAN, 0.9, null);
    const ring = new THREE.Line(ringGeometry, ringMaterial);
    ring.frustumCulled = false;

    return { arcPositions, arcGeometry, arcMaterial, arc, ringGeometry, ringMaterial, ring };
  }, []);

  const refusal = useRef<THREE.Sprite>(null);
  const label = useRef<ReturnType<typeof holoLabel> | null>(null);
  const labelKey = useRef("");
  const labelAspect = useRef(4);

  useEffect(
    () => () => {
      label.current?.dispose();
      parts.arcMaterial.dispose();
      parts.arcGeometry.dispose();
      parts.ringMaterial.dispose();
      parts.ringGeometry.dispose();
    },
    [parts],
  );

  useFrame(({ camera }) => {
    const read = props.read();
    const refusalNode = refusal.current;

    if (!read) {
      parts.arc.visible = false;
      parts.ring.visible = false;
      if (refusalNode) refusalNode.visible = false;
      return;
    }

    const samples = read.samples;

    // ---- the arc and the landing ring, only for a throw that will happen ----
    //
    // The arc is the object's OWN trajectory, sample for sample, not a curve fit
    // to its endpoints: a synthetic parabola would lie about a throw that clips a
    // parapet or stops at a body, which is exactly the read the aim is for.
    if (read.ok && samples.length >= 2) {
      // Long flights (a throw that bounces a while) are strided onto the fixed
      // buffer; the final sample is always included so the line reaches the rest.
      const stride = Math.max(1, Math.ceil(samples.length / ARC_MAX));
      let count = 0;
      const put = (point: Point3): void => {
        if (count >= ARC_MAX) return;
        const at = count * 3;
        parts.arcPositions[at] = point.x;
        parts.arcPositions[at + 1] = point.y;
        parts.arcPositions[at + 2] = point.z;
        count += 1;
      };
      let lastIndex = -1;
      for (let index = 0; index < samples.length && count < ARC_MAX; index += stride) {
        put(samples[index]!);
        lastIndex = index;
      }
      if (lastIndex !== samples.length - 1) put(samples[samples.length - 1]!);

      parts.arcGeometry.attributes.position!.needsUpdate = true;
      parts.arcGeometry.setDrawRange(0, count);
      parts.arc.visible = count >= 2;

      const rest = read.restsAt ?? samples[samples.length - 1]!;
      parts.ring.visible = true;
      parts.ring.position.set(rest.x, rest.y + RING_LIFT_M, rest.z);
      const radius = Math.max(0.2, read.radiusM);
      parts.ring.scale.set(radius, 1, radius);
    } else {
      parts.arc.visible = false;
      parts.ring.visible = false;
    }

    // ---- the reason, only when the throw is refused ------------------------
    if (!refusalNode) return;
    if (read.ok || read.message === null) {
      refusalNode.visible = false;
      return;
    }
    if (read.message !== labelKey.current) {
      labelKey.current = read.message;
      const next = holoLabel({ title: read.message, accent: VISOR_INK, tone: "DIM" });
      label.current?.dispose();
      label.current = next;
      labelAspect.current = next.widthPx / next.heightPx;
      refusalNode.material.map = next.texture;
      refusalNode.material.needsUpdate = true;
    }
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = ((perspective.fov ?? 50) * Math.PI) / 180;
    const height = pxToWorld(REFUSAL_PX, fov, viewport.height);
    refusalNode.visible = true;
    refusalNode.position.set(read.from.x, read.from.y + REFUSAL_RISE_M, read.from.z);
    refusalNode.scale.set(height * labelAspect.current, height, 1);
  });

  return (
    <group name="visor-throw-aim">
      <primitive object={parts.arc} />
      <primitive object={parts.ring} />
      {/* A NAME, so it is not depth-tested: the reason a throw was refused must
          be readable even when the player is tucked behind the cover that
          refused it. */}
      <sprite ref={refusal} renderOrder={12} visible={false}>
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
