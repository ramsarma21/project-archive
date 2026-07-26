# @pa/netcode

Making two browsers agree about one fight, and proving it rather than hoping.

No rendering, no sockets, no database, and exactly one timer (`src/server/loop.ts`).
Everything else is pure values, for the same reason `@pa/duel` and `@pa/pvp` are: the
thing that decides a ranked outcome should be exercisable without a process, and a bug
in it should reproduce from a seed rather than from a story. The whole 57-test suite,
including twelve-second disconnects and full six-round matches at 10% packet loss,
runs in about eight seconds of virtual time.

## The architecture, and why it is not lockstep

**One authoritative simulation on the server** at engine-world's fixed 60 Hz, with
client-side prediction for the local player, interpolation for the opponent, and a
per-tick state hash compared across both ends.

Two arguments rule out deterministic lockstep, and the second is the one that settles
it.

**The floats.** The simulation calls `sin`, `cos`, `atan2` and `hypot` 52 times across
the movement and combat path — 8 in `combat.ts`, 10 in `policy.ts`, 18 in
`collision.ts`, 16 in `playerMotion.ts`. IEEE 754 pins `+`, `-`, `*`, `/` and `sqrt`;
it does not pin any of those, and the ECMAScript specification says outright that they
are implementation-approximated. `src/__tests__/transcendental.test.ts` measures what
that actually costs: over 40 seeded twenty-second rounds started from a bit-identical
state, a one-ulp engine difference diverged the state hash in **40 of 40 rounds, first
divergence at tick 1**.

But the same test also records a result that cuts the other way, and it is recorded
because it is true rather than because it is convenient: **the divergence does not
amplify.** Accumulated position error after a full round is a median of 3.6e-15 m and a
worst of 3.6e-14 m — femtometres — and no health or hit outcome changed in any of the
40 rounds, nor did any pair of positions end more than 5 cm apart. The simulation is
contracting, not
chaotic — `stepMotion` damps toward a target velocity, and positions are repeatedly
snapped to support and depenetrated out of walls, and every one of those operations
shrinks error rather than growing it.

What keeps the float argument alive is the tail, not the average. Hit resolution is a
step function, and the same test bisects the exact lateral offset at which a shot stops
connecting and shows that **the hit/miss boundary moves by 5.5e-14 m under a one-ulp
engine difference** — so the set of game states on which Chrome and Safari disagree
about whether a ball connected is non-empty. It is a rare event per shot. A class of
twenty-five playing all year is a great many shots, and under lockstep there is no
authority to arbitrate and no correction: the two students simply see different
winners, permanently, with nothing to appeal to.

**The structural argument, which needs no floats at all.** `@pa/pvp` deliberately does
not tell a client where an opponent it cannot see is standing, because a snapshot
containing that is a wallhack for any modified client. Lockstep *requires* both clients
to hold the whole world state in order to simulate it. The anti-cheat model and
lockstep are mutually exclusive, so the choice was already made upstream and this
package implements it rather than reopening it.

## There is one simulation, and none of it is here

Search this package for a position update and you will not find one. Client prediction
calls `stepCombat` — the real one, the same function the authoritative server calls,
with the same arguments. `src/enginePort.ts` is three symbols wide and `src/pvpPort.ts`
names the entire dependency on the match authority in one file.

Prediction is **stateless**, which is stronger than "reconciled". There is no running
predicted state; the predicted state is a pure function recomputed every frame:

```
predicted = fold(stepCombat, lastServerSnapshot, unacknowledgedInputs)
```

A newer snapshot is not a correction that has to be merged into anything — it is a
better argument to the same function. With no incremental client state, there is
nothing for incremental error to accumulate in.

## Measured, on a bad network

Reconciliation error is the gap between what a client had already drawn for tick T and
what the server later says tick T was. That is what a player feels as a snap. It is
**not** "client position now versus server position now": a correct prediction is
deliberately a round trip ahead of the server, and that comparison punishes a healthy
client.

Ten seconds of two players strafing, sprinting, crouching, dodging and firing, with the
pattern changing every second so the prediction is under continuous correction:

| profile | RTT | loss | worst correction | opponent render lag | comparisons |
|---|---|---|---|---|---|
| `LOCALHOST` | 0 ms | 0% | 0 µm | 69 ms | 203, 2 skipped |
| `SCHOOL_GOOD` | 33 ms | 0.5% | 0 µm | 123 ms | 195, 6 skipped |
| `SCHOOL_TYPICAL` | 95 ms | 2% | 0 µm | 157 ms | 174, 15 skipped |
| `SCHOOL_CONGESTED` | 230 ms | 5% | 0 µm | 245 ms | 145, 27 skipped |
| `SCHOOL_AWFUL` | 442 ms | 10% | 0 µm | 337 ms | 84, 51 skipped |

