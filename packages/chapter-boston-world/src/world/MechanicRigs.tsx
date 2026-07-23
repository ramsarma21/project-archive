import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { InputRequest } from "@pa/contracts";
import { DAY1_CUES } from "@pa/chapter-boston";
import { STAGE_ANCHORS } from "./choreography.js";
import { getDocumentTexture } from "./documentTextures.js";
import { FittedGlb, ImportedTexturedProp } from "./Character.js";

// World-side execution rigs for the Day 1 gamified mechanics (docs/engine/Production.md §1/§3:
// confirm the action by animating the OBJECT; the character holds a generic pose).
// Every rig is driven by the presentational "pa:mechanic-visual" browser event that
// the mechanic controls already dispatch, so runtime/event semantics stay untouched.

type MechanicKind =
  | "PRESS"
  | "EFFORT"
  | "SORT"
  | "PLACE"
  | "PRINT_JOB"
  | "HAUL_JOB"
  | "POST_JOB";
type MechanicPhase = "READY" | "ACTIVE" | "COMMIT" | "COMPLETE";

interface MechanicVisualState {
  kind: MechanicKind | null;
  stage: string | null;
  progress: number;
  active: boolean;
  phase: MechanicPhase;
  // Latched at the first COMMIT/COMPLETE so completion beats survive the
  // trailing READY event emitted when the control unmounts.
  sawCommit: boolean;
  commitAt: number;
}

export function useMechanicVisual(): { current: MechanicVisualState } {
  const state = useRef<MechanicVisualState>({
    kind: null,
    stage: null,
    progress: 0,
    active: false,
    phase: "READY",
    sawCommit: false,
    commitAt: 0,
  });
  useEffect(() => {
    const onVisual = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind?: MechanicKind;
        stage?: string;
        progress?: number;
        active?: boolean;
        phase?: MechanicPhase;
      }>).detail;
      const s = state.current;
      const phase = detail?.phase ?? (detail?.active ? "ACTIVE" : "READY");
      const nextStage = detail?.stage ?? null;
      if (nextStage !== s.stage) {
        s.stage = nextStage;
        s.sawCommit = false;
        s.commitAt = 0;
      }
      if ((phase === "COMMIT" || phase === "COMPLETE") && !s.sawCommit) {
        s.sawCommit = true;
        s.commitAt = performance.now();
      }
      s.kind = detail?.kind ?? null;
      s.progress = detail?.progress ?? 0;
      s.active = Boolean(detail?.active);
      s.phase = phase;
    };
    window.addEventListener("pa:mechanic-visual", onVisual);
    return () => window.removeEventListener("pa:mechanic-visual", onVisual);
  }, []);
  return state;
}

// Single rebind point for sheet artwork, resolved against the documents module.
function mechanicSheetTexture(
  use: "PRESS_OUTPUT" | "PRESS_OUTPUT_FINAL" | "FRESH_SHEET" | "POSTED_NOTICE",
): THREE.Texture {
  switch (use) {
    case "PRESS_OUTPUT_FINAL":
      return getDocumentTexture("FINAL_FRONT_PAGE");
    case "FRESH_SHEET":
      return getDocumentTexture("PIKE_PROOF_PLAIN");
    case "POSTED_NOTICE":
      return getDocumentTexture("CUSTOMHOUSE_NOTICE");
    default:
      return getDocumentTexture("PIKE_PROOF_STAMPED");
  }
}

const PRESS_MECHANIC_IDS = ["PRESS_PIKE_PROOF", "PIKE_REPRINT", "FINAL_PRESS_PULL"] as const;

export function isPressMechanicCueId(cueId: string | null | undefined): boolean {
  return Boolean(cueId && PRESS_MECHANIC_IDS.some((id) => cueId.includes(id)));
}

