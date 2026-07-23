// AudioDirector: bridges the live scene to the ambient audio engine.
// Mounted inside the World3D canvas so it can poll the same PlayerApi the
// rest of the presenter uses; the engine itself throttles and mixes.

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
}) {
  useFrame(() => {
    const clock = props.clock;
    const pos = props.apiRef.current?.position;
    const t = clock
      ? clamp01(clock.spentUnits / Math.max(1, clock.fixedEventBoundary))
      : 0;
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