The local player's own body is bit-exact at every profile. What degrades with the link
is how far in the past the opponent is drawn, which is a readability cost rather than a
control cost — latency should feel like "they are hard to read", never like "my own
character is fighting me".

**Read the zero correctly.** It says the *network path* contributes no error: because
prediction replays the identical inputs the server applied, from the server's own
baseline, through the same `stepCombat`, latency and loss cost nothing in accuracy —
only in how much the detector can verify (the skipped column) and how stale the
opponent is. It does **not** say Chrome and Safari will agree, because both ends here
run in one Node process and therefore share one `Math.sin`. That question is answered
by `transcendental.test.ts` above, and in production by the hash detector shipping
alongside.

The first row is included specifically because it is what a two-tabs-on-one-laptop test
measures, and it is the least informative row in the table.

Two related figures. Redundant intent windows: over six seconds at 5% loss the server
accepted **1112 frames with a four-frame window against 459 with none**. And latency
tolerance is unusually good here for a reason that is a property of the game rather
than of this package — at `BULLET_SPEED_MPS = 22` a ball takes about 0.9 s to cross the
arena, so 150 ms of latency delays when your ball starts and does not make you miss a
target you saw. That is why there is no server rewind: lag compensation exists to fix
hitscan, and this is not hitscan.

## Desync detection, and what it caught

The server hashes every tick and keeps a bounded history of state, applied inputs and
per-tick digests. Checkpoints are free because `@pa/duel`'s reducer is persistent —
keeping a checkpoint is keeping a reference. Each snapshot carries the server's digest
of the client's own body plus the exact sequence in force on each tick of the span, so
a client reproduces the server's input mapping precisely rather than guessing it. A
disagreement produces a `DivergenceReport` that `replayDivergence` re-derives from a
baseline and an input log — a report plus that function **is** a failing test.

Three real bugs it caught during development, none of which is visible on localhost by
inspection:

1. **The client was predicting with raw input while the server simulated normalised
   input.** `Math.hypot(0.6, 0.8)` is not guaranteed to be exactly 1, so dividing by it
   changes the last bit. The client now runs its own frames through `@pa/pvp`'s
   `toCombatIntent`, the same function the server applies.
2. **Redundant input windows were eating shots.** The authority holds one intent per
   side, replaced by each accepted frame. Several frames in one datagram are ingested
   back to back with no tick between them, so only the newest is ever in force — and a
   fire press that was not the newest frame in its datagram was applied for zero ticks
   and simply never happened. Fixed by latching momentary presses until acknowledged;
   see `LATCHED_PRESSES`.
3. **The client was extrapolating the combat tick through phases where it does not
   advance.** `stepCombat` runs only during a live engagement, so a three-second grant
   countdown left the combat tick frozen while the client added elapsed milliseconds to
   it, drifted 180 ticks ahead, and had every subsequent frame refused as
   `TICK_TOO_FAR_AHEAD`. Play then resumed with the server holding a stale intent.

One divergence remains and is **recorded rather than tuned away**: roughly one
comparison in two hundred disagrees on the aim vector by about a third of a degree
while the position agrees to the bit. It occurs at the same rate on localhost as on a
congested link, so it is not a network effect; the server provably reproduces its own
history exactly, so it is not server non-determinism; and it is corrected by the next
snapshot. Asserting zero would mean dropping aim from the compared digest, which is
exactly the convenient blindness this package exists to prevent.

## The round barrier

Six twenty-second rounds separated by an untimed free-response question is an unusually
strong asset. It gives a hard resync barrier six times a match, at a moment when both
bodies are stationary and neither player is looking at the arena, so a full state
transfer costs nothing perceptually. Drift therefore cannot accumulate across a match:
the worst case is bounded at one round.

Two consequences handled deliberately. The server owns the round clock and publishes it
as an absolute tick, because a client-owned twenty-second timer can simply be slowed for
extra shooting time. And the question phase is genuinely untimed — `phaseEndsAtTick` is
null there, and `@pa/pvp`'s own `silentSides` rule (consumed, not restated) means a
student who is thinking is never counted as silent.

## Disconnect and reconnect

School wifi drops constantly, and rage-quitting must not become a way to dodge a loss.
Those pull in opposite directions and the policy is the line between them.

