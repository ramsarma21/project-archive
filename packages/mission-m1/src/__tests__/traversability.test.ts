import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  levelDesignMaxGapM,
  solveLeapOfFaith,
} from "@pa/engine-world/parkour";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import {
  findLip,
  receivingTargetsOf,
  standableSpanM,
  verifyLevel,
  verifyLink,
} from "../traversal.js";
import type { Vec3Tuple } from "../types.js";
import { gapBudgetM, resolveDrop } from "../envelope.js";

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const { nodeProblems, linkVerdicts } = verifyLevel(level, compiled);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));

// The route is checked by running the shipped systems, not by re-deriving them:
// ballistic links go through simulateBallistic, dives through solveLeapOfFaith,
// affordances through beginAuthored, and every distance is measured against
// levelDesignMaxGapM. A failure here means the geometry is wrong, not the test.

test("every route node stands where it says it does", () => {
  const failures = [...nodeProblems].map(
    ([id, problems]) => `${id}: ${problems.join("; ")}`,
  );
  assert.deepEqual(failures, []);
});

test("the GAOL vault is verified against the runtime's own arc, not a lower static one", () => {
  // PROVEN ROOT: the live vault flies an OBSTACLE-TOP arc that, at the earlier
  // GAOL line, drove the capsule up through the stall canopy over its landing —
  // so the runtime refused the VAULT and silently fell back to MANTLE, while the
  // old static verifier flew a lower endpoint arc and passed it. The verifier now
  // asks the runtime's exact question (probe -> planVerb -> beginAuthored), so the
  // two can no longer disagree. Never by ignoring a canopy.
  const spec = level.links.find(
    (l) => l.from === "B_VAULT_IN" && l.to === "B_VAULT_OUT",
  )!;
  assert.deepEqual(
    spec.ignore,
    ["GAOL_BARRELS"],
    "the vault ignores only the barrels it clears — never a canopy",
  );

  // The shipped, shifted line verifies.
  const shipped = verifyLink(compiled, nodeById, spec, []);
  assert.ok(shipped.ok, `the shipped GAOL vault must verify: ${shipped.problems.join("; ")}`);

  // The earlier line, reconstructed: barrels at z[-0.90, 0.20], vault nodes at
  // z=-0.35. Its runtime arc clips the canopy, so the verifier now refuses it too.
  const withOldGaol = (dropDecks: readonly string[] = []) => ({
    ...level,
    masses: level.masses.map((m) =>
      m.id === "GAOL_BARRELS"
        ? { ...m, rect: { ...m.rect, minZ: -0.9, maxZ: 0.2 } }
        : m,
    ),
    decks: level.decks.filter((d) => !dropDecks.includes(d.id)),
    nodes: level.nodes.map((n) =>
      n.id === "B_VAULT_IN" || n.id === "B_VAULT_OUT"
        ? { ...n, pos: [n.pos[0], n.pos[1], -0.35] as Vec3Tuple }
        : n,
    ),
  });
  const verifyOld = (lvl: ReturnType<typeof withOldGaol>) => {
    const c = compileLevel(lvl);
    const nodes = new Map(lvl.nodes.map((n) => [n.id, n]));
    return verifyLink(c, nodes, spec, []);
  };

  const oldVerdict = verifyOld(withOldGaol());
  assert.equal(
    oldVerdict.ok,
    false,
    "the old GAOL line must be refused by the runtime-faithful verifier",
  );

  // And it is the canopy, specifically. The stall canopy over the landing
  // (STALL_1__CANOPY; the Sol brief named the flank STALL_0) is the binding one:
  // lift it off the old line and the same vault verifies, proving the refusal is
  // the arc clipping it — not the barrels, which are ignored, nor the endpoints.
  const clear = verifyOld(withOldGaol(["STALL_1__CANOPY"]));
  assert.ok(
    clear.ok,
    "removing the flanking canopy clears the old vault: the canopy is the blocker",
  );
});

test("every authored link is performed by the shipped physics", () => {
  const failures = linkVerdicts
    .filter((v) => !v.ok)
    .map((v) => `${v.id} (${v.kind}): ${v.problems.join("; ")}`);
  assert.deepEqual(failures, []);
});

test("no jump exceeds the published gap budget for its drop", () => {
  for (const verdict of linkVerdicts) {
    if (verdict.kind !== "JUMP" || verdict.gapM === null) continue;
    const hardCap = levelDesignMaxGapM(Math.max(0, verdict.dropM));
    assert.ok(
      verdict.gapM <= hardCap + 1e-9,
      `${verdict.id}: ${verdict.gapM.toFixed(2)}m gap over a ${verdict.dropM.toFixed(2)}m drop, cap ${hardCap.toFixed(2)}m`,
    );
    assert.ok(
      verdict.gapM <= gapBudgetM(Math.max(0, verdict.dropM), verdict.line) + 1e-9,
      `${verdict.id} sits outside what a ${verdict.line} line may spend`,
    );
  }
});

test("no jump asks for more rise than the jump apex", () => {
  for (const verdict of linkVerdicts) {
    if (verdict.kind !== "JUMP") continue;
    const rise = -verdict.dropM;
    assert.ok(
      rise <= MOVEMENT_CAPABILITIES.jumpApexM,
      `${verdict.id} needs ${rise.toFixed(2)}m of rise, apex is ${MOVEMENT_CAPABILITIES.jumpApexM.toFixed(2)}m`,
    );
  }
});

