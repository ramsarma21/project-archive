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

**Needs an owner decision, not more measurement**
- **wharf-a's roof is now FLAT rather than gambrel, and that is the owner's call to keep or
  reverse.** The fork recorded here (keep the full-footprint deck and its lie, or take an asset
  that draws the roof flat at its own top) was resolved by taking option (b): the asset lane
  re-authored both sheds at box-true scale (`47be671`) and it is synced (`d0c69d4`). Measured off
  the placed meshes: wharf-a's deck went 12% → **100%** of samples carried, wharf-b's drawn roof
  4.031 → **4.300** under a 4.30 plane. Both decks stayed exactly where they were, so no take-off
  lip moved and the descents still solve. The cost, which is the decision: a full-footprint
  standable plane at `roofY` and a pitched roof are mutually exclusive when `roofY` is the box cap,
  so wharf-a lost its gambrel silhouette. Reversing it means accepting a narrower deck and
  re-solving the descents — the measurement that produced the fork already showed that breaks the
  run. Reasoning in the asset lane's `wharf-warehouses.INTEGRATION.md`.
- **The general trap behind it: `structure()` ties the mass top, the placement box and the walkable
  deck to ONE number (`roofY`).** So a mesh whose principal walkable roof is not at its own top
  cannot be authored honestly, and re-pointing the deck to chase the drawn roof *moves the drawn
  roof*: dropping wharf-b's `roofY` 5.35 → 4.30 made height the binding axis of the contain-fit,
  shrank the mesh ~6% and carried the flat roof from 4.30 to 4.05. It **cannot converge by
  iterating `roofY`** — only author-at-true-scale fixes it, which is what shipped. The debt note
  that blamed the residue on the deck's jetty was wrong and is corrected.
  - **A jetty caveat for whoever next reads a deck's fill number.** `structure()` inflates every
    roof deck past its mass by `JETTY_M` (0.7 m), so a deck rect is ALWAYS wider than any mesh can
    draw and a narrow shed can never sample 100%. wharf-b reads 60% for exactly this reason: on a
    4 m-wide shed the 5×5 grid puts two of five columns (x ±2.16) outside the 4 m footprint.
    Arithmetic, not a hole — wharf-a's wider rect happens to land all 25 samples inside. Do not
    chase a narrow deck's residual fill as a defect without doing this division first.

**Would affect play now**
- **`C_SCAFF_FOOT` is a SAFE dead end, and it has pushed the guided line off the B2 goods yard
  (`55e19d0`, OPEN).** Retiring the scaffold's ground ascent removed the only onward SAFE link
  from that node: it now carries three inbound RUN links (`C_SQUARE_N`, `C_SQUARE_NW`,
  `C_LANE_FOOT`) and nothing out. The cost is not local. With no SAFE way up the staging from the
  street, the cheapest SAFE route to POST re-routes over the merchant, and the B2 goods-yard vault
  drops off the guided line entirely — at `B2_PIER_GAP` the wayfinder now points at
  `B_CRATES_B`/`M_LEDGE` instead of arming `B2_GOODS_IN->B2_GOODS_OUT`. That is the whole of the
  `wayfind.test.ts` failure (38/39); it is NOT cross-file pollution, it reproduces with that file
  run alone. Confirmed causally: restoring any SAFE climb chain out of `C_SCAFF_FOOT` returns it to
  39/39. The honest fix is the deferred bent ground approach — a new node south of z −1.0 with the
  climb onto `SCAFFOLD_D1`, NOT moving `C_SCAFF_FOOT` (measured: that breaks two ground RUN links
  on the Town House corner and SAFE-distance continuity). Note for whoever takes it: a lane's
  guided line is a GLOBAL quantity here, so deleting a spur in one branch can silently re-route
  another.
