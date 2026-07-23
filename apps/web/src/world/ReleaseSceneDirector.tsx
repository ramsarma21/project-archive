import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { RiggedCharacter } from "./Character.js";
import type { PlayerApi } from "./Player.js";
import { INSPECTOR_OFFICE } from "./stealthManifest.js";
import { dispatchPresentationNotice } from "../presenter/noticeArbiter.js";

// The post-catch "chewed out" beat (Act-1-Production-Plan M4): after a CAUGHT
// chase the player reappears outside the Watch House, visibly later in the
// day, and the constable delivers a short scolding before release. Pure
// presentation over already-committed field consequences (clock, custody,
// heat, Standing) — deterministic state changed nothing here; skipping it on
// reduced-motion profiles shortens but never removes the release.
const LINES: readonly { speaker: string; text: string; holdMs: number }[] = [
  {
    speaker: "CONSTABLE",
    text: "Caught with the goods, and you run from the King's officers?",
    holdMs: 2600,
  },
  {
    speaker: "CONSTABLE",
    text: "The goods are forfeit. The writ needs no name and never expires — remember that.",
    holdMs: 3200,
  },
  {
    speaker: "CONSTABLE",
    text: "Off with you. The day's half spent already.",
    holdMs: 2200,
  },
];

export function ReleaseSceneDirector(props: {
  active: boolean;
  apiRef: { current: PlayerApi | null };
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const [lineIndex, setLineIndex] = useState(0);
  const startedRef = useRef(false);
  const timerRef = useRef(0);
  const constablePos: readonly [number, number, number] = [
    INSPECTOR_OFFICE.releaseAnchor[0] + 1.4,
    0,
    INSPECTOR_OFFICE.releaseAnchor[2] - 0.4,
  ];

  useEffect(() => {
    if (!props.active) {
      startedRef.current = false;
      window.clearTimeout(timerRef.current);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    props.apiRef.current?.setInputLocked(true);
    // The player takes the scolding visibly: head-down, deflated stance.
    props.apiRef.current?.setInteractionClip("scolded");
    setLineIndex(0);
    const lines = props.reducedMotion ? LINES.slice(1) : LINES;
    let cursor = 0;
    const step = () => {
      cursor += 1;
      if (cursor >= lines.length) {
        props.apiRef.current?.setInteractionClip(null);
        props.apiRef.current?.setInputLocked(false);
        props.onDone();
        return;
      }
      setLineIndex(cursor);
      timerRef.current = window.setTimeout(step, lines[cursor]!.holdMs);
    };
    timerRef.current = window.setTimeout(step, lines[0]!.holdMs);
    return () => window.clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active]);

  // Keep the player's scolded stance facing the constable (pose driver,
  // no camera snap; runs only while the short beat is active).
  const posedRef = useRef(false);
  useFrame(() => {
    if (!props.active) {
      posedRef.current = false;
      return;
    }
    const player = props.apiRef.current;
    if (!player || posedRef.current) return;
    const dx = constablePos[0] - player.position.x;
    const dz = constablePos[2] - player.position.z;
    if (Math.hypot(dx, dz) > 0.01) {
      player.setPose(
        [player.position.x, player.position.y, player.position.z],
        Math.atan2(dx, dz),
      );
      posedRef.current = true;
    }
  });

  const lines = props.reducedMotion ? LINES.slice(1) : LINES;
  const line = lines[Math.min(lineIndex, lines.length - 1)]!;
  useEffect(() => {
    if (!props.active) return;
    dispatchPresentationNotice({
      id: `release:${lineIndex}`,
      kind: "CINEMATIC_DIALOGUE",
      speaker: line.speaker,
      text: line.text,
      dedupeKey: `release:${lineIndex}`,
      cooldownMs: 30_000,
      durationMs: line.holdMs,
      captions: true,
    });
  }, [line, lineIndex, props.active]);

  if (!props.active) return null;
  return (
    <group>
      <group
        position={constablePos}
        rotation={[0, Math.atan2(-1.4, 0.4), 0]}
      >
        <RiggedCharacter
          glbKey="constable-rigged"
          height={1.78}
          clip="argu1"
          showFallback={false}
          probeId="release-constable"
        />
      </group>
    </group>
  );
}
