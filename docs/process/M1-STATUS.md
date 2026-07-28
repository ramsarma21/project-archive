# M1 status — fixed, open, and what each gate can actually see

The single record of where M1 stands. Updated at every merge into `main`.

**Why this file exists.** Work ran in five parallel lanes across two days and roughly forty
merges. Three regressions reached the owner in one morning, all of them introduced by the
previous night's fixes, because nothing tracked state across the lanes. A green suite is not
a record of what works — several of the bugs below passed every gate while the game was
visibly broken.

**The discipline.** Before merging a lane: run the full gate *and* `PLAYTHROUGH_BASE=<url>
node scripts/check-playthrough.mjs`. After merging: update this file. A fix is not "done"
because a worker reported it — it is done when it is merged, gated, and recorded here.

**The standing loop**, every 15 minutes, in this order:
1. **Merge** every finished lane; verify `main` green; hunt for stranded or unmerged lane work.
2. **Fix** — launch a worker on the highest-value open item no active lane is blocking.
   Player-facing before infrastructure. Launch, don't queue.
3. **Hunt** a new area, rotating so coverage accumulates: mutation-test a package not yet
   hunted; visually sweep authored surfaces; architecturally review an old system; audit a dev
   path for preconditions it hands itself; hunt guards that report instead of failing.
4. **Verify** one previously-claimed fix by reading code, not its commit message.
5. **Track** everything found, here.

**Why step 3 exists.** Both of 28 Jul's visible defects — the elm rendering as glass shards
and the ladders floating in air — were found by the **owner, playing**, and by no instrument
we have. A blocking played-mission gate, a collision-vs-visible gate, a placement verifier, an
affordance verifier, a texture check and a scale check all passed. The render census counts
draw calls, triangles, textures and untextured white-boxes; a *badly shaped* mesh is none of
those. Waiting to be told is not a verification strategy.

---

## Fixed and merged

One line each; the reasoning lives in the commit message. Every one was reproduced and
verified in the running game, not in a replay harness.

**Traversal** — climbs wrote position past the solver, driving the capsule a full radius into
what it climbed (`c31c2b1`) · climb/vault/climb-over anchors sat *at* the face rather than a
radius off it, holding 0.34 m of divergence then popping the body onto the ledge
(`7d92531`, `2cf2105`) · the scaffold gap **soft-locked permanently** because the edge brake
killed a jump that was always makeable (`fd99dc5`) · the Shambles street was impassable, the
vault committing only on an axis the street's nodes don't sit on (`c31c2b1`) · ladders rebuilt
as real leaning geometry with human rung gauge, and climb **refusal** is authoritative on
validated ladders and grips (`8686ae6`).

**Route** — one guided line, 337 m → 164.5 m against 77.5 m straight, no backtracking
(`6d7319e`, `d3ff453`, `74c9424`) · guidance no longer widens to three lines on retry
(`2f6486c`) · the mandatory beat moved off a detour onto the roofline (`7d5ed19`) · every
climb, vault and leap now names its verb on take-off (`942c8a9`).

**Encounters** — a resolved guard re-armed when a reprieve lapsed, and the "glitchy running"
was that same churn flipping the locomotion clip (`d587293`) · **the soft-lock**: the trigger
ignored height, so a roof beat armed from the cobbles 8 m below and the clock drained to PAST
DAWN; triggers now require the beat's own surface, with a 16 s abort (`9f082e7`) · the officer
now stops the player before the fight, subtitled, staged on their own surface and structurally
unhangable (`067adc8`) · the duel opens in the hour the cutscene ended, instead of jumping from
pre-dawn to midday (`77e6167`).

**Duel** — grading had **never run** in play; every playtest before this was ungraded
(`c1881b6`, `2482a37`) · the live harness drew an arena 90 m from the real one (`648f693`) ·
all Boston boss fights now enter the shared arena, with drawn cover pinned as blockers
(`1798e23`) · the mission boss never took cover, 0 events before and 11 after (`2c567a8`) ·
one item was bare recall, and its gate was silently failing at 3.4% on stale labels, now 0.0%
(`c36c1db`) · the nine cards each state one facet instead of three near-copies per topic
(`13cdc12`) · the tightest question no longer baits with a decoy's own vocabulary.

