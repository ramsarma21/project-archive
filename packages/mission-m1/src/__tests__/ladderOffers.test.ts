import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PARKOUR_TUNING,
  probeAhead,
  selectVerb,
  selfIntrusionIds,
  type SelectContext,
} from "@pa/engine-world/parkour";
import { RUN_SPEED, WALK_SPEED } from "@pa/engine-world/playerMotion";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";

// ---------------------------------------------------------------------------
// DOES THE LADDER OFFER ANYTHING TO A PLAYER STANDING AT THIS LINK?
//
// This is a different question from the one traversability.test.ts asks, and
// the difference is the whole reason this file exists. That file verifies every
// authored link through `beginAuthored` — "could the body perform this move if
// something commanded it" — and it has been green throughout. During play
// NOTHING COMMANDS ANYTHING. The player walks at the geometry and `probeAhead`
// plus `rankVerbs` decide, on their own, what is on offer. A link can therefore
// be perfectly performable and completely unavailable, and for a long time most
// of this level's climbs were exactly that.
//
// The mechanism was that a `deck` compiles to a platform, a platform has no
// solid vertical span, and the obstacle reader only ever asked which BLOCKERS a
// point sample was inside. So the Town House scaffold, the gallery, the clock
// ledge, the cornice, the meeting-house ridge and every bough of the Liberty Elm
// — the objective — read as empty air. The owner played it three times and
// reported that there was no path to the tree. There was not.
//
// So: stand a body where a player arrives, face it the way the link goes, and
// require the shipped reader to name a verb. Nothing here is allowed to consult
// the link's own kind — the point is what the geometry says by itself.
// ---------------------------------------------------------------------------

const level = M1_EFFIGY_RUN;
const world = compileLevel(level).world;
const nodeById = new Map(level.nodes.map((node) => [node.id, node]));

/** Links whose target is something to get over, onto or under. */
const OBSTACLE_KINDS = new Set(["CLIMB", "VAULT", "DUCK_UNDER"]);

/**
 * How finely the walk toward the obstacle is sampled.
 *
 * THE QUESTION IS ABOUT AN APPROACH, NOT A SPOT. Asking only at the from-node
 * gets two kinds of wrong answer and both are about where the node happens to
 * sit rather than about the reader. A node three metres short of its canopy is
 * outside the 2.2m obstacle probe and reads nothing, though a player walking at
 * it is offered the climb a stride later. And a node authored UNDERNEATH the
 * thing it names — which is what a duck-under node is — sits inside the very
 * mass in question, where the self-intrusion rule correctly ignores it, though
 * the player met its face on the way in. So the check walks the leg.
 */
const APPROACH_STEP_M = 0.25;

function offeredAt(
  from: readonly [number, number, number],
  dirX: number,
  dirZ: number,
  speed: number,
  parkourHeld = true,
): string | null {
  const pos = { x: from[0], y: from[1], z: from[2] };
  const probe = probeAhead(world, {
    pos,
    velX: dirX * speed,
    velZ: dirZ * speed,
    yaw: Math.atan2(dirX, dirZ),
    intentX: dirX,
    intentZ: dirZ,
  });
  const ctx: SelectContext = {
    grounded: true,
    sprintHeld: parkourHeld,
    jumpBuffered: false,
    crouchHeld: false,
    chaining: false,
    receivingTargets: [],
    reducedMotion: false,
    pushing: true,
  };
  const choice = selectVerb(world, probe, ctx, pos, PARKOUR_TUNING);
  if (!choice) return null;
  if (choice.verb === "BLOCKED" || choice.verb === "EDGE_BRAKE") return null;
  return choice.verb;
}

interface Approach {
  readonly id: string;
  readonly kind: string;
  readonly line: string;
  /** Stations along the walk from the from-node toward the to-node. */
  readonly stations: ReadonlyArray<readonly [number, number, number]>;
  readonly dirX: number;
  readonly dirZ: number;
  /** True when the link goes down rather than up: read as a drop, not a climb. */
  readonly descending: boolean;
}

