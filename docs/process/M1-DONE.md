# What "M1 is done" means

The standing loop needs a target, or it runs forever. This is the target: the acceptance
conditions M1 must meet, each stated so it can be **checked** rather than argued about.

Status marks: **[x]** met and verified · **[~]** partly met · **[ ]** not met.

Nothing here is aspirational polish. Every line traces to something the owner reported or a
law he stated. When all of these are met, M1 is done and the loop's job changes from fixing to
guarding.

---

## 1. The body obeys physics you could defend in a real street

The owner's law: *"physics [must make] 1:1 sense to what can be done in real life."*

- **[x]** No transition drives the capsule through an authored solid. Swept, per-substep, no
  ignore list.
- **[~]** No transition drives the body through **drawn** geometry. **Now measurable**
  (`0aefc4c`): 10 of 32 transitions clip drawn geometry — the meeting-house ridge at 0.32 m is
  "climbing through a church", caught at last. Five elm climbs bury the body ≤0.81 m in the trunk
  and **survived two elm rebuilds**, so the anchors run up the bole's centreline by design: a
  climb-authoring defect, not an asset one. Fixes in flight.
- **[x]** A climb happens only where a visible means exists, and the means is **solid** — the
  body can no longer pass through a ladder (`381860f`). It stands a body-radius beside the climb
  foot so no invisible wall appears where the player must stand; the mover collides with it while
  the reader and arming predicate see through it. Route completes, 0 m penetration.
  - **Remaining, honestly:** because the ladder stands beside the foot, the body climbs
    *alongside* the rungs rather than on them. True rung contact needs the climb volume moved
    onto the ladder line, which re-opens the invisible-wall problem it was placed beside to avoid.
- **[ ]** A fall has a consequence proportional to its height. An 11 m drop onto cobbles
  currently ends in a harmless stand; the edge brake gates a run-off above 5.5 m but never a
  jump.
- **[~]** Eight of nine traversal moments are adjudicated **legitimately hard and kept, with
  reasons** — a 2.2 m stride off a roof is what the engine's own `runOffMaxDropM` encodes. The one
  genuinely implausible moment is a 3.4 m drop that classifies as a *roll* onto a 1.6 m beam
  barely wider than the body; a 0.2 m beam raise makes it a controlled hang-drop. In flight.
  Original measurements: three drops land 1.9–2.2 m
  as a stride where a body would roll, one 5.2 m drop is at the roll ceiling, one 3.4 m drop
  lands on a 1.6 m beam, one 3.2 m hang-drop hits hard ground, two 3.0 m roof-pitch climbs are
  at the climb ceiling.
- **[ ]** Ground support is swept, not a point query, so a body cannot float off a roof edge.
- **[x]** No leap the guidance offers is unmakeable, and no brake kills a makeable one.

## 2. What you see is what you touch

- **[x]** Every collision solid is filled by the mesh drawn in it, gated and ratcheted.
- **[~]** Every affordance has real geometry under it. 22 itemised debt entries remain, down
  from 25; three retired when the elm was rebuilt.
- **[~]** Every asset reads as the object it represents. A visual sweep now exists
  (`c3afd4a`) — it drives the real client, enumerates all 170 placements, and emits a legible
  contact sheet. Its first run found the Town House rendering with its cornice, leads and cupola
  **floating detached in open sky** — a 1.4 m band of zero vertices the generator baked in and
  the build's height warp stretched rather than filled. **Fixed** (`d96eb40`) by drawing the
  solid tower drum the collision already declares. Still open: `bldg-brick`-class buildings
  (the Gaol and the dormered row) ship a **torn, doubled facade** — trim and mortar shredded
  into zigzag ribbons with ghosted window frames, identical from every angle, so a baked
  mesh/atlas defect rather than lighting.
  - **The sharpest illustration of the root problem yet:** in the same frame, one of the nine
    ladders leans in **mid-air** against the floating slab. It is geometrically correct — foot
    and top match the authored surfaces exactly. The drawn building is not where the authored
    solid is. Authored-versus-drawn divergence, in one image.
- **[x]** All five catch targets land on the thing meant to catch them (`8e7e218`). Two were
  already resolved by the elm rebuild; the three real overruns were each fixed with the right
  lever — re-centring, a radius cut only where no solver consumes it, and a *bigger object* where
  the radius is pinned by test. Debt 22 → 19.