**World and performance** — Old Brick drew a small church inside a huge solid, so ~90% of what
you collided with was air; 6% → 73% fill (`e77ef51`) · the watch post stood 3.4 m above the
roofline (`d166733`) · movement lurches were **synchronous shader compilation**, a frame
blocking 96–118 ms past the 83 ms window that discards ~10 ticks (`1e47247`, `74c432e`) ·
street draw calls 177 → 60, crowd 1.7M → 0.44M triangles (`324f26c`, `3200cd0`) · the yard
stage sat a metre under the duel plane and catches landed on a heaped crown (`922f2e5`).

**The elm beat** — it was failing to *arm*, not rendering wrong: a 1.1 m circle plus a ±60°
facing arc rejected the pose a player arrives in, and the facing gate was meaningless because
the panel is screen-space (`27ec2b5`).

**Verification and determinism** — the played mission is a **blocking** gate (`8eb2393`) · all
fourteen dev/harness paths swept, the two load-bearing ones pinned (`afe8717`) · the motion
path is bit-exact across browsers (`35ab20c`) · a test double that returned every profile's
data behind a comment promising otherwise (`e16aed1`) · the module deck's third and fourth
hand-copies removed (`a5360d2`) · two untested mastery guards, either of which let a
zero-evidence form pass (`1c4250f`).
---

## Open

**Would affect play now**
- **Ladders rebuilt and refusal is on (`8686ae6`) — but you can still walk through them.**
  The old GLB was a braced trestle (back tapering 0.57 m → 0.06 m), drawn bolt upright; new
  art gives two rails and N rungs at a fixed 0.30 m gauge, one GLB per rung count, so height
  comes from more rungs rather than bigger ones (measured 0.287–0.315 m across all nine).
  `SceneryPlacement` gained a **pitch** composed about the foot, so ladders lean at 72°;
  `geom.json` confirms every foot on its standing surface and every top on the served one.
  Refusal is authoritative — a climb-volume ascent arms only where a validated ladder or grip
  exists, and the elm crown and stone buttress pass as **grips** validated on real geometry
  (the named support must be a solid spanning the rise with clearance above) rather than by
  exemption. Route completable, `check-playthrough` ALL PASS, 0 m penetration.
  **Still open, and it is the owner's original complaint verbatim:** the ladders carry **no
  collision**, so the body passes through them. Also open: the climb clip is the generic
  root-neutral animation, looped, with a planted foot sliding 4.07 m/s and no tie to the
  rungs. Both in flight.
  <details><summary>What the facade was, for the record</summary>

  The first pass (`025ad65`) drew nine ladders that satisfied a placement spec and nothing a
  body could do. The owner found it in one frame. Four structural defects:
  - `SceneryPlacement` has only `yaw` — **no pitch** — so a leaning ladder cannot lean.
    Every one is drawn bolt upright.
  - The draw uniformly scales one 1.90 m mesh to each rise (2.3–3.0 m), so rung spacing
    inflates 1.2–1.58× and corresponds to nothing a leg could step on. Height should come
    from more rungs, not bigger ones.
  - They carry no collision by design, so the body climbs the air beside a ghost. The
    reasoning (a solid at a climb foot would block the standing spot) was sound about the
    problem and wrong about the fix: the ladder should stand *beside and leaning over* the
    spot, not occupy it.
  - The asset may be the wrong object outright — described as "a braced leaning ladder,"
    renders as a splayed four-legged trestle.
  - **The predicate is not wired to the mover at all.** `alignClimbToLadder` is defined,
    compiled into `world.ladders` and unit-tested, but `select.ts`, `flow.ts` and
    `playerMotion.ts` never call it — `CLIMB_UP` is still ranked purely on geometry. So the
    pipe is inert end to end, not merely switched off. (`collision.ts` still carries a stale
    comment saying ladders are "absent today … nothing authors one yet.")
  </details>
  Refusal is still off. Asset, placement, lean, collision, animation and refusal are being
  redone as one task, because the owner is right that they only work together.
- **Animations do not match motion.** Vault: planted foot slides 6.8 m/s and pokes 11 cm
  into the obstacle, hands only graze the top. Climb-over: foot 13.5 cm through the wall,
  only 81% of the clip shown. Hang-drop: hand 30 cm inside the wall. Mantle: foot slides
  4 m/s while a *looping* clip plays. Step-up has no clip — it plays the run cycle.
  Landings show 44% (run) and 55% (received) before being cut off. Measured, unfixed.
  *Sequenced after the ladders, since climb paths are changing.*
