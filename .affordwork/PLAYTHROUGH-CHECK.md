# check-playthrough — the gate that opens the game and plays it

`scripts/check-playthrough.mjs` (`pnpm verify:playthrough`) drives the **real
client** with Playwright and asserts the mission actually works. It reads the
running game's own black boxes — `window.__floor` (mission runtime), `window.__stage`
(the R3F root: `renderer.info` + scene graph), `window.__diag` (per-tick
penetration), `window.__duel` (duel runtime) — the same handles the dev harnesses
already expose. Nothing is mocked.

## What it asserts

### WORLD — the mission scene renders a world (not "the page loaded")
Reads `renderer.info.render` off the live `WebGLRenderer` and censuses the scene graph:
- draw calls in `[40, 4000]` (near-zero = empty scene),
- triangles in `[300k, 40M]`,
- textures uploaded `>= 20` (a wiped scene is ~0),
- **zero untextured white-box props**: a lit (Standard/Physical) mesh with no
  base-color `map` and a near-white color — the exact signature of a prop whose
  texture did not bind at runtime. Skinned meshes (characters) and unlit
  `MeshBasic` (markers/UI) are exempt.

### ROUTE — a driven run advances in order; every stop arms *and* resolves; nothing penetrates
Drives from spawn (hold sprint, aim at the next objective waypoint, jump on jump
verbs, strike the reaction beat with `F`, answer stops through the real overlay):
- every authored encounter **arms** (leaves `DORMANT`) **and resolves**
  (`RESOLVED`/`RELEASED`); arming alone is the soft-lock, so it is not enough,
- **no soft-lock**: a stop armed but unresolved > 30s fails (a timeout that
  *fails* rather than hangs),
- **no beat hang**: motionless > 8s while free-running fails; a `TRAVERSAL_TIMEOUT`
  reached while stuck is reported as a hang, not a fair loss,
- **route advances** past the Shambles/ropewalk (progress east of x=60),
- **no penetration**: `window.__diag`'s invariant embed ring must stay < 0.30m
  (a body inside solid geometry at any tick fails).

### YARD — a driven run reaches the rope-walk yard
Drops in on the final section (`F_VAULT_OUT` → `G_SPAWN`) and asserts the player
enters the yard rect `x∈[88,100], z∈[-6.5,6.5]` within 25s.