The simulation **does not pause** for a drop. Pausing is the intuitive kindness and it
is an exploit: pulling the cable the moment a ball is in the air would become the
strongest defensive move in the game. A dropped player's body stays in the world and
stays shootable. What the policy gives back is the ability to return — reconnect inside
the grace window and you resume the same match with no standing penalty at all.

An explicit leave is `ABANDONED` and is not resumable; a dropped socket is
`DISCONNECTED` and is. `@pa/pvp` already makes a forfeit a loss with
`standingApplies: true`, so netcode only decides *when* to call it. The resume window is
`@pa/pvp`'s `DISCONNECT_GRACE_MS` rather than a second opinion, because two windows
would produce the state where a player is let back into a match already forfeited.

The reconnect detail most likely to be missed: a returning client must restart its
sequence counter **above** the highest the server accepted, or `@pa/pvp`'s replay guard
silently refuses every frame and the player experiences dead controls with no error
anywhere. The resync states the floor (`resumeFromSeq`) and the client obeys it.

## What this package needs from elsewhere

**From `apps/api`** — one WebSocket registration. Nothing in `@pa/pvp`'s policy
changes, because the authority already ingests intent frames one at a time and emits
snapshots on demand. In `app.ts`, after the existing route registrations:

```ts
import websocket from "@fastify/websocket";
import { registerPvpSocket } from "./routes/pvpSocket.js";

await app.register(websocket);
await registerPvpSocket(app);   // GET /api/pvp/match/:matchId/socket
```

`registerPvpSocket` is a new file (nobody owns it yet) and is thin: authenticate the
cookie, resolve the caller's side, call `runMatchLoop(host, transport)` once per match,
forward `ClientMessage` in and `ServerMessage` out, and call `detach(side)` on close.
The one behavioural change it must bring is that **the match loop is driven by a timer
rather than by an arriving request**. The current HTTP route advances the simulation on
poll, which means the twenty-second round clock only moves when somebody asks it to.

**From the PvP agent**, in rough order of value:

1. `ingestIntent` should OR the momentary bits (`fire`, `jump`, `dodge`, `abilityId`)
   across the frames accepted since the last tick. Only the newest frame in a datagram
   survives today, so a press that is not newest is applied for zero ticks. Latched
   client-side here as a workaround; upstream it needs no latch and no cap.
2. `MAX_INTENT_LEAD_TICKS` at 8 caps how much round trip a client can compensate at
   133 ms, which puts the usable ceiling around 350 ms RTT. Widening it to ~24 costs
   nothing — the field is advisory and `ingestIntent` does not schedule the future.
3. `advanceMatch` should decay a held intent to idle after ~200 ms of silence. It cannot
   be done from outside: the only writer of `heldIntents` is `ingestIntent`, which also
   stamps `lastIntentAtMs`, so injecting an idle frame would mark a disconnected player
   as alive and they would never forfeit.
4. `OpponentView` could carry the opponent's active movement and fire-rate modifiers.
   They are not private — being slowed is felt — and without them a client cannot
   predict correctly while an opponent ability is active.
5. `advanceMatch` projects both snapshots on every tick even when none will be sent. A
   variant that skips projection would cut per-tick work for every live match.

## Layout

```
src/hash.ts                canonical state hashing over raw IEEE-754 bits
src/history.ts             per-tick digests, applied inputs, free checkpoints
src/divergence.ts          the report, and its reduction to a replay
src/barrier.ts             the inter-round resync barrier
src/protocol.ts            the wire vocabulary, both directions
src/pvpPort.ts             the single import surface onto @pa/pvp
src/enginePort.ts          the three engine symbols @pa/duel does not re-export
src/server/host.ts         authority + sessions + history + outbox, as a value
src/server/loop.ts         the only timer, and the only clock read
src/server/session.ts      presence, resume tokens, the disconnect policy
src/server/snapshot.ts     projection plus the viewer's own body
src/client/prediction.ts   stateless prediction; calls stepCombat, owns no physics
src/client/interpolation.ts adaptive-delay opponent buffer
src/client/client.ts       sampling, latching, reconciliation, resume
src/sim/link.ts            latency/jitter/loss/reorder, seeded by fieldRandom
src/sim/profiles.ts        LOCALHOST through SCHOOL_AWFUL
```

## Running

```bash
pnpm --filter @pa/netcode test        # 57 tests, ~8s
pnpm --filter @pa/netcode typecheck
pnpm lint                             # the repo-wide one-core guard
```
