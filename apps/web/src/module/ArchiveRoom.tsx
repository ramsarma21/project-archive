import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";
import { fieldRandom } from "@pa/engine-world";
import type { ArchiveFileStatus } from "./archiveLayout.js";
import type { ModulePresenter } from "./moduleFormat.js";
import { SystemPresenter } from "./SystemPresenter.js";
import {
  RACK_CENTER_X,
  ROOM_CAMERA,
  SLAB,
  cornerBracketPositions,
  makeSlabFaceTexture,
  makeSlabMaterial,
  rackPlacements,
  slabPalette,
  slabStateFor,
  type SlabVisualState,
} from "./archiveHologram.js";
import {
  playArchiveHandoff,
  playArchiveHover,
  playArchiveOpen,
  playArchiveSealed,
  setArchiveAudioMuted,
} from "./archiveAudio.js";
import "./module.css";

// ---------------------------------------------------------------------------
// The Archive room — a 3D holographic case-file display.
//
// This REPLACES the flat DOM shelf that ModuleArchive used to render for its
// index. The lesson's behaviour is untouched: this is presentation only. The
// same `archiveLayout` decides which files exist and which are locked; this
// component just draws them as projected slabs in a dark briefing room and
// reports a chosen file back up. Selecting a file is a MOVE — the slab lifts
// out of the rack and expands as the room dims — and then the existing
// ModuleFilePlayer takes over inside the file, its shot director unchanged.
//
// Everything visible here is projected light: procedural shaders, a grid floor,
// fog, particles and canvas-drawn file faces, which the workspace rule permits
// for Archive UI. Nothing is a physical prop, so nothing is an imported mesh —
// except the presenter, who is (and stays) her imported rigged GLB.
// ---------------------------------------------------------------------------

/** One file as the room needs to draw it — derived from the layout by the caller. */
export interface ArchiveRoomFile {
  readonly ordinal: number;
  readonly title: string;
  readonly note: string;
  readonly status: ArchiveFileStatus;
}

export interface ArchiveRoomProps {
  readonly title: string;
  readonly subtitle: string;
  readonly kicker: string;
  readonly clockLabel: string;
  readonly files: readonly ArchiveRoomFile[];
  readonly hasBrief: boolean;
  readonly briefReady: boolean;
  readonly reducedMotion: boolean;
  readonly presenter?: ModulePresenter;
  readonly onOpenFile: (index: number) => void;
  readonly onPlayBrief: () => void;
  readonly onExit: () => void;
}

/** A slot the room draws and the player can focus: a file, or the handoff brief. */
interface RoomSlot {
  readonly kind: "FILE" | "BRIEF";
  /** File index into `files`, or -1 for the brief. */
  readonly fileIndex: number;
  readonly ordinalLabel: string;
  readonly title: string;
  readonly note: string;
  readonly conceptTag: string;
  readonly state: SlabVisualState;
  readonly openable: boolean;
}

const SELECT_SECONDS = 0.7;

