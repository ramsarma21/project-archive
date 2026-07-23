import { useSyncExternalStore } from "react";
import type { RuntimeView } from "@pa/contracts";
import { ambientAudio } from "@pa/chapter-boston-world";

export function Hud(props: {
  view: RuntimeView | null;
  profileName: string;
  exitDisabled?: boolean;
  onManual: () => void;
  onExit: () => void;
}) {
  const v = props.view;
  const spent = v?.clock.spentUnits ?? 0;
  const boundary = v?.clock.fixedEventBoundary ?? 24;
  const pct = Math.min(100, (spent / boundary) * 100);
  const warn = v?.clock.warningStage ?? "NONE";
  const muted = useSyncExternalStore(ambientAudio.subscribe, () => ambientAudio.getMuted());
  return (
    <div className="hud">
      <strong>Project Archive</strong>
      <span className="badge">{props.profileName}</span>
      <div className="clock">
        <span className="small muted">{phaseLabel(v?.clock.phase)}</span>
        <div className="daymeter" title="Remaining daylight">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
      {warn !== "NONE" && <span className="warn">☀ light is going</span>}
      <div className="grow" />
      <button
        className="btn-ghost audio-toggle"
        aria-pressed={muted}
        title={muted ? "Unmute ambient sound" : "Mute ambient sound"}
        onClick={() => ambientAudio.setMuted(!muted)}
      >
        {muted ? "♪ Sound off" : "♪ Sound on"}
      </button>
      {/* The manual folded into the pause surface (design1 kill list): one
          quiet Menu button instead of a manual advertisement. */}
      <button className="btn-ghost archive-manual-button" onClick={props.onManual}>Menu</button>
      <button
        className="btn-ghost"
        disabled={props.exitDisabled}
        title={props.exitDisabled ? "Finishing the current action…" : ""}
        onClick={props.onExit}
      >
        Save & exit
      </button>
    </div>
  );
}

function phaseLabel(p?: string): string {
  switch (p) {
    case "MORNING": return "Morning";
    case "MIDDAY": return "Midday";
    case "AFTERNOON": return "Afternoon";
    case "DUSK": return "Dusk";
    default: return "Morning";
  }
}
