import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type {
  ChapterMapData,
  MutableRef,
  PresenterSpatialState,
} from "./chapterWorld.js";

export function projectMapPoint(
  map: ChapterMapData,
  point: readonly [number, number],
): readonly [number, number] {
  const x = (point[0] - map.bounds.minX) / (map.bounds.maxX - map.bounds.minX);
  const y = 1 - (point[1] - map.bounds.minZ) / (map.bounds.maxZ - map.bounds.minZ);
  return [
    Math.max(0, Math.min(1, x)),
    Math.max(0, Math.min(1, y)),
  ];
}

export function approximateMapPosition(
  position: readonly [number, number],
  grid = 8,
): readonly [number, number] {
  return [
    Math.round(position[0] / grid) * grid,
    Math.round(position[1] / grid) * grid,
  ];
}

export function compassBearing(
  from: readonly [number, number],
  to: readonly [number, number],
): { degrees: number; cardinal: string } {
  const degrees =
    (Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI;
  const normalized = (degrees + 360) % 360;
  const cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return {
    degrees: normalized,
    cardinal: cardinals[Math.round(normalized / 45) % 8]!,
  };
}

function useSpatialSample(
  spatialRef: MutableRef<PresenterSpatialState | null>,
): PresenterSpatialState | null {
  const [spatial, setSpatial] = useState(spatialRef.current);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = spatialRef.current;
      setSpatial(current ? { ...current, pos: [...current.pos] } : null);
    }, 200);
    return () => window.clearInterval(timer);
  }, [spatialRef]);
  return spatial;
}

export function RunnerMapOverlay(props: {
  map: ChapterMapData;
  spatialRef: MutableRef<PresenterSpatialState | null>;
  discoveredIds: readonly string[];
  unlockedRouteIds: readonly string[];
  objectiveTargetId: string | null;
  highContrast: boolean;
  onClose(): void;
}) {
  const spatial = useSpatialSample(props.spatialRef);
  const approximate = approximateMapPosition([
    spatial?.pos[0] ?? 0,
    spatial?.pos[2] ?? 0,
  ]);
  const player = projectMapPoint(props.map, approximate);
  const objective = props.objectiveTargetId
    ? props.map.objectiveAnchors[props.objectiveTargetId]
    : undefined;
  const objectivePoint = objective ? projectMapPoint(props.map, objective) : null;
  const known = useMemo(
    () => new Set(props.discoveredIds),
    [props.discoveredIds],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.code === "KeyM") {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <div className={`runner-map-backdrop${props.highContrast ? " high-contrast" : ""}`}>
      <section className="runner-map" role="dialog" aria-modal="true" aria-label={props.map.title}>
        <header>
          <span>RUNNER'S SKETCH</span>
          <strong>{props.map.title}</strong>
          <small>{props.map.subtitle}</small>
        </header>
        <svg viewBox="0 0 1000 560" role="img" aria-label="Hand-drawn map of known Boston routes">
          <path className="map-waterline" d="M0 470 C190 438 330 500 500 462 S800 442 1000 482 L1000 560 L0 560 Z" />
          {props.map.routes.map((route) => {
            const routeKnown =
              props.unlockedRouteIds.includes(route.id) ||
              route.points.some((point) =>
                props.map.landmarks.some(
                  (landmark) =>
                    known.has(landmark.id) &&
                    Math.hypot(
                      landmark.position[0] - point[0],
                      landmark.position[1] - point[1],
                    ) < landmark.discoveryRadius * 2,
                ),
              );
            if (!routeKnown) return null;
            const points = route.points
              .map((point) => projectMapPoint(props.map, point))
              .map(([x, y]) => `${x * 1000},${y * 560}`)
              .join(" ");
            return <polyline key={route.id} className="map-route" points={points} />;
          })}
          {props.map.landmarks.map((landmark) => {
            if (!known.has(landmark.id)) return null;
            const [x, y] = projectMapPoint(props.map, landmark.position);
            return (
              <g key={landmark.id} className={`map-landmark kind-${landmark.kind.toLowerCase()}`} transform={`translate(${x * 1000} ${y * 560})`}>
                <circle r="8" />
                <path d="M-12 0 H12 M0 -12 V12" />
                <text y="-17">{landmark.label}</text>
              </g>
            );
          })}
          {objectivePoint && (
            <g className="map-objective" transform={`translate(${objectivePoint[0] * 1000} ${objectivePoint[1] * 560})`}>
              <circle r="17" />
              <path d="M0 -25 L8 -12 L0 -15 L-8 -12 Z" />
            </g>
          )}
          <g className="map-player" transform={`translate(${player[0] * 1000} ${player[1] * 560})`}>
            <circle r="15" />
            <text y="31">about here</text>
          </g>
        </svg>
        <footer>
          <span>Ink appears as you learn the streets.</span>
          <button type="button" onClick={props.onClose}>Fold map <kbd>M / Esc</kbd></button>
        </footer>
      </section>
    </div>
  );
}

export function CompassRibbon(props: {
  map: ChapterMapData;
  spatialRef: MutableRef<PresenterSpatialState | null>;
  objectiveTargetId: string | null;
  visible: boolean;
}) {
  const spatial = useSpatialSample(props.spatialRef);
  if (!props.visible || !spatial || spatial.interiorId) return null;
  const target = props.objectiveTargetId
    ? props.map.objectiveAnchors[props.objectiveTargetId]
    : undefined;
  if (!target) return null;
  const bearing = compassBearing(
    [spatial.pos[0], spatial.pos[2]],
    target,
  );
  return (
    <div className="compass-ribbon" aria-label={`Objective ${bearing.cardinal}`}>
      <span>W</span><i /><span>N</span><i /><span>E</span>
      <strong style={{ "--bearing": `${bearing.degrees}deg` } as CSSProperties}>
        ◆ {bearing.cardinal}
      </strong>
    </div>
  );
}