// Where the staged third-person executions stand, relative to the cue's
// player anchor: nudged out of the input panel's screen footprint for each
// authored event/checkpoint shot (cameras owned elsewhere; the action and
// its staging are ours). Consumed by Player.tsx for the body offset and here
// for companion props (the climb perch).
export const MECHANIC_STAGE_OFFSETS: [string, [number, number]][] = [
  // Spots picked by projecting the crowd ring into each authored shot and
  // keeping the whole action clear of the input panel, the task list, and
  // any closer crowd figure. CLIMB perches in the right strip; PUSH starts
  // front-right and shoves left along the clear band under the panel into
  // the crowd; CHANT stands close on the left, fists clearing the task list.
  ["EVENT_CLIMB", [5.2, 2.5]],
  ["EVENT_PUSH", [4.0, 0.9]],
  ["EVENT_CHANT", [0.4, -0.55]],
  ["CUSTOMS_SLIP", [0, 1.1]],
];

export function mechanicStageOffset(promptId: string): [number, number] {
  const entry = MECHANIC_STAGE_OFFSETS.find(([key]) => promptId.includes(key));
  return entry ? entry[1] : [0, 0];
}

// The crate the player steps onto for the climb vantage; sits exactly under
// the staged climb spot so the rise reads as mounting it.
function ClimbPerch() {
  const anchor = STAGE_ANCHORS.CROWD_PLAYER ?? [89, 0, -19];
  const [offX, offZ] = mechanicStageOffset("EVENT_CLIMB");
  return (
    <group position={[anchor[0] + offX, 0, anchor[2] + offZ]} rotation={[0, 0.4, 0]}>
      <FittedGlb
        glbKey="organizer-crate-perch"
        size={[1.45, 1.15, 1.05]}
        fallback={null}
      />
    </group>
  );
}

export function MechanicRigs(props: {
  request: InputRequest | null;
  cueId: string | null;
  interiorId: string | null;
  reducedMotion: boolean;
  objectives: Record<string, string> | null;
  playerApiRef: { current: { position: THREE.Vector3 } | null };
}) {
  const promptId = props.request?.kind === "MECHANIC" ? props.request.promptId : "";
  const mechanicKind =
    props.request?.kind === "MECHANIC" ? props.request.params.kind : null;
  return (
    <group>
      {(isPressMechanicCueId(promptId) || mechanicKind === "PRINT_JOB") && (
        <PressOutputSheet
          key={`press-output:${promptId}`}
          effortDriven={promptId.includes("FINAL_PRESS_PULL")}
          reducedMotion={props.reducedMotion}
        />
      )}
      {(props.cueId === DAY1_CUES.CATCH_SHEET ||
        mechanicKind === "PRINT_JOB") && (
        <CatchSheetToss key={`catch-toss:${props.cueId}`} reducedMotion={props.reducedMotion} />
      )}
      {promptId.includes("THOMAS_HAUL") && (
        <HaulBoltStaging key={promptId} reducedMotion={props.reducedMotion} />
      )}
      {(promptId.includes("RIDER_QUICK_HANDOFF") || promptId.includes("RIDER_GAP_HANDOFF")) && (
        <RiderBundle
          key={promptId}
          playerApiRef={props.playerApiRef}
          reducedMotion={props.reducedMotion}
        />
      )}
      {promptId.includes("EVENT_CLIMB") && <ClimbPerch />}
      {props.interiorId === "CUSTOM_HOUSE" && (
        <PostedNotice
          objectives={props.objectives}
          tackingNow={
            promptId.includes("POST_NOTICE") &&
            (mechanicKind === "POST_JOB" || mechanicKind === "PLACE")
          }
        />
      )}
    </group>
  );
}

