import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type AffordanceEndpoint,
  type PlayerKinematics,
  type ActionContext,
  selectPrompt,
  decideAction,
  promptKey,
  ACQUIRE_RANGE,
  RELEASE_RANGE,
} from "../traversalResolver.js";

function player(over: Partial<PlayerKinematics> = {}): PlayerKinematics {
  return {
    x: 0,
    y: 0,
    z: 0,
    facingX: 0,
    facingZ: 1,
    speed: 0,
    velX: 0,
    velZ: 0,
    grounded: true,
    airtimeMs: 0,
    ...over,
  };
}

const vault: AffordanceEndpoint = {
  affordanceId: "VAULT_1",
  dir: 1,
  kind: "VAULT",
  label: "Vault",
  pos: [0, 0, 1.0],
  approachDirX: 0,
  approachDirZ: 1,
};

function ctx(over: Partial<ActionContext> = {}): ActionContext {
  return {
    affordances: [],
    player: player(),
    prompt: null,
    nowMs: 1000,
    fPressedAtMs: 1000,
    fReleasedSinceAction: true,
    uiFocused: false,
    busy: false,
    actionActive: false,
    cooldownUntilMs: 0,
    ...over,
  };
}

test("F with no object does no locomotion action", () => {
  assert.equal(decideAction(ctx({ player: player({ speed: 0 }) })).kind, "NONE");
  assert.equal(
    decideAction(
      ctx({ player: player({ speed: 3, velX: 0, velZ: 3, facingX: 0, facingZ: 1 }) }),
    ).kind,
    "NONE",
  );
});

test("F near an aligned vault -> AFFORDANCE (vault only)", () => {
  const prompt = { affordanceId: "VAULT_1", dir: 1 as const, label: "Vault", pos: vault.pos };
  const d = decideAction(ctx({ affordances: [vault], prompt }));
  assert.equal(d.kind, "AFFORDANCE");
  if (d.kind === "AFFORDANCE") assert.equal(d.affordanceId, "VAULT_1");
});

test("F resolves each authored object kind exactly", () => {
  const kinds = [
    "VAULT",
    "CLIMB_UP",
    "CLIMB_DOWN",
    "DUCK_UNDER",
    "INTERACT_FLAVOR", // seat/flavor marker; director preserves its authored pose
  ] as const;
  for (const kind of kinds) {
    const endpoint: AffordanceEndpoint = {
      ...vault,
      affordanceId: kind,
      kind,
    };
    const prompt = {
      affordanceId: kind,
      dir: kind === "CLIMB_DOWN" ? -1 as const : 1 as const,
      label: kind,
      pos: endpoint.pos,
    };
    const decision = decideAction(ctx({ affordances: [endpoint], prompt }));
    assert.equal(decision.kind, "AFFORDANCE", kind);
    if (decision.kind === "AFFORDANCE") {
      assert.equal(decision.affordanceId, kind);
      assert.equal(decision.dir, prompt.dir);
    }
  }
});

test("F near but misaligned (safety halo) -> SUPPRESS, no free jump", () => {
  // Facing away from the affordance while inside the halo.
  const d = decideAction(
    ctx({
      affordances: [vault],
      prompt: null,
      player: player({ x: 0, z: 0.6, facingX: 1, facingZ: 0, speed: 2, velX: 2, velZ: 0 }),
    }),
  );
  assert.equal(d.kind, "SUPPRESS");
});

test("no mantle fallback: near a tall obstacle with no prompt suppresses rather than jumping", () => {
  const wall: AffordanceEndpoint = {
    affordanceId: "MANTLE_WALL",
    dir: 1,
    kind: "CLIMB",
    label: "",
    pos: [0, 0, 0.7],
    approachDirX: 0,
    approachDirZ: 1,
  };
  // Player pressed into the wall but not facing the acquire cone -> no action.
  const d = decideAction(
    ctx({ affordances: [wall], prompt: null, player: player({ z: 0.5, facingX: 1, facingZ: 0 }) }),
  );
  assert.equal(d.kind, "SUPPRESS");
});

test("prompt hysteresis: acquire at 1.35, stays sticky to 1.55", () => {
  // Just outside acquire but inside release: only shows if it was already held.
  const p = player({ z: 1.0 - 1.45 }); // distance 1.45 to endpoint at z=1.0
  const fresh = selectPrompt([vault], player({ z: 1.0 - 1.45 }), null);
  assert.equal(fresh, null, "1.45m should be outside the 1.35 acquire radius");
  const held = selectPrompt([vault], p, promptKey({ affordanceId: "VAULT_1", dir: 1 }));
  assert.ok(held, "1.45m should stay acquired within the 1.55 release radius");
  // Beyond release, even a held prompt drops.
  const far = selectPrompt([vault], player({ z: 1.0 - 1.7 }), promptKey({ affordanceId: "VAULT_1", dir: 1 }));
  assert.equal(far, null);
  void ACQUIRE_RANGE;
  void RELEASE_RANGE;
});

test("no repeats: F held (not released since last action) -> NONE", () => {
  const d = decideAction(ctx({ fReleasedSinceAction: false }));
  assert.equal(d.kind, "NONE");
});

test("cooldown blocks a fresh action", () => {
  const d = decideAction(ctx({ nowMs: 1000, cooldownUntilMs: 1100 }));
  assert.equal(d.kind, "NONE");
});

test("UI focus, busy, and an active action all gate F", () => {
  assert.equal(decideAction(ctx({ uiFocused: true })).kind, "NONE");
  assert.equal(decideAction(ctx({ busy: true })).kind, "NONE");
  assert.equal(decideAction(ctx({ actionActive: true })).kind, "NONE");
});

test("input buffer: a stale F press is ignored", () => {
  const d = decideAction(ctx({ nowMs: 2000, fPressedAtMs: 1000 }));
  assert.equal(d.kind, "NONE");
  const prompt = { affordanceId: "VAULT_1", dir: 1 as const, label: "Vault", pos: vault.pos };
  const fresh = decideAction(
    ctx({ nowMs: 1050, fPressedAtMs: 1000, affordances: [vault], prompt }),
  );
  assert.equal(fresh.kind, "AFFORDANCE");
});

test("selectPrompt returns null while airborne or during an action", () => {
  assert.equal(selectPrompt([vault], player({ grounded: false, airtimeMs: 300 }), null), null);
  assert.equal(
    selectPrompt([vault], player(), null, { enabled: true, actionActive: true }),
    null,
  );
});

test("one prompt only: nearest wins among several", () => {
  const near: AffordanceEndpoint = { ...vault, affordanceId: "NEAR", pos: [0, 0, 0.8] };
  const far: AffordanceEndpoint = { ...vault, affordanceId: "FAR", pos: [0, 0, 1.3] };
  const p = selectPrompt([far, near], player(), null);
  assert.equal(p?.affordanceId, "NEAR");
});