- **Market→Town House guided line now runs the covert ELEVATED line, with an authored
  drop-to-contact (`86396fc`).** The mark used to follow the cheapest SAFE path (the retired
  ground street), leading the player onto the market floor against the covert rule. Fixed by
  giving the wayfinder an authored `guidedLine` (GOLDEN_GUIDED_LINE) and restricting its graph
  to that line, so the mark can only lead along sheds/canopies and touches the cobbles only at
  the beat. Verified in-engine (:5200): elevated mark with the constable on the cobbles below;
  the beat arms ("Hold there") and points CLIMB UP back to the line. mission-m1 243/243,
  affordances green.
  - **Design change to know about:** SHAMBLES_STOP's trigger moved from the ground entrance
    (16.6) east onto the canopy line's natural touchdown (B_CRATES_FOOT, 29.4,0,-0.8) — the
    covert line enters the Shambles at B_SHED_MID (~x22.6) and never passes 16.6, so the stop
    had to move onto the line the way ROPEWALK_STOP moved onto the roofline. The market-watch is
    the same watcher; the machine clamps the speaker's approach origin near the player, so his
    patrol post in opposition.ts was left as-is. encounterMachine.test now reads the beat from
    the trigger instead of pinning 16.6.
  - **Defect 3 (the "OVER THE TOP" brick-wall wedge, f0106) traced, NOT independently fixed.**
    That "OVER THE TOP" is the King-lane yard-gate CLIMB_OVER (C_LANE_GATE_IN→C_LANE_GATE_OUT),
    which the note itself calls the first climb-over on the OLD guaranteed path. In-engine:
    SPRINTING over it fires the climb-over cleanly (body crosses the 51.4–51.9 gate in one
    sample); WALKING into it wedges, because `parkour/select.ts`'s standstill branch only offers
    the climb-over while `sprintHeld` (the deliberate held-key contract — NOT my lane, not flipped
    for one gate without sign-off). The camera "buried in brick" is the chase camera clipping the
    Town House / row brick in the tight King-lane corridor — a camera-collision issue in
    `apps/web/src/mission/*` (CONTESTED, not edited). The routing cause is fixed above: the mark
    no longer sends the player down this corridor (verified — at the gate the mark points "12m up,
    Orange Street roofline"). Also flagged: the gate art (`int-partition-board-a`) draws far taller
    than its 1.6 m climbable collision, reading as an unclimbable wall (asset/scenery scale).
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

### A mantle is REFUSED onto a deck that is overhead — read this before authoring any multi-level structure (31 Jul)

The constraint that governs every stacked structure in this level, found while integrating the
regenerated Town House scaffold. Nothing in the design docs accounted for it.

`readRaisedSurface` in `packages/engine-world/src/parkour/probe.ts` takes
`overhead = raisedAt(0)` — the highest support over the player's own feet, within the climb
ceiling — and then **skips every hit carrying that same id**. It exists so that walking about
under a scaffold does not offer a climb onto its middle. The consequence nobody had drawn out:

- **It reads the level's AUTHORED deck rects, not the mesh.** Staggering the art changes
  nothing; the rects are what decide.
- **Therefore full-run stacked staging cannot be climbed at ANY spacing.** With every lift on
  one full-run rect, the lift above is overhead from everywhere on the lift below, so no step
  is ever offered. Widening the gap does not help: below 1.68 m the board above intrudes on
  `STAND_HEIGHT`, and above it the lift is still overhead.
- **A `climbVolume` does not enable a deck mantle, it RESTRICTS one.** The refusal at
  probe.ts:502-511 fires where a volume covers the surface and no ladder or grip validates it
  at that foot; a bare lipped ledge passes straight through. So retiring a ladder means
  retiring its climb volume too, or the climb goes silently dead in play.
- **`carriedBy` is the escape for a massless structure.** For two DECKs `oneObject` is
  `sameFootprint` and nothing else, so staggered rects would split the draw into one
  contain-fitted object per lift. A deck joins a MASS by `carriedBy` with no geometric test, so
  one mass in the cluster fixes both the grouping and the base (`drawBox` bases on the solids'
  own minY). The scaffold was trapped precisely because it was the one structure with no mass.
  Note a mass is *unconditionally* a collider — `MassSpec` has no non-colliding option — so an
  anchor has to be small and off the walking line, or it becomes an invisible kerb.

Also corrected here: a comment in `eastCovert.ts` claimed a thin deck "reads as empty air, so a
deck-mantle must be validated by a ladder/grip". That was true before `readRaisedSurface`
existed and is now false — it is what motivated the four `crate-stack`/`crate-mound` staging
steps, i.e. the "floating crates" the owner rejected.

**Which instrument sees it.** The affordance gate does NOT: it measures mesh against plane and
reported the staging perfectly healthy while every step was refused. `traversability.test.ts`
DOES — it drives the shipped physics at each authored link, and it is what caught all four
staging climbs going dead. Use it, not the affordance gate, for any "can the player actually
get up this" claim.

### The overhead-refusal sweep is SUPERSEDED — the predicate was a proxy, and driving the body replaced it (31 Jul)

The sweep matched twelve authored CLIMB links against the exact `readRaisedSurface` condition
(source node's x,z inside the target deck's rect, positive rise inside the climb ceiling) and
named two candidates. **Both of its conclusions were wrong, and measuring them is what produced
the gate that now covers the class.** Kept as a correction, not as an open item.

- **There is NO ladder-versus-grip asymmetry.** The sweep recorded it as untraced; it does not
  exist. `readOverhead` (probe.ts:644) is the *designed fallback* for exactly this shape — a pure
  vertical ascent whose standing spot is inside its target's footprint — and it consults ladders
  and grips through the same `climbAffordanceAt` call at the same refusal. Driven at both,
  `C_GALLERY_EMID->C_CLOCK` (ladder) and `F_LOW->F_CROWN` (grip) behave identically: CLIMB_UP
  offered at rest and at sprint, over 23/36 and 24/36 headings.
- **`F_LOW->F_CROWN` was not failing for the recorded reason.** The reader offered the climb. What
  failed was the harness: devEntry's `dropSpawn` overrode the requested facing (see the defect
  below), so the bot was driven into the elm bole instead of at the crown. Fixed at `02d549a`;
  `check-playthrough` BEAT now passes in a real browser.
