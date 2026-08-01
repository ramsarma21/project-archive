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

---

## M1-only freeze (owner decision, 29 Jul)

**The project demos only M1 for now.** `main` is the clean M1-demo trunk: the vertical slice —
route, traversal, encounters, the officer cutscene, the graded duel, the elm finale, and the module
lesson that teaches into them.

- **No broad or future-facing work merges to `main` without the owner saying so explicitly.** That
  covers chapter infrastructure beyond M1, missions and chapters past M1, the four-mission collapse,
  capstone and PvP shipping gates, standards/STAAR reporting, and question-generation pipeline work.
  Merge it only if the M1 slice is broken without it.
- **Nothing is reverted, deleted or abandoned.** Every branch and worktree stays. Paused work stays
  committed on its lane branch and is named below, so resuming it is a merge and not a rebuild. Do
  not delete a branch or a worktree to tidy up.
- **Already on `main` and staying:** the `m4` asset pipeline, `content/staar`, `content/capstone` and
  the 14-mission curriculum registry (`registry.test.ts` pins `ALL_MISSIONS.length === 14`) all arrived in the 22–27 Jul baseline, not in this week's
  merges. Out of scope to remove — removing them is a larger risk than leaving them sitting unused.
- Meta-work was already time-boxed (`M1-DONE.md`); the freeze tightens it. A merge that moves no line
  of `M1-DONE.md` needs a reason.

**The scope calls in the table are my classification, not the owner's — only the freeze itself is
his.** Where a branch mixes scopes the exact commits are named, so splitting it is a cherry-pick
rather than a judgement call made at merge time.

| Pending | Scope | Do |
|---|---|---|
| `mission-world` — jump-hang clip vocabulary (`ab007f2`, `07eb7d2`) | **post-demo polish/risk** — the route already works via ladder | preserve on branch; do **not** merge for the M1 demo without browser capture and route/ladder gates |
| `duel-hud` +2 — interstitial retired, hit marker legible (granted, `dab549b`) | **M1-critical**, demo-facing | merge when gated |
| `api-hunt` `ca2e345` — an outage round enforces the deterministic card half | **M1-critical** — the "told he was right when he was wrong" class | cherry-pick alone; it is the branch's oldest commit, below the PvP pair |
| `mission-encounters` `c3db1b9` `33a7f2d` `76cfcc2` `5094c73` — question draw ordered by concept, winnability aimed at the fight M1 ships | **M1**, but current branch also has unsafe WIP | preserve; do **not** merge/cherry-pick current WIP until the hang below is resolved |
| `boss-clip` +2 — hit confirmation: sound, stronger flinch, unified colour | **nice-to-have M1** (the fight reads as a fight) | merge after the criticals |
| `module-lesson` `72ab1c9` — lesson checks vary by distractor pool, plus an **inert** remediation subset | **M1, carrying debt** | the variation is M1; the inert subset is the dead-but-plausible shape this file warns about — wire it or drop it, do not merge it inert |
| `api-hunt` `a854ab9` `a459d89` — PvP card access and `/join` reasons | **future** | pause on branch |
| `mission-encounters` `253b675` `2510c09` — the PvP server's own catch-up bound | **future** | pause on branch |
| `boss-fight` `8b00e3c` — STAAR standards reporting, `content/staar/README.md` | **future** | pause on branch |

**Five findings from the audit, none of them fixed here.**
1. **`mission-world` carries a bit-identical duplicate of the slow-running fix.** `2e617a0`/`c7cf212`
   have the same `git patch-id` as `main`'s `cf262c9`/`a109930` — the same fix was committed on two
   lanes and reached `main` from `boss-fight`. `main` is not an ancestor of the branch (27 behind),
   so merge `main` into it first, expect the duplicate to resolve as a no-op, and confirm
   `MAX_CATCHUP_STEPS` still derives 15 from the clamp afterwards.
2. **The PvP server's catch-up bound is still wired to M1's frame clamp.** On `main`,
   `packages/netcode/src/enginePort.ts` re-exports engine-world's `MAX_CATCHUP_STEPS` and
   `server/host.ts` passes it as `maxCatchUpTicks`, so raising the cap 5 → 15 for the M1
   slow-running fix silently retuned the PvP server too. The decoupling is the paused `2510c09`,
   which despite its message ("back at 5") does **not** revert the engine constant. Harmless for the
   M1 demo, since nothing in the slice runs the PvP host — recorded so it is not re-derived.
3. **An uncommitted `infra/lib/project-archive-stack.ts` edit sits in the `mission-presentation`
   worktree**, and `infra/**` appears in no lane's globs, so it is unowned. Whoever left it should
   claim or discard it.
4. **`workflow/mission-encounters` is not merge-ready after the boss duel WIP.** The reload-exposure
   pass improved the correct-answer path, but the last edit (`directionToOpenLane` plus call sites)
   leaves the duel suite hanging. The last known-good point is two edits earlier: 23s suite with one
   `bossTactics.test.ts` failure (`exposedTicks` 179/360). The safe resume path is to revert only the
   `policy.ts` addition and its two `bossAi.ts` call sites, then re-measure. The deeper M1 defect it
   exposed is real and unresolved: firing uses eye-line LOS while balls are still eaten by cover, so
   LOW-peek fights can look active while both sides shoot crates.
5. **`workflow/mission-world` jump-hang is preserved but not demo-critical.** The clock ledge already
   works on `main` via a ladder, so the branch replaces a working route action with an unproven one.
   Engine and clip-fidelity checks passed, but there is no browser capture, no completed `check-playthrough`,
   and the route/wayfind/ladder tests were killed mid-run. It should resume after the M1 demo unless the
   owner explicitly wants the risk in the demo path.

**Verified cheaply, not gated.** Both named invariants hold on `main`: `MAX_CATCHUP_STEPS =
floor(MAX_FRAME_DT_S / FIELD_DT)`, and `verdictLabel.ts` returns "Not graded" with `DuelOverlay`
still rendering `verdictBeatTone(verdict).label`. No gate was run for this audit. The hub working
tree is clean and `main` is 34 commits ahead of `origin/main`.

---

## The Archive lesson and the 1774 documents landed (30 Jul) — `main` = `73a4b58`

Design of record for all of this: **`docs/design/M1-Remedial-Slice.md`**.

| Merge | From | What |
|---|---|---|
| `f6e5caf` | `workflow/m1-sources` | Four rights-verified 1774 images + `content/m1/historical-sources.json`. Additive. |
| `73a4b58` | `workflow/m1-lesson` | The **Archive** lesson: player-paced case files with sequential unlock, a source-tolerant `ModuleVideo` variant, schema mirror. `ModulePlayer.tsx` removed in favour of `ModuleArchive.tsx` + `ModuleFilePlayer.tsx`. |
| `3fc89d6` | (orchestration) | Lane map reconciled: `m1-lesson` co-owns `apps/web/src/module/**`, `m1-sources` owns `historical/m1/**`. Detector clean. |

**Gated green on the merged tree** (measured, not asserted): build, typecheck, lint,
`verify:content`, `verify:units`, all `assets:verify:*`, lane-integrity, **2881 tests 0 failing**,
and **`check-playthrough` ALL PASS**.

**A worry that turned out to be unfounded, recorded so nobody re-raises it:**
`scripts/check-playthrough.mjs` opens only `src/mission/floor.html` and `src/duel/duel.html`. **It
never loads `src/module/*` and never uses `?boss=1`.** So the lesson going from auto-advance to
player-paced cannot affect that gate, and the harness needed no change.

**The auto-advance reversal is deliberate.** `moduleShots.ts` used to state "playback advances
itself — nothing here asks the learner to turn a card." The owner asked for a case-file Archive you
press play on, so that comment is now reversed in place. The completion gate did **not** weaken:
"every file played and every question answered" reduces to the same cues-plus-checks the server
independently re-derives, so `apps/api`'s module-deck parity is untouched.

**Open, non-blocking:**
- **GUARD DRIFT in 17 worktrees** — all hold the pre-reconciliation `.cursor/lane-ownership.json`.
  Non-failing by design; the detector prints the exact `cp` per lane. **Do not run it for the
  `playtest` worktree** — that tree stays frozen at its tag.
- The `m1-lesson` schema grant and `m1-sources` manifest grant now describe merged work and are
  retirement candidates; retiring them properly means re-pointing the guard's `--selftest` cases.
- **Files 2 and 3 of the lesson have no readable primary document.** Nothing cleanly licensed exists
  for the Acts' scope or for consent — the good candidates are paywalled (Gale/ECCO) or request-only
  (MHS). File 2 teaches what saves the player from patrols, so it should not stay thin. Permission
  requests would likely solve both.

---

## M1 is now the 1774 Coercive-Acts slate, and the capstone is LIVE (30 Jul) — `main` = `38e8a58`

Owner-approved atomic migration. Design of record: **`docs/design/M1-Remedial-Slice.md`**.
`d19028c` = the migration; `38e8a58` = capstone enabled + the subtitle comma fix.
**GATE GREEN on the merged tree, measured:** test, typecheck, build, lint, `verify:content`,
`verify:units`, all `assets:verify:*`, `lane-integrity`, and **`check-playthrough` ALL PASS**.

**Concepts: three assessed, none minted.** All reassignments of existing 8.4(A) macros.

