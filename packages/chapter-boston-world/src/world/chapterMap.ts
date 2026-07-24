import type { ChapterMapData } from "@pa/engine-world";
import { MARKER_ANCHORS, WORLD_BOUNDS } from "./manifest.js";

const objectiveAnchors = Object.fromEntries(
  Object.entries(MARKER_ANCHORS).map(([id, position]) => [
    id,
    [position[0], position[2]] as const,
  ]),
);

export const BOSTON_RUNNER_MAP: ChapterMapData = {
  title: "Boston, from Queen Street to the wharf",
  subtitle: "A runner's ink, not a surveyor's measure",
  bounds: WORLD_BOUNDS,
  landmarks: [
    { id: "MERCER", label: "Mercer's Press", position: [-0.31, 8.4], discoveryRadius: 20, kind: "PRESS" },
    { id: "MARKET", label: "Market", position: [-49, -4], discoveryRadius: 24, kind: "MARKET" },
    { id: "THOMAS", label: "Thomas", position: [-70, -9.3], discoveryRadius: 18, kind: "MARKET" },
    { id: "CUSTOM_HOUSE", label: "Custom House", position: [55, 8.5], discoveryRadius: 24, kind: "CIVIC" },
    { id: "LIBERTY_TREE", label: "Great Elm", position: [89, -19], discoveryRadius: 28, kind: "LIBERTY" },
    { id: "TOWN_WHARF", label: "Town Wharf", position: [-132, 3], discoveryRadius: 30, kind: "WHARF" },
    { id: "BACK_LANES", label: "Back lanes", position: [-8, -17], discoveryRadius: 24, kind: "ALLEY" },
    { id: "WATER_ALLEY", label: "Water alley", position: [-86, 14], discoveryRadius: 22, kind: "ALLEY" },
  ],
  routes: [
    {
      id: "QUEEN_STREET",
      label: "Queen Street",
      points: [[-152, 5], [-90, 4], [-45, 5], [0, 6], [55, 7], [98, 4]],
    },
    {
      id: "BACK_LANES",
      label: "Back lanes",
      points: [[-70, -10], [-35, -17], [-8, -17], [26, -13], [55, -7]],
    },
    {
      id: "THOMAS_DOCK_ROUTE",
      label: "Thomas's dock shortcut",
      points: [[-71, -9], [-95, -3], [-122, 3], [-145, 4]],
    },
    {
      id: "WHARF_WALK",
      label: "Wharf walk",
      points: [[-155, 12], [-135, 4], [-112, 8], [-88, 14]],
    },
  ],
  objectiveAnchors,
};