- **`C_CORNICE_S->C_LEADS_S` is not a defect.** Driven with real `stepFlow` it climbs and the body
  arrives on the leads: the read tops onto the `TOWNHOUSE` mass at 12.40, which *is* the leads. Its
  2.20 m rise is inside the reader's CLIMB_UP band (the 1.9-3.1 m "dead zone" is an authoring
  preference, not an engine refusal, and roughly a dozen links sit in it).

**The general lesson, which is why the predicate did not become the gate.** Matching the predicate
is necessary and nowhere near sufficient: ten of the twelve hits are fine, seven served through the
`readOverhead` fallback and three standing exactly on a rect boundary, which is a body at the lip
and correct authoring. A check that cries wolf ten times in twelve gets muted. What landed instead
is `packages/mission-m1/src/__tests__/routeAscent.test.ts` — the ascent half of `routeFlow`: drive
real `stepFlow` UP every authored SAFE climb and require the body to arrive at the destination's
height. It needs no exclusion list, and it found a defect the sweep could not see (below). It
carries a mutation self-test that drops a bare climb volume over a foot and requires the driver to
notice, because a gate that cannot fail is not evidence.

### Three defects the ascent driver found on its first runs, and one it did not (31 Jul)

- **The merchant's covert entry was DEAD, and the mesh was not why** (`c54316e`). Three climb
  volumes outlived the ladders they were authored for — the 31-Jul re-mass took the ladders out and
  left the volumes, and *a volume with no ladder or grip at the foot refuses the ascent rather than
  enabling it*. The body sat on the Shambles crate and was offered BLOCKED, then RUN_OFF. Exactly
  the mistake `climbs.ts` already warns about for the scaffold, made two files away. The affordance
  gate had the surfaces healthy throughout.
- **The steeple's regenerated 14.7 east set-off cannot be climbed onto, and it needs an ASSET
  change.** The 15.8 gallery oversails to x 83.7 and the ledge runs x 83.0..84.7, so the gallery
  roofs its western 0.7 m; the north ledge below ENDS at x 83.0, so every trajectory crosses the
  overhang while rising and the head is 0.17-0.26 m through the soffit however the nodes are
  placed. Standing east of 83.7 is fine — that is the 1.0 m of open sky the regen aimed at — so
  the deck is authored and simply carries no node. Routed to the asset lane, which pulled the
  gallery's east oversail back to the shaft face. **STILL NOT AUTHORABLE — see the next section.**
- **The belfry's 14.7 set-off is on its THIRD failed attempt, and a green ascent run is what
  nearly shipped it** (1 Aug). The regen removed the soffit that refused the rising arc, so the
  departure now only needs to stand at x >= 83.35 for its west shoulder to clear the trimmed
  gallery edge at 83.0, and the mesh duly draws the 13.0 ledge out to x 84.0. **Nothing can stand
  out there.** Clearance above the 13.00 plane, sampled off the delivered GLB across the ledge's
  whole z 7.9-9.6 depth: open sky to x 83.1, then a flat **1.00 m** from x 83.2 east — the
  photoreal corner urn's base at 14.00, spanning the entire extension. That is the same urn the
  asset lane's own note used to rule OUT extending this ledge; it applies just as much to the pair
  it shipped, and the note did not carry it forward.

  **What makes this worth reading twice: every instrument in the lane said yes.** `routeAscent`
  drove the full four-hold chain (1.8 / 1.7 / 1.1) green, `traversability` passed each new node's
  standable check with a node out at x 83.5, and the 246-test suite was clean. The urn is drawn and
  carries no collision, so none of them can see it — only `verify_m1_steeple`'s mesh-reading
  headroom pass, which called 16.4% of the extended ledge crouch-only with a lowest ceiling of
  0.58 m. **A four-hold belfry chain reported green by the ascent driver is not evidence; only the
  mesh verifier is admissible here.** Wiring reverted, mesh and the deck trim it requires shipped.
  Needs the urn moved or shortened, not the route re-authored. Belfry stays ridge -> 13.0 -> 15.8
  at 1.8 and 2.8, one dead-zone entry, on drawn stone.
- **`O2_BARRICADE_WALL` stopped 0.6 m short of the merchant's south wall**, and 0.6 m is narrower
  than the 0.70 m capsule: a body in that slot was inside a solid whichever way it faced, 44
  consecutive ticks. As old as the barricade — the penetration fuzzer only reaches it when the
  world bounds move, which node edits do. Closed.
