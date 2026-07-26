// The instrument itself. If the hash is wrong, every other test in this package is
// measuring nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCombatState, playerParams, referenceArena } from "@pa/duel";
import type { CombatParams, CombatState } from "@pa/duel";
import {
  decodeFighter,
  encodeFighter,
  hashCombatState,
  hashPredictable,
  hashSelf,
  nonFiniteFields,
  StateHasher,
} from "../index.js";

const arena = referenceArena();
const params: CombatParams = { A: playerParams(), B: playerParams() };

function fresh(): CombatState {
  return createCombatState(params, arena.placement);
}

function withPosition(state: CombatState, x: number): CombatState {
  const fighter = state.fighters.A;
  return {
    ...state,
    fighters: {
      ...state.fighters,
      A: { ...fighter, motion: { ...fighter.motion, pos: { ...fighter.motion.pos, x } } },
    },
  };
}

/** The next representable double above `value`. One ulp, by construction. */
export function nextUp(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + 1n);
  return view.getFloat64(0);
}

test("a one-ulp difference in a position changes the digest", () => {
  // This is the whole reason the encoding goes through raw IEEE-754 bits instead of
  // through rounded metres. A hash that quantises to millimetres cannot see the
  // difference that a cross-engine `Math.sin` actually produces, and a detector that
  // cannot see it is decoration.
  const nudgedValue = nextUp(3.25);
  assert.notEqual(3.25, nudgedValue, "the fixture must genuinely differ");
  assert.ok(Math.abs(nudgedValue - 3.25) < 1e-15, "and differ by only one ulp");
  assert.notEqual(
    hashCombatState(withPosition(fresh(), 3.25)),
    hashCombatState(withPosition(fresh(), nudgedValue)),
  );
});

test("identical states hash identically, repeatedly", () => {
  const digest = hashCombatState(fresh());
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(hashCombatState(fresh()), digest);
  }
});

test("the digest is total: every simulation field moves it", () => {
  const base = fresh();
  const baseHash = hashCombatState(base);
  const mutations: [string, CombatState][] = [
    ["tick", { ...base, tick: base.tick + 1 }],
    [
      "health",
      {
        ...base,
        fighters: { ...base.fighters, A: { ...base.fighters.A, health: 99 } },
      },
    ],
    [
      "ammo",
      { ...base, fighters: { ...base.fighters, B: { ...base.fighters.B, ammo: 3 } } },
    ],
    [
      "dodge window",
      {
        ...base,
        fighters: {
          ...base.fighters,
          A: { ...base.fighters.A, dodge: { iframeUntilTick: 9, readyAtTick: 40 } },
        },
      },
    ],
    [
      "capsule height",
      {
        ...base,
        fighters: {
          ...base.fighters,
          A: {
            ...base.fighters.A,
            motion: { ...base.fighters.A.motion, capsuleHeight: 1.2 },
          },
        },
      },
    ],
    [
      "airtime",
      {
        ...base,
        fighters: {
          ...base.fighters,
          B: { ...base.fighters.B, motion: { ...base.fighters.B.motion, airtimeMs: 16 } },
        },
      },
    ],
    [
      "dash window",
      {
        ...base,
        fighters: {
          ...base.fighters,
          A: {
            ...base.fighters.A,
            motion: {
              ...base.fighters.A.motion,
              dash: {
                dirX: 1,
                dirZ: 0,
                speed: 8,
                elapsedMs: 0,
                durationMs: 200,
                fromPhase: "GROUNDED",
              },
            },
          },
        },
      },
    ],
    [
      "a projectile",
      {
        ...base,
        projectiles: [
          {
            id: 1,
            shooter: "A",
            x: 0,
            y: 1.2,
            z: 0,
            vx: 22,
            vz: 0,
            damage: 20,
            expiresAtTick: 120,
          },
        ],
      },
    ],
    ["next projectile id", { ...base, nextProjectileId: 7 }],
  ];
  for (const [name, mutated] of mutations) {
    assert.notEqual(hashCombatState(mutated), baseHash, `${name} must move the digest`);
  }
});

test("-0 and 0 are the same state and hash alike", () => {
  // They compare equal to every test the simulation makes, so two spellings of the
  // same number must not read as a divergence.
  assert.equal(
    hashCombatState(withPosition(fresh(), 0)),
    hashCombatState(withPosition(fresh(), -0)),
  );
});

test("the predictable digest ignores what a client cannot predict", () => {
  const base = fresh();
  const damaged = {
    ...base,
    fighters: {
      ...base.fighters,
      A: { ...base.fighters.A, health: 40, hitsTaken: 3, hitsLanded: 2 },
    },
  };
  assert.equal(
    hashPredictable(damaged.fighters.A),
    hashPredictable(base.fighters.A),
    "damage is the server's and must not read as a client divergence",
  );
  assert.notEqual(
    hashSelf(damaged.fighters.A),
    hashSelf(base.fighters.A),
    "the full digest must still see it, because the audit trail needs to",
  );
});

test("the predictable digest does see everything on the movement path", () => {
  const base = fresh();
  const moved = {
    ...base.fighters.A,
    motion: {
      ...base.fighters.A.motion,
      pos: { ...base.fighters.A.motion.pos, x: 0.001 },
    },
  };
  assert.notEqual(hashPredictable(moved), hashPredictable(base.fighters.A));
});

test("tagged absence keeps null distinguishable from zero", () => {
  const nullish = new StateHasher().absent().digest();
  const zero = new StateHasher().uint32(0).digest();
  const empty = new StateHasher().string("").digest();
  assert.notEqual(nullish, zero);
  assert.notEqual(nullish, empty);
});

test("the wire codec is lossless over a fighter, Sets included", () => {
  const base = fresh();
  const withAction = {
    ...base.fighters.A,
    motion: {
      ...base.fighters.A.motion,
      // An authored action never opens inside a duel today, but the integrator reads
      // the field, so the codec has to carry it — including the Set that JSON cannot.
      action: {
        kind: "VAULT" as const,
        anchors: [{ x: 1, y: 0, z: 2, yaw: 0.5 }],
        durationMs: 400,
        elapsedMs: 100,
        ignore: new Set(["COVER.PILLAR_WEST", "COVER.CRATES_NORTH"]),
        arcHeight: 0.4,
        faceObstacle: true,
        startPos: { x: 0, y: 0, z: 0 },
        startYaw: 0,
        endPos: { x: 2, y: 0, z: 2 },
        endYaw: 1,
      },
    },
  };
  const round = decodeFighter(JSON.parse(JSON.stringify(encodeFighter(withAction))));
  assert.equal(
    hashSelf(round),
    hashSelf(withAction),
    "a field the codec drops is a divergence nobody can explain",
  );
  assert.ok(round.motion.action?.ignore instanceof Set);
});

test("non-finite state is named rather than hidden inside a digest", () => {
  const base = fresh();
  const broken = {
    ...base,
    fighters: {
      ...base.fighters,
      B: {
        ...base.fighters.B,
        motion: { ...base.fighters.B.motion, pos: { x: Number.NaN, y: 0, z: 0 } },
      },
    },
  };
  assert.deepEqual([...nonFiniteFields(broken)], ["B.pos.x"]);
  assert.deepEqual([...nonFiniteFields(base)], []);
});
