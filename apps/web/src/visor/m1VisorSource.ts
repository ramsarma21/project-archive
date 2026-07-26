import { M1_EFFIGY_RUN } from "@pa/mission-m1";
import type { VisorLandmark, VisorSource, VisorZone } from "./visorPlan.js";

// ---------------------------------------------------------------------------
// M1, as something the visor can annotate.
//
// Every field is read off `M1_EFFIGY_RUN` — the same authored level object the
// mission container compiles into collision and the traversability tests verify.
// There is not one coordinate in this file. That is the whole point of it: a
// briefing that restated where the elm is would be a briefing that could point at
// the wrong tree, and the failure would look like a rendering bug.
//
// The two things that ARE this file's own are classifications, not measurements:
// which light levels are worth calling dark and which are worth calling lit. The
// simulation does not have that opinion — `visibility` takes light as a
// continuous term — so choosing the two bands a briefing should mention is a
// presentation decision, and it is made here in the open.
// ---------------------------------------------------------------------------

/**
 * Authored light at or below this is worth telling the player about as cover.
 *
 * Dassett Alley is 0.06 and the Town House's north lane is 0.15; the ambient the
 * mission runs at is more than twice that. So this band is "noticeably darker
 * than the night already is", which is the only kind of dark that is a tool.
 */
const DARK_AT_OR_BELOW = 0.15;

/**
 * Authored light at or above this is worth telling the player about as exposure.
 *
 * Queen Street's shop lanterns are 0.55 and the Shambles' working lamps are 0.70.
 * Both cost the player something from the first second, which is exactly the sort
 * of thing a briefing exists to say out loud once.
 */
const LIT_AT_OR_ABOVE = 0.5;

function nodePos(id: string): readonly [number, number, number] {
  const node = M1_EFFIGY_RUN.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`M1 route has no node ${id}`);
  return node.pos;
}

function zones(): VisorZone[] {
  const out: VisorZone[] = [];

  for (const volume of M1_EFFIGY_RUN.light) {
    const kind =
      volume.level <= DARK_AT_OR_BELOW
        ? "DARK"
        : volume.level >= LIT_AT_OR_ABOVE
          ? "LIT"
          : null;
    if (!kind) continue;
    const { rect } = volume;
    out.push({
      id: volume.id,
      kind,
      centre: [(rect.minX + rect.maxX) / 2, 0, (rect.minZ + rect.maxZ) / 2],
      halfX: (rect.maxX - rect.minX) / 2,
      halfZ: (rect.maxZ - rect.minZ) / 2,
      label: kind === "DARK" ? "Unlit" : "Lit",
      detail:
        kind === "DARK"
          ? "Cover that costs nothing. Crouch and it costs him more."
          : "Lamps still burning. He reads you at full range here.",
    });
  }

  for (const volume of M1_EFFIGY_RUN.blend) {
    out.push({
      id: volume.id,
      kind: "CROWD",
      centre: volume.centre,
      radiusM: volume.radiusM,
      label: "Crowd",
      detail: "Walk in and stay in. Leaving restarts it.",
    });
  }

  return out;
}

/**
 * The one thing named at middle distance.
 *
 * The Town House tower, and it is the tower rather than the square because the
 * route file says what the tower is for: it is where the effigy first comes into
 * sight, which makes it the only navigation the mission has. Naming it turns the
 * run from "east, somehow" into a shape — up over that, then down to the tree.
 */
function landmarks(): VisorLandmark[] {
  return [
    {
      id: "TOWNHOUSE_TOWER",
      pos: nodePos("C_TOWER_GALLERY"),
      label: "Town House",
      detail: "The high point. The elm is in sight from up there.",
    },
  ];
}

export function m1VisorSource(): VisorSource {
  const beat = M1_EFFIGY_RUN.precision;
  return {
    nodes: M1_EFFIGY_RUN.nodes.map((node) => ({
      id: node.id,
      pos: node.pos,
      tags: node.tags,
    })),
    links: M1_EFFIGY_RUN.links.map((link) => ({
      from: link.from,
      to: link.to,
      line: link.line,
      verb: link.verb,
    })),
    startNodeId: M1_EFFIGY_RUN.startNode,
    watcherRoles: Object.fromEntries(
      M1_EFFIGY_RUN.patrols.map((patrol) => [patrol.id, patrol.role]),
    ),
    zones: zones(),
    landmarks: landmarks(),
    destination: {
      // The nail, not the tree: the beacon is standing on the thing the player is
      // going to do, and the ring is drawn at the height they will do it from.
      pos: beat.target,
      workY: beat.target[1],
      label: "The Liberty Elm",
      detail: "Nail the handbill. Six strokes, in rhythm.",
    },
    // The drying rack, found by its authored tag rather than by its id, so a
    // level that moves its opening pickup moves this with it.
    firstBeatNodeId:
      M1_EFFIGY_RUN.nodes.find((node) => node.tags.includes("pickup"))?.id ??
      null,
  };
}