// The imported operable press is rendered once by InteriorDirector and owns
// all mechanism geometry/animation. This companion renders only the imported
// physical output sheet with the runtime document texture.
function PressOutputSheet(props: { effortDriven: boolean; reducedMotion: boolean }) {
  const vis = useMechanicVisual();
  const sheet = useRef<THREE.Group>(null);
  const texture = useMemo(
    () => mechanicSheetTexture(props.effortDriven ? "PRESS_OUTPUT_FINAL" : "PRESS_OUTPUT"),
    [props.effortDriven],
  );
  const base = STAGE_ANCHORS.MERCER_PRESS_RIG ?? [-1.35, 0, 14.3];

  useFrame(() => {
    if (!sheet.current) return;
    const s = vis.current;
    if (s.kind === "PRINT_JOB") {
      const progress = THREE.MathUtils.clamp(s.progress, 0, 1);
      if (s.stage === "CATCH" || s.stage === "INK" || !s.stage) {
        sheet.current.visible = false;
        return;
      }
      sheet.current.visible = true;
      if (s.stage === "REGISTER") {
        const t = props.reducedMotion ? 1 : progress;
        sheet.current.position.set(
          THREE.MathUtils.lerp(0.46, 0, t),
          THREE.MathUtils.lerp(1.14, 1.02, t),
          THREE.MathUtils.lerp(0.82, 0.08, t),
        );
        sheet.current.rotation.y = THREE.MathUtils.lerp(0.14, 0, t);
        return;
      }
      if (s.stage === "PULL") {
        sheet.current.position.set(0, 1.02, 0.08);
        sheet.current.rotation.y = 0;
        return;
      }
      const peel = props.reducedMotion ? 1 : progress;
      sheet.current.position.set(0, 1.02 + peel * 0.16, 0.08 + peel * 0.68);
      sheet.current.rotation.y = peel * 0.08;
      return;
    }
    const slamT = s.sawCommit ? (performance.now() - s.commitAt) / 1000 : -1;
    let out = 0;
    if (slamT >= 0) {
      out = THREE.MathUtils.clamp((slamT - 0.14) / 0.32, 0, 1);
    }
    if (props.reducedMotion) {
      out = slamT >= 0 ? 1 : 0;
    }
    sheet.current.visible = out > 0.01;
    const glide = 1 - (1 - out) * (1 - out);
    sheet.current.position.set(0, 1.02, 0.05 + glide * 0.7);
  });

  return (
    <group position={[base[0], base[1], base[2]]}>
      <group ref={sheet} position={[0, 1.01, 0.06]} visible={false}>
        <group rotation={[-Math.PI / 2, 0, 0.04]}>
          <ImportedTexturedProp
            texture={texture}
            size={[0.46, 0.16, 0.6]}
          />
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// 2. Catch the sheet: Abigail's toss, a world-space arc from her hand toward
// the camera, timed so the first-person fluttering paper takes over.
// ---------------------------------------------------------------------------

const TOSS_DELAY = 0.35;
const TOSS_DURATION = 0.85;

function CatchSheetToss(props: { reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera);
  const ref = useRef<THREE.Group>(null);
  const firstFrameAt = useRef<number | null>(null);
  const texture = useMemo(() => mechanicSheetTexture("FRESH_SHEET"), []);
  const end = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3());

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (props.reducedMotion) {
      g.visible = false;
      return;
    }
    if (firstFrameAt.current === null) firstFrameAt.current = performance.now();
    const t = (performance.now() - firstFrameAt.current) / 1000;
    const raw = THREE.MathUtils.clamp((t - TOSS_DELAY) / TOSS_DURATION, 0, 1);
    if (raw >= 0.97) {
      // Hidden as the first-person fluttering paper takes over.
      g.visible = false;
      return;
    }
    g.visible = true;
    const startArr = STAGE_ANCHORS.MERCER_ABIGAIL_HAND ?? [0, 1.2, 14.85];
    camera.getWorldDirection(forward.current);
    end.current.copy(camera.position).addScaledVector(forward.current, 1.35);
    end.current.y -= 0.16;
    const sx = startArr[0];
    const sy = startArr[1];
    const sz = startArr[2];
    // Quadratic arc with a lofted control point above the midpoint.
    const cx = (sx + end.current.x) / 2;
    const cy = (sy + end.current.y) / 2 + 0.42;
    const cz = (sz + end.current.z) / 2;
    const u = 1 - raw;
    g.position.set(
      u * u * sx + 2 * u * raw * cx + raw * raw * end.current.x,
      u * u * sy + 2 * u * raw * cy + raw * raw * end.current.y,
      u * u * sz + 2 * u * raw * cz + raw * raw * end.current.z,
    );
    g.rotation.set(-0.35 - raw * 0.5, -2.7, 0.25 + Math.sin(raw * Math.PI * 2) * 0.35);
  });

  return (
    <group ref={ref} visible={false}>
      <ImportedTexturedProp texture={texture} size={[0.28, 0.12, 0.38]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// 3. Thomas haul: cloth bolt staging. The carried bolt itself is rendered by
// the player rig (CarriedClothBolt below); this stages the world copy at the
// cloth stack while idle and snaps it onto the counter on completion.
// ---------------------------------------------------------------------------

function BoltMeshes() {
  return (
    <FittedGlb
      glbKey="int-textile-personal-cluster"
      size={[0.9, 0.5, 0.65]}
      fallback={<group />}
    />
  );
}

function HaulBoltStaging(props: { reducedMotion: boolean }) {
  const vis = useMechanicVisual();
  const ref = useRef<THREE.Group>(null);
  const stack = STAGE_ANCHORS.THOMAS_WORK ?? [-70.55, 0.85, -14.5];

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const s = vis.current;
    const counter = STAGE_ANCHORS.THOMAS_COUNTER ?? [-69.55, 1.12, -16.05];
    const compoundDone =
      s.kind === "HAUL_JOB" &&
      s.stage === "THREAD" &&
      (s.sawCommit || s.progress >= 0.999);
    if (compoundDone || (s.kind !== "HAUL_JOB" && (s.sawCommit || s.progress >= 0.999))) {
      // Completion beat: the bolt snaps onto the counter stack.
      g.visible = true;
      g.position.set(counter[0], counter[1], counter[2]);
      g.rotation.set(0, 0.3, 0);
    } else if (
      s.kind === "HAUL_JOB"
        ? s.stage === "BALANCE" || s.stage === "THREAD"
        : s.active && !props.reducedMotion
    ) {
      // The player is carrying it (see CarriedClothBolt inside the player rig).
      g.visible = false;
    } else {
      g.visible = true;
      g.position.set(stack[0], stack[1], stack[2]);
      g.rotation.set(0.08, 0.45, 0);
    }
  });

  return (
    <group ref={ref} position={[stack[0], stack[1], stack[2]]}>
      <BoltMeshes />
    </group>
  );
}