- **What it did NOT catch, and cannot:** the ascent driver reads authored hulls like everything
  else in the mover. It says nothing about whether the climb passes through drawn geometry. The
  steeple soffit above was found by `beginAuthored`'s deck test, and the elm's headroom by a direct
  GLB probe; neither is the driver's job.

### `devEntry`'s drop-in silently overrode the facing you asked for — FIXED (`d887e2f`)

`dropSpawn` in `apps/web/src/mission/devEntry.tsx` replaced the `toward=` yaw with the beat's own
`facingYaw` whenever the drop landed within `stanceRadiusM` of the beat stance — measured in **XZ
only**. Measured: the elm's `F_LOW` drop is 1.25 m from the stance in XZ, inside its 2.4 m radius,
and 1.85 m below it, so it was silently aimed at the nail. Held W then walked the body into the
bole, which is solid to 12 m, and the stage reported "the elm climb never arms" for a week — read
as a parkour defect and briefed as one. Now the override also requires the feet within 0.6 m of
the stance height, the tolerance `m1Mission.ts` already uses for the same question. The BEAT
stage's `back=1.6` workaround is deleted: it passes with no back at all, and the climb takes 43
sim ticks against 166 with the workaround in.

**The general lesson, which outlives this file: a dev-path convenience that silently overrides an
input is indistinguishable from a defect in the thing under test.** This one produced a wrong
diagnosis that survived a week and shaped two briefs.

### The edge brake holds a walk and loses a run, and a deck ends one capsule radius late (31 Jul)

Measured off the regenerated scaffold, tick by tick, against the shipped `stepFlow`. Both halves
generalise to any deck standing in open air.

`edgeBrakeMinDropM` is 5.5 and the tuning comment promises the reader "refuses to run off an edge
and brakes instead". It does — at a WALK. Driven south off `SCAFFOLD_D5` (plane 10.70, authored
lip z 1.2) the brake arms at z 0.83, kills the along-velocity, and the body settles: fall 0.00 m.
At RUN the identical station arms only at z 1.47 with `brakeLipDistM = 0.00`, which is 0.27 m —
one `CAPSULE_RADIUS` — PAST the lip, because a body stays grounded until its capsule clears the
deck. The brake still zeroes the horizontal velocity, so the body then drops vertically 10.70 m
to the street. Nothing is stale and no sub-threshold ledge is involved: the predicted drop reads
6.58 m throughout, comfortably over the ceiling.

So a `>5.5 m` lip on a massless deck is protected at a walk and not at a run, and the failure is
invisible to anything that only tests walking.

Two traps in reading the report, both of which cost time here:

- **The named surface is not where the body falls from.** `fatalTraversal` names the STATION, and
  the reader offers `CLIMB_UP` automatically, so a body driven off `SCAFFOLD_D3` (7.30) climbs the
  staircase and leaves from `D5` (10.70). That is why a 9.00 lift reports a 10.70 m fall.
- **`worstFallOff` truncates at 4 s.** The `D3` run reports 9.90 m because the window closed with
  the body still airborne at y 0.80; it is the same 10.70 m fall, clipped, after ~200 ticks spent
  climbing. Two different numbers, one hazard.

A fall past the ceiling is `HARD`: `LANDING_RECOVERY_TICKS.HARD = 48` (a roll is 24) and the flow
chain resets. There is no health, death or mission-fail on landing anywhere in the tree, so it is
recoverable — but `fatalTraversal.test.ts` asserts it unconditionally and its only "accounted for"
category is *unreachable*, so there is no way to record one as accepted debt without weakening the
gate. Owner's ruling 31 Jul: do not add an allow-list.

### Adding collision behind a roof lip can be FATAL, and the run-up is the whole variable (1 Aug)

Found while making the meeting-house monitor's louvred housing solid (`d16406e`). The housing is
drawn on the lead flat 1.30 m from `HOLLIS_MEETING__ROOF`'s jettied south lip, with an 8.20 m drop
over that lip. `fatalTraversal` searches DOWN from a 2.40 m run-up for the longest one that stays
on the deck, so a solid there caps every station behind that lip at **0.90 m** — and survival off
this lip is decided almost entirely by run-up length. Swept station by station with the gate's own
driver:

- **≥ 2.10 m** — the edge brake arms in time, the body never leaves: fall **0.00 m**.
- **1.20–2.00 m** — the body leaves and `TREE_AWNING` (3.20) catches it: **5.00 m**, under the 5.5 ceiling.
- **≤ 1.10 m with a late dash** — `dash-end` fires at 0.15 × run-up, 0.135 m from the lip, and the
  burst is still fully live as the body leaves. It **overshoots the awning** and hits the ground:
  **8.20 m**. The only fatal station in 5485 driven trajectories.

