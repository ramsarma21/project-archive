import type { RuntimeView } from "@pa/contracts";

const OBJ_LABELS: Record<string, string> = {
  REPORT_TO_MERCER: "Report to Abigail Mercer",
  THOMAS_CIRCULAR: "Deliver circular to Thomas",
  PIKE_PROOF: "Bring Pike his proof",
  CUSTOMHOUSE_NOTICE: "Post the Custom House notice",
  RIDER_HANDBILLS: "Handbills to the rider",
  OBSERVE_CROWD: "See the gathering crowd",
  RETURN_TO_PRESS: "Return to the press",
  SET_HEADLINE: "Set tomorrow's headline",
};

function markerClass(status: string): string {
  switch (status) {
    case "SELECTED": return "gold";
    case "ACTIVE": return "blue";
    case "COMPLETED": return "done";
    case "MISSED":
    case "FAILED": return "missed";
    default: return "";
  }
}

export function Side(props: { view: RuntimeView | null }) {
  const v = props.view;
  if (!v) return <div className="side" />;
  const visible = Object.entries(v.objectives).filter(
    ([, s]) => s !== "NOT_YET_ELIGIBLE" && s !== "HIDDEN",
  );
  return (
    <div className="side">
      <div className="panel-title">Today's tasks</div>
      {visible.map(([id, status]) => (
        <div className="obj" key={id}>
          <span className={`dot ${markerClass(status)}`} />
          <span className={status === "MISSED" || status === "FAILED" ? "muted" : ""}>{OBJ_LABELS[id] ?? id}</span>
        </div>
      ))}

      <div className="panel-title">Concepts</div>
      {Object.entries(v.learner).map(([name, c]) => (
        <div className="concept" key={name}>
          <span>{name}</span>
          <span className="row" style={{ gap: 4 }}>
            <span className={`pill ${c.understanding === "UNDERSTOOD" ? "ok" : ""}`}>{c.occasions}/3 · {c.types} types</span>
            {c.demonstration === "DEMONSTRATED" && <span className="pill ok">shown</span>}
          </span>
        </div>
      ))}

      {v.peopleMet.length > 0 && (
        <>
          <div className="panel-title">People</div>
          {v.peopleMet.map((p) => (
            <div className="obj" key={p}><span className="dot blue" />{p}</div>
          ))}
        </>
      )}

      {v.notes.length > 0 && (
        <>
          <div className="panel-title">Notes</div>
          {v.notes.map((n) => (
            <div className="concept" key={n.concept} style={{ display: "block" }}>
              <strong>{n.concept}</strong>
              <div className="small muted">{n.body}</div>
            </div>
          ))}
        </>
      )}

      {v.routesUnlocked.length > 0 && (
        <>
          <div className="panel-title">Routes</div>
          {v.routesUnlocked.map((r) => (
            <div className="obj" key={r}><span className="dot gold" />{r}</div>
          ))}
        </>
      )}
    </div>
  );
}