| Concept | Was | Now carries |
|---|---|---|
| `INTOLERABLE_ACTS` | M11 | **Two propositions** — the closure as collective punishment, *and* the scope of the four acts |
| `REPRESENTATION` | M1 | Consent — the objection is who laid the tax, not its amount |
| `MERCANTILISM` | M11 | Non-importation. Label softened to "Non-importation and resistance"; slug/`parentSe`/clause unchanged |

`POSTWAR_REVENUE` and `STAMP_SCOPE` demoted to taught context (`mission: null`, definitions kept).
M11 dropped `8.4(A)` — reversible data, recorded in `missions.ts`.

**Why four lesson files but three mastery records.** `registry.test.ts` pins exactly six macros under
8.4(A), one per TEKS-named cause. There is no seventh clause to hang a separate "scope of the Acts"
concept on, so files 1 and 2 share `INTOLERABLE_ACTS`. A fourth macro was impossible without
weakening that test, which was correctly refused. **Do not "fix" this by adding a macro.**

**The capstone is enabled and proven by behaviour, not by green tests.** All **seven**
`ProgressionContent` methods are wired from the authored bank — flipping only `chapterConceptIds`
and `assessmentId` (the original estimate) would have opened an attempt serving **zero items**.
Assessment id canonicalised on **`BOS.CAPSTONE.v1`**; `content.ts` was the one half still answering
`null`. An end-to-end test opens a real attempt against `bostonProgressionContent()`, serves 2 items
per concept in both formats, answers them, and — against a real throwaway Postgres — writes **three
`concept_mastery` rows with `mastered_at` set** and mints **nine PvP-legal cards**. A parity test
pins `content.ts` to `content/capstone` and the released TEA keys, so a transcription drift fails a
gate instead of silently under-assessing.

**Released-item upgrade:** `STAAR.2021MAY.G8SS.38` and `STAAR.2022MAY.G8SS.04` — the actual measured
41–43% coercion items that justified choosing this concept — are wired to `INTOLERABLE_ACTS`.
2019 #24 stays on `REPRESENTATION`. `MERCANTILISM` is all-authored (`NO_RELEASED_TEA_ITEM`).

**PvP pool re-measured: 34 total / 25 guarded**, both above the 24-round ceiling. The two-tab demo is
intact. `MERCANTILISM` carries 7 guarded items — one short of an evenly-rotated 24-round match, which
is contingent on a rotating selector that does not exist (the same benign warning `STAMP` carried).

### Open, tracked, not fixed