**Two fixes that look right and are both wrong.** Trimming the deck's south jetty to close the slot
makes it *worse*, because shorter run-ups are more lethal, not less — and a flush lip fails
`every roof deck oversails the mass beneath it` at 0.00 m of a required 0.35 m. Pulling the mass's
south face north to buy run-up leaves the capsule standing 0.25–0.35 m inside drawn louvre.

**Still open, and it is a placement decision.** The pass-through is real and load-bearing: today
`D_MEETING_ROOF` stood *inside* the drawn housing and the run in from the west crossed it (both
moved north in `d16406e` for the overhead rule anyway). The honest fix is to move the whole monitor
**~1.15 m north** — south face to z 8.75, restoring a 2.40 m run-up, and nearer the roof's centre
(drawn roof z 7.00–15.60) than z 7.60 is. That moves both deck rects, `E_RIDGE`, `E_RIDGE_W`,
`E_MEETING_STEP`, `D_MEETING_ROOF`, `E_GAMBREL_S` and `S7_HOLLIS_NICHE`, and re-opens the steeple
relationship (`E_RIDGE` would leave `STEEPLE_LEDGE_N`'s rect), so it needs its own re-mass and its
own run of the 145 s gate. The footing that makes the monitor draw ONCE is separable and shipped.

Generalises: **any new solid within ~2.4 m of a >5.5 m lip is a candidate fatal station**, and no
gate warns before the fact. `fatalTraversal` catches it, at 145 s a run.

### ROUTE wedged at x≈45.6 — FIXED (`77af03f`): a 0.2 m hole in the scaffold, not the wayfinder

The playthrough wedged on the Town House repair scaffold with `ROPEWALK_STOP` never armed. The
body reached `C_SCAFF_2S` on the 5.60 staging and stopped: the mantle onto the 7.30 board was
never offered, the edge brake answered the lip instead, and nine un-stick bursts got nothing.

**The 7.30 board stopped at world z −4.00 while the 5.60 board below it ends at −4.20**, leaving
0.2 m of open air between them over a 5.6 m fall to the street. The reader answers a lip with a
fall behind it, so `rankVerbs` returned `RUN_OFF` alone and `CLIMB_UP` was **not a candidate from
any standing spot on the lower board** — swept all 15 samples across its 3.5 m length, all
`RUN_OFF` before, all `CLIMB_UP` after. Every other consecutive pair of lifts abuts or overlaps by
0.4–0.8 m; this was the only one that parted company. Fixed in the generator's LIFTS table and the
mesh regenerated, so drawn still equals collision, with `SCAFFOLD_D3`'s rect mirroring it.

Three things worth keeping from how this was found:

- **It was none of the candidates.** Not the overhead rule, not a re-tread of a passed node
  (the `SHAMBLES_STOP` shape), not the guided line re-routing at the scaffold corner. The
  hypothesis that x≈45 was "the scaffold corner where the guided line re-routes" was in the brief
  and was wrong; the guided line was correct throughout and the body was standing exactly on its
  own waypoint.
- **`traversability.test.ts` cannot see this class.** It refuses a climb the *overhead rule*
  kills, which is why the staggered lifts are gated at all, but a gap between two boards leaves
  every authored rect legal and every rise inside the mantle limit. The failure only exists in
  the reader's verb ranking. `routeAscent.test.ts` drives real `stepFlow` up authored SAFE climbs
  and would have caught it, had the scaffold chain been in its set.
- **The generator's own comment caused it.** "Consecutive lifts must not overlap" is true of the
  lower lift's route NODE and false of the boards; read as the boards, it produced the one
  negative overlap in the table. Both files now say which.

**The 13 `apps/web` failures are NOT this class** — the brief's premise, and it does not hold. Ten
of them run identically with and without the scaffold fix (A/B'd, `missionSafeRun` /
`missionElmContinuation` / `missionSafeRoute`), and they span the ropewalk tie beam, the hemp
descent and capstan vault, the Dock Square goods vault and the gaol barrels — sections the
scaffold is nowhere near. They remain pre-existing at `7216217` and **unchased**; nobody has yet
established whether they are one cause or several.

### `check-playthrough` needs a persistent server on IPv6, and the API for a full pass

Three ways to waste twenty minutes on this gate:

- The dev server must run in a **persistent** shell. Backgrounded inside the same shell call it
  dies when the call returns, and the gate then reports "no dev web server reachable" — which
  reads like the fix that was just applied is broken.
- Vite binds **IPv6 only**, so the gate works against `localhost` and NOT `127.0.0.1`. Node's
  `fetch` and `curl` disagree about which one `localhost` means, so a passing `curl` proves
  nothing.
- The DUEL stage opens a REAL graded attempt, so a full green needs the **API** up as well as the
  web server. A web-server-only run fails DUEL no matter what the world is doing. Worth knowing
  before calling the release bar met.

### The harbour ships were boxed to how a ship LOOKS, and the exemption written for them names the wrong cause (1 Aug)

`check-world-collision` failed on exactly these three and nothing else. Each box is now the drawn
hull's own AABB (`8159c66`), measured off the placed GLBs:

| ship | was boxed | drawn | fill |
|---|---|---|---|
| brig | 14 × **18** × 6 | 14.000 × **8.733** × 4.197 | 29% → 39% |
| snow | 14 × **15** × 5 | 14.000 × **9.027** × 4.304 | 35% → 43% |
| sloop | 14 × **14** × 4 | 14.000 × **9.849** × 2.747 | 47% → **55%, passes** |

**The dominant lie was HEIGHT — 9.3 m of solid above the brig's masthead — and the gate's table
prints only x-by-z, so the worst axis never appeared in its own output.** Read `--json` for the
y column before believing a fill number is a footprint problem.

**The retraction, and it matters because the fix is unmerged and would have shipped the wrong
reason.** `SPARSE_VESSELS` on `workflow/mission-presentation` (`2d77fcb`) justifies itself with
"its collision box HEIGHT is set by the MAST for render scale, so a hull mesh can never fill it."
**That premise is false.** A prop contain-fits UNIFORMLY and **x** is the binding axis on all three
(drawn x sits exactly on the box), so the box height never affected the drawn size at all: dropping
the brig 18 → 8.8 left the mesh identical to four decimals. The height was simply over-authored.
The exemption is still *warranted*, for a narrower reason it does not state — the hull TAPERS inside
an axis-aligned rect whose x extent is **pinned to the drawn length by the contain-fit**, so
shrinking x shrinks the whole ship and a pointed hull cannot fill a 14 m rectangle. Re-word it
before merging, and note its `KNOWN_DEBT` half (the two wharf warehouses as PENDING-REGEN) is now
**stale by its own retirement condition** — both fill 100%.

Reachability, which bounds what the residue costs: the player is clamped to `LEVEL_BOUNDS` maxZ 24,
so the snow (z 28.3+) is untouchable, and only the north 1.1 m of the brig and 1.4 m of the sloop
lie in reach — faces that just moved 0.9 m and 0.6 m further out. Separately noted, not chased:
**the ground plate is walkable to z 24**, i.e. out over the drawn harbour past the bollard-and-rope
rail at z 19.

### The elm/roof-walk penetration brief is STALE — the transition it names does not exist (1 Aug)

Handed to me as "`LIBERTY_ELM_TRUNK`'s canopy penetrates the `D_MEETING_ROOF→E_RIDGE` walk by
0.309 m at head height". Measured with `check-drawn-penetration` (the admissible instrument here —
it drives the real mover against DRAWN meshes and self-tests that it can tell penetration from the
contain-fit gap): **there is no `D_MEETING_ROOF→E_RIDGE` transition.** The chain is
`D_MEETING_ROOF → E_MEETING_STEP → E_RIDGE`, and neither leg touches the elm. No 0.309 anywhere.