test("no drop link lands in the band where the reader brakes at the lip", () => {
  for (const verdict of linkVerdicts) {
    if (verdict.kind !== "DROP") continue;
    assert.notEqual(
      resolveDrop(verdict.dropM),
      "EDGE_BRAKE",
      `${verdict.id} drops ${verdict.dropM.toFixed(2)}m; the reader stops dead above ${MOVEMENT_CAPABILITIES.maxRollDropM}m`,
    );
  }
});

test("every leap of faith clears the dive floor and has a target the solver picks", () => {
  const targets = receivingTargetsOf(level);
  const leaps = linkVerdicts.filter((v) => v.kind === "LEAP_OF_FAITH");
  assert.ok(leaps.length >= 1, "the mission has its signature dive");
  for (const verdict of leaps) {
    assert.ok(
      verdict.dropM >= MOVEMENT_CAPABILITIES.leapMinDropM,
      `${verdict.id} only drops ${verdict.dropM.toFixed(2)}m; the reader offers a dive at ${MOVEMENT_CAPABILITIES.leapMinDropM}m`,
    );
    const spec = level.links.find((l) => l.id === verdict.id)!;
    const from = nodeById.get(spec.from)!;
    const to = nodeById.get(spec.to)!;
    const dx = to.pos[0] - from.pos[0];
    const dz = to.pos[2] - from.pos[2];
    const length = Math.hypot(dx, dz);
    const lip = findLip(
      compiled.world,
      { x: from.pos[0], y: from.pos[1], z: from.pos[2] },
      { x: dx / length, z: dz / length },
    );
    const solution = solveLeapOfFaith(
      lip.point,
      dx / length,
      dz / length,
      targets,
    );
    assert.ok(solution, `${verdict.id}: the solver offers nothing from this lip`);
    assert.equal(
      solution!.target.id,
      spec.target,
      `${verdict.id}: the solver prefers ${solution!.target.id}`,
    );
    assert.ok(
      solution!.offAxisRad <= PARKOUR_TUNING.leapMaxOffAxisRad,
      `${verdict.id} sits outside the offer cone`,
    );
  }
});

test("nothing but a declared target is advertised as a dive", () => {
  const targets = receivingTargetsOf(level);
  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.ok(
      (target.radiusM ?? 0) >= MOVEMENT_CAPABILITIES.leapTargetRadiusM,
      `${target.id} is a smaller acceptance radius than the reader assumes`,
    );
  }
  // A catch that merely breaks a chain drop must not offer a dive, or the
  // solver would hijack an ordinary run-off into a committed swan dive.
  for (const volume of level.catches) {
    if (volume.offersLeap) continue;
    assert.ok(
      !targets.some((t) => t.id === volume.id),
      `${volume.id} leaked into the dive target list`,
    );
  }
});

test("every vault, slide and climb sits inside its verb's envelope", () => {
  for (const spec of level.links) {
    if (spec.kind === "VAULT") {
      for (const id of spec.ignore ?? []) {
        const mass = compiled.massById.get(id)!;
        assert.ok(
          mass.topY - mass.baseY <= PARKOUR_TUNING.vaultMaxHeightM + 1e-9,
          `${id} is too tall to vault`,
        );
        const depth = Math.min(
          mass.rect.maxX - mass.rect.minX,
          mass.rect.maxZ - mass.rect.minZ,
        );
        assert.ok(
          depth <= PARKOUR_TUNING.vaultMaxDepthM + 1e-9,
          `${id} is too deep to vault`,
        );
      }
    }
    if (spec.kind === "DUCK_UNDER") {
      const from = nodeById.get(spec.from)!;
      const to = nodeById.get(spec.to)!;
      const span = Math.hypot(to.pos[0] - from.pos[0], to.pos[2] - from.pos[2]);
      assert.ok(
        span <= PARKOUR_TUNING.slideMaxDepthM + 1e-9,
        `${spec.id} slides ${span.toFixed(2)}m; the envelope stops at ${PARKOUR_TUNING.slideMaxDepthM}m`,
      );
    }
    if (spec.kind === "CLIMB") {
      const from = nodeById.get(spec.from)!;
      const to = nodeById.get(spec.to)!;
      const rise = Math.abs(to.pos[1] - from.pos[1]);
      assert.ok(
        rise <= MOVEMENT_CAPABILITIES.maxClimbHeightM + 1e-9,
        `${spec.id} climbs ${rise.toFixed(2)}m; above ${MOVEMENT_CAPABILITIES.maxClimbHeightM}m the geometry reads as BLOCKED`,
      );
    }
  }
});

test("every surface the route stands on is wide enough to be standable", () => {
  for (const spec of level.nodes) {
    const height = spec.tags.includes("crouch")
      ? MOVEMENT_CAPABILITIES.crouchHeightM
      : MOVEMENT_CAPABILITIES.standHeightM;
    const span = standableSpanM(compiled.world, spec.pos, height);
    assert.ok(
      span >= MOVEMENT_CAPABILITIES.minStandableTopDepthM - 1e-9,
      `${spec.id}: ${span.toFixed(2)}m across the narrow axis`,
    );
  }
});

test("no SAFE link needs a verb a level-0 player does not have", () => {
  // Every parkour verb is base movement, so this is really a guard against a
  // SAFE line quietly depending on an EXPERT-only chain.
  const safeVerbs = new Set(
    linkVerdicts.filter((v) => v.line === "SAFE").map((v) => v.verb),
  );
  for (const verb of safeVerbs) {
    assert.notEqual(verb, "BLOCKED", "a SAFE link resolved to BLOCKED");
    assert.notEqual(verb, "EDGE_BRAKE", "a SAFE link resolved to a dead stop");
  }
});
