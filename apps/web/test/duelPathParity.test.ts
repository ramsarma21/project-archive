// Parity between the two ways M1's duel is constructed.
//
// THE PRINCIPLE THIS FILE ENFORCES. A dev path exists to test the real thing. A
// dev path that differs from the real path in a load-bearing way is worse than
// having no dev path at all, because it produces confident false results — which
// is exactly how the boss-fight owner's entire playtesting history was spent on a
// boss that ignored cover: the stand-alone `m1DuelDescriptor` opted the officer
// into cover-seeking and the ammo-aware plan, and the real mission path
// (`duelBrief`) did not, and a green suite reported the player's identical 7/14
// either way.
//
// `missionDuel.test.ts` pins the MISSION half against the core's own award. This
// file pins the TWO PATHS AGAINST EACH OTHER: the stand-alone descriptor the dev
// harness screenshots (`?verdict=correct|wrong|alt`, and the reference the mission
// is meant to mirror) and the production brief the mission and the graded
// `?verdict=live` harness both build. If someone adds a fourth opt-in to one and
// not the other — the precise shape of the original defect — this breaks.
//
// It asserts on the CONSTRUCTED boss profile and arena rather than restating the
// opt-ins, so the test cannot pass by agreeing with a copy of the mistake.

import assert from "node:assert/strict";
import test from "node:test";

import {
  M1_BOSS_OVERRIDES,
  M1_BOSS_TACTICS,
  M1_BOSS_TIER,
  bossProfileForTier,
  projectFieldSeed,
  ropewalkYardArenaSpec,
  type BossProfile,
  type OpponentSource,
} from "@pa/duel";

import { M1_MISSION_ID, duelBrief } from "../src/chapter/m1Mission.js";
import { m1DuelDescriptor } from "../src/duel/m1Duel.js";
import { missionCast, missionDuelDescriptor } from "../src/duel/missionBrief.js";
import { yardArena, yardArenaSpec } from "../src/duel/arenaSpec.js";

const SEED = projectFieldSeed(["MISSION.DUEL.PARITY.TEST"]);

/** The boss both paths build, for whichever construction is under test. */
function standaloneBoss(): BossProfile {
  const opponent = m1DuelDescriptor({ attempt: 1, tier: 1 }).opponent as OpponentSource;
  assert.equal(opponent.kind, "BOSS");
  return (opponent as { profile: BossProfile }).profile;
}

function missionBoss(): BossProfile {
  const opponent = duelBrief(SEED, 1).opponent as OpponentSource;
  assert.equal(opponent.kind, "BOSS");
  return (opponent as { profile: BossProfile }).profile;
}

/**
 * The boss profile minus its id.
 *
 * `bossId` is the ONE field that legitimately differs: the stand-alone descriptor
 * labels it `BOS.MD01.BOSS.OFFICER.v1` and the mission `BOS.MD01.BOSS.CONSTABLE`,
 * and the reducer reads it only into the `DUEL_STARTED` telemetry's `opponentId`
 * (machine.ts) — never into the field clock, the RNG or a verdict. So it is a
 * label, not a load-bearing input, and everything ELSE about the fight must be
 * identical. Stripping it here is deliberate: it documents the one allowed
 * difference in the same place it excludes it, so a reviewer sees the boundary.
 */
function loadBearing(profile: BossProfile): Omit<BossProfile, "bossId"> {
  const { bossId: _bossId, ...rest } = profile;
  return rest;
}

test("the stand-alone descriptor and the mission brief build the same boss, opt-ins and all", () => {
  const standalone = standaloneBoss();
  const mission = missionBoss();

  // Field by field on the constructed profile, not a restatement of the three
  // opt-ins: tier, health, damage and fire interval are all derived from tier and
  // would drift silently if one path passed a different tier, and the three
  // opt-ins (ammoPolicy, takesCoverBeforeQuestion, tactical) are the exact fields
  // whose divergence the owner played through. Everything but the id must match.
  assert.deepEqual(loadBearing(standalone), loadBearing(mission));

  // Spelled out so the failure names the field, not just "objects differ".
  assert.equal(standalone.ammoPolicy, "SYMMETRIC_COMPLEMENT");
  assert.equal(mission.ammoPolicy, "SYMMETRIC_COMPLEMENT");
  assert.equal(standalone.takesCoverBeforeQuestion, true);
  assert.equal(mission.takesCoverBeforeQuestion, true);
  assert.equal(standalone.tactical, M1_BOSS_TACTICS);
  assert.equal(mission.tactical, M1_BOSS_TACTICS);
  assert.equal(standalone.tier, mission.tier);
});