The real remaining elm intrusion is **`E_LEDGE_N→E_GALLERY`, 0.244 m into `liberty-elm-hero` at
[80.8, 13.3, 7.8]** during approach/settle, graded OFF — the mildest non-marginal band. The elm's
other three (`F_LOW→F_CROWN` 0.775, `F_POST→F_POST_STEP` 0.577, `F_LOW→F_AWNING` 0.380) are
inherent: you climb a tree by moving through its canopy, and no reposition fixes them.

**No reposition was attempted, deliberately.** The intrusion sits on the belfry chain that is
already parked on the drawn urn, `STEEPLE_LEDGE_N`'s north strip (z 7.90) is inside a canopy that
reaches z 8.8, and the obvious cheap fix — sliding `E_LEDGE_N` south within its own deck, the
precedent `E_RIDGE` set when it moved 79.5 → 78.5 for this same canopy — would push the node
**into `STEEPLE_GALLERY`'s own rect** (z 8.90..14.30) and hand the mantle to the overhead-skip rule
on the ascent to the leap of faith. Moving the elm instead moves the mission's terminal beat: three
bough decks, both effigies, the awning catch, the `F_*` nodes and the nail stance. Not a trade worth
making for 0.244 m the night before a playtest. Whoever takes it should treat it as an asset job
(canopy sprawl trimmed north of z ~7.5) rather than a level job.

### The 13 stale `apps/web` failures: 7 were the guided line, 6 are three other things (1 Aug)

**Corrects this entry's own earlier headline, "they are ONE cause, and it is not a defect."** That
was wrong, and the measurement that refuted it was made by acting on it: unpinning the graph in the
three files fixed **7 of 13**, not 10, and the survivors turned out to have three separate causes —
one of them a live player-facing defect — since fixed, see the visor entry below. `apps/web` is now
**5 red**, every other package green; `packages/mission-m1` 246/246. Fixed at `m1Instance`, whose
`guidedLine` is now an optional parameter defaulting to `GOLDEN_GUIDED_LINE` — production behaviour
is unchanged, and the three test files pass `guidedLine: null` at four call sites to get the full
authored SAFE graph back.