### DUEL — the harness loads a world, and a graded answer discriminates
- `verdict=live` must **not render into an empty void**: `botSky`, the fraction of
  the lower-centre band of the frame that is open sky, must be `<= 0.5`. Void ≈ 0.885
  (fighters float in sky because the arena is drawn at the origin while the fight is
  at the mission's coordinates); a real arena ≈ 0.058.
- `verdict=correct` must load the player a bigger magazine than `verdict=wrong`
  (14 vs 7), driven through the real question panel (prose + evidence cards +
  submit) — proving the client wires a verdict to a bullet count.

## Evidence it catches today's regressions (run against current `main`, merged)

```
[WORLD]  PASS  draw calls / tris / textures / no white boxes   (172 calls, 5.1M tris, 149 tex, 0 white)
[ROUTE]  PASS  both stops arm+resolve, no soft-lock/hang/penetration, progressX=74
[YARD]   PASS  reaches the rope-walk yard region                (ended [88,0,0])
[DUEL]   FAIL  duel renders a world, not an empty void
               the lower-centre of the frame is 88% open sky (> 50%) — the fighters
               are standing in the void with no arena around them
[DUEL]   PASS  a graded answer discriminates right from wrong   (correct=14 wrong=7)
1 CHECK(S) FAILED
```

**The live duel void is caught (`botSky=0.885`, exit 1).** This is the single most
important acceptance criterion, and the check was built against this known-broken
state. The other two morning regressions **do not currently reproduce on this
merged branch** — the mission scene is fully textured (0 white boxes) and both
encounters resolve — so their assertions pass here. To prove those assertions are
not vacuous, `.affordwork/fault-inject.mjs` reproduces each fault in the live client:
- **white-box**: stripping the base-color map off the 25 instanced prop materials
  takes the census from `whiteBoxes=0` → `whiteBoxes=25` (detector FIRES).
- **soft-lock**: withholding the answer to `SHAMBLES_STOP` leaves it armed at 5.5s
  and unresolved; at 32.6s (> the 30s timeout) the soft-lock check FIRES.

## Runtime and flakiness

- **Runtime: ~88s** end-to-end (WORLD+ROUTE ~42s in one browser session, YARD ~10s,
  DUEL ~35s across three loads). Under the two-minute target. The ROUTE stage stops
  as soon as both stops resolve rather than playing the whole mission.
- **Flakiness: none observed.** Across 6 full runs the results were identical to the
  decimal: `botSky=0.885` every time, `magazine correct=14 wrong=7` every time,
  exactly one failure (the void) every time, `progressX=74`, `penetration=0`,
  `maxStall` 1–3.6s. The strongest assertions (`botSky` 0.885 vs 0.058, magazine 14
  vs 7) sit on a ~15× / 2× gap, far from their thresholds. No retries are used;
  nothing degrades to green.

## Wiring it into CI — NOT done yet, deliberately

It is red on `main` today (the void), so a blocking gate would stop four other lanes.
To stage it the way the affordance verifier was staged before it became a gate:

1. **Provision the runtime in CI.** It needs a dev web server (mission + duel
   harnesses) and, for the DUEL stage, the API up — `verdict=live` opens a real
   (throwaway) graded attempt, which needs a Postgres and a matching `WEB_ORIGIN`
   (the API's origin check is what returns `CSRF_INVALID` otherwise). `playwright
   install chromium` (or a Chrome image). The script falls back to bundled Chromium
   if Google Chrome is absent.
2. **Go green first.** The boss-fight owner must fix the void (pass the mission's
   `Scenery` to `DuelScreen` in the live-mode harness, or recentre the arena) so the
   DUEL stage passes. Then run it non-blocking (report-only) for a few days to
   confirm the measured 0% flakiness holds on CI hardware.
3. **Promote to blocking** once green and stable, adding `verify:playthrough` to the
   gate list — with **no `continue-on-error`**, matching the other six gates
   (`check-world-textures` was silently unguarded for weeks because it warned
   instead of failing; this must fail loudly).

## Deliberate omissions, labelled

- **Full `REACHED_DUEL` completion is not required of the autonomous driver.** The
  terminal objective is gated on the reaction-timing posting beat at the Liberty Elm
  and a precise bough dismount; a bot that reliably executes that skill beat is
  itself a flaky dependency, and a flaky gate gets disabled — worse than none. The
  authored route's reachability is already covered at the DATA level by mission-m1's
  `route.test.ts` / `traversability.test.ts`; this gate adds the rendered + encounter
  + penetration coverage those cannot see, and samples the final "reach the yard"
  section end-to-end via a drop-in (YARD stage) instead of playing the skill beat.
- **Live-mode grading is not verified against the real classifier**, because no
  classifier credential is resolvable in this environment (the API logs "DUEL GRADING
  IS OFF … grant the maximum"). The discrimination assertion therefore uses the
  scripted authority (`verdict=correct`/`wrong`), which still exercises the real
  `DuelScreen → runtime.commitVerdict → magazine` path end-to-end. Server-side
  grading correctness is covered by apps/api duel tests.

## A finding to report (not fixed — siblings own it)

Not a new bug, but worth flagging: `verdict=live` against the API fails with
`CSRF_INVALID` unless the API's `WEB_ORIGIN` matches the web origin exactly (the
progression route rejects a mismatched `Origin` as CSRF). Running the duel harness
on any port other than the API's configured `WEB_ORIGIN` (default `localhost:5173`)
silently produces the "could not open a gradeable attempt" state rather than the
graded duel — easy to mistake for a code bug when it is an origin-config mismatch.
