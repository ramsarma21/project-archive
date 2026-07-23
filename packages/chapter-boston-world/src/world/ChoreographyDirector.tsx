import { useEffect } from "react";
import type { ChoreographyCue } from "@pa/contracts";
import { CameraDirector } from "./CameraDirector.js";
import { PropDirector } from "./PropDirector.js";

export function ChoreographyDirector(props: {
  cueId: string | null;
  cue: ChoreographyCue | null;
  cameraActive: boolean;
  reducedMotion: boolean;
  onReady: (cueId: string) => void;
}) {
  useEffect(() => {
    if (!props.cueId) return;
    const delay = props.reducedMotion ? 0 : props.cue?.blockingMs ?? 0;
    const timeout = window.setTimeout(() => props.onReady(props.cueId!), delay);
    return () => window.clearTimeout(timeout);
  }, [props.cueId, props.reducedMotion, props.cue?.blockingMs, props.onReady]);

  return (
    <>
      <CameraDirector cue={props.cue} active={props.cameraActive} reducedMotion={props.reducedMotion} />
      <PropDirector cue={props.cue} active={props.cameraActive} reducedMotion={props.reducedMotion} />
    </>
  );
}