`86396fc` pinned the wayfinder to `GOLDEN_GUIDED_LINE`. Traced in `wayfind.ts:481-502`:
`createWayfinder` with `guidedLine` set **filters `level.links` down to exactly the consecutive
pairs of that line and discards every other authored link.** A body standing on a node that is not
on the line therefore has no links in the graph at all, so no leg can commit there —
`legSpeedCap` returns `null`, no gateway arms, and guidance offers no vault or climb.

**Seven are fixed by unpinning the harness.** Each one in `missionSafeRoute` /
`missionSafeRun` / `missionElmContinuation` drives guidance on a leg the line no longer contains:
the ropewalk tie beam and the hemp/capstan descent (`D2_*`), the Dock Square goods vault and throng
(`B2_*` — the very legs recorded above as having dropped off the line), the gaol barrels, and the
tower's east face and clock ledge (the line goes up the `C_SCAFF_*` staging instead). They encode
the pre-`86396fc` cheapest-SAFE route. `route.ts` says as much in its own voice about the ropewalk:
it "stays authored… the guided line just no longer detours through it." Two representative
assertions read verbatim: `speedCapMps=null` where 2.3 was expected (no committed leg off the line
to carry a cap), and a held sprint failing to climb the east face (that chain is off the line).

This also explains the A/B that puzzled the earlier pass — they run identically with and without the
scaffold fix because that fix changed board geometry, not line membership.

**The five that remain are deliberately red, and they are not one class.** No assertion was deleted
and none was greened by a flag that stops it checking anything.

1. **`missionGroundLane` "a naive forward run clears the Shambles ground lane" — not guidance at
   all.** It assigns `runtime.motion` directly at `B_STREET_W` and holds +x with **no mark read**,
   so the graph is irrelevant and `guidedLine: null` changes nothing. Its own message names the
   cause: *"it wedged in the lane (the gaol-barrel vault trap)"*. That is a traversal/collision
   finding on an authored-but-unguided leg, and the guided line steers production clear of it, which
   is why no gate catches it either.
2. **`missionWayfinding` "the first attempt is guided down SAFE; a later attempt uses every line"
   encodes a requirement the owner retired.** Its second assertion demands a retry widen to every
   authored line; `m1Mission.ts` says in its own voice that there is ONE route and "a retry no
   longer gets alternate marks", and the code passes `guidanceLines: ["SAFE"]` on every attempt with
   no ordinal branch. Unsatisfiable without reviving retired machinery. Unpinning would green its
   *first* assertion and leave the second red, so it was left alone: this one needs the owner's
   call (re-point it at the one-route rule, or delete it), not a harness flag.
3-5. **The three long end-to-end runs** — `missionSafeRoute`'s steeple-gallery dive,
   `missionElmContinuation`'s full-run-composes, and `missionSafeRun`'s clock ledge — are still red
   *after* unpinning, so the guided line was not their only cause. **Their second cause is not
   traced to a location**, and that is stated rather than guessed: `missionSafeRun` fails on
   `reachedLedge`, i.e. the drive never arrives, and a scratch drive of my own ended inside the
   gaol-barrel x-band `[20.5, 24]` that item 2 names — suggestive of one shared wedge, but my
   controller is not the tests' controller and is **not admissible** for that claim. Settling it
   means instrumenting the tests' own drive for where it stops.

One genuine player-facing residue worth a look: the authored **walk cap** is a safety cue at a lip
over a fall, and off the guided line there is no committed leg to carry it, so a player who wanders
onto the tie beam gets no cap.

### FIXED: the visor briefing drew NO route at all, and one back-link did it (1 Aug)

The first thing a player sees on a first attempt, drawing zero polylines, at `72ec557`. Found only
because `visorHold`'s "the lines drawn are the fork" was on the stale-failure list and turned out
**not** to be a guided-line casualty: it fails on `plan.paths.length > 0`, and `m1VisorSource()`
reads `M1_EFFIGY_RUN.links` directly and never consults the wayfinder, so unpinning the harness
could not have fixed it — it would have left the defect live and the test green.

**Mechanism**, traced in `apps/web/src/visor/visorPlan.ts`: `chainPolylines` seeded a polyline only
at a **head** node — one with nothing arriving at it — and then required that seed within
`LINE_REACH_M` (10 m) of spawn. `S1_PRINTSHOP_VANTAGE -> A_START` arrives at the start node, so
`A_START` was not a head; the only heads left were `C_SQUARE_NW` and `C_GALLERY_STAIRHEAD`, both
away in section C, both rejected. The degenerate fallback was gated on `heads.length > 0`, i.e. on
whether a head **exists** rather than whether one **drew**, so it never ran.