- **[ ]** Cover you can see is cover that stops a ball, everywhere — true in the arena, not yet
  true for the rope capstan and coils, which sit 0.64–0.99 m below their cover line.
- **[ ]** **Owner decision, 28 Jul:** at the market the cover you hide behind is the neighbouring
  awning, and the stall body is 0.45 m too short to shelter you. He wants **the stall body itself
  to be the cover**. Queued for `level-data` (its files are in use).

## 3. Animation and motion agree

- **[~]** A climb plays a one-shot mantle rather than a looping ladder clip (`f9ef8e1`) — the
  baked `mantle` was orphaned while `CLIMB_UP` played the cyclic `climbUp`. Planted-foot slide
  4.07 → 2.94 m/s and the loop is gone. Hands still are not *on* the rungs: that needs IK.
- **[ ]** Vault, climb-over, hang-drop and mantle stop sliding planted feet and pushing limbs
  through walls. **One structural cause, now identified:** authored verbs assign the root from a
  smoothstep anchor path while clips play root-neutral and un-retargeted with **no IK**. No
  source clip can fix it — it needs end-effector IK onto the anchor geometry, or a per-window
  re-bake. Separately, `climbOver` is simply too long for its 520 ms window (81% shown); showing
  it whole needs ≥642 ms, which is a gameplay-tuning call nobody has made.
- **[~]** Step-up plays the run cycle, and that is **declined on measurement**: run is
  spatially clean on a curb (zero clip-through, zero slide), while the only Mixamo candidate
  shows 28% of itself in the deliberate 200 ms window — a flag becoming a severe. The real need
  is a sub-half-second curb absorb that does not exist in the library.
- **[x]** Locomotion clips are chosen from state, not from aliased per-frame speed.

## 4. The route reads, and cannot trap you

- **[x]** One guided line, no backtracking: 164.5 m against 77.5 m straight.
- **[x]** Every action names the verb it needs on the take-off.
- **[x]** No encounter can arm across a surface it cannot reach, and no approach can hang.
- **[x]** No route reaches the objective bypassing the mandatory beat (`8e7e218`). It *is*
  mandatory — the duel is gated on every stop reaching a verdict — and the bypass was thin rather
  than open: the buttress branch cleared the trigger by 0.1 m. Widened 3.6 → 5.0 m with margin,
  bounded so the thin same-surface interaction with the elm crown does not worsen.
- **[x]** A resolved encounter stays resolved.

## 5. The fight is a fight

- **[x]** The officer stops you and calls the duel, subtitled, staged on your own surface,
  unhangable.
- **[x]** The hour is continuous from the cutscene into the arena.
- **[x]** The boss uses cover.
- **[x]** Grading actually runs on the real path.
- **[x]** Questions demand reasoning and have exactly one defensible answer. Cards state one
  facet each, the tightest pair separates on the question, and the two over-crediting rubrics
  are fixed: false positives 1.73% → 0.58%, `AUTHORED_REJECT` 97.9% → 100%, false negatives
  held at 0.00% (`7e02bf2`).
- **[x]** False positives are gated (`fcd7fbf`): a 2.0% ceiling for gross drift **plus** a
  named-exception list that fails on any un-tolerated over-credit at any rate, shipping **empty**,
  with a mandatory reason a test enforces. Majority mode defends the gate against a
  temperature-zero flip. False positives 0.58% → 0.00%, false negatives held at 0.00%.

## 6. It runs

- **[x]** No synchronous shader compilation mid-route; spawn spikes 3 → 0.
- **[~]** Residual mid-route frame spikes trace to GPU rasterisation, not compilation. Needs a
  capture on the owner's hardware to settle magnitude.
- **[ ]** **"Cannot run"** — unexplained. Every in-lane mechanism ruled out. Needs a location or
  a live capture from the owner.

## 7. The finale works

- **[x]** The elm beat arms from the pose a player actually arrives in.
- **[x]** It is a reaction test, generous and large, not a precision test.
- **[x]** The beat is reachable by climbing, asserted in real play: the gate drops in on the low
  bough, climbs the elm grip to the crown, and requires the beat to arm from that arrival
  (`08b4ec6`). The unit test still spawns on the bough, which is now acceptable because the gate
  covers reachability.