test("both paths fight in the one shared rope-walk arena", () => {
  // The stand-alone descriptor carries the arena directly; the mission brief's
  // arena is assembled by `missionDuelDescriptor` from `yardArena()`. Both must be
  // the same origin-built yard — the reversal pinned in missionDuel.test.ts, held
  // here across the OTHER construction too so a change to `m1Duel.ts`'s arena
  // cannot quietly re-open the void the owner saw in live mode.
  const standalone = m1DuelDescriptor({ attempt: 1, tier: 1 }).arena;
  const mission = missionDuelDescriptor(duelBrief(SEED, 1), missionCast(M1_MISSION_ID)!).arena;
  const shared = yardArena();

  assert.deepEqual(standalone.world.bounds, shared.world.bounds);
  assert.deepEqual(mission.world.bounds, shared.world.bounds);
  assert.deepEqual(standalone.placement, shared.placement);
  assert.deepEqual(mission.placement, shared.placement);

  // The cover the fight is decided by, on both paths, is the ONE YARD_COVER list:
  // same ids, same footprints, same top heights, in the same order. A blocker
  // added to one construction and not the other would be the arena-shaped twin of
  // the opt-in drift, so it is pinned rather than assumed.
  const coverOf = (world: typeof shared.world) =>
    world.blockers
      .filter((blocker) => blocker.tags.has("DUEL_COVER"))
      .map((blocker) => blocker.id)
      .sort();
  assert.deepEqual(coverOf(standalone.world), coverOf(shared.world));
  assert.deepEqual(coverOf(mission.world), coverOf(shared.world));
});

// ---- and the third construction: the core's balance gate --------------------
//
// THERE IS A THIRD PLACE M1'S FIGHT IS BUILT, and until now nothing pinned it. The
// balance gate (`packages/duel/src/__tests__/winnability.test.ts`) has to drive the
// shipped fight or its "winnability verified" claims describe a fight nobody plays —
// which is exactly what they did while it measured `bossProfileForTier(tier)` in
// `referenceArena()`. So @pa/duel now carries the shipped configuration itself:
// `M1_BOSS_OVERRIDES` for the three opt-ins and `ropewalkYardArenaSpec()` for the yard.
//
// It carries them as a RESTATEMENT, not an import, and that is forced rather than
// chosen: the authoring lives in `arenaSpec.ts` because each piece of cover is an
// imported GLB fitted to a height, which is asset-pipeline data the headless core has
// no business knowing — and the core cannot import from `apps/web` anyway, since the
// dependency runs the other way. A restatement with no pin is how the
// SYMMETRIC_COMPLEMENT opt-in went missing from the real mission path in the first
// place, so these two tests are that pin. If they fail, the gate is measuring something
// M1 does not ship, and the fix is to update @pa/duel — never to relax the assertion.

test("the core's copy of M1's arena is M1's arena, bit for bit", () => {
  // Deep equality, not a tolerance: both sides apply the same uniform fit to the same
  // measured prop sizes in the same order of operations, so they must agree exactly. A
  // tolerance here would let a genuinely refitted prop through.
  assert.deepEqual(ropewalkYardArenaSpec(), yardArenaSpec());
});

test("the core's copy of M1's boss opt-ins is what the mission passes", () => {
  // Built through the same factory the two production sites use, so this compares the
  // OVERRIDES rather than restating the resulting profile. A fourth opt-in added to
  // `m1Duel.ts` and `m1Mission.ts` but not to `M1_BOSS_OVERRIDES` fails here.
  const fromCore = bossProfileForTier(M1_BOSS_TIER, "PIN", M1_BOSS_OVERRIDES);
  assert.deepEqual(loadBearing(fromCore), loadBearing(missionBoss()));
  assert.deepEqual(loadBearing(fromCore), loadBearing(standaloneBoss()));
  // And the tier is the one the mission authors, not just whatever the constant says.
  assert.equal(M1_BOSS_TIER, missionBoss().tier);
});