- **A 6.4–11.2 m fall costs nothing.** The elm fall-through was **disproven** (`5ec3684`): the
  floor is solid everywhere under the tree and a jump off every bough lands *on* it, guarded
  by 35 cases. What is genuinely wrong is that the drop is consequence-free — a HARD landing
  only emits noise, and the edge brake gates a *run-off* above 5.5 m but never a *jump*, so
  jumping bypasses the protection entirely. Against the owner's 1:1-with-real-life rule an
  11 m drop onto cobbles is an injury or a refused take-off. Lives in `engine-world`;
  sequenced behind the ladder rework. **Not a soft-lock:** what met him at the tree was the
  street constable patrolling under it, drawn by the landing noise — a patrol, not a beat, and
  the same-surface band correctly refuses arming from the base or the boughs.
- **A route bypasses a possibly-mandatory beat.** The ground-up buttress line reaches the
  steeple without crossing the roof trigger, which is a soft-lock waiting to happen if
  `ROPEWALK_STOP` is mandatory. Also: the 2.0 m same-surface band alone does not separate the
  meeting-house leads (8.2) from `BOUGH_CROWN` (8.3) — only the XZ radius does. Flagged, open.
- ~~The Liberty Elm~~ — **done** (`8d816cb`, then bark reworked). Rebuilt procedurally rather
  than through Meshy, because Meshy foliage *is* the shard defect. All five F_TREE affordance
  rows at 100%, so the boughs the player stands on fill their footprints. Bark now matte with a
  baked normal map and irregular interlacing furrows; it reads as bark rather than varnished
  timber. Procedural, not photographic — a Gemini texture pass on the hero trunk remains a
  legitimate future upgrade, not a defect.
- **Duel cards were too alike to answer — mostly fixed** (`13cdc12`). My diagnosis was wrong:
  the duel does **not** draw from the 46-concept teaching registry. It already asks on exactly
  three concepts, with nine cards (three per concept) derived from the bank. The overlap was
  *intra*-concept, and the mechanic deals five of nine as an evidence hand, so a hand of
  same-facet cards was a guess. All nine now state one facet and name their boundaries, and the
  reused perspective badges are differentiated. Still open: `CONSENT_GROUND` vs
  `LAWFUL_NOT_CONSENTED` are a principle and its rebuttal, separable only when the question
  explicitly invokes virtual representation — being closed by moving the discriminator into the
  question. In flight.
- **The grader credits wrong answers, and nothing gates that.** Two false positives reproduce
  across runs and pre-date the card work: `NAME_TWO` credits "a letter to my sister and a
  newspaper," and `WHAT_RIGHT` credits "the right to not pay taxes" — which is not a right, it
  is the misconception the mission exists to correct. False negatives are gated; false
  positives are **not**, so every pressure in the system points toward leniency, which is why
  these survived. This is the owner's own complaint ("it keeps … granting right") in another
  form. In flight, with the hard constraint that FN must not leave 0.00% to fix it.
- **The live classifier gate is now wired to run without anyone remembering — but
  unverified in a real runner.** `.github/workflows/grading-eval.yml` runs `pnpm
  grading:eval:gate` (`--repeats 3 --concurrency 3 --timeout 20000`) nightly (08:00 UTC) and
  on demand, against a dedicated `TRUEFOUNDRY_GRADING_API_KEY` secret. The ~20 s timeout is a
  *measurement* cap, not the 1.5 s *play* cap; low concurrency stays off the rate limit;
  repeats=3 keeps a temperature-zero flip from deciding the gate; the harness's coverage gate
  turns a degraded gateway into a loud fail, not a false pass. **It fails loudly when the
  secret is absent** (a red run naming what to add), never a silent skip — the failure mode
  being removed. Failure signals, ranked by surviving nobody watching: a **committed dated
  report** under `docs/process/grading-eval/` (a gap in the dates is itself the alarm), a
  GitHub **issue** labelled `grading-eval`, and a red run + artifact. The offline structural
  `eval.test.ts` still runs per-PR. **Honest limits:** (1) the secret does not exist yet — the
  owner must add it, and until then every run fails at the credential preflight; (2) nothing
  here can confirm the workflow runs in a real GitHub Actions runner (`gh` unauthenticated
  locally, no run observed), the same unverified basis the `playthrough` gate already blocks
  on. Wired and merged is not "works": the first real run, or the first missing date, settles
  it. Nightly chosen over pre-release because only a live series catches drift in the *model
  itself*, and there is no release process to hang a pre-release trigger on. Reasoning in
  `CI-AND-BROWSER-CHECKS.md` §1a.