## 8. Nothing silently regresses

- **[x]** The played mission is a blocking gate. **[ ]** Verified to run in a real CI runner —
  `gh` is unauthenticated locally, so this is unconfirmed.
- **[x]** Dev and harness paths are pinned to the real paths they mirror.
- **[x]** Cross-lane and main-checkout writes are mechanically refused; one worker per worktree.
- **[x]** Climb refusal is asserted end to end, in real play: a controlled A/B where the same
  climb volume arms with its ladder and refuses without it (`08b4ec6`).
- **[x]** The grader is asserted to run on the live duel path — the API's own grading window
  must advance, which a client-minted fallback cannot cause. Limit stated honestly: it asserts
  the gradeable-round delta, not a model classification, because CI has no classifier
  credential.
- **[ ]** Nothing asserts mastering a concept actually learns its codex card and mints it
  PvP-legal; `codexDev` injects that standing. Also unconfirmed: whether any test drives
  `M1_PVP_CARD_ACCESS`'s shipping `ASSESSMENT_PASSED` branch, since it is set to `PLAYTEST_ALL`
  — a production gate deliberately held open for playtesting, which must not ship that way.
- **[~]** The full gate is run before every merge, not at the orchestrator's
  discretion. `scripts/merge-gate.mjs` (`pnpm gate`) now runs **every** blocking
  gate — lint, typecheck, test, build, verify:content, the three assets:verify:*
  (affordance debt held-or-shrunk), and check-playthrough where the change could
  affect play — and exits non-zero (MERGE REFUSED) on any failure. Validated end to
  end: static gates ~200 s parallel, a provisioned throwaway-stack playthrough
  ~118 s, ALL PASS. **Honestly still [~], not [x]:** local enforcement can only be a
  convention plus this loud tool — `git merge` fast-forwards (the orchestrator's
  usual case) run no hook, so a hook cannot gate them; the tool must still be *run*.
  Discretion is only truly removed by **CI as a required status check**, which needs
  `main` pushed and branch protection on (main is still unpushed). See
  `CI-AND-BROWSER-CHECKS.md` §1b.

---

## Needs the owner — cannot be closed from here

1. **`gh auth login`.** The played-mission gate is "blocking" only because the YAML says so;
   nothing here can confirm it runs in a real Actions runner. Two gates now rest on that.
2. **Add repository secret `TRUEFOUNDRY_API_KEY`** — the same shared TrueFoundry key the app
   uses (owner's decision: one key, not two). The nightly runs at 03:00 local, off the owner's
   play window, so contention essentially closes; if a heavy nightly and a daytime manual run
   ever do contend, fallbacks rise and the harness's 90% classification floor fails the run
   loudly rather than lying (the acceptable failure mode). Until the secret exists the nightly
   grading gate fails loudly at preflight. See `CI-AND-BROWSER-CHECKS.md` §1a for the trade-off.
3. **A location or a live capture for "cannot run."** Every in-lane mechanism is ruled out.
4. **A frame-trace on the owner's hardware** to settle whether residual GPU spikes are real.

## How the loop uses this

Each tick, prefer the **unmet** condition with the most player impact whose files are free.
When a condition flips to met, mark it here with its evidence. Do not add conditions to feel
thorough — a target that grows faster than it is met is not a target.

**Mutation testing was assessed and rejected as a gate**, with numbers: the suite runs on
`node --test`, which Stryker has no runner for, so it falls back to a coverage-blind command
runner and re-runs a whole package suite per mutant — roughly 17 CPU-hours for the load-bearing
set. Worse, it is blind to the grader-wiring and beat-reachability gaps entirely, because those
live where no unit test reaches. Useful as an occasional per-file discovery run; not a gate.

**Owner decisions taken 28 Jul:** build end-effector IK rather than re-baking clips, because
limbs landing on the geometry is the last thing between the parkour and looking real. Widen the
climb-over window to ~650 ms so the move reads complete. Make the market stall body the cover.
He will capture "cannot run" in play, since every in-lane mechanism is ruled out.

**Meta-work is time-boxed.** Process, guards and instruments exist to make the list above
shrink. If a tick produces only process, that is a failed tick.
