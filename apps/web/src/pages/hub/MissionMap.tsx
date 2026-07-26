import { useMemo } from "react";
import {
  MAP_VIEWBOX,
  MISSION_ROWS,
  missionEdgesFor,
  missionKindLabel,
  missionStatusLabel,
  nodeById,
  type MissionNode,
  type MissionStatus,
} from "./hubState.js";

// Node radius in viewbox units; the DOM node is sized to match. Fifteen nodes
// and their labels have to clear each other in five rows, which is what sets
// this rather than the node needing to be any particular size.
const NODE_RADIUS = 18;

/**
 * An edge is "live" when the player has already reached its source, so the
 * traversed spine reads brighter than the locked branches ahead of it.
 *
 * SPENT counts. Three burned attempts is not a success and the node says so,
 * but the player did pass through it and the route did advance — drawing that
 * stretch as untravelled would tell them the chapter is further back than it is.
 */
function edgeIsLive(from: MissionStatus | undefined): boolean {
  return from === "COMPLETE" || from === "SPENT";
}

export function MissionMap(props: {
  /**
   * The chapter, already projected from durable progression. Taken as a prop
   * rather than read from the module constant, which is the fresh-runner map
   * and would draw every operation locked for a player who has cleared six.
   */
  nodes: readonly MissionNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Hover/focus preview; null clears it back to the selection. */
  onPreview: (id: string | null) => void;
}) {
  const { nodes } = props;
  const edges = useMemo(() => missionEdgesFor(nodes), [nodes]);

  return (
    <div className="hub-map">
      <div
        className="hub-map-body"
        style={{
          ["--map-w" as string]: MAP_VIEWBOX.width,
          ["--map-h" as string]: MAP_VIEWBOX.height,
        }}
        onPointerLeave={() => props.onPreview(null)}
      >
        <svg
          className="hub-map-lines"
          viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Row bands: a faint horizontal rule the nodes of a row sit along. */}
          {MISSION_ROWS.map((y, row) => (
            <line
              key={`band:${row}`}
              className="hub-map-band"
              x1={12}
              y1={y}
              x2={MAP_VIEWBOX.width - 12}
              y2={y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {edges.map((edge) => {
            const from = nodeById(nodes, edge.from);
            const to = nodeById(nodes, edge.to);
            if (!from || !to) return null;
            const live = edgeIsLive(from.status);
            // Vertical row hand-offs bow outward; in-row links use a gentle S.
            const midY = (from.y + to.y) / 2;
            const path =
              from.row === to.row
                ? `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`
                : `M ${from.x} ${from.y} C ${from.x + 54} ${midY}, ${to.x - 54} ${midY}, ${to.x} ${to.y}`;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                className={`hub-map-edge${live ? " is-live" : ""}`}
                d={path}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {nodes.map((node) => (
          <MissionNodeButton
            key={node.id}
            node={node}
            selected={props.selectedId === node.id}
            onSelect={() => props.onSelect(node.id)}
            onPreview={props.onPreview}
          />
        ))}
      </div>
    </div>
  );
}

function MissionNodeButton(props: {
  node: MissionNode;
  selected: boolean;
  onSelect: () => void;
  onPreview: (id: string | null) => void;
}) {
  const { node } = props;
  const classes = [
    "hub-node",
    `is-${node.status.toLowerCase()}`,
    `kind-${node.kind.toLowerCase()}`,
    props.selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      style={{
        left: `${(node.x / MAP_VIEWBOX.width) * 100}%`,
        top: `${(node.y / MAP_VIEWBOX.height) * 100}%`,
        ["--node-size" as string]: `calc(${(NODE_RADIUS * 2) / MAP_VIEWBOX.width} * 100%)`,
      }}
      aria-pressed={props.selected}
      aria-label={
        `${node.title}. ${missionKindLabel(node.kind)}. ${missionStatusLabel(node.status)}.`
      }
      onClick={props.onSelect}
      onPointerEnter={() => props.onPreview(node.id)}
      onFocus={() => props.onPreview(node.id)}
      onBlur={() => props.onPreview(null)}
    >
      <span className="hub-node-face" aria-hidden="true">
        {/* Counter-rotated as a unit so the diamond capstone stays upright. */}
        <span className="hub-node-core">
          <span className="hub-node-ordinal">{node.ordinal ?? "★"}</span>
        </span>
      </span>
      {node.status === "COMPLETE" && (
        <span className="hub-node-done" aria-hidden="true">✓</span>
      )}
      <span className="hub-node-label" aria-hidden="true">{node.title}</span>
    </button>
  );
}