1. **`verify:units`: POSTWAR/STAMP are still encounter-assessed in unit 1 though no lesson teaches
   them.** M1's two mission encounters test concepts the lesson retired — tested-but-not-taught.
   Fixing it is mission-content design (the design doc's own plan is to retarget both encounters);
   not patched here.
2. **The open-response grader is stubbed to CORRECT in both e2e tests.** Only the
   **selected-response** half is proven end to end. The prose half runs the real TrueFoundry path,
   which the owner's `.env` configures, but nobody has watched it grade a capstone answer.
3. **`assessments.test.ts`'s header comment** still carries the stale "answers null" claim
   (boss-fight's lane, ungranted).

### The original presenter asset is deliberately restored — DO NOT re-swap (30 Jul)

`main` `1670c7c` reverts `apps/web/public/world/characters/system-presenter-rigged.glb` to the
original figure. The owner prefers her likeness; the v2 covered replacement's Meshy-regenerated
face lost her and carried a hair-to-jaw seam.

**This is an accepted feel/demo choice with a known, accepted shipping blocker.** The original
asset is an open jacket over a bare torso and reads as bare-chested in the lesson's
head-and-shoulders framing. It **must not ship to Grade 8 classrooms as-is** — a future agent must
not "fix" the seam by swapping the covered v2 asset back in without the owner saying so.

The real fix, when wanted, is not either existing asset: re-run the v2 pipeline with tight
face-fidelity to the original so she is recognisably *her*, dressed. The covered v2 asset lives in
history at `3266f80`; its full pipeline (Gemini concepts, Meshy manifest, Blender scripts) remains
as source under `assets/pipeline/` and `assets/source/concepts/system-presenter-v2-*`. So it is a
re-run, not a rebuild.

Also note: the archive-room framings were *relaxed* for the covered asset, so with the original
restored the room/brief close-ups may show the original outfit again. Accepted under this choice.

**Room presenter jaw regression from the restore — FIXED (30 Jul, ArchiveRoom.tsx).** The original
GLB ships `char1` with the `jawOpen` morph **defaulted to weight 1** (mouth fully open) and **no
clip animates the morph** (`idle`/`talk`/`talk2` are translation/rotation/scale only). The room's
`PresenterRigMesh` never drove the morph, so the mouth sat gaping at rest — the "frozen/terrifying"
look. Both hypotheses in the brief were disproven by inspecting the GLB: the clips are named exactly
`idle`/`talk`/`talk2` and the morph exactly `jawOpen`, so `chooseAvailableClip` returns `idle` and it
**does play** (she moves between frames; she was never in bind pose). Fix: the room now finds the
`jawOpen` mesh/index and pins the influence to 0 every frame (the room presenter is silent, so no
lip-sync belongs there). The in-file/brief path (`SystemPresenter`) was already correct — its
lip-sync drives the morph to 0 at rest and up on speech, which overrides the default-1. Verified on
the real GPU (ANGLE Metal) at dpr 2: room mouth closed at rest with the idle still animating;
in-file/brief `__presenterJaw` reads ~0.10–0.40 speaking and 0 paused. Her arms at rest are the
idle's authored relaxed stance (hand near the hip), not a bind pose — not adjustable without
touching the clip, which is off-limits.

**In-file/opening/brief framing relaxed to a comfortable portrait — FIXED (30 Jul, moduleShots.ts).**
`PRESENTER_FRAMINGS` was a tight telephoto aimed at y≈1.51 from z≈2.3/fov12, which put the crown at
the top edge (~10% headroom) and dived the bottom to mid-chest (open jacket centred). Relaxed to
z≈2.45–2.8, fov 11.5–12, target y=1.56 → headroom above the crown, framed to the collarbone/upper
chest, eyes upper-middle. **The owner's "narrow window zooms in tighter" hypothesis is DISPROVEN by
measurement:** R3F keeps the PerspectiveCamera's VERTICAL fov fixed and only updates `.aspect`, so the
crown and collarbone project to the SAME NDC.y at aspect 1.78 and 1.19 (probed both). A narrower
window shows the same height and less width, never a tighter vertical crop — so the framing is
aspect-INVARIANT and needs no aspect-aware fov (documented in the moduleShots.ts comment so a future
lane doesn't add one). The brief uses the same `PRESENTER_FRAMINGS` set. Verified by eye on the real
GPU at dpr 2 at BOTH ~16:9 and the owner's ~1024×860: crown in frame with headroom, no chest dive,
mouth closed. Note (not acted on): `dc501d4` records that cutscenes should read as clean realistic
footage, not hologram-filtered — a separate future change; the framing holds either way.

### IRIS naming, the game-open intro, the lesson ramp, and the hub label (30 Jul, archive-room)

- **IRIS naming.** The presenter is named **IRIS** (Immersive Reconstruction & Instruction System):
  `module.json` presenter `displayName` → "IRIS", and she introduces herself by name in the intro.
  Judgement call taken: the hub/visor wordmark **"THE SYSTEM" stays as the apparatus/product
  surface** (also the duel questioner label and the system-error voice) while **IRIS is the AI
  persona** — a clean apparatus-vs-voice split, no code-symbol/file renames.
- **Game-open intro** (`apps/web/src/pages/intro/GameIntro.tsx`, wired in `App.tsx`): an intake
  cutscene between `enterPlay` and the hub, **every launch, no persistence flag**, with Skip →
  hub. Three beats (what Project Archive is / your role / meet IRIS), grounded in PRD + Day-1 B0.
  Beats 1-2 are **pending `ModuleVideo` slots** (no `src` → `ModuleVideoStage` renders nothing;
  IRIS narrates over a clean frame) so it works now with no MP4; beat 3 is IRIS live 3D. Honours
  the media decisions: no hologram coat on cutscene video, that stays on IRIS/UI. Dev bypasses:
  `?intro=1` opens the intro (review/capture); `?hub=1` deliberately **skips** it (lands on hub).
- **Lesson opening ramp** (`module.json` IDENTITY card, same `cueId` BRIEF_IDENTITY, **no new
  cues/checks — receipt still 6/4**): world (June 1774, occupied Boston, harbour shut eight
  months) → courier cover for the Committee + the non-importation Covenant → "read these four
  records." Windows re-cut (IDENTITY 24→38s, absorbed from the roomy BRIEF window) to satisfy the
  verify:content reading-time gate; total still 180s. Killed "three minutes" at source (subtitle +
  beat), so the `framedLede()` display workaround in `ModuleArchive.tsx` is deleted as dead.
- **Hub label** (`bostonChapter.ts`): M1 node "Nailed to the Post / 14 August 1765" → **"The
  Covenant / June 1774"** to match the lesson.
- **FLAG for the `m1-1774` lane:** `apps/web/src/chapter/m1Mission.ts` (its file) is **still the
  1765 Effigy Run** — `title: "Nailed to the Post"`, old concept ids, a "14 August 1765" briefing.
  The hub node and the lesson now read 1774, but the *deployed mission internals* are 1765. The
  1774 migration is the atomic pass the design doc describes (module+duel+codex+capstone+mission);
  the lesson/hub half now leads it. `missionAttempt.test.ts` still asserts the mission title
  "Nailed to the Post", so that half must move together.

### A structural flaw in the guard's own selftest, found while managing grants

`lane-guard.sh --selftest` tests the grant-override mechanism using whichever grant is live, with the
instruction that those cases "must be re-pointed at a LIVE grant whenever one is retired, never
deleted." But the **ownership-override** case needs a live grant on an *owned* path, and the
**contested-override** case needs one on a *contested* path. So **the last grant of each kind cannot
be retired without restructuring the test** — the mechanism makes its own grants un-retirable, which
is the opposite of "a grant that outlives its work should be deleted."

Consequently two grants are being kept past their work, deliberately and recorded rather than
silently: **`m1-1774`** (ownership-override case) and **`duel-hud`** (contested-override case). The
real fix is to stand those two cases on synthetic fixture paths instead of live grants, so grants can
retire freely. That is guard surgery and belongs to a pass that owns `.cursor/hooks/**`.

## Trunk consolidation (29 Jul) — the ledger table above is now ACTIONED

`main` was rebuilt into one clean M1-demo trunk so the owner has a single point to scope down from.
**Nothing was destroyed:** every branch and worktree is left in place, and every branch head is
captured in an annotated `archive/…-2026-07-29` tag (list + recovery below). Landed directly on
`main`, fully reversible via `archive/main-preconsolidate-2026-07-29` (= `8595cc2`, main before any
of this). **Trunk HEAD `82c88d6`** = `8595cc2` + the STAAR rescue + the six salvage items.

**Landed** (cherry-picked `-x`; provenance in each message):

| From | Branch commit(s) | On trunk | What |
|---|---|---|---|
| untracked | rescued from `boss-fight` worktree | `d762a63` | measured TEA statewide item-performance data (200 items × 5 admins) — was in **no** commit |
| `api-hunt` | `ca2e345` | `4eb386a` | outage round enforces the deterministic card half ("told he was right when he was wrong") |
| `boss-clip` | `f791a0a` `8399adb` | `cad7e6a` `8cf8aab` | support-hand fix + hit confirmation (sound, flinch, unified colour) |
| `duel-hud` | `dab549b` `4296cf4` | `dd0c07c` `d798a61` | stat card retired, hits-to-win on the persistent HUD, hit marker legible |
| `mission-encounters` | `c3db1b9` `33a7f2d` `76cfcc2` `5094c73` | `24d441b` `eba18ad` `7dc502d` `4ba5334` | question draw ordered by concept; winnability aimed at the fight M1 ships |
| `module-lesson` | `72ab1c9` (**Deliverable A only**) | `86d6e1d` | lesson checks vary by distractor pool |
| `mission-presentation` | `8a7e3bc` `5502d76` | `0d46e7c` `82c88d6` | one TrueFoundry key injected under both env names + docs |

**The "Not graded" invariant survived the duel-HUD merge.** `duel-hud` predates boss-fight's
`540c0e3`; its `DuelOverlay.tsx` hardcoded `correct ? "Correct" : "Wrong"`. The cherry-pick
conflicted **only** on the import block (kept both `verdictBeatTone` and the new `useLearnOnce`); the
auto-merge kept `main`'s `verdictBeatTone(verdict).label`. Verified: `verdictLabel.ts` byte-identical
to baseline (GRADING_TIMEOUT → "Not graded"), `DuelOverlay.tsx` renders `verdictBeatTone(verdict).label`,
`duelVerdictLabel.test.ts` 5/5 **run package-native** (cwd=`apps/web`; a root-cwd run false-fails on a
JSX-runtime/tsconfig artifact — not a code defect).

**module-lesson's inert half was DROPPED, not landed inert.** `72ab1c9`'s Deliverable B
(`remediationDeck` + coherence gate appended to `moduleOrder.ts`, plus `remediationDeck.test.ts`) was
wired to nothing; per this file's own instruction it was stripped before landing. Deliverable A stands
alone (web 752/752, `verify:content` pass). B is recoverable from `archive/workflow/module-lesson-2026-07-29`.

**Dropped from the trunk** (preserved on branch + archive tag):
- `mission-world` jump-hang (`ab007f2` `07eb7d2` + clip commits) — clock ledge already works via its ladder.
- `mission-encounters` `253b675` `2510c09` — PvP netcode catch-up bound (future).
- `api-hunt` `a854ab9` `a459d89` — PvP card-access gate and `/join` reasons (future).
- `boss-fight` `8b00e3c` — STAAR standards reporting / four-mission assignment (future). Its untracked
  data file was rescued in `d762a63`; the commit itself is dropped.
- `mission-encounters` **uncommitted WIP** — not taken (it hangs the duel suite); only the four committed M1 commits.

**Archive tags — recover any dropped work** with `git checkout -b <name> <tag>`:
`archive/main-preconsolidate-2026-07-29` (8595cc2), and `archive/workflow/<lane>-2026-07-29` for all
twelve lanes (api-hunt, boss-clip, boss-fight, duel-hud, level-data, mission-cinematic,
mission-encounters, mission-flow, mission-presentation, mission-world, module-lesson, world-audit).

**Verification — measured this session from a worktree** (pnpm still hangs in the main checkout; gates
belong in a worktree). typecheck 16/16 · lint green · full suite **2869 tests, 0 failing** · static
gate GREEN (build, all `assets:verify:*`, lane-integrity, verify:content, verify:units) ·
**check-playthrough ALL PASS** (WORLD/ROUTE/YARD/REFUSAL/BEAT/DUEL — the duel renders a real world,
botSky 0.058, and grades on the real path; status UNGRADED locally with no TrueFoundry key). PvP left
in playtest position: `M1_PVP_CARD_ACCESS="PLAYTEST_ALL"` and `M1_PVP_TRIAL_ACCESS=true` byte-identical
to baseline; `poolHealth()` resolves (34 questions).

**Open after consolidation.**
- **M1 duel balance — owner's call.** `packages/duel` winnability marks two `todo` (non-failing, so
  the suite is green): a *correct* answer **lengthens** the fight (11.5 rounds vs 5.8 wrong) because
  `SYMMETRIC_COMPLEMENT` hands the boss mirror ammo so it camps in cover on the correct path, and the
  24-round anti-hang ceiling is reached on some seeds. A balance decision, not a bug to silently retune.
- **Remediation** (module Deliverable B) dropped, awaiting scope.
- Audit finding #3 above (uncommitted `infra` edit) is **resolved** — captured by `8a7e3bc`, the
  `mission-presentation` worktree is now clean. Finding #4's WIP-hang stands, but its WIP was not taken.

---

## Conservative prune (29 Jul) — on `workflow/m1-prune`, NOT yet merged

A small, fixed-scope removal of three genuinely dead things, each in its own commit so any one reverts
alone. Branched off `4c16caf`; **not merged** — the orchestrator merges it when the owner is not
mid-session. Gated from the worktree (measured, not relayed): full suite **2869 tests, 0 failing**
(unchanged from baseline), `typecheck` 16/16, `lint`, `build`, `verify:content`, `verify:units` and all
three `assets:verify:*` green. The only static-gate red is `check-lane-integrity`, flagging the prune
lane's own `apps/api` edits as cross-lane — an expected artifact of a one-off prune lane that is not in
the ownership map, not a correctness failure.

**Removed** (commit; the evidence that made each safe):
- `bbdfbdb` — `SubmissionRateLimiter` (`apps/api/src/assessment/requestPolicy.ts`, 26 LOC). Defined,
  never instantiated / imported / tested; only its definition and two docs referenced it. The file and
  its live sibling `validAssessmentMutationRequest` stay; a two-line note now points to `routes/duels.ts`,
  which already explains why a naive 429 limiter must not be added (a 4xx on the grading wire grants the
  full magazine).
- `499ca86` — `apps/api/src/routes/grading.ts` (258 LOC). Never mounted: `app.ts` registers progression,
  duels, encounters, pvp, reporting, localSession, devReset; grading is absent, and
  `registerGradingRoutes`/`routes/grading` appear only in this file and docs. Its unique value — the
  `RoundItemAuthority` anti-cheat — is already enforced on the LIVE duel path (`routes/duels.ts` computes
  `expectedItemId` and grades the server's item, never the client's claim). The sibling
  `apps/api/src/duels/grading.ts` is live and was untouched.
- `232d25c` — 11 `assets/pipeline/qa_*.mjs` scripts (qa_wave2_exchange, qa_slice, qa_m4, qa_m3,
  qa_m1_chase, qa_locomotion, qa_inspect_card, qa_fixwave2_feel, qa_design2_continuous,
  qa_density_traversal, qa_cognitive_learning). Each statically imports the deleted
  `packages/chapter-boston(-world)`, gone from disk, so it throws on load. None are in `package.json`, CI
  (`*.test.mjs` + `verify_m1_placements.mjs` only), or `run-tests.mjs` discovery — the suite never loaded
  them. Only doc mentions remain.

**Deliberately NOT removed — recorded so it is not rediscovered or re-litigated:**
- **`@pa/netcode` is PARKED by owner decision, not dead.** Zero importers (no file outside the package
  imports `@pa/netcode`; the few mentions are comments), ~4.3k lines of non-test source (measured 4,347)
  plus ~2.5k of tests, fully tested against a simulated link. Not part of the M1 demo — live PvP uses HTTP
  polling (`apps/web/src/pvp/arenaFeed.ts`) — and the owner chose to keep it against the named future seam
  (`docs/design/Unwired-Systems.md` §3.2). Do not "tidy it up".
- The **curriculum registry** (`packages/curriculum/src/{conceptRegistry,missions,missionIds,aliases}.ts`):
  its 14 mission rows and their `set` field feed the blocking `verify:units` gate, `validate.ts`, reporting
  and ~a dozen tests. Its stale `chapter-boston` path constants stay too.
- **Dead code inside protected directories**, by owner instruction: the orphaned `engine-world` modules
  (`traversalResolver.ts`, `noticeArbiter.ts`, `cameraOwnership.ts`, `QuestMarkerHud.tsx`),
  `moduleOrder.ts`'s `retryOrderedModule`, and `arenaPlacement()` in `mission-m1/src/runtime.ts`.
- **`MISSION_BINDINGS.strike.does` cannot be removed** — `TraversalBinding.does` is a required field, so
  removal is a compile error, not a prune.

---

**The standing loop**, every 15 minutes, in this order:
1. **Merge** every finished lane **whose work is M1** — see the freeze above; a future-scope lane
   stays on its branch. Verify `main` green; hunt for stranded or unmerged lane work.
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
stage sat a metre under the duel plane and catches landed on a heaped crown (`922f2e5`) ·
**"the running is like slow running" — CLOSED** (`cf262c9`, test `a109930`): `advanceFieldClock`
capped catch-up at `MAX_CATCHUP_STEPS = 5`, an 83 ms window sitting *below* the 0.25 s
frame-delta clamp, so every frame heavier than 83 ms had its excess fixed steps **discarded** —
sim time thrown away, which the sim advances through as slow motion. The cap is now derived
from the clamp, `floor(MAX_FRAME_DT_S / FIELD_DT)` = **15**, so no frame the clamp admits
discards a tick. Reproduced in real play both ways: **cap 5 dropped 87 ticks, cap 15 dropped 0**.
It was a frame-rate symptom all along, which is why two systematic passes looking for a
*locomotion* mechanism found nothing — the search was in the wrong subsystem, not incomplete ·
the chase and cinematic cameras now know about drawn-only occluders (`d457081`, was the
`camera-occluder` lane; that lane is finished and its grant is retired).

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
- **Two grading-integrity fixes are DONE ON `workflow/api-hunt` AND NOT ON `main`.** Both were
  handed to me as landed; they are not. Read from the branch, 29 Jul (`main` still has the old
  behaviour, so neither is in anything the owner plays):
  1. **An outage round no longer excuses the card half.** A `GRADING_TIMEOUT` round is granted
     the maximum by design — a student is not punished for infrastructure — but the evidence
     gate skipped card enforcement for that source, so an outage granted CORRECT with the wrong
     cards placed. The card half is deterministic and needs no model, so it is now enforced for
     *every* verdict source; the prose half is still granted, so right cards still pass.
  2. **The encounter `/v1/health` blind spot is closed.** `registerEncounterRoutes` built its
     own grading (its bank differs) and kept a private signal, so an encounter-grading outage
     read as healthy on the one endpoint meant to report it. It now shares `duelGrading.signal`.
  Merge `api-hunt` and this pair becomes real; until then, do not cite either as prevention.
- **The live classifier gate is now wired to run without anyone remembering — but
  unverified in a real runner.** `.github/workflows/grading-eval.yml` runs `pnpm
  grading:eval:gate` (`--repeats 3 --concurrency 3 --timeout 20000`) nightly (08:00 UTC) and
  on demand, against the **shared `TRUEFOUNDRY_API_KEY`** (owner's decision: one key, not the
  dedicated `TRUEFOUNDRY_GRADING_API_KEY` originally introduced — the job runs at 03:00 local,
  off the owner's play window, so contention essentially closes; if it ever does contend the
  90% classification floor fails the run loudly rather than lying). The ~20 s timeout is a
  *measurement* cap, not the 1.5 s *play* cap; low concurrency stays off the rate limit;
  repeats=3 keeps a temperature-zero flip from deciding the gate; the harness's coverage gate
  turns a degraded gateway into a loud fail, not a false pass. **It fails loudly when the
  secret is absent** (a red run naming what to add), never a silent skip — the failure mode
  being removed. Failure signals, ranked by surviving nobody watching: a **committed dated
  report** under `docs/process/grading-eval/` (a gap in the dates is itself the alarm), a
  GitHub **issue** labelled `grading-eval`, and a red run + artifact. The offline structural
  `eval.test.ts` still runs per-PR. **Honest limits:** (1) the secret does not exist yet — the
  owner must add `TRUEFOUNDRY_API_KEY`, and until then every run fails at the credential
  preflight; (2) nothing here can confirm the workflow runs in a real GitHub Actions runner
  (`gh` unauthenticated locally, no run observed), the same unverified basis the `playthrough`
  gate already blocks on. Wired and merged is not "works": the first real run, or the first
  missing date, settles it. Reasoning and the one-key trade-off in `CI-AND-BROWSER-CHECKS.md` §1a.
- **One TrueFoundry key now works everywhere the owner touches — the last two-key requirement
  is a `NODE_ENV` branch in `packages/grading`, and it must be routed to `boss-fight`.**
  `TRUEFOUNDRY_API_KEY` is canonical: local dev, the nightly eval and the asset pipeline
  already ran on it, and `infra/` now injects the single `project-archive/grading-credential`
  value under **both** `TRUEFOUNDRY_API_KEY` and the legacy `TRUEFOUNDRY_GRADING_API_KEY`, so
  the deployed task grades on one key with no second secret. Docs, `.env.example`, `README.md`
  and `infra/README.md` now say to set only `TRUEFOUNDRY_API_KEY`.
  **What is NOT done, and where it lives:** `credential()` in
  `packages/grading/src/provider.ts` still accepts `TRUEFOUNDRY_API_KEY` only when `NODE_ENV
  !== "production"`, so the library alone would refuse the canonical key in a deployed task.
  That file is `boss-fight`'s and was not touched. The fix is to read
  `TRUEFOUNDRY_GRADING_API_KEY ?? TRUEFOUNDRY_API_KEY` unconditionally and re-word the
  `NO_CREDENTIAL` advice in `src/verdict.ts`, the message in `src/eval/cli.ts` and the table in
  `README.md`. **Keep the string `TRUEFOUNDRY_GRADING_API_KEY` somewhere in that advice** —
  `apps/api/test/grading-signal.test.ts:193` (api-hunt, unmerged work in flight) asserts on it,
  and naming both keys keeps that test passing without a cross-lane edit. There is no test for
  `credential()` today; add one. Until it lands the double injection in `infra/` is load-bearing
  — do not delete it as redundant.
  The dedicated-key rationale is **accepted-and-overruled, not disproven**: the gateway
  serialises (1516 ms at concurrency 3 against a 1.5 s cap), so a lesson run during an asset
  render still raises fallbacks. `GradingFallbackRateHigh` at 25% is what makes that loud.
- **The merge gate exists (`scripts/merge-gate.mjs`, `pnpm gate`) — the last regression
  condition, partly.** One loud command runs every blocking gate and refuses (exit non-zero)
  on any failure; the playthrough is provisioned on a throwaway stack and skipped only when the
  change is play-irrelevant (docs/CI/scripts/pipeline/published-assets/tests). Validated end to
  end (static ~200 s parallel; playthrough ~118 s; ALL PASS). It cannot be *forced* locally — a
  git hook can't gate a fast-forward merge — so this removes discretion only as a convention +
  loud tool until CI required checks are on (main unpushed). `M1-DONE.md` §8, `CI-AND-BROWSER-CHECKS.md` §1b.
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
- **pnpm's lockfile is in sync — the "pnpm refuses to run scripts" state is stale.**
  `pnpm install --frozen-lockfile` succeeds (30221f7 regenerated it when
  `@react-three/rapier` was dropped), so `pnpm lint/test/typecheck/build` all run
  directly. Caveat that survives: `verify-deps-before-run=false` in `.npmrc` is inert
  on pnpm 11 (it reads `verifyDepsBeforeRun` from `pnpm-workspace.yaml`, unset), so
  the *next* dependency move that drifts the lockfile will make `pnpm -r` try to repair
  node_modules mid-run. `merge-gate.mjs`'s frozen-install preflight catches that state
  and refuses rather than purging. The CI `lockfile`/`api-image` advisory jobs should
  now pass; flip the main installs to `--frozen-lockfile` after the first real run.
  - **Observed, not diagnosed (29 Jul): `pnpm <script>` HANGS in the MAIN checkout.**
    `pnpm verify:units` there produced no output in ~235 s and was killed; the same script
    run directly (`node --import tsx scripts/check-unit-coverage.mjs`) finished in seconds
    in that same checkout, and `pnpm verify:units` finished in **1 s** in a worktree. So the
    stall is pnpm, it is specific to `/Users/ramsarma/Projects/project-archive`, and it is
    not the script. It is the shape the caveat above predicts — a drifted tree making pnpm
    try to repair `node_modules` mid-run — but that was NOT confirmed, because confirming it
    means letting pnpm act on the owner's checkout, which can purge. **Do not run `pnpm` in
    the main checkout to investigate.** Reconcile deliberately (`CI=true pnpm install`) when
    the owner is not playing, or run gates from a worktree, which is where they belong anyway.
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
- **A latent trap in `apps/api`**, found while hunting, not fixed: `matchesById`/`passes` in the pvp
  route are module-global, so live matches leak across tests in that file. (Its former neighbour
  `SubmissionRateLimiter` — dead code that read as a live protection — was removed on
  `workflow/m1-prune`; see "Conservative prune".)

---

## Regressions, and what now prevents them

All three of 28 Jul's regressions were introduced by the previous night's fixes.

| Regression | Introduced by | Now prevented by |
|---|---|---|
| Duel harness rendered a void | the graded-attempt rewrite | `check-playthrough` duel-void census |
| Encounter soft-lock from a roof | relocating the beat to a roof | same-surface arming + 16 s abort |
| Boss ignored all cover | arena swap exposing a missing opt-in | parity assertions in `missionDuel.test.ts` |
| Ladders drawn floating, upright, ghosted | the ladder placement itself | *nothing yet — see Open* |
| An ungraded round shown as "Correct" (the owner's headline complaint: told he was right when he was wrong) | a timeout/no-credential round is granted the max (`kind: CORRECT`) by design, and the HUD hardcoded the label off `kind` | landed on `main` from `boss-fight` (`76a6153`). `apps/web/src/duel/verdictLabel.ts` sources the label off `verdict.source`: `GRADING_TIMEOUT` → **"Not graded"**, only `source: CLASSIFIER` may read "Correct"/"Wrong". Pinned by `apps/web/test/duelVerdictLabel.test.ts`. **INVARIANT for the next agent: the ungraded-round label MUST read "Not graded". Any later duel-HUD rework of `DuelOverlay.tsx` has to keep rendering `verdictBeatTone(verdict).label` — do NOT reintroduce a hardcoded "Correct"/"Wrong" in `VerdictBeat`, or this regresses silently.** |

### Process errors, and the change that prevents each

Kept because catching an error is worth less than removing its source. Each row is a mistake
the orchestrator actually made, and the specific change made in response.

| Error | Change made |
|---|---|
| Merged the ladder facade on captures the worker itself called too dark to read | Open the artifact, never the caption. An illegible frame is a failed check. |
| Two workers in one worktree; an interrupt swept a sibling's files into a stray commit | `subagentStart` lock: one worker per worktree, `--status` makes activity visible |
| Cross-lane writes prevented only by prose in briefs, which drifted every time | `preToolUse` lane guard reads one enforced map; ownership stopped being retyped. **Correction (29 Jul): the guard does not fire for background-subagent tool calls, so prevention alone was never sufficient** — `scripts/check-lane-integrity.mjs` now detects crossed lanes post-hoc from git state, and `grants` gives contested files a legal temporary owner. |
| Asserted a mechanism from adjacent code three times; twice wrong, one proposed fix would have worsened the defect | Briefs give **candidates to distinguish**, never conclusions, and say when untraced |
| Ten of fifteen open conditions serialised behind one lane's files | Split `mission-world`; ownership now sized to the work, not to a theme |
| Granted a worker a path the enforced map assigned elsewhere, blocking it | Update the map *before* writing the brief that depends on it |
| Loop reported instead of acting; work queued waiting to be asked | Loop launches on every tick; a tick producing only process is a failed tick |
| Told a hunt not to spend long on two items — suppression in miniature | Hunts report everything and rank afterwards; filtering is a separate pass |
| Inherited "three clips are unbaked" from an earlier worker's report and asserted it as fact; the rig had all three | A claim relayed from another worker is **untraced** until measured. Cite the measurement, not the report. |
| Called two gates "blocking" for hours when CI had never run once — `main` was 204 commits unpushed | A gate is unverified until a real run is observed. Say "unverified" until then, and push early enough to find out. |
| Accepted a local green as evidence for a cross-platform property; the first Linux run failed on a baked-constant guard comparing against the host's own `Math.sin` | A determinism claim cannot be verified on one platform. Reason about the runner, not the laptop. |
| Quoted the affordance debt count as a fixed number to a lane whose branch predated three retirements | A moving count needs its baseline named. Say "22 on `main` as of X", not "22". |
| Told a lane the elm climb **anchors** ran through the trunk; standing at every anchor was clean and it was the **swept paths** threading the canopy | Name the measured thing, not the inferred cause. The instrument reported per-transition depth, not per-anchor. |
| Derived a speed from two frames of a variable-frame-rate screen capture and used it to contradict the owner's direct report | **Trust his report first**; use the video to locate what he is pointing at, not to re-measure it. A capture made during a performance problem cannot time that problem. |
| Built a pacing case on the 24-round duel ceiling; it is an anti-hang backstop that never fires, and duels end on health at 4–7 rounds | Check whether a limit is *reached* before treating it as the cost. A ceiling is not a duration. |
| Told the owner M1 owns "~23 concepts" and built a broken-ratio argument on it — the number was a grep of lines containing "M1". M1 owns **2–3**; the 46 belong to 14 modules | Never quote a count from a text search. Call the function that computes it. |
| Asserted twice, from the hooks log, that the lane guard "never returns a verdict" — then, corrected, guessed that its 148 zero-millisecond aborts were harmless teardown after a success. Both wrong. The guard completes 89 runs and denies correctly; the aborts share **zero** `tool_use_id`s with those and split **by session**, so the truth is worse than either guess: background-subagent writes — most lane work — are entirely unguarded, and `Shell`-mediated edits fire no hook at all and never even reach the log. Nothing was lost only because the contested writes happened to be benign. | Read the instrument's own output properly before theorising about it; both wrong answers came from counting one line pattern instead of joining the log by id and session. And the general form: **a mechanism's own selftest cannot tell you whether it runs in production.** `lane-guard.sh --selftest` was green throughout — it tests the decision, and the decision was never reached. So the selftest now says so in its header, and the coverage question is answered by a post-hoc detector wired into `pnpm gate`, not by the guard's own report on itself. |
| Dispatched four workers into `apps/web/src/mission/**` — paths the enforced map assigns to other lanes or marks **contested** — without reading `lane-ownership.json` first. The writes landed; nothing was destroyed only because the guard never ran for those background subagents, so a stale-brief error and an unenforced guard cancelled out. That is luck, not safety. | Read `lane-ownership.json` **before** writing a brief, and name the lane in the brief. `grants` gives a contested file a legal, recorded, temporary owner, so "it had to change" stops meaning "change it off the books" — and a grant is retired the day its work merges, together with the selftest case pinning it. |

**Guard coverage, measured from the hooks log (29 Jul), and what was done about it.**
Of ~237 logged `Write`/`Delete` calls, **89 completed and returned a verdict (87 allow, 2 correct
deny)** — the guard's logic works. The other **148 were cancelled at 0 ms with no verdict → a
fail-open allow.** They are not teardown after success: they share zero `tool_use_id`s with the
completed runs and split cleanly **by session** — foreground calls complete, whole
background-subagent conversations abort. Two holes, neither fixable in the guard:
1. **Subagent fail-open**, which is how the contested mission/duel writes landed: every one came
   through `Write` with an absolute path the guard parses fine; the hook never ran. (The same
   `duel.css` was correctly denied once from a foreground call and silently allowed twice from
   aborted subagent calls — the whole mechanism visible in one file.)
2. **`Shell` is not in the matcher** (`Write|StrReplace|Delete|EditNotebook`), so an edit made
   with python, sed, a heredoc, `cp` or `>` fires no hook at all and is invisible even to that
   log. A shell command carries no file path to inspect, so this is structural, not a bug. Adding
   `Shell` to the matcher would produce a guard that *looks* stronger and is not.

**So prevention is unavailable and detection is the enforcement point** —
`scripts/check-lane-integrity.mjs`, which reads the same map out of git state after the fact and
catches both holes. It now **runs inside `pnpm gate`** (`--lane auto`: prints every finding, fails
only on ones involving the lane being gated, so an unfixable red from a sibling cannot mute it)
and self-tests before it measures. It is deliberately **not** a CI job: it reads local sibling
worktrees, which do not exist on a runner, so a CI job would be a green light that can see
nothing. `failClosed` was not set and the guard was not otherwise touched — it is free, and it
works for foreground writes.

**A second, quieter reason the guard was not enforcing what the map said.** `.cursor/hooks.json`
registers it as the *relative* path `.cursor/hooks/lane-guard.sh`, so an agent in a worktree runs
**that worktree's copy against that worktree's map**, while the detector reads the hub's. A map
edit therefore changes nothing until it both merges to `main` and is copied into each worktree.
Both were done on 29 Jul and verified live from the worktrees (`module-lesson` now allows its own
tree and its granted `content/m1/module.json`, and denies `engine-world` and contested `duel.css`;
`boss-fight` is now correctly denied the file granted away). Copy only into worktrees whose copy
still matches the previous `main` blob — a differing copy is somebody's edit.

**That twelve-copy requirement is now DETECTED rather than remembered** (29 Jul). Keeping twelve hand-
copied maps in step is itself the drift class the map exists to catch, and it had the worst possible
shape: a worktree sitting *clean* on a stale copy never appears in any changed-file set, so nothing
could see it while its guard enforced a policy `main` had retired. `check-lane-integrity.mjs` now
hashes each worktree's `.cursor/{lane-ownership.json,hooks.json,hooks/lane-guard.sh}` against `main`'s
blob and reports **GUARD DRIFT**, separating a lane's own edit from a STALE copy and printing the `cp`
for each stale lane. Observed firing on exactly the condition it is for: after the `duel-hud` grant
merged, all eleven sibling worktrees reported STALE, and all reported in-step after the copy.
**Its first implementation was wrong in the dangerous direction, and only running it against the real
worktrees caught it.** It asked git whether the lane had *touched* the path and called that a lane
edit — but the previous propagation round was **committed** on every lane branch, so ten of eleven
stale copies were labelled "lane-edit", i.e. "leave it alone", and their `cp` was suppressed. The
discriminator is now **content**: a copy whose blob appears anywhere in `main`'s history for that path
was propagated or inherited, whatever the lane's history claims. Pinned by a selftest case naming the
regression. It **does not fail** —
a lane cannot propagate `main`'s `.cursor/` into itself, so failing its gate would be the unfixable
red that mutes a gate. **Still open, and deliberately not built:** the structural fix is an absolute
hook registration or a symlink so one copy serves every worktree. Detection is not that.

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
| `verify:units` (`check-unit-coverage`) | every concept a unit's lesson teaches has ≥1 encounter or duel item **in that unit** — the gap that would sit in the reteach set forever | whether the item is any *good*, whether the student can reach it, and any unit whose lesson deck is not authored yet (it requires nothing, correctly) |
| `verify:lanes` (`check-lane-integrity`) | a crossed lane, a same-file-two-lanes clobber, and a worktree whose guard copy has drifted from `main`'s, from git state, *after* the fact | anything on a machine with no sibling worktrees; and it is post-hoc by construction — it reports the crossing, it cannot stop it. GUARD DRIFT reports but never fails, so a stale worktree does not redden any gate |
| `assets:verify:collision` | a collision solid that isn't drawn (invisible walls) | whether a surface exists at an authored height |
| `assets:verify:placement` | route surfaces having their asset's shape | non-route geometry |
| `assets:verify:affordances` | real mesh geometry at each authored affordance | whether a human could make the move |
| `check-playthrough` — **blocking in CI** (`8eb2393`) | world renders, route advances, stops resolve, no hang, no hull penetration | climbing through *drawn* geometry, animation fidelity, the terminal elm beat (deliberately unplayed — a bot that could reliably hit it would itself be flaky). **And it cannot tell a broken route from a contended machine**: ROUTE's tick budget is machine-independent but the bot is steered from Node, so heavy load coarsens control and inflates the ticks the drive needs. It now reports control resolution, an exit reason and a headroom note instead of failing silently at random — see the ROUTE entry above |
| `check-clip-fidelity` | hands/feet vs surfaces, plant slide, clip timing | not yet a gate — red by construction |

**Disproven, do not re-derive:** the elm is *not* drawn four times — trunk and all three
bough decks already cluster into one draw at the declared size, and nulling the boughs' asset
would collapse it to a 1.8 m pole (`7353b82`, guarded).

**Four authoring rules no gate states, and a ledge/deck author must satisfy all of them.** Each is
a way the mover refuses a move that every static gate passes, so an asset can be box-accurate,
weld-clean and drawn==collision and still not carry the route:
1. **The overhead skip.** A mantle is refused when the target surface is overhead, and that test
   reads authored deck rects — so a legal-height intermediate ledge tucked *under* the ledge above
   it is refused no matter its height. Stagger onto its own footprint (the steeple belfry chain and
   the ridge monitor both spiral for this reason).
2. **The verb-ranking gap.** The verb comes from the obstacle, not the endpoint height difference;
   a top too narrow to stand on reads CLIMB_OVER, and a rise into the 1.9–3.1 m dead-zone band reads
   BLOCKED. A height that looks legal can resolve to the wrong verb or none.
3. **`authoredTrajectoryClear` refuses on the rising ARC, not standing headroom** (steeple belfry,
   31 Jul). A CLIMB flies a **2-anchor eased-linear diagonal** from take-off to stance
   (`traversal.ts` pushes `[from, to]`); `authoredTrajectoryClear` samples it and refuses if
   `headClearance < STAND_HEIGHT − 0.05` (1.55 − 0.05 = **1.50 m**) at any sample. So a ledge under
   an oversail must be designed against the **arc**, not the stance: the rising body drags its west
   shoulder (centre − CAPSULE_RADIUS 0.35) under the soffit through the whole high-feet part of the
   climb even when it *stands* clear. On the steeple this measured 0.44–0.65 m of head into the drawn
   gallery underside at every node placement, and moving the stance east to clear it stranded it from
   the next node — the fix had to delete the oversail *and* move the take-off. No gate sees this;
   only sweeping the real 2-anchor arc against the drawn soffit does.
4. **Drawn-but-non-colliding decoration overhangs a ledge, and only the mesh pass sees it**
   (steeple belfry, 1 Aug). The 13.0 ledge's east extension (FIX 2, worldX 84.0) rose straight
   under the belfry base cornice's **east wing** — a sloped decorative skirt that is drawn and
   carries no collision, so `routeAscent` and every authored-hull gate drove the four-hold chain
   green; only `verify_m1_steeple`'s **mesh** pass refused. Clearance above the 13.0 top fell from
   open sky to 1.00 m and down to 0.45 m at 84.0. The blocker was **not** the corner urn the first
   diagnosis named (the urn base is worldX 84.14+, east of the 84.0 ledge end and outside the
   column); it was the cornice, found only by re-probing. **Reflexive rule: after changing a
   ledge's extent, raycast the clearance column over its WHOLE new extent — the blocker is
   whatever the stance/arc passes under, which need not be the feature you were reasoning about,
   and a drawn non-colliding cornice is invisible to every gate but the mesh pass.** Fix: trim the
   cornice wing back to the shaft depth (one quad); the urn did not need moving (capsule sweep
   confirmed >= 1.90 m at the tightest corner).
5. **A generated canopy keep-out must be RNG-neutral, or it silently moves everything downstream**
   (elm belfry, 1 Aug). `E_LEDGE_N->E_GALLERY` (the last `STEEPLE_DEADZONE_CLIMBS` entry) drove the
   head **0.244 m** into the elm's north-rim leaf cards — measured by `check-drawn-penetration`'s
   real-mover sweep, invisible to a vertical column probe because leaf cards are near-vertical. Fix:
   extend `build_liberty_elm_v2.py`'s canopy keep-out (`over_belfry`, elm-local x −1.7..0.7 /
   z +6.4..8.1 / h 12.6..16.2) to drop clusters in that corridor. **The trap:** an early `return` in
   `add_leaf_cluster` skipped the cluster's per-quad `RNG_PY` draws, re-rolling the *entire* downstream
   canopy — which moved the crown and deepened the (ignored) `F_LOW->F_CROWN` haul 0.775 → 0.996 m,
   visible only by diffing the full penetration report. The keep-out consumes the same draws and emits
   no faces instead. Verified: of 46 authored transitions **only the belfry changed** and the climax
   mantle is byte-identical. The belfry dead-zone can drop its last entry once the level lane wires it.
   (The elm bakes its own 1024 bark normal and never runs through `fix_glb_normals`, so the
   `normalMax` stamp is inert here — no stamp added.)
6. **On a shed whose roof-walk IS the box cap, roof "clutter" can only be material, not
   geometry** (wharf roofs, 1 Aug). The owner's "Minecraft roofs" read is the flat uniform
   repeating slate tile on the walkable decks. On the wharf warehouses the walk sits at `z=H ==
   roofY == the placement box cap` (contain-fit 1.0 pins natural bbox == declared box; the
   generator's own guard `SystemExit`s on >0.02 height drift). So a chimney/ridge/parapet/dormer
   *above* the walk grows the bbox, fails the guard, and — worse — rescales the whole mesh so the
   walk drops off `roofY`, re-opening the invisible-floor lie. **Above-walk built detail is
   therefore impossible on these sheds without either lowering the walk (barred: moves a gated
   deck) or making the roof genuinely pitched (the owner's reserved decision).** The in-scope fix
   is material: `build_wharf_warehouse.py` now draws the walk as a period LEADED ROOF-WALK
   (standing-seam rolls at true ~0.72 m spacing, cross welts, per-bay weathering, patina, water
   streak, perimeter flashing, mapped 0..1 so it does not tile) instead of a tiled slate atlas.
   Geometry byte-identical to shipped: bbox / tris (612, 430) / weldPairs (9, 4) / zeroUv 0 all
   unchanged; only the top quad's material+UV changed. Chimneys/dormers belong on the TALLER
   buildings (townhouse `C_LEADS`, the brick/clapboard rows `D_ROOFLINE`, printshop) whose roof
   sits below their box cap — and those GLBs are `m1-evasion-loop`'s (globs `*brick* *facade*
   *townhouse* *printshop*` + the named row GLBs), not this lane's. Roof-albedo path bakes no
   normal (nrm() is disabled under PHOTOREAL), so no `normalMax` stamp applies.
   **Extended 1 Aug to five roofs, varied BY BUILDING** (the owner's word was "flat and *uniform*", so five
   identical lead walks would just swap one uniformity for another): `bldg-merchant` → blue-grey SLATE field
   with a central lead ROOF-WALK strip + flashing; `bldg-row-shop` → weathered WOOD SHINGLE (warm, mossy);
   the wharf pair stay working-wharf LEAD. All material+UV only on the existing top quad, geometry
   byte-identical (merchant tris 1368 / weld 19, row-shop 624 / 12, both unchanged). Merchant and row-shop
   DO run through `fix_glb_normals` (default 512 cap), so the roof gets a derived normal from the new albedo;
   no generator normal, no `normalMax` stamp. **`bldg-warehouse-street` deliberately NOT touched:** it is a
   23k-tri single-atlas Meshy import (weld 2223, built by `build_m1_flat_decks.sh` decimation, source
   `bldg-row-brick-b.glb`) — no parametric roof face, no clean material+UV path; its roof is non-route-bearing
   and already reads as a built seamed metal roof with a cornice (rendered 1 Aug), so it adds distinctness for
   free. Retinting it is GLB atlas surgery on a blob — flagged for a later pass if wanted, not forced here.

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

**The dev-reset did not give a fresh duel** (fixed, `api-hunt`). A duel's verdict key is
`<levelId>#duel@<ordinal>` — no attempt id — so after a reset re-opened attempt 1, the old
`duel_verdicts` rows were still returned with `firstMinted=false` and the "fresh" replay silently
re-served the prior run's verdicts **without re-grading**. Every mission reset and replay before
this was replaying old grading. Found while building the retrieval ledger, because clearing run
history forced the question of what else survives a reset.

**House pattern for a baked constant.** Two guards asserted a baked literal equalled the host's
own `Math.*` bit-for-bit — the exact functions whose cross-platform variance motivated baking —
and the first Linux run failed one while the constants were correct. Both are fixed the same way,
and this is now the pattern:

- an **ulp tolerance sized from measurement**: the observed platform gap, versus the cheapest
  genuine typo. For the cover ring those were 1 and 62 ulps, so 16 sits in an empty band.
- **expressed where the error lives.** `1 − exp(x)` lands in a smaller binade than `exp(x)`, so the
  subtraction *amplifies* — one `exp`-ulp is eight blend-ulps. Budget the transcendental, then
  convert through the measured amplification.
- a **permanent perturbation self-test** that nudges the libm worse than any real platform gap and
  requires the literals to still pass. This is what lets a local green license a cross-platform
  claim, which nothing in this repo could do before.

**A repo-wide static check was considered and rejected**, with a scan: only two instances ever
existed. A rule keying on equality near an unpinned `Math.*` would fire on threshold comparisons,
already-toleranced checks and legitimate same-platform assertions — noise guarding correct files
against something CI now catches empirically for free.

**The tear signature is now gated and everything is measured** (`5bd6835`). Near-coincident
same-facing face pairs: authored facades **0**, generator buildings **855–6721**. Ranked, unfixed,
awaiting sequencing:

| building | pairs | |
|---|---|---|
| `bldg-townhouse-1713` | 6721 | civic centrepiece, on the climb route |
| `bldg-row-brick-a` | 5457 | *was* my clean counter-example on sliver % — it is not |
| `bldg-row-shop` | 2530 | the shambles |
| `bldg-warehouse-street` | 2223 | the sugar house |
| `bldg-meeting-hollis` | 1922 | Old Brick + Hollis meeting |
| `bldg-printshop` | 1189 | the printshop, where the run opens |
| `bldg-scaffold-run` | 855 | scaffolding lattice |

**Why the gate is scoped to facades:** measured world-wide the signal is confounded — the
hand-authored, accepted Liberty Elm scores **16040**, because a canopy of overlapping leaf cards is
near-coincident by design. A whole-world gate would false-fail the elm.

**The played-mission gate's wall-clock sensitivity — FIXED** (mission-presentation lane). CI's
only failing job was the played-mission gate: 8 progress-and-time checks over ~12 min on a GPU-less
runner. **Traced** (not inferred): the sim runs at a fixed 60 Hz and the body's motion is a pure
function of the STEPS that executed, but `advanceFieldClock` ran at most `MAX_CATCHUP_STEPS` —
**5 at the time; now 15**, derived from the frame clamp (`cf262c9`, the slow-running fix) — per
render frame and DISCARDS the rest (`diag.ts`: dropped sim time, not banked). On a software
rasteriser the render loop is slow, so the sim runs in heavy slow-motion — measured ~1.5 sim-ticks
/wall-second with scenery, ~24 bare — and a wall-clock budget ("reach x=60 in 95 s") measures the
renderer, not the mission. The fix, entirely in `scripts/check-playthrough.mjs`: **budget every
driven stage in SIM TICKS** (`window.__floor.ticks`, duel `clock.tick`), wall-clock surviving only
as a 45 s liveness watchdog for a hung page; **drive the driven stages in bare mode** (`?bare=1` —
authored verdicts unchanged, ~16× faster, WORLD keeps scenery and waits for texture load to
stabilise); and a **bounded un-stick** (rotate aim + jump when the bot wedges at a parkour beat) so
the transient the audit saw ("stalled at x≈29, cleared on re-run") recovers deterministically.
Proven both ways: **ALL PASS under forced software WebGL** where the wall-clock gate failed 8
checks; still **FAILS** on a genuine stall — an unanswered encounter at 1801 armed-but-unresolved
ticks, and a pinned body at 1505 stall-ticks *despite 16 un-stick nudges* (a wedge cannot be nudged
free; a transient clears in 2). A slow runner passes because it advances per tick; a stuck body
fails because it does not.
- **The grader-on-real-path failure was NOT collateral from the route** (the brief's supposition):
  the DUEL stage is an independent page. It is the SAME wall-clock class — the duel's FACE_OFF
  intro counts down 600 ticks on the field clock (`combat.tick` stays 0), so a slow renderer
  reached the question past the harness's fixed 36 s wait (measured ~48 s under throttle). Now
  budgeted on `clock.tick` too. Confirmed by reproduction, not assumed.
- **Also fixed the cause of "no run ever completed":** CI `concurrency` cancelled in-flight `main`
  runs on every push. Now `cancel-in-progress` is true only for pull requests; `main` pushes queue
  and each finishes. Noted in `CI-AND-BROWSER-CHECKS.md` §1 and the workflow.
- **Confirmed on a real CI runner** (first cross-platform verification): 4/5 jobs green incl.
  `verify`, and **no progress check failed** — the tick-relative measure holds on a GPU-less runner.
  The playthrough job then **hit its 20 m `timeout-minutes` cap mid-gate** (provisioning clean, it
  just did not finish). Cap raised to **50 m** to learn the true figure from one completed run;
  per-stage wall-clock is now logged (`stage wall-clock: …`). Local software-WebGL breakdown: ROUTE
  135 s + DUEL 141 s dominate (≈75%), WORLD 57 s (scene *load*, not "fast" on CI), rest trivial.
  Recommendation: **keep it per-push and blocking** — one dev, no queue, so a 20–30 m gate blocks
  nobody, and ROUTE/DUEL are the stages that catch the soft-lock/void/grader class; do not defer
  them to nightly, and do not shrink tick budgets to fit a cap. Reasoning in `CI-AND-BROWSER-CHECKS.md`.
  Still pending: the actual completed-run number (`gh` unauthenticated here).

**`check-playthrough`'s intermittent ROUTE failure — MECHANISM FOUND AND MEASURED, not widened**
(29 Jul, mission-presentation lane). The symptom was three `ROPEWALK_STOP` / route failures on a red
run whose ROUTE stage took **206 s against 42 s on both green runs**. A prior agent had already
disproven "regression" by stashing its diff and re-running on clean `main`.

**The 5x duration is not a slowdown — it is the tick cap being reached.** Green runs consume ~2,360–2,460
sim ticks in ~42 s, i.e. **60.0 sim-ticks per wall-second**, exactly real time; `ROUTE.capTicks` is
12,000, which at that rate is ~206 s. So the red run burned its whole budget. The sim never slowed:
since `MAX_CATCHUP_STEPS` was raised to cover the frame clamp (`cf262c9`), a slow frame runs every tick
it is *owed* instead of discarding the excess, so the sim holds real time under load. That is the
opposite of the load-dependent slow-motion the brief expected, and it matters: the slow-running fix
**removed the coupling that used to keep the harness's controller and the sim degrading together.**

**The mechanism is the one wall-clock coupling the tick-budget rewrite left behind.** Budgets are in
sim ticks, but the bot is driven from Node — each poll reads state over CDP, aims, maybe presses a key —
so *steering* advances once per poll while the sim advances on wall time. Measured on one machine, one
day, varying only the control cadence (`PLAYTHROUGH_POLL_MS`, a new repro knob) with the sim at full
speed throughout:

| control resolution | sim ticks needed | ROUTE wall-clock | verdict |
|---|---|---|---|
| 5 t/update (healthy) | 2,460 | 41 s | PASS |
| 24 t/update | 2,360 | 39 s | PASS |
| 91 t/update | 4,342 | 72 s | PASS (1 un-stick burst) |
| 192 t/update | **11,558** | **202 s** | PASS — at **96% of the 12,000 cap** |
| 151 t/update | **12,003** | **209 s** | **FAIL — the red run reproduced** |

Sharply non-linear, and the cap is only ~5x the healthy figure. The last row **is** the reported red:
cap exhausted, `ROPEWALK_STOP` never armed, 209 s against the report's 206 s. **So it is load
contention** — but with a real defect underneath: the gate had no way to say so, and a near-miss was
indistinguishable from a healthy green. (Ordering above is by cadence, not by run; 151 t failing while
192 t passed is the run-to-run variance you would expect this close to the cap.)

Fixed, all in `scripts/check-playthrough.mjs`:
- **It diagnoses itself.** ROUTE now records and prints its wall-clock, sim-ticks-per-wall-second,
  **control resolution** (median/p95/worst ticks per control update), an **exit reason** (previously
  absent — a red could not distinguish a wedge from a wander from a budget simply running out), what
  was still unresolved or never armed, and a sampled position trace. Every route failure detail carries
  that line verbatim. **Verified on the reproduced red**, which now reports: `exit=capTicks exhausted`,
  `sim=12003 ticks (57.4 ticks/wall-s)`, `control resolution=151 ticks/update median (healthy ~6)`,
  `neverArmed=[ROPEWALK_STOP]`, `lastSeen=tick 12088 at x=61,z=-6.8 heading for x=51 preview=BLOCKED`.
  That last field is a finding in itself: the bot was being aimed **west** (waypoint x=51) from x=61
  with `preview=BLOCKED`, so the waypoint had flipped behind it. Worth a look by whoever owns the route
  guidance; not chased here.
- **A HEADROOM note above 70% of the cap.** The 192 t run above *passed* at 96% — the flake's precursor,
  previously invisible because a green is a green. This is why the cap was **not** widened: widening
  hides the precursor and slows every genuine soft-lock at the same time.
- **The un-stick's claimed bound did not exist, and now does.** Its comment said it was bounded by the
  stall ceiling (`stallTicks`, 1500) — but the stall anchor resets whenever the body moves 0.5 m, and a
  forced jump moves it much further, so every burst reset the anchor. `worstStall` peaked at 599 even in
  the 202 s run, so 1500 was never approachable. A recoverable-but-not-progressing body could therefore
  loop to the cap untouched. It is now bounded by bursts since the body last gained ground on its
  **eastward high-water mark**, which a nudge cannot fake, and fails by name. Latent, not the flake's
  cause (only 3 bursts fired at 192 t) — but it was the assertion supposedly covering this class.
  **Mutation-tested**, because a guard that never fires is not evidence: with the budget forced to 0 it
  fails by name and exits at 2,698 ticks / 48 s instead of grinding to the cap, and `worstStall` was
  nowhere near 1500 at the time — the ceiling could not have caught it.

**Not done, and this is the honest remaining gap.** The fix that would make ROUTE genuinely
load-independent is to stop driving it from Node: either an in-page per-tick driver (a rAF loop reading
`window.__floor` and dispatching synthetic key events — possible entirely within `scripts/`, but a large
change to a *blocking* gate that would need every tick budget recalibrated) or a sim-pause handle so the
harness can step the sim explicitly, which needs a handle in contested `MissionRun.tsx`/`devEntry.tsx`.
Until one of those, ROUTE's verdict remains sensitive to machine load — it now says so loudly instead
of failing at random. Running six or seven agents plus the owner's dev servers is enough to reach the
degraded regime; the two default-poll runs measured for this entry took 41 s and 64 s on the same
machine minutes apart.

**A pipeline finding, from three independent repairs today.** Every one traced to the generator's
own output, not to the processing:
- the elm's canopy *was* Meshy foliage — a handful of intersecting alpha cards;
- the Town House's cupola was drawn on a thin neck over a 1.4 m void, which the build's height
  warp stretched rather than filled;
- `bldg-brick`'s raw generation is **32% needle slivers** on a half-resolution atlas, and no
  weld, de-spike or decimate reaches it.

Two were fixed by procedural authoring; the third is being. **Treat "regenerate it" as the option
to justify, not the default** — asking the same generator for a better retry has failed three
times, and the pipeline's contain-fit stage cannot repair a jagged surface.

**`build_steeple_clean.py` needs `PHOTOREAL=1` or it silently ships a degraded landmark** (31 Jul).
The env-less build emits a **302-tri base form**; the shipped, deck-gated mesh is the **454-tri**
`PHOTOREAL=1` build (corner urn pinnacles at ±3.4, tower clock, belfry keystones) then
`fix_glb_normals`. Anyone regenerating without the env var downgrades the steeple and nothing catches
it — the same failure shape as the scaffold generator that would have rebuilt an unclimbable ascent
from a stale copy. Verified: pristine env-less = 302 tris / 89 KB, `PHOTOREAL=1` = 454 tris / 6 meshes
matching the shipped geometry, + normals = 2.3 MB. Recorded so it is not silently under-built. (The
±3.4 pinnacles are also load-bearing on traversal: they block extending the belfry's north ledge far
east, which is why the soffit fix trimmed the gallery instead — see the three authoring rules above.)

**`fix_glb_normals` writes the normal at the ALBEDO's resolution, and a PNG cannot compress a
normal — so every base-color-only bake ships a normal that dwarfs its geometry** (1 Aug). The
derived tangent map is high-frequency noise; PNG-encoded it costs ~0.4 MB at 512, ~1.5 MB at 1024,
~2.6 MB at 2048, while the same-res albedo JPEG is 10–30× smaller. Since the resolution is chosen
for COLOUR fidelity, the normal silently rides along oversized. Audit of the ten branch GLBs found
this on every hero facade: `bldg-row-shop` 5.48, `bldg-merchant` 4.57 (a 2048 brick normal alone was
2.6 MB), `bldg-warehouse-wharf-a/b` 3.83/3.81 MB — **17.7 MB of which ~14 MB was normal PNG on ~0.3 MB
of geometry.** Fixed per-prop by downsampling normals-only to 512 in place (BIN rebuilt, albedo +
geometry byte-identical) → 7.2 MB, `e9bbbe0`; and the monitor at `5521b12`. Left at res with reasons:
steeple normals stay 1024 (climbed landmark, read at arm's length on the belfry); duck-beam already
512; scaffold/printshop have no normal payload; `billeting-pile`'s 3.17 MB is a Meshy ALBEDO atlas
(no normal) — a separate albedo pass, out of scope here.

**Closed (owner-approved, 1 Aug):** `fix_glb_normals` now takes `--normal-max` (default **512**) and
downsamples the derived normal before PNG-encode, so the trap closes for every FUTURE bake instead of
being rediscovered per prop. The default fails *visibly* (a slightly soft normal anyone can see at
arm's length) where the old behaviour failed *silently* (14 MB nobody saw until an audit) — the loud
failure is preferred deliberately. Precedence: explicit `--normal-max` flag > generator stamp > 512.
JPEG-encoding normals was considered and rejected: chroma artefacts decode to wrong surface directions,
a worse and subtler failure than resolution. It only ever reduces normal res, never albedo/geometry.

**The opt-in lives in the generators, not this note — the note is a record, the generators are the
enforcement.** A prop the player reads at arm's length stamps a `normalMax` node extra (`obj["normalMax"]
= 1024` + `export_extras=True`) that travels IN the GLB, and `fix_glb_normals` reads it, so a rebuild
keeps the detail without anyone remembering a flag. This is the fix for the exact trap that cost a day
once — a decision recorded in prose while the file that dispatches was never edited. Props opting into
1024, each with its one-line reason:
- **`build_steeple_clean.py`** (`steeple-meetinghouse-climbable`) — the one landmark the player is
  physically *on* during the ascent (belfry chain, leap gallery); belfry brick/leadwork read at arm's length.
- **`build_partition_gate.py`** (`int-partition-board-a`) — a vault-height climb-over; the body is right
  on top of the board/iron as it vaults, so the relief is read up close.
- **`build_roofline_kit.py` → `build_ropewalk_shell`** (`int-shell-ropewalk-a`) — an interior (four walls
  + ceiling, ~26 m² seen from beside it), so its boarding relief is close-range. Threaded through the kit's
  `finish(..., normal_max=1024)`; every other kit prop is `None` → 512, correct for a roof seen at range.

Everything else takes the 512 default deliberately: the hero facades (`bldg-row-shop`, `bldg-merchant`,
`bldg-warehouse-wharf-a/b`) and the ridge monitor are seen at traversal range where 512 is
indistinguishable (proven by before/after renders in the audit); `duck-beam` was already 512;
`scaffold`/`printshop` carry no normal payload; `billeting-pile` is a Meshy albedo (no normal). Verified
end-to-end: the three opt-in generators stamp `normalMax:1024` into the exported GLB and `fix_glb_normals`
reports `normal cap = 1024 (generator stamp)`; unstamped props report `512 (default)`.

**The gap that cost the most:** every collision *invariant* reads authored hulls, and the
mover has never touched a GLB — `collision.ts`, `playerMotion.ts` and `traversalResolver.ts`
are THREE-free and work on analytic rects. So a body can be provably outside every hull while
visibly inside a building, which is why "0 of 44 transitions phase" was true and useless at
the same time.

The three `assets:verify:*` gates are the exception, and the reason they exist: they load the
published GLB and compare it against the authored hull. They are the only checks in the repo
that can see the picture diverging from the solid. Do not read the sentence above as
distrusting them — it is the invariant and replay suite that cannot see a drawn building.