// Rendered inside the player's body group during THOMAS_HAUL so the bolt
// follows the shuttle walk. Visible only while the hold is live.
export function CarriedClothBolt(props: { reducedMotion: boolean }) {
  const vis = useMechanicVisual();
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const s = vis.current;
    g.visible =
      !props.reducedMotion &&
      (s.kind === "HAUL_JOB"
        ? (s.stage === "BALANCE" || s.stage === "THREAD") &&
          !(s.stage === "THREAD" && s.sawCommit)
        : s.active && !s.sawCommit && s.progress < 0.999);
  });
  return (
    <group ref={ref} position={[0, 1.02, 0.34]} rotation={[-0.08, 0, 0]} visible={false} scale={0.85}>
      <BoltMeshes />
    </group>
  );
}

// ---------------------------------------------------------------------------
// 5. Rider handoff: the bundle travels from the player's hands to the rider
// as the hold progresses, snapping into the rider's grip at completion.
// ---------------------------------------------------------------------------

function RiderBundle(props: {
  playerApiRef: { current: { position: THREE.Vector3 } | null };
  reducedMotion: boolean;
}) {
  const vis = useMechanicVisual();
  const ref = useRef<THREE.Group>(null);
  const rider = STAGE_ANCHORS.RIDER_ACTOR ?? [-96.8, 0, -18.2];
  const fallback = STAGE_ANCHORS.RIDER_PLAYER ?? [-95, 0, -17];

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const s = vis.current;
    const done = s.sawCommit || s.progress >= 0.999;
    const player = props.playerApiRef.current?.position;
    const px = player?.x ?? fallback[0];
    const pz = player?.z ?? fallback[2];
    let nx = rider[0] - px;
    let nz = rider[2] - pz;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    const sx = px + nx * 0.45;
    const sz = pz + nz * 0.45;
    const ex = rider[0] - nx * 0.3;
    const ez = rider[2] - nz * 0.3;
    if (props.reducedMotion) {
      g.visible = done;
      g.position.set(ex, 1.02, ez);
      g.rotation.set(0, Math.atan2(nx, nz), 0);
      return;
    }
    const p = done ? 1 : s.progress;
    g.visible = done || (s.active && p > 0.08);
    const t = p * p * (3 - 2 * p);
    g.position.set(
      THREE.MathUtils.lerp(sx, ex, t),
      THREE.MathUtils.lerp(1.02, 1.1, t) + Math.sin(t * Math.PI) * 0.1,
      THREE.MathUtils.lerp(sz, ez, t),
    );
    g.rotation.set(0, Math.atan2(nx, nz), Math.sin(t * Math.PI) * 0.18);
  });

  return (
    <group ref={ref} visible={false}>
      <FittedGlb
        glbKey="paper-satchel"
        size={[0.5, 0.3, 0.35]}
        fallback={<group />}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// 7. Pike sort assignment tracking, shared with the first-person sort fan.
// Assigning an item in the sort UI (pa:sort-assign) gives that sheet a pile
// slot: left for the first bucket (needs the stamp), right for the second.
// ---------------------------------------------------------------------------

export interface SortAssignSlot {
  bucketId: string;
  pileIndex: number;
}

export function useSortAssignments(): { current: Map<string, SortAssignSlot> } {
  const assignments = useRef(new Map<string, SortAssignSlot>());
  useEffect(() => {
    const onAssign = (event: Event) => {
      const detail = (event as CustomEvent<{ itemId?: string; bucketId?: string }>).detail;
      if (!detail?.itemId || !detail.bucketId) return;
      assignments.current.delete(detail.itemId);
      const pileIndex = [...assignments.current.values()].filter(
        (entry) => entry.bucketId === detail.bucketId,
      ).length;
      assignments.current.set(detail.itemId, { bucketId: detail.bucketId, pileIndex });
    };
    window.addEventListener("pa:sort-assign", onAssign);
    return () => window.removeEventListener("pa:sort-assign", onAssign);
  }, []);
  return assignments;
}

// Wraps one fanned sort item (whatever mesh the documents module renders for
// it) and slides it onto the matching pile when the player assigns it:
// left for "needs the stamp", right for "does not".
export function SortFanSlide(props: {
  itemId: string;
  basePosition: [number, number, number];
  baseRotation: [number, number, number];
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const assignments = useSortAssignments();
  const ref = useRef<THREE.Group>(null);
  const target = useMemo(
    () => ({ position: new THREE.Vector3(), rotation: new THREE.Euler() }),
    [],
  );
  useFrame((_, rawDt) => {
    const g = ref.current;
    if (!g) return;
    const assigned = assignments.current.get(props.itemId);
    if (assigned) {
      const side = assigned.bucketId === "NEEDS_STAMP" ? -1 : 1;
      target.position.set(
        side * 0.47,
        -0.035 + assigned.pileIndex * 0.014,
        0.02 + assigned.pileIndex * 0.005,
      );
      target.rotation.set(0, 0, side * 0.1 - assigned.pileIndex * 0.03);
    } else {
      target.position.set(...props.basePosition);
      target.rotation.set(...props.baseRotation);
    }
    const blend = props.reducedMotion ? 1 : 1 - Math.exp(-10 * Math.min(rawDt, 0.05));
    g.position.lerp(target.position, blend);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, target.rotation.x, blend);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, target.rotation.y, blend);
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, target.rotation.z, blend);
  });
  return (
    <group ref={ref} position={props.basePosition} rotation={props.baseRotation}>
      {props.children}
    </group>
  );
}

// ---------------------------------------------------------------------------
// 4. Posted notice: once the Custom House notice is tacked, the board inside
// the hall carries the posted sheet (plus its two tacks) from then on.
// ---------------------------------------------------------------------------

function PostedNotice(props: {
  objectives: Record<string, string> | null;
  tackingNow: boolean;
}) {
  const vis = useMechanicVisual();
  const ref = useRef<THREE.Group>(null);
  const texture = useMemo(() => mechanicSheetTexture("POSTED_NOTICE"), []);
  const posted = props.objectives?.CUSTOMHOUSE_NOTICE === "COMPLETED";
  const board = STAGE_ANCHORS.CUSTOMHOUSE_BOARD ?? [50.6, 1.25, 16.7];

  useFrame(() => {
    if (!ref.current) return;
    ref.current.visible = posted || (props.tackingNow && vis.current.sawCommit);
  });

  return (
    <group
      ref={ref}
      position={[board[0], board[1] + 0.18, board[2] - 0.04]}
      rotation={[0, Math.PI, 0]}
      visible={posted}
    >
      <ImportedTexturedProp texture={texture} size={[0.34, 0.14, 0.46]} />
    </group>
  );
}
