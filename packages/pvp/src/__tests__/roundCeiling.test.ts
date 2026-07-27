import test from "node:test";
import assert from "node:assert/strict";
import { DUEL_ROUND_CEILING, referenceArena } from "@pa/duel";
import { createPvpMatch, type CreatePvpMatchInput } from "../authority.js";
import { askableItems } from "../questionPool.js";
import { createLobby, joinLobby, lobbySides } from "../lobby.js";
import { M1_PVP_CARD_IDS, loadM1Bank, member } from "./harness.js";

// The round ceiling is authoritative (bug: a rounds override must never move it).
//
// A rounds override above DUEL_ROUND_CEILING would silently invalidate the bounds the
// rest of the system derives from it — the feed's cue capacity, the wire's tick range —
// so `createPvpMatch` rejects it rather than letting `createDuel` coerce it. A malformed
// count (nonpositive, non-integer) is refused outright. The live default, which passes no
// override, is untouched: the ceiling stays the duel's own.

function baseInput(): CreatePvpMatchInput {
  const host = member("profile-host");
  const guest = member("profile-guest");
  const lobby = createLobby(host, 1_000_000);
  const joined = joinLobby(lobby, guest, 1_000_100);
  if (!joined.ok) throw new Error(joined.reason);
  const sides = lobbySides(joined.lobby);
  if (!sides) throw new Error("no sides");
  // The askable bank is smaller than the ceiling, so cycle it to give a boundary test
  // enough drawn questions; which item a round asks is chosen by the duel, not the index.
  const pool = askableItems(loadM1Bank(), { A: M1_PVP_CARD_IDS, B: M1_PVP_CARD_IDS });
  if (pool.length === 0) throw new Error("no askable items");
  const questions = Array.from({ length: DUEL_ROUND_CEILING + 1 }, (_, i) => pool[i % pool.length]!);
  const arena = referenceArena();
  return {
    identity: { matchId: `pvp_${joined.lobby.code}`, seed: joined.lobby.seed, startedAtMs: 0 },
    participants: { A: sides.A, B: sides.B },
    world: arena.world,
    questions,
    placement: arena.placement,
  };
}

test("a rounds override AT the ceiling is accepted", () => {
  const result = createPvpMatch({ ...baseInput(), rounds: DUEL_ROUND_CEILING });
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
});

test("a rounds override ABOVE the ceiling is rejected", () => {
  const result = createPvpMatch({ ...baseInput(), rounds: DUEL_ROUND_CEILING + 1 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /ceiling/i);
});

test("a malformed rounds override — nonpositive or non-integer — is rejected", () => {
  for (const bad of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = createPvpMatch({ ...baseInput(), rounds: bad });
    assert.equal(result.ok, false, `rounds=${bad} was accepted`);
    if (!result.ok) assert.match(result.reason, /positive integer/i);
  }
});

test("the live default (no override) is unchanged: the ceiling stays the duel's own", () => {
  // The production path passes the whole askable pool and NO rounds. It must still build a
  // live match, with the ceiling left to @pa/duel rather than pinned by the draw size.
  const pool = askableItems(loadM1Bank(), { A: M1_PVP_CARD_IDS, B: M1_PVP_CARD_IDS });
  const host = member("profile-host");
  const guest = member("profile-guest");
  const lobby = createLobby(host, 2_000_000);
  const joined = joinLobby(lobby, guest, 2_000_100);
  if (!joined.ok) throw new Error(joined.reason);
  const sides = lobbySides(joined.lobby)!;
  const arena = referenceArena();
  const result = createPvpMatch({
    identity: { matchId: `pvp_${joined.lobby.code}`, seed: joined.lobby.seed, startedAtMs: 0 },
    participants: { A: sides.A, B: sides.B },
    world: arena.world,
    questions: pool,
    placement: arena.placement,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (result.ok) assert.equal(result.authority.phase, "LIVE");
});