function ease(t: number): number {
  // A soft ease-in-out so the lift settles rather than snapping.
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// One projected file slab: shader body, canvas "dossier" face, edge frame, and
// reticle brackets. Reads its live focus/selection from shared refs so the rack
// re-renders React only when the logical slots change, not every frame.
// ---------------------------------------------------------------------------

interface SelectState {
  index: number | null;
  t: number;
  done: boolean;
}

function Slab(props: {
  slot: RoomSlot;
  slotIndex: number;
  placement: { position: readonly [number, number, number]; rotationY: number; driftPhase: number };
  reducedMotion: boolean;
  focusRef: MutableRefObject<number | null>;
  selectRef: MutableRefObject<SelectState>;
  onHover: (slotIndex: number) => void;
  onActivate: (slotIndex: number) => void;
}) {
  const { slot, placement, reducedMotion } = props;
  const groupRef = useRef<THREE.Group>(null);
  const material = useMemo(() => makeSlabMaterial(reducedMotion), [reducedMotion]);
  const palette = useMemo(() => slabPalette(slot.state), [slot.state]);

  const faceTexture = useMemo(
    () =>
      makeSlabFaceTexture({
        ordinalLabel: slot.ordinalLabel,
        kicker: slot.title,
        note: slot.note,
        conceptTag: slot.conceptTag,
        state: slot.state,
        reducedMotion,
      }),
    [slot.ordinalLabel, slot.title, slot.note, slot.conceptTag, slot.state, reducedMotion],
  );

  const bracketGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        cornerBracketPositions(SLAB.width * 1.02, SLAB.height * 1.02, 0.16),
        3,
      ),
    );
    return geo;
  }, []);

  const edgeGeometry = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(SLAB.width, SLAB.height, SLAB.depth)),
    [],
  );
  const slabGeometry = useMemo(
    () => new THREE.BoxGeometry(SLAB.width, SLAB.height, SLAB.depth),
    [],
  );

  useEffect(() => {
    // Seed steady-state uniforms from the palette.
    material.uniforms.uColor!.value = new THREE.Color(palette.base);
    material.uniforms.uEdge!.value = new THREE.Color(palette.edge);
    material.uniforms.uEmissive!.value = palette.emissive;
    material.uniforms.uPulse!.value = palette.pulse;
    material.uniforms.uDropout!.value = palette.dropout;
  }, [material, palette]);

  useEffect(() => {
    return () => {
      material.dispose();
      faceTexture.dispose();
      bracketGeometry.dispose();
      edgeGeometry.dispose();
      slabGeometry.dispose();
    };
  }, [material, faceTexture, bracketGeometry, edgeGeometry, slabGeometry]);

  const hoverRef = useRef(0);
  const mountRef = useRef(reducedMotion ? 1 : -props.slotIndex * 0.12);
  const edgeMatRef = useRef<THREE.LineBasicMaterial>(null);
  const bracketMatRef = useRef<THREE.LineBasicMaterial>(null);
  const faceMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_state, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;
    const delta = Math.min(rawDelta, 0.05);
    const t = (material.uniforms.uTime!.value += delta);

    // Mount stagger: rise + fade in, delayed by slot order (negative start).
    if (mountRef.current < 1) mountRef.current = Math.min(1, mountRef.current + delta * 1.4);
    const mount = ease(reducedMotion ? 1 : Math.max(0, mountRef.current));

    const sel = props.selectRef.current;
    const selecting = sel.index !== null;
    const isSelected = sel.index === props.slotIndex;
    const selT = isSelected ? ease(sel.t) : 0;

    // Hover damping.
    const hovered = props.focusRef.current === props.slotIndex && !selecting;
    const target = hovered ? 1 : 0;
    hoverRef.current += (target - hoverRef.current) * Math.min(1, delta * 12);
    material.uniforms.uHover!.value = reducedMotion ? target : hoverRef.current;
    material.uniforms.uSelect!.value = selT;

    // A selection dims and desaturates the rest of the rack — focus racks to the
    // chosen file.
    const otherDim = selecting && !isSelected ? 1 - 0.82 * ease(sel.t) : 1;
    material.uniforms.uOpacity!.value =
      palette.opacity * otherDim * mount * (1 + 0.18 * material.uniforms.uHover!.value);

    // Rest pose from the placement, plus idle drift (stilled under reduced motion
    // and while a selection is animating).
    const [rx, ry, rz] = placement.position;
    const drift =
      reducedMotion || selecting ? 0 : Math.sin(t * 0.7 + placement.driftPhase) * palette.drift;
    const restY = ry + drift + (1 - mount) * -0.25;

    // Presented pose: centred in front of the camera, upright, close, enlarged.
    const px = THREE.MathUtils.lerp(rx, ROOM_CAMERA.target[0], selT);
    const py = THREE.MathUtils.lerp(restY, 1.55, selT);
    const pz = THREE.MathUtils.lerp(rz, 2.9, selT);
    group.position.set(px, py, pz);
    group.rotation.y = THREE.MathUtils.lerp(placement.rotationY, 0, selT);
    const scale = THREE.MathUtils.lerp(0.92 + 0.08 * mount, 1.7, selT);
    group.scale.setScalar(scale);

    // Reticle + edge intensity track focus/ready; face follows body opacity.
    const reticleOn = (palette.reticle || hovered) && !selecting;
    if (bracketMatRef.current) {
      bracketMatRef.current.opacity =
        (reticleOn ? 0.5 + 0.5 * material.uniforms.uHover!.value : 0) * mount;
    }
    if (edgeMatRef.current) {
      edgeMatRef.current.opacity =
        (0.35 + 0.4 * material.uniforms.uHover!.value + 0.4 * selT) * otherDim * mount;
    }
    if (faceMatRef.current) {
      faceMatRef.current.opacity = Math.min(1, (0.9 + 0.1 * selT) * otherDim * mount);
    }
  });

  const handleOver = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      props.onHover(props.slotIndex);
    },
    [props],
  );
  const handleClick = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      props.onActivate(props.slotIndex);
    },
    [props],
  );

  return (
    <group ref={groupRef}>
      {/* Invisible, slightly padded hit target so hover/click never flickers
          between the body, face and brackets. */}
      <mesh
        onPointerOver={handleOver}
        onPointerOut={(event) => {
          event.stopPropagation();
        }}
        onClick={handleClick}
      >
        <boxGeometry args={[SLAB.width * 1.08, SLAB.height * 1.08, SLAB.depth * 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh geometry={slabGeometry} material={material} raycast={() => null} />

      <lineSegments geometry={edgeGeometry} raycast={() => null}>
        <lineBasicMaterial
          ref={edgeMatRef}
          color={palette.edge}
          transparent
          opacity={0.4}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      <mesh position={[0, 0, SLAB.depth / 2 + 0.002]} raycast={() => null}>
        <planeGeometry args={[SLAB.width * SLAB.faceInset, SLAB.height * SLAB.faceInset]} />
        <meshBasicMaterial
          ref={faceMatRef}
          map={faceTexture}
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.NormalBlending}
        />
      </mesh>

      <lineSegments
        geometry={bracketGeometry}
        position={[0, 0, SLAB.depth / 2 + 0.02]}
        raycast={() => null}
      >
        <lineBasicMaterial
          ref={bracketMatRef}
          color={palette.edge}
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

// ---------------------------------------------------------------------------
// The rack: the arc of slabs, plus the selection driver that hands control to
// ModuleFilePlayer once a slab has finished lifting out.
// ---------------------------------------------------------------------------

function Rack(props: {
  slots: readonly RoomSlot[];
  reducedMotion: boolean;
  focusRef: MutableRefObject<number | null>;
  selectRef: MutableRefObject<SelectState>;
  onHover: (slotIndex: number) => void;
  onActivate: (slotIndex: number) => void;
  onSelectComplete: (slotIndex: number) => void;
}) {
  const placements = useMemo(
    () =>
      rackPlacements(
        props.slots.filter((s) => s.kind === "FILE").length,
        props.slots.some((s) => s.kind === "BRIEF"),
        RACK_CENTER_X,
      ),
    [props.slots],
  );

  const completedRef = useRef(false);
  useFrame((_state, rawDelta) => {
    const sel = props.selectRef.current;
    if (sel.index === null || sel.done) return;
    const delta = Math.min(rawDelta, 0.05);
    sel.t = Math.min(1, sel.t + delta / SELECT_SECONDS);
    if (sel.t >= 1 && !completedRef.current) {
      completedRef.current = true;
      sel.done = true;
      props.onSelectComplete(sel.index);
    }
  });

  return (
    <group>
      {props.slots.map((slot, index) => (
        <Slab
          key={`${slot.kind}-${slot.fileIndex}`}
          slot={slot}
          slotIndex={index}
          placement={placements[index] ?? { position: [0, 1.4, 0], rotationY: 0, driftPhase: 0 }}
          reducedMotion={props.reducedMotion}
          focusRef={props.focusRef}
          selectRef={props.selectRef}
          onHover={props.onHover}
          onActivate={props.onActivate}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Room dressing — camera rig with a soft dolly intro, cyan projector lights,
// atmospheric motes, and a gradient backdrop. All motion is stilled under
// reduced motion.
// ---------------------------------------------------------------------------

function CameraRig(props: { reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const look = useRef(new THREE.Vector3(...ROOM_CAMERA.target));
  const progress = useRef(props.reducedMotion ? 1 : 0);

  useEffect(() => {
    if (props.reducedMotion) {
      camera.position.set(...ROOM_CAMERA.position);
      camera.lookAt(look.current);
    } else {
      camera.position.set(ROOM_CAMERA.position[0], ROOM_CAMERA.position[1] - 0.35, ROOM_CAMERA.position[2] + 1.15);
    }
  }, [camera, props.reducedMotion]);

  useFrame((_state, rawDelta) => {
    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + Math.min(rawDelta, 0.05) / 1.2);
      const k = ease(progress.current);
      camera.position.x = ROOM_CAMERA.position[0];
      camera.position.y = THREE.MathUtils.lerp(ROOM_CAMERA.position[1] - 0.35, ROOM_CAMERA.position[1], k);
      camera.position.z = THREE.MathUtils.lerp(ROOM_CAMERA.position[2] + 1.15, ROOM_CAMERA.position[2], k);
    }
    camera.lookAt(look.current);
  });
  return null;
}

function Motes(props: { reducedMotion: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);
  const fx = useMemo(() => {
    const count = 90;
    const seed = 0x3ac1e; // seeded so the dust is deterministic (repo rule: no Math.random)
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (fieldRandom(seed, i, 0) - 0.5) * 12;
      positions[i * 3 + 1] = fieldRandom(seed, i, 1) * 4.5;
      positions[i * 3 + 2] = (fieldRandom(seed, i, 2) - 0.5) * 7 - 1.5;
      speeds[i] = 0.05 + fieldRandom(seed, i, 3) * 0.12;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x9fe4ff,
      size: 0.035,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    return { geometry, material, positions, speeds, count };
  }, []);

  useEffect(() => () => {
    fx.geometry.dispose();
    fx.material.dispose();
  }, [fx]);

  useFrame((_state, rawDelta) => {
    if (props.reducedMotion || !pointsRef.current) return;
    const delta = Math.min(rawDelta, 0.05);
    const attr = fx.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < fx.count; i += 1) {
      let y = fx.positions[i * 3 + 1]! + fx.speeds[i]! * delta;
      if (y > 4.6) y -= 4.6;
      fx.positions[i * 3 + 1] = y;
      attr.setY(i, y);
    }
    attr.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={fx.geometry} material={fx.material} />;
}

function Backdrop() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uTop: { value: new THREE.Color(0x02060d) }, uHorizon: { value: new THREE.Color(0x0a2942) } },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vPos;
          uniform vec3 uTop; uniform vec3 uHorizon;
          void main() {
            float h = clamp((normalize(vPos).y + 0.25) / 1.1, 0.0, 1.0);
            vec3 col = mix(uHorizon, uTop, h);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} raycast={() => null}>
      <sphereGeometry args={[24, 24, 24]} />
    </mesh>
  );
}

function RoomEffects(props: { reducedMotion: boolean }) {
  const caOffset = useMemo(() => new THREE.Vector2(0.0006, 0.0011), []);
  const effects = [
    <Bloom
      key="bloom"
      intensity={props.reducedMotion ? 0.8 : 1.15}
      luminanceThreshold={0.34}
      luminanceSmoothing={0.85}
      kernelSize={KernelSize.LARGE}
      mipmapBlur
    />,
    <ChromaticAberration
      key="ca"
      blendFunction={BlendFunction.NORMAL}
      offset={caOffset}
      radialModulation={false}
      modulationOffset={0}
    />,
    <Vignette key="vig" eskil={false} offset={0.28} darkness={0.72} />,
  ];
  if (!props.reducedMotion) {
    effects.push(
      <Noise key="noise" premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.045} />,
    );
  }
  return <EffectComposer multisampling={4}>{effects}</EffectComposer>;
}

function RoomScene(props: {
  slots: readonly RoomSlot[];
  reducedMotion: boolean;
  focusRef: MutableRefObject<number | null>;
  selectRef: MutableRefObject<SelectState>;
  onHover: (slotIndex: number) => void;
  onActivate: (slotIndex: number) => void;
  onSelectComplete: (slotIndex: number) => void;
}) {
  return (
    <>
      <color attach="background" args={[0x02060c]} />
      <fog attach="fog" args={[0x03070e, 6.5, 20]} />
      <CameraRig reducedMotion={props.reducedMotion} />

      <ambientLight intensity={0.28} color={0x9fd0ff} />
      <pointLight position={[0, 3.4, 4]} intensity={22} distance={16} decay={2} color={0x8fd6ff} />
      <pointLight position={[-4, 2, 2]} intensity={9} distance={13} decay={2} color={0x4fb4ff} />
      <pointLight position={[4, 2, 2]} intensity={9} distance={13} decay={2} color={0x6fd6ff} />

      <Backdrop />
      <Grid
        position={[0, 0.001, 0]}
        args={[40, 40]}
        cellSize={0.6}
        cellThickness={0.6}
        cellColor={0x1c5f86}
        sectionSize={3}
        sectionThickness={1.1}
        sectionColor={0x3aa0d8}
        fadeDistance={26}
        fadeStrength={2.4}
        infiniteGrid
        followCamera={false}
      />
      <Motes reducedMotion={props.reducedMotion} />

      <Rack
        slots={props.slots}
        reducedMotion={props.reducedMotion}
        focusRef={props.focusRef}
        selectRef={props.selectRef}
        onHover={props.onHover}
        onActivate={props.onActivate}
        onSelectComplete={props.onSelectComplete}
      />

      <RoomEffects reducedMotion={props.reducedMotion} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The composited presenter — her imported rigged GLB, standing in the room to
// the left of the rack. She keeps her own tuned hologram treatment (its face-
// readability shader is pinned by tests); the room's grid and light read behind
// her so she stands IN the space rather than in a floating panel. Inside a file
// the shot director takes her camera back over, unchanged.
// ---------------------------------------------------------------------------

function RoomPresenter(props: { presenter: ModulePresenter; reducedMotion: boolean }) {
  return (
    <div className="mod-arch-presenter" aria-hidden="true">
      <SystemPresenter
        presenter={props.presenter}
        speaking={false}
        shot="ESTABLISH"
        reducedMotion={props.reducedMotion}
        speechCueId="archive-room"
        speechText=""
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The room, with its JARVIS chrome overlay.
// ---------------------------------------------------------------------------

export function ArchiveRoom(props: ArchiveRoomProps) {
  const slots = useMemo<RoomSlot[]>(() => {
    const out: RoomSlot[] = props.files.map((file, index) => ({
      kind: "FILE" as const,
      fileIndex: index,
      ordinalLabel: String(file.ordinal).padStart(2, "0"),
      title: file.title,
      note: file.note,
      conceptTag: "Case file",
      state: slabStateFor(file.status),
      openable: file.status !== "LOCKED",
    }));
    if (props.hasBrief) {
      out.push({
        kind: "BRIEF",
        fileIndex: -1,
        ordinalLabel: "→",
        title: "The handoff",
        note: props.briefReady
          ? "Every file read, every question answered. The brief into the mission."
          : "Read every case file first.",
        conceptTag: "Brief",
        state: props.briefReady ? "READY" : "LOCKED",
        openable: props.briefReady,
      });
    }
    return out;
  }, [props.files, props.hasBrief, props.briefReady]);

  const reviewedCount = props.files.filter((f) => f.status === "DONE").length;

  const focusRef = useRef<number | null>(null);
  const selectRef = useRef<SelectState>({ index: null, t: 0, done: false });
  const openRef = useRef(props.onOpenFile);
  const briefRef = useRef(props.onPlayBrief);
  openRef.current = props.onOpenFile;
  briefRef.current = props.onPlayBrief;

  // The focused slot drives the JARVIS dock. Default to the first actionable one
  // so the room opens pointing at what the player can do.
  const defaultFocus = useMemo(() => {
    const ready = slots.findIndex((s) => s.state === "READY");
    return ready >= 0 ? ready : 0;
  }, [slots]);
  const [focus, setFocus] = useState<number>(defaultFocus);
  const [selecting, setSelecting] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  useEffect(() => {
    setFocus(defaultFocus);
  }, [defaultFocus]);
  useEffect(() => {
    setArchiveAudioMuted(muted);
  }, [muted]);

  const activate = useCallback(
    (slotIndex: number) => {
      if (selectRef.current.index !== null) return;
      const slot = slots[slotIndex];
      if (!slot) return;
      setFocus(slotIndex);
      focusRef.current = slotIndex;
      if (!slot.openable) {
        playArchiveSealed();
        return;
      }
      if (slot.kind === "BRIEF") playArchiveHandoff();
      else playArchiveOpen();

      const run = () => {
        if (slot.kind === "BRIEF") briefRef.current();
        else openRef.current(slot.fileIndex);
      };
      if (props.reducedMotion) {
        run();
        return;
      }
      selectRef.current = { index: slotIndex, t: 0, done: false };
      setSelecting(true);
    },
    [slots, props.reducedMotion],
  );

  const onSelectComplete = useCallback((slotIndex: number) => {
    const slot = slots[slotIndex];
    if (!slot) return;
    if (slot.kind === "BRIEF") briefRef.current();
    else openRef.current(slot.fileIndex);
  }, [slots]);

  const hover = useCallback((slotIndex: number) => {
    if (selectRef.current.index !== null) return;
    if (focusRef.current !== slotIndex) playArchiveHover();
    focusRef.current = slotIndex;
    setFocus(slotIndex);
  }, []);

  // Keyboard: arrows move focus across the rack, Enter opens, Escape leaves.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setFocus((current) => {
          const step = event.key === "ArrowRight" ? 1 : -1;
          const next = Math.max(0, Math.min(slots.length - 1, current + step));
          focusRef.current = next;
          if (next !== current) playArchiveHover();
          return next;
        });
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate(focus);
      } else if (event.key === "Escape") {
        event.preventDefault();
        props.onExit();
      }
    },
    [slots.length, activate, focus, props],
  );

  const focusedSlot = slots[focus];
  const isRetry = props.kicker.includes("attempt");

  return (
    <div
      className={`mod mod-arch${props.reducedMotion ? " is-reduced" : ""}${selecting ? " is-selecting" : ""}`}
    >
      <Canvas
        className="mod-arch-canvas"
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        dpr={[1, 2]}
        camera={{ position: [...ROOM_CAMERA.position], fov: ROOM_CAMERA.fov }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <RoomScene
          slots={slots}
          reducedMotion={props.reducedMotion}
          focusRef={focusRef}
          selectRef={selectRef}
          onHover={hover}
          onActivate={activate}
          onSelectComplete={onSelectComplete}
        />
      </Canvas>

      {props.presenter && (
        <RoomPresenter presenter={props.presenter} reducedMotion={props.reducedMotion} />
      )}

      {/* ---- JARVIS chrome: hairline strokes, brackets, readouts, dock ------ */}
      <div
        className="mod-arch-chrome"
        role="application"
        aria-label={`${props.title} — Archive case files`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <span className="mod-arch-corner tl" aria-hidden="true" />
        <span className="mod-arch-corner tr" aria-hidden="true" />
        <span className="mod-arch-corner bl" aria-hidden="true" />
        <span className="mod-arch-corner br" aria-hidden="true" />
        <span className="mod-arch-scan" aria-hidden="true" />

        <header className="mod-arch-top">
          <button type="button" className="mod-arch-leave" onClick={props.onExit}>
            <span aria-hidden="true">←</span> Leave
          </button>
          <div className="mod-arch-title">
            <span className="mod-arch-kicker">{props.kicker}</span>
            <span className="mod-arch-name">{props.title}</span>
          </div>
          <div className="mod-arch-clock">
            <span className="mod-arch-clock-time">{props.clockLabel}</span>
            <span className="mod-arch-clock-xp">Pays no XP</span>
          </div>
        </header>

        <div className="mod-arch-rail" aria-hidden="true">
          <span className="mod-arch-rail-title">ARCHIVE // FIELD SYSTEM</span>
          <span className="mod-arch-rail-line">
            <i>STATUS</i> {isRetry ? "REMEDIAL" : "PROJECTING"}
          </span>
          <span className="mod-arch-rail-line">
            <i>FILES</i> {props.files.length}
          </span>
          <span className="mod-arch-rail-line">
            <i>REVIEWED</i> {reviewedCount}/{props.files.length}
          </span>
          <span className="mod-arch-rail-line">
            <i>LINK</i> 1774 · TRANSPORT
          </span>
          <span className="mod-arch-rail-bar">
            <b style={{ width: `${(reviewedCount / Math.max(1, props.files.length)) * 100}%` }} />
          </span>
        </div>

        <p className="mod-arch-lede">{props.subtitle}</p>

        {focusedSlot && (
          <aside className="mod-arch-dock" data-state={focusedSlot.state} aria-live="polite">
            <div className="mod-arch-dock-head">
              <span className="mod-arch-dock-ord">{focusedSlot.ordinalLabel}</span>
              <span className="mod-arch-dock-tag">{focusedSlot.conceptTag}</span>
              <span className={`mod-arch-dock-state state-${focusedSlot.state.toLowerCase()}`}>
                {focusedSlot.state === "LOCKED"
                  ? "Sealed"
                  : focusedSlot.state === "DONE"
                    ? "Reviewed"
                    : "Ready"}
              </span>
            </div>
            <h2 className="mod-arch-dock-title">{focusedSlot.title}</h2>
            <p className="mod-arch-dock-note">
              {focusedSlot.state === "LOCKED" && focusedSlot.kind === "FILE"
                ? "Contained until the prior file is reviewed. Read the files in order."
                : focusedSlot.note}
            </p>
            {focusedSlot.openable ? (
              <button
                type="button"
                className="mod-arch-open"
                onClick={() => activate(focus)}
                disabled={selecting}
              >
                {focusedSlot.kind === "BRIEF"
                  ? "Transmit the brief"
                  : focusedSlot.state === "DONE"
                    ? "Replay file"
                    : "Open file"}
                <span className="mod-arch-open-key" aria-hidden="true">↵</span>
              </button>
            ) : (
              <span className="mod-arch-open is-sealed" aria-disabled="true">
                <span aria-hidden="true">⬡</span> Sealed
              </span>
            )}
            <span className="mod-arch-dock-hint">
              ← → to move · Enter to open{props.hasBrief ? " · finish every file to transmit" : ""}
            </span>
          </aside>
        )}

        <button
          type="button"
          className={`mod-arch-mute${muted ? " is-muted" : ""}`}
          onClick={() => setMuted((value) => !value)}
          aria-pressed={muted}
          title={muted ? "Unmute Archive sounds" : "Mute Archive sounds"}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>

        {/* An accessible fallback: real buttons for each openable slot, so the
            room is fully operable by keyboard and assistive tech even though the
            files themselves are projected into the canvas. */}
        <div className="mod-arch-sr">
          {slots.map((slot, index) =>
            slot.openable ? (
              <button
                key={`${slot.kind}-${slot.fileIndex}`}
                type="button"
                onFocus={() => setFocus(index)}
                onClick={() => activate(index)}
              >
                {slot.kind === "BRIEF" ? "Transmit the brief" : `Open ${slot.title}`}
              </button>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
