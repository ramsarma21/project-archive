// AudioDirector: bridges the live scene to the ambient audio engine.
// Mounted inside the World3D canvas so it can poll the same PlayerApi the
// rest of the presenter uses; the engine itself throttles and mixes.

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { RuntimeView } from "@pa/contracts";
import type { PlayerApi } from "./Player.js";
import { ambientAudio } from "./ambientAudio.js";
import { weatherBlend, clamp01 } from "./atmosphere.js";

export function AudioDirector(props: {
  apiRef: { current: PlayerApi | null };
  clock: RuntimeView["clock"] | null;
  interiorId: string | null;
  dusk: boolean;
  /** HUNTED heat or a live chase drives the identity drum layer (design1 #5). */
  hunted: boolean;
  reducedMotion: boolean;
}) {
  // One deep toll per daylight unit spent (identity audio; distinct from the
  // ambient warning bell). Initialized lazily so a resumed save never tolls
  // its whole backlog at once.
  const lastSpentUnits = useRef<number | null>(null);
  useEffect(() => {
    const spent = props.clock?.spentUnits;
    if (spent === undefined) return;
    if (lastSpentUnits.current === null) {
      lastSpentUnits.current = spent;
      return;
    }
    const delta = spent - lastSpentUnits.current;
    lastSpentUnits.current = spent;
    if (delta <= 0) return;
    const tolls = Math.min(3, delta);
    for (let i = 0; i < tolls; i++) {
      window.setTimeout(
        () => ambientAudio.playIdentity("bell-toll-daylight"),
        i * 1400,
      );
    }
  }, [props.clock?.spentUnits]);

  useFrame(() => {
    const clock = props.clock;
    const pos = props.apiRef.current?.position;
    const t = clock
      ? clamp01(clock.spentUnits / Math.max(1, clock.fixedEventBoundary))
      : 0;
    ambientAudio.setChaseDrum(props.hunted, props.reducedMotion);
    ambientAudio.update({
      x: pos?.x ?? 0,
      z: pos?.z ?? 0,
      interiorId: props.interiorId,
      phase: clock?.phase ?? "MORNING",
      warningStage: clock?.warningStage ?? "NONE",
      rain: weatherBlend(props.dusk ? 1 : t).drizzle,
      dusk: props.dusk,
    });
  });
  return null;
}