That back-link is not a mistake to delete: reserved pads are authored with RUN links **both** ways
by construction, so all seven will do this, and the pads are owner-reserved. The seeding was the
defect. Three changes, all in `chainPolylines`:

- **Seed at the route's DECLARED `startNodeId`**, not just at graph heads. "Nothing arrives here" was
  a bad proxy for "the run begins here", and this is immune to any number of pads.
- **The fallback now runs when nothing was DRAWN**, not when no head exists, and orders its
  candidates by range to spawn. The old last resort took `[...outgoing.keys()].slice(0, 1)` — whichever
  node the first authored link happened to leave from. In this level that is `A_START` by luck, so a
  fallback-only fix would have worked here and silently depended on authoring order.
- **A polyline may not double back onto a node it has already drawn.** Without this the fixed hold
  drew a line leaving the player's feet and returning to them — the pad's own back-link as a closed
  loop under the reticle, spending a quarter of the four-polyline budget saying nothing.

Measured after: `paths=4, segments=7` against a budget of ≤4 and ≤12, all four seeded at spawn and
running out to 2.5–12.0 m, all inside the 26 m near field. `visorHold` is 12/12. Note the budget is
now exactly full at 4, so the next pad authored within 10 m of spawn will breach it.

**Left alone deliberately:** FAST and EXPERT are now zero-link, so this test's premise — a *fork* —
is stale. What the hold should draw when there is one route is a design decision on owner-reserved
ground, and getting *a* route drawn is the defect fix.

### `check-playthrough` is NOT all-pass in a lane worktree, at HEAD, for two environment reasons (1 Aug)

Briefs are being written on "check-playthrough is currently **ALL PASS**". In this worktree it is
not, and **it is not all-pass at clean `72ec557` either** — verified by stashing every edit and
re-running, which produced the identical single failure. So this is environmental, not a regression,
but a brief that quotes ALL PASS as the state to preserve is quoting something a worker cannot
reproduce.

- **The gate defaults to `:5273`, not `:5200`.** It refuses fast and prints the vite command to run.
- **`.env` is gitignored, so it does not exist in any worktree.** `apps/api` then refuses to start
  at all — "GRADING_RECEIPT_SECRET is unset and SESSION_SECRET is not available to derive from" —
  which is correct behaviour and fatal to the DUEL stage. Copying the checkout's `.env` in gets the
  API up; the file stays untracked and cannot be committed. This will bite every future worktree.
- **The DUEL stage still fails even with the API up**, on "could not open a local session", which is
  unresolved and needs whoever owns the duel harness. Every other stage passes: world, route order,
  no penetration, yard, the ladder refusal pair, and all four elm-beat checks.

**Reconciling the two runs, owner-confirmed:** the earlier ALL PASS was against the owner's live
stack, which has `.env` and a running API; a bare worktree has neither. Both observations are true,
and the honest statement of the bar is that **every traversal stage passes in both, and the DUEL
stage is environment-gated.** Quote it that way. A release bar that only passes on one machine is
not a bar, and "ALL PASS" as a brief's premise sends a worker looking for a regression it did not
cause — which is what happened here before the stash test settled it.

### `verify_m1_steeple` is RED at `72ec557`, on the texture atlas count (1 Aug)

Named in the release bar and currently failing, which nothing else records. The single problem is
`FAIL 6 texture atlases; a hero landmark ships one` — a property of
`steeple-meetinghouse-climbable.glb` alone, which last changed at `72ec557` (the belfry sync), so it
arrived with that commit. Everything else in the verifier is green: all five rings 100% underfoot,
0 walking-on-air, headroom clear, and the `E_GALLERY→F_CROWN` dive corridor clear. It is an asset
packaging job for the asset lane, not a world defect — but the gate is red, so a release cannot be
called clean by quoting it.

Also: the artifact mirror `~/Projects/project-archive-artifacts/m1-world-assets-out-2026-07-31/` is
**stale for the wharf** — it holds the pre-rebuild GLBs (21:42) and not the 00:23 rebuild or its
integration note. Read `/tmp/m1-world-assets-out/` for those, and do not treat the mirror as the
delivery of record without checking mtimes.

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

**The gap that cost the most:** every collision *invariant* reads authored hulls, and the
mover has never touched a GLB — `collision.ts`, `playerMotion.ts` and `traversalResolver.ts`
are THREE-free and work on analytic rects. So a body can be provably outside every hull while
visibly inside a building, which is why "0 of 44 transitions phase" was true and useless at
the same time.

The three `assets:verify:*` gates are the exception, and the reason they exist: they load the
published GLB and compare it against the authored hull. They are the only checks in the repo
that can see the picture diverging from the solid. Do not read the sentence above as
distrusting them — it is the invariant and replay suite that cannot see a drawn building.