- ~~The elm beat is finicky and hard to start~~ — **fixed** (`27ec2b5`). It was failing to
  arm, not rendering wrong: a 1.1 m circle on the crown tip plus a ±60° facing arc rejected
  the exact pose a player arrives in off the leap (1.5 m back, ~105° off, moving south down
  the limb), and armed for single frames when the look swung through. The facing gate was
  pointless — the panel is a screen-space overlay centred regardless of heading — so it was
  an invisible precision test inside a mechanic rebuilt to stop being one. Now 2.4 m and
  ±135°; the act's own difficulty untouched.
- ~~No staging into the boss fight~~ — **fixed** (`067adc8`, `77e6167`). The officer bars the
  way, names the ink on the player's hands, and calls the reckoning, subtitled in the encounter
  cinematic's own voice, staged on the player's live arrival surface so it cannot teleport, and
  structurally unhangable (completion, a 16 s cap independent of the render loop, or a skip —
  none depending on the officer's rig loading).
  - A **continuity break** was found by putting its own two frames side by side: the officer
    stopped the player before dawn and the fight opened at midday, because the arena's light
    rig was hardcoded to a stand-alone afternoon with no parameter for time of day. The dawn
    lift at yard arrival is now threaded through the `duelPort` seam; the arena takes dawn's
    colours verbatim and maps intensity into its own ACES range. Sun direction and shadow
    frustum deliberately unchanged — cover shadows are how a player reads where cover is.
  - **Watch item:** on a very fast arrival the dawn lift is low and the yard is dim. Legible in
    capture, but lit braziers would be the in-fiction floor if it reads badly in play.
- **"Cannot run"** — unexplained. Every in-lane mechanism ruled out by two systematic
  passes; the per-leg speed cap is disproven (it releases ~3 m *early*). Needs a location
  or a live capture from the owner.

**Measured, subtler**
- Nine traversal moments at a human threshold: three drops land 1.9–2.2 m on hard cobbles
  as a stride where a body would roll; a 5.2 m tower drop at the roll ceiling; a 3.4 m drop
  onto a 1.6 m beam; a 3.2 m hang-drop to hard ground; two 3.0 m roof-pitch climbs at the
  climb ceiling.
- One moment unverifiable: `D_SROOF_E→D2_ROOF_W` measures 9.78 m horizontally for a 3.8 m
  "drop" — either two roof edges nearly touching or a leap mislabelled. The hull cannot
  distinguish them.
- Rope capstan and cover coils sit 0.64–0.99 m below their cover line. No fit recovers a
  1.05 m capstan from a 0.25 m flat coil; needs a taller asset.
- Five catch targets have acceptance radii reaching past the thing meant to catch you:
  `LEAP_YARD_HAY` (59%), `CATCH_LANE_HAY` (75%), `LEAP_UPPER` (75%), `LEAP_CROWN` (84%),
  `CATCH_PRINTSHOP_HAY` (88%).
- Market stall cover is the *neighbouring awning*; the stall bodies are 0.45 m short.
  Needs a design decision on whether that arrangement is intended.

**Infrastructure and debt**
- Ground support is a point query, so a body can float off a roof edge (audit P4,
  deliberately deferred).
- **Simulation is bit-exact across browsers**, motion (`35ab20c`) and duel (`4a467eb`).
  Perturbing the transcendentals by 16 ulp over 400 ticks leaves the predictable hash
  bit-identical; end-of-round position gap and the hit/miss boundary shift are both 0.
  - **A call worth remembering:** yaw is dropped from the client-facing digest (kept in the
    full server hash) because `atan2` cannot be pinned and nothing reads `motion.yaw` to produce
    position, velocity, health or hits. **Aim is different and was not dropped** — it is hashed
    and a predicting client recomputes it, so it was made exact instead. If facing ever becomes
    load-bearing, a desync in it will not be reported.
- Residual mid-route frame spikes trace to GPU rasterisation, not compilation — hardware and
  load, not code. Needs the owner's machine to settle magnitude.
- ~~Dead `MissionDuelBrief` fields~~ — **removed** (`8573c27`). Four fields were built and
  never read, and `duelBrief()` was constructing a whole collision world and placement on every
  mission start for nobody. Verified across the seam with the full playthrough gate on an
  isolated stack. Residue: `arenaPlacement()` in `packages/mission-m1/src/runtime.ts` now has no
  app callers (`arenaWorld()` still has a real test caller); worth a look when that lane frees.
- Two `check-world-scale` findings print as observations and gate nothing:
  `playerboy-rigged.glb` is 1.2× off its declared size and `flintlock-pistol.glb` 1.5×.
  Deliberately non-blocking, so nothing enforces them.
- 25 itemised affordance debt entries, gated so the list can shrink but never grow silently.
- ~~One flaky test~~ — **fixed** (`111323b`), and it was **three**, not one. All drove a real
  `setInterval` against a fake clock and used wall-clock sleeps as a proxy for "a tick ran". The
  test now injects a scheduler driver and controls time; one assertion was tightened rather than
  any loosened. Production backoff was never fragile.
- **Two latent traps in `apps/api`**, found while hunting, not fixed: `SubmissionRateLimiter` in
  `assessment/requestPolicy.ts` is defined but never wired in and never tested — dead code that
  reads as a live protection. And `matchesById`/`passes` in the pvp route are module-global, so
  live matches leak across tests in that file.

---

## Regressions, and what now prevents them

All three of 28 Jul's regressions were introduced by the previous night's fixes.

| Regression | Introduced by | Now prevented by |
|---|---|---|
| Duel harness rendered a void | the graded-attempt rewrite | `check-playthrough` duel-void census |
| Encounter soft-lock from a roof | relocating the beat to a roof | same-surface arming + 16 s abort |
| Boss ignored all cover | arena swap exposing a missing opt-in | parity assertions in `missionDuel.test.ts` |
| Ladders drawn floating, upright, ghosted | the ladder placement itself | *nothing yet — see Open* |

### Process errors, and the change that prevents each

Kept because catching an error is worth less than removing its source. Each row is a mistake
the orchestrator actually made, and the specific change made in response.

| Error | Change made |
|---|---|
| Merged the ladder facade on captures the worker itself called too dark to read | Open the artifact, never the caption. An illegible frame is a failed check. |
| Two workers in one worktree; an interrupt swept a sibling's files into a stray commit | `subagentStart` lock: one worker per worktree, `--status` makes activity visible |
| Cross-lane writes prevented only by prose in briefs, which drifted every time | `preToolUse` lane guard reads one enforced map; ownership stopped being retyped |
| Asserted a mechanism from adjacent code three times; twice wrong, one proposed fix would have worsened the defect | Briefs give **candidates to distinguish**, never conclusions, and say when untraced |
| Ten of fifteen open conditions serialised behind one lane's files | Split `mission-world`; ownership now sized to the work, not to a theme |
| Granted a worker a path the enforced map assigned elsewhere, blocking it | Update the map *before* writing the brief that depends on it |
| Loop reported instead of acting; work queued waiting to be asked | Loop launches on every tick; a tick producing only process is a failed tick |
| Told a hunt not to spend long on two items — suppression in miniature | Hunts report everything and rank afterwards; filtering is a separate pass |

**The pattern behind all three:** a dev, harness or standalone path was correct while the
real path it mirrored had drifted. The owner's entire boss-fight playtesting history ran
inside a harness that didn't grade, in the wrong arena, against a boss that ignored cover —
and nothing failed. A dev path that differs from the real path in a load-bearing way is
worse than no dev path, because it produces confident false results.

A deduplication sweep (`a5360d2`) then found the module gate deck had a **fourth** hand-copy
in the Postgres e2e test, and the progression double existed **twice** — which is why the
scoping lie needed correcting in two places. Both now derive from one source, so the
unification is itself the pin. No new live bug came out of that sweep; the defects of this
shape had already been caught, and what was removed was latent drift.

All fourteen dual-path surfaces were swept (`afe8717`). Eleven agree; two differ
legitimately and say so loudly (the scripted verdict harness, dev sessions). The two that
were load-bearing and unguarded are now pinned: the standalone-vs-mission boss profile
must match field-for-field in the same arena, and the server's transcribed module gate must
equal the authored deck in order. The harness's third hand-copy of that deck is deleted
rather than pinned. Still divergent and deliberately deferred: PvP runs its own arena
(`docs/process/PvP-Arena-Unification-Plan.md`).

**That sweep's conclusion was overbroad, and a re-audit corrected it.** It cleared eleven
surfaces as honest "because they mount the real component with real content" — true, and
insufficient. It conflated **driving** surfaces with **screenshot** surfaces.

- **Survive the sharpened test** (usable as evidence): duel `?verdict=live` (opens a real
  attempt and grades), `module/devEntry`, `visor/devEntry`, `dev/resetMission` (drives the real
  progression service), and the duel/netcode/pvp/container/parkour package drivers.
- **Do not survive — screenshot tools, never parity evidence:** `beatQa` (hardcodes
  `inStance: true` in all five capture paths), **`codexDev`** (injects the learned and
  PvP-legal card standing), `combatHudQa` (injects health and ammo), and the default asset
  sheet (fits every GLB to a fixed height, not the level's boxes). Each mounts the real
  component and injects the exact state real play must earn.
- **`mission/devEntry` is trustworthy only on its default path.** `?at=<node>` drops the player
  at any route node, `?boss=1` fabricates a `REACHED_DUEL` after 900 ms regardless of the route,
  and the offline encounter authority **grants every verdict** by default. A capture taken under
  any of those is not reachability evidence.

The generalisation: **checking what a dev path uses is not checking what it skips.** A default
is only a defect when *nothing* exercises the other side — `packages/beat` and
`packages/assessment` both default a precondition to passing and both have tests driving the
failing branch, so they are genuinely fine.

---

## What each gate can and cannot see

Read this before concluding a green run means the game is correct.

| Gate | Sees | Blind to |
|---|---|---|
| `lint`, `typecheck`, `build`, ~2,719 tests | logic, types, contracts | anything about the rendered game |
| `verify:content` | authored content against its own contracts | geometry, rendering, feel |
| `assets:verify:collision` | a collision solid that isn't drawn (invisible walls) | whether a surface exists at an authored height |
| `assets:verify:placement` | route surfaces having their asset's shape | non-route geometry |
| `assets:verify:affordances` | real mesh geometry at each authored affordance | whether a human could make the move |
| `check-playthrough` — **blocking in CI** (`8eb2393`) | world renders, route advances, stops resolve, no hang, no hull penetration | climbing through *drawn* geometry, animation fidelity, the terminal elm beat (deliberately unplayed — a bot that could reliably hit it would itself be flaky) |
| `check-clip-fidelity` | hands/feet vs surfaces, plant slide, clip timing | not yet a gate — red by construction |

**Disproven, do not re-derive:** the elm is *not* drawn four times — trunk and all three
bough decks already cluster into one draw at the declared size, and nulling the boughs' asset
would collapse it to a 1.8 m pole (`7353b82`, guarded).

**A mutation hunt found the suite's own blind spots** (`6cb600d`). Method: break the code a
test claims to guard, and see whether the test still passes. Results, ranked:

1. **Climb refusal is not tested end to end — the highest-value gap in the repo.** Neutering
   the refusal condition in `parkour/probe.ts` so it never fires left **496/496 engine-world
   and 234/234 mission-m1 tests green**. Only the isolated predicate is tested; nothing drives
   a real probe against a climb volume with no ladder and asserts it refuses. This is the exact
   class as the shipped floating-ladder and climb-through bugs. **Route to the engine lane.**
2. **Nothing asserts the grader runs in a live duel.** Grading is well covered in isolation,
   but "grading never ran in play" was a *wiring* failure, and no test asserts the duel round
   path invokes the classifier. The same bug could recur silently today.
3. **Nothing asserts a beat's stance is reachable.** `missionBeat.test.ts` correctly pins
   arming from the arrival pose, but it *spawns* the player on the bough — so climbing there is
   assumed, which folds into finding 1.
4. Two mastery guards had no test at all (fixed): either could be deleted silently, letting a
   zero-evidence form report `passed: true` or a zero-item concept read as mastered. That path
   gates the capstone and mints PvP-legal cards.
5. **Screenshot dev surfaces inject the state real play earns** and are not parity evidence:
   `beatQa`, `codexDev`, `combatHudQa`, the default asset sheet. Newly found: `codexDev` cannot
   catch whether mastering a concept actually learns a card or mints it PvP-legal.

**The pattern across all of them:** every gap is a *runtime, cross-system, visible* property,
which is exactly what a unit suite structurally cannot reach — and exactly the list of things
that have reached the owner in play.

**The gap that cost the most:** every collision *invariant* reads authored hulls, and the
mover has never touched a GLB — `collision.ts`, `playerMotion.ts` and `traversalResolver.ts`
are THREE-free and work on analytic rects. So a body can be provably outside every hull while
visibly inside a building, which is why "0 of 44 transitions phase" was true and useless at
the same time.

The three `assets:verify:*` gates are the exception, and the reason they exist: they load the
published GLB and compare it against the authored hull. They are the only checks in the repo
that can see the picture diverging from the solid. Do not read the sentence above as
distrusting them — it is the invariant and replay suite that cannot see a drawn building.
