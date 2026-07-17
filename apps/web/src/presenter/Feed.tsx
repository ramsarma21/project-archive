import { useEffect, useRef } from "react";
import type { PresentationDirective } from "@pa/contracts";

export function Feed(props: { directives: PresentationDirective[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [props.directives.length]);

  return (
    <div className="feed">
      {props.directives.map((d, i) => (
        <DirectiveView key={i} d={d} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function DirectiveView({ d }: { d: PresentationDirective }) {
  switch (d.kind) {
    case "SCENE":
      return d.text ? <div className="block scene">{d.text}</div> : null;
    case "NARRATION":
      return <div className="block narration">{d.text}</div>;
    case "DIALOGUE":
      return (
        <div className="block dialogue">
          <div className="who">
            {speakerName(d.speaker)} {d.glyph === "INTERACTION" && <span className="glyph">◆ interactive</span>}
            {d.glyph === "SPEECH" && <span className="glyph">◦</span>}
          </div>
          <div>{d.text}</div>
        </div>
      );
    case "ARCHIVE":
      return <div className="block archive">▲ Archive · {d.text}</div>;
    case "AMBIENT_CHATTER":
      return <div className="block ambient">◦ {d.text}</div>;
    case "READ_PANEL":
      return (
        <div className="block read-panel">
          <div className="rp-title">{d.title}</div>
          <div>{d.body}</div>
        </div>
      );
    case "FLICKER":
      return (
        <div className={`block flicker ${d.flicker === "NOTES_ADDED" ? "notes" : ""}`}>
          {d.flicker === "NOTES_ADDED" ? `✓ Added to Notes: ${d.label}` : `⇄ Route unlocked: ${d.label}`}
        </div>
      );
    case "RELATIONSHIP_CARD":
      return (
        <div className="block">
          <span className="relcard">
            <strong>{d.character}</strong> · {d.dimension}{" "}
            <span className={d.direction === "UP" ? "up" : "down"}>{d.direction === "UP" ? "▲" : "▼"}</span>
            <span className="muted small">{d.label}</span>
          </span>
        </div>
      );
    case "CLOCK_UPDATE":
      return null; // handled by HUD
    case "OBJECTIVE_STRIP":
      return null;
    case "DAY_END_CARD":
      return null; // rendered by Play as full-screen
  }
}

function speakerName(s: string): string {
  const map: Record<string, string> = {
    ABIGAIL: "Abigail", THOMAS: "Thomas", PIKE: "Pike", CLARKE: "Clarke",
    RIDER: "Rider", OFFICER: "Customs officer", CROWD: "The crowd", NARRATOR: "", ARCHIVE: "Archive",
  };
  return map[s] ?? s;
}
