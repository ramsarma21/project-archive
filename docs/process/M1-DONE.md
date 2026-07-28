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
- **[ ]** No transition drives the body through **drawn** geometry. Distinct from the above and
  not yet checkable — the mover reads authored hulls and has never touched a GLB.
- **[~]** A climb happens only where a visible means exists. Refusal is on and validated
  against ladders and grips; **the ladders are still non-colliding, so the body passes through
  them.**
- **[ ]** A fall has a consequence proportional to its height. An 11 m drop onto cobbles
  currently ends in a harmless stand; the edge brake gates a run-off above 5.5 m but never a
  jump.
- **[ ]** Nine traversal moments sit at or past a human threshold: three drops land 1.9–2.2 m
  as a stride where a body would roll, one 5.2 m drop is at the roll ceiling, one 3.4 m drop
  lands on a 1.6 m beam, one 3.2 m hang-drop hits hard ground, two 3.0 m roof-pitch climbs are
  at the climb ceiling.
- **[ ]** Ground support is swept, not a point query, so a body cannot float off a roof edge.
- **[x]** No leap the guidance offers is unmakeable, and no brake kills a makeable one.

## 2. What you see is what you touch

- **[x]** Every collision solid is filled by the mesh drawn in it, gated and ratcheted.
- **[~]** Every affordance has real geometry under it. 22 itemised debt entries remain, down
  from 25; three retired when the elm was rebuilt.
- **[~]** Every asset reads as the object it represents. The elm is a tree again but its bark
  reads as polished timber; a systematic visual sweep of the world is being built because both
  visible defects so far were found by the owner, not by any instrument.
- **[ ]** Five catch targets have acceptance radii reaching past the thing meant to catch you
  (59%–88% overrun).
- **[ ]** Cover you can see is cover that stops a ball, everywhere — true in the arena, not yet
  true for the rope capstan and coils, which sit 0.64–0.99 m below their cover line.

## 3. Animation and motion agree

- **[ ]** A climb puts hands and feet on the rungs that exist. Currently the generic clip plays,
  looped, with a planted foot sliding up to 4.07 m/s.
- **[ ]** Vault, climb-over, hang-drop and mantle stop sliding planted feet and pushing limbs
  through walls (6.8 m/s slide, 13.5 cm and 30 cm penetration respectively).
- **[ ]** Step-up has a clip at all. It currently plays the run cycle.
- **[x]** Locomotion clips are chosen from state, not from aliased per-frame speed.

## 4. The route reads, and cannot trap you

- **[x]** One guided line, no backtracking: 164.5 m against 77.5 m straight.
- **[x]** Every action names the verb it needs on the take-off.
- **[x]** No encounter can arm across a surface it cannot reach, and no approach can hang.
- **[ ]** No route reaches an objective while bypassing a mandatory beat. The ground-up buttress
  line reaches the steeple without crossing the roof trigger.
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
- **[~]** False positives are gated. Approved design in flight: a 2.0% ceiling for gross drift
  **plus** a named-exception list, because a ceiling alone would not have caught this bug — it
  began at 1.73%. One keyword-salad false positive remains.

## 6. It runs

- **[x]** No synchronous shader compilation mid-route; spawn spikes 3 → 0.
- **[~]** Residual mid-route frame spikes trace to GPU rasterisation, not compilation. Needs a
  capture on the owner's hardware to settle magnitude.
- **[ ]** **"Cannot run"** — unexplained. Every in-lane mechanism ruled out. Needs a location or
  a live capture from the owner.

## 7. The finale works

- **[x]** The elm beat arms from the pose a player actually arrives in.
- **[x]** It is a reaction test, generous and large, not a precision test.
- **[ ]** The beat is reachable by climbing, asserted. Today the test spawns the player on the
  bough.

## 8. Nothing silently regresses

- **[x]** The played mission is a blocking gate. **[ ]** Verified to run in a real CI runner —
  `gh` is unauthenticated locally, so this is unconfirmed.
- **[x]** Dev and harness paths are pinned to the real paths they mirror.
- **[x]** Cross-lane and main-checkout writes are mechanically refused; one worker per worktree.
- **[ ]** Climb refusal is asserted end to end. Turning it off entirely leaves 730 tests green.
- **[ ]** Nothing asserts the grader runs on the live duel path — the same wiring failure could
  recur undetected.
- **[ ]** The full gate is run before every merge, not at the orchestrator's discretion.

---

## How the loop uses this

Each tick, prefer the **unmet** condition with the most player impact whose files are free.
When a condition flips to met, mark it here with its evidence. Do not add conditions to feel
thorough — a target that grows faster than it is met is not a target.

**Meta-work is time-boxed.** Process, guards and instruments exist to make the list above
shrink. If a tick produces only process, that is a failed tick.
