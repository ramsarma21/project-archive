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
  "climbing through a church", caught at last. Four of the five elm climbs now **graze** rather than bury
  (0.667→0.115, 0.461→0.114, 0.330→0.055) after routing the swept paths out of the drawn canopy
  — standing at the anchors was always clean. The fifth cannot clear without moving the beat
  stance, and its residual is the instrument's own synthetic run-up. Remaining: the church ridge
  at 0.326 m is the `roof-ridge-monitor` **asset drawn proud**, not a path defect — routed to the
  asset lane. Town House ×2 at 0.144 m judged mesh-proud and left, with reasons.
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
  barely wider than the body — **fixed**: the beam is up 0.2 m, so the fall is 3.2 m and reads as
  a feet-first hang-drop. All nine now adjudicated. Original measurements: three drops land 1.9–2.2 m
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
- **[x]** Vault and climb-over no longer slide feet or push limbs through walls, and the IK now
  runs **in the game and in the official instrument** (`384d894`): vault's planted-foot slide
  6.78 → 0.00 m/s and its 11.2 cm clip-through → 0; mantle clean but for a 1.04× timing overrun.
  8 µs per solve, gated to active-verb frames. Hashed path unchanged.
  - **`HANG_DROP` remains the one placement partial** (hand 12.6 cm): its anchor seats the capsule
    centre *on* the wall face. Fix is a level-data anchor inset of **≥ 0.28 m, use 0.30 m** for
    margin against the leg's minimum fold — then the foot lands on the face with no correction.
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

## Open, and newly named 28 Jul

- **[ ]** **The game records nothing about what was learned.** `conceptMastery` is written *only*
  by the chapter-assessment commit — all-or-nothing at 100% on a form. Every formative retrieval is
  lost: encounter and duel verdicts are graded server-side with a known `conceptId` and stored, and
  the mission commit carries them in `committedEvents`, which the server "derives nothing whatsoever
  from." So which concepts were asked, right or wrong, how often, is recorded nowhere. Matters more
  after the pacing decision, since the duel now carries retrieval breadth. In flight.
- **[ ]** **Consequences are binary and scripted**, not accumulating. Designed (a run-scoped
  suspicion that raises patrol density, withdraws cover and watches the final gate — world state
  rather than events, which is also what stops it glitching), and deliberately **not built**: the
  accumulator lives in a contested file, and emitting a field nothing reads is the dead-but-plausible
  shape removed from the duel brief. Needs orchestrator sequencing across three lanes.
- **[ ]** A wrong answer teaches nothing. In a teaching game the wrong answer is the highest-value
  moment — the player is attentive and has just committed to a false belief. Owner wants feedback
  in PvP. The competitive constraint is load-bearing: both sides draw from a shared eligible pool
  spent on the union of their ledgers, so revealing an answer can hand the opponent an edge.
- **[ ]** **There is no question-authoring pipeline.** Verification is strong (schema, content
  verifier, eval labels, FN and FP gates); authoring is entirely by hand — items, rubrics, card
  bindings and eval labels. And the bank is scarce: M1's PvP pool is 34 items against a 24-round
  ceiling, so "no match can exhaust it" holds **by one item**, on a constant in another package
  (`BANK-EXHAUSTION-PROPOSAL.md`, written and deliberately unimplemented).
  - The order matters: **generation without mechanical verification multiplies the ambiguity that
    made the cards unanswerable.** The pairwise discriminator was run *by hand* today and found
    the one pair that separated only by luck. Mechanise the checks first.

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

**Owner's pacing decisions, 28 Jul — the learn-to-play ratio.** **My framing overstated it.** I
built the case on the 24-round ceiling, which a later trace showed is an anti-hang backstop that
never fires: health already ends every duel, in PvE and PvP, at a measured **4–7 rounds**. So a
typical duel is **7–11 min**, not 26–44, and a typical module is nearer 15–20 min than 45–60. The
ratio is worth improving; it was never as broken as I said. Within a round the
cost is the **prose answer** (45–90 s to compose) plus a ~20 s engagement window.
  - **No round ceiling** — health ends the match, and rounds get much faster. This makes bank
    exhaustion *reachable*, since the 34-item pool only clears the 24-round cap by one item.
  - **Exhaustion policy: reuse questions, as a stopgap.** The owner's call — "just reuse questions
    for now until we figure out pipeline and bank." So no new behaviour: a repeat is served and
    graded normally. `BANK-EXHAUSTION-PROPOSAL.md` is **deferred, not rejected**. Two conditions on
    the stopgap: a repeat must be *identifiable as a repeat* so the retrieval ledger can decline to
    treat five answers in one match as five sessions' evidence, and it must not be silent to the
    player — reuse is fine, reuse you can't tell from a fresh question is a small lie. Replaced when
    generation reaches a few hundred items per chapter, at which point exhaustion stops being
    reachable in practice.
  - **An answer is 1–2 cards plus one sentence.** The evidence placement *is* the reasoning; the
    sentence says why. ~20–25 s instead of 45–90, and it suits the deterministic-card /
    short-prose-comparison architecture far better than a paragraph.
  - ~~Engagement window 20 s → 10–12 s~~ — **cannot ship**, measured. The coupling isn't the 7-ball
    path (7 balls fit any window over ~7 s) but the 14-ball ones: reaching 12 s needs a faster
    reload, after which the reference skilled player is **knocked out on the wrong-answer path** at
    tiers 3–4, violating "answering wrong is a handicap, never a lockout." Needs a full magazine and
    economy retune to be safe — deferred, ~8 s/round of payoff.
  - **Missions become milestones**, every 3rd–4th module rather than every module — but **longer and
    covering more concepts**, since the world already exists. Retrieval breadth stays with the duel.
  - Target: ~15 min per module, ~10 retrievals, one every 90 s — roughly 3.5 h per chapter instead
    of 10–14.

**Owner's question-pipeline architecture, 28 Jul:** offline generation producing the question, its
card binding and a **reference prose answer**, all verified before shipping. At runtime the card
half is checked **deterministically** against the played hand — no model — and the prose half is a
**short comparison** against the reference rather than a full rubric judgement. Cheaper, faster,
and it removes the model from the evidence half entirely.
  - **The risk to design around:** today's rubrics generalise (they credit wordings the module
    never named), and a single reference answer does not. Rejecting a correct answer phrased
    differently is a **false negative** — the gated metric, at 0.00%, and the one that silently sat
    at 3.4%. The prose half has to stay generous without becoming a rubric call again.
  - **The opportunity:** a deterministic card half means the two halves can be graded
    independently, so "your evidence was right, your reasoning missed" becomes sayable — which is a
    far better teaching signal than pass/fail, and it is exactly the wrong-answer feedback he asked
    for.

**Owner decisions taken 28 Jul:** build end-effector IK rather than re-baking clips, because
limbs landing on the geometry is the last thing between the parkour and looking real. Widen the
climb-over window to ~650 ms so the move reads complete. Make the market stall body the cover.
He will capture "cannot run" in play, since every in-lane mechanism is ruled out.

**Meta-work is time-boxed.** Process, guards and instruments exist to make the list above
shrink. If a tick produces only process, that is a failed tick.