function approaches(): Approach[] {
  const out: Approach[] = [];
  for (const link of level.links) {
    if (!OBSTACLE_KINDS.has(link.kind)) continue;
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    if (!from || !to) continue;

    const dx = to.pos[0] - from.pos[0];
    const dz = to.pos[2] - from.pos[2];
    const planar = Math.hypot(dx, dz);
    // A link whose two nodes share a footprint is a vertical reach and has no
    // direction of its own. It keeps the heading the plan gives it, or north.
    const dirX = planar > 1e-6 ? dx / planar : 0;
    const dirZ = planar > 1e-6 ? dz / planar : 1;

    // Start behind the node — a player arrives at it, they do not materialise on
    // it — and back off further while the body is standing inside solid geometry.
    // A duck-under node is authored UNDER its own beam, so half a metre behind it
    // is still inside the mass, where the self-intrusion rule correctly refuses
    // to read the thing the body is in. The player met its face on the way in.
    let start = -0.5;
    while (start > -3) {
      const station = {
        x: from.pos[0] + dirX * start,
        y: from.pos[1],
        z: from.pos[2] + dirZ * start,
      };
      if (selfIntrusionIds(world, station).length === 0) break;
      start -= APPROACH_STEP_M;
    }

    const stations: Array<readonly [number, number, number]> = [];
    for (
      let along = start;
      along <= Math.max(0, planar - 0.2) + 1e-9;
      along += APPROACH_STEP_M
    ) {
      stations.push([
        from.pos[0] + dirX * along,
        from.pos[1],
        from.pos[2] + dirZ * along,
      ]);
    }

    out.push({
      id: `${link.from}->${link.to} (${link.kind}/${link.line})`,
      kind: link.kind,
      line: link.line,
      stations,
      dirX,
      dirZ,
      descending: to.pos[1] < from.pos[1] - 0.35,
    });
  }
  return out;
}

const APPROACHES = approaches();

/** The best verb offered anywhere along the walk, or null if nowhere. */
function offeredAlong(
  approach: Approach,
  speed: number,
  parkourHeld = true,
): string | null {
  for (const station of approach.stations) {
    const verb = offeredAt(
      station,
      approach.dirX,
      approach.dirZ,
      speed,
      parkourHeld,
    );
    if (verb) return verb;
  }
  return null;
}

test("the level actually authors obstacle links to check", () => {
  assert.ok(
    APPROACHES.length >= 40,
    `expected the route to author obstacle links; found ${APPROACHES.length}`,
  );
});

test("every authored obstacle link offers a verb to a player holding the key", () => {
  const silent: string[] = [];
  for (const approach of APPROACHES) {
    // A downward link is a drop, and drops are the edge reader's business:
    // asking the obstacle ladder to name a verb for stepping off a bough is
    // asking the wrong half of the system.
    if (approach.descending) continue;
    if (!offeredAlong(approach, RUN_SPEED) && !offeredAlong(approach, WALK_SPEED)) {
      silent.push(approach.id);
    }
  }
  assert.deepEqual(
    silent,
    [],
    `these authored links offer a player nothing as they walk at them, so the ` +
      `move exists in the route and not in the game:\n  ${silent.join("\n  ")}`,
  );
});

test("and nothing at all to a player who is not holding it", () => {
  // THE OTHER HALF OF THE CONTRACT, and it is the half the owner asked for.
  // Every verb above is the world reaching out and taking hold of the body, and
  // it may only do that while the player is asking. Without this the reader
  // pulls somebody up the first ledge they run past — "it automatically climbs
  // and vaults you through everything" — and there is no geometric rule that
  // separates a staging you meant to climb from a clock ledge you meant to run
  // along, because the difference is intent and intent has to be said.
  //
  // A duck is excluded: a crouched player at a low span is already doing the
  // thing, and the crouch key is its own intent signal.
  // Walk speed only, because that is the only speed a player who is not holding
  // it can be at: `freeMoveSpeed` gives WALK_SPEED whenever the key is up, so
  // "sprinting with the key released" is not a state the game can produce and
  // testing it would be testing a fiction.
  //
  // RUN_OFF and JUMP_GAP are not grabs and are deliberately ungated. Walking off
  // a low ledge is just walking, and refusing to let a strolling player leave a
  // kerb would be a wall nobody asked for either.
  const PASSIVE = new Set(["RUN_OFF", "JUMP_GAP", "EDGE_BRAKE", "HANG_DROP"]);
  const unasked: string[] = [];
  for (const approach of APPROACHES) {
    if (approach.descending || approach.kind === "DUCK_UNDER") continue;
    const loose = offeredAlong(approach, WALK_SPEED, false);
    if (loose && !PASSIVE.has(loose)) unasked.push(`${approach.id} -> ${loose}`);
  }
  assert.deepEqual(
    unasked,
    [],
    `these links grab a player who never asked to be grabbed:\n  ${unasked.join("\n  ")}`,
  );
});

// The companion property — that a body which has come to REST against a face is
// still offered the verb — is asserted in engine-world against a synthetic wall,
// because here it would be a question about how far each authored node happens
// to stand from its own obstacle rather than about the reader. See
// "a body pressed against a climbable face is still offered the climb" in
// parkourVerbs.test.ts.
