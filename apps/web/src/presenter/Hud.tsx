import type { RuntimeView } from "@pa/contracts";

export function Hud(props: { view: RuntimeView | null; profileName: string; onExit: () => void }) {
  const v = props.view;
  const spent = v?.clock.spentUnits ?? 0;
  const boundary = v?.clock.fixedEventBoundary ?? 24;
  const pct = Math.min(100, (spent / boundary) * 100);
  const warn = v?.clock.warningStage ?? "NONE";
  return (
    <div className="hud">
      <strong>Project Archive</strong>
      <span className="badge">{props.profileName}</span>
      <div className="clock">
        <span className="small muted">{phaseLabel(v?.clock.phase)}</span>
        <div className="daymeter" title={`day ${Math.round(pct)}%`}>
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
      {warn !== "NONE" && <span className="warn">☀ light is going</span>}
      <div className="grow" />
      <button className="btn-ghost" onClick={props.onExit}>Save & exit</button>
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
