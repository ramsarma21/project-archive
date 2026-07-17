# Interaction & UX Micro-Spec (implementation-ready)

**Purpose.** The design docs say *what* and *why*; this doc says *exactly how each interaction behaves* so it can be coded without re-deriving intent from prose. Every rule the playtests pinned down lives here as a **codeable statement + parameters**. `Backend-AI-System.md` owns the concrete runtime/state implementation; `Day-1.md` (scene), `Day-Template.md` (laws), and `Production.md` (build/art) are the rationale; when a rule here changes, update the matching spot there too.

**Conventions in this doc:**
- **`[TUNABLE]`** = a starting value to feel-test in the slice, not sacred.
- **States** are written as enums; **triggers** as `on <event>`; **transitions** as `→`.
- Distances are world-meters in the *compressed* district (traversal is cheap, so these are small).

---

## 1. Objective markers (pings) & the Today strip — one coupled system

**Rationale:** `Day-1.md` §B0, §4A. Markers (where) and the strip (what's left) are the same objective shown two ways; they always agree 1:1.

### 1.1 Ping states
```
enum PingState { BLUE_AVAILABLE, GOLD_ACTIVE, HIDDEN, DONE }
```
- **BLUE_AVAILABLE** — an available, not-yet-selected objective. Shows a **live distance readout** (`70m`) that updates as the player moves.
- **GOLD_ACTIVE** — the current selected target, or the sole/urgent objective. One gold at a time in pick-one-focus.
- A **timed** objective's ping/strip line carries the **waning-sun/bell glyph** (☼); the glyph **advances visually as day-time is spent** (see §8). Non-timed objectives never show it.
- Pings are diegetic AR, subtle (Fortnite-ping style), **never a full quest arrow / breadcrumb trail**.

### 1.2 Pick-one-focus state machine (must-do-all, order-free set — the deliveries)
```
start: N objectives → N BLUE + N strip lines
on player_select(obj):        obj → GOLD_ACTIVE; all others → HIDDEN     // single focus, no clutter
on complete(obj):             obj → DONE (check/dim); remaining set → BLUE (resurface)
repeat until all DONE
```
- Day 1 count-down: **4→1→3→1→2→1→1** (4 errands).
- The player **may select the moment a set resurfaces** (pings are pickable anytime), but selection is **never force-prompted** the instant a beat resolves (see §7 pacing).
- **Expanded Today tab always shows the full set** regardless of collapse.

### 1.2a Gold-marker redirect (rule of thumb — HARD)
```
on gold_active(obj) AND player_moving_away_or_idle for > REDIRECT_GRACE:
    archive_redirect(obj)   // warm, escalating; points back at the gold
```
- **Whenever a gold marker is active and the player doesn't head to it, the Archive redirects them** back to it. This is the general form of the crowd-steer (`Day-1.md` B10.4) and the shop-exit nudge (B4): any *selected/urgent* objective that's being ignored gets a warm handler line plus the gold ping staying lit.
- Tone is **encouraging, not nagging** (*"The crowd's gathering, let's go check it out."*), escalating only if ignored, and merging with the time-warning (§8) as dusk nears.
- **[TUNABLE] `REDIRECT_GRACE`** ≈ the §7 breather (~7 s of free-roam) before the first redirect, so it never stacks on the beat that just set the gold.
- Blue (available, unselected) pings do **not** redirect; only **gold** (the committed/urgent target) does.

### 1.3 Mutually-exclusive choice (e.g. route pick)
```
on player_select(opt):  opt → GOLD_ACTIVE; alternatives → HIDDEN (permanent, never resurface)
```
Same collapse visual as 1.2, but unchosen options are gone for good (only one was ever going to happen).

### 1.4 Strip ↔ marker coupling (hard)
- Strip line set == ping set, always. Selecting a strip line == selecting its ping, and vice-versa.
- Strip **evolves with the task set** (`"Go to Mercer's Press"` → the four errands → whatever follows); never stale.
- Completed lines **check off / dim**.

### 1.5 Strip = Archive collapsed state
- The always-on strip **is** the Archive overlay collapsed. Expand (click / hold / hotkey) → full overlay, tabs **Today · People · Notes · Routes**, landing on Today.
- **Expanded = free pause** (world/clock do **not** advance; no hidden rolls shown). **Collapsed = unobtrusive strip.**
- Anti-clutter (hard): glyphs over words; collapses to a thin tab during action/cutscenes; never covers the world; never more than a few lines.
- **The strip carries the persistent day-clock** (diegetic sun-arc / daylight meter, non-numeric — see §8) so daylight-remaining is always glanceable alongside the task lines.

---

## 2. Glyphs — speech vs. interaction (two distinct AR marks)

**Rationale:** `Day-1.md` §5 NPC speech/interaction glyphs; Production §2AA.

| Glyph | When it shows | Notes |
|---|---|---|
| **Speech glyph + attributed subtitle** | over **any** NPC speaking outside the player's active dialogue (ambient talk, barks, crowd lines) | **always on** — the player always knows who said what |
| **Interaction glyph** | over any NPC/object the player can **engage** (talk, read, handle) | marks engageability only |
- **Co-occurrence:** an engageable talker (Clarke) shows **both**. A pure ambient talker shows **only** the speech glyph. The player's **active partner** (Abigail mid-scene, Thomas while helping) needs **neither**.
- **[TUNABLE] Interaction-glyph appear radius:** ~**5 m** and within view frustum. Fades in on approach, out on leave.

### 2.1 Ambient background chatter runs the WHOLE day (soft exposition — never tracked)
- **Throughout the entire day**, background NPCs (passersby, shopkeepers, dockhands, people in the crowd) trade **short overheard lines that carry real period exposition** — grumbling about the stamp, the price of paper, the watch, "no vote in London," etc. Every such line shows the **speech glyph + attributed subtitle** (§2), so the player always sees who said it.
- This is **ambient support, NOT tracked** (it isn't a deliberate, verifiable interaction — §3). It **never counts** toward the L2 exposure gate and **skipping/ignoring it costs nothing**; it exists to make the street feel alive and to reward a curious ear, layered *under* the tracked/authored curriculum. The guarantee always lives on the tracked set.
- **[TUNABLE] chatter density / audibility radius** — dial so the street feels populated without turning into noise; ambient lines duck under any active dialogue, Sync, or Archive line.
- Optionally the **Archive may spotlight** an especially teachable ambient exchange (a light *"worth a listen"*), same courtesy rule as ambient reads (`Day-1.md` §77) — still never tracked.

---

## 3. Tracked-read interaction grammar (the verifiability gate — HARD)

**Rationale:** `Day-1.md` §2C tracked-vs-ambient; §B4.5/B5.5/B7.5; Production §2B Focus-Inspect.

A **tracked read** logs its curriculum exposure **only** on the full deliberate action:
```
requires ALL of:
  1. player within READ_RADIUS of the marked read
  2. player presses INTERACT
  3. camera transitions to 1st person (focus-read)
  4. read panel opens (content shown)
→ on open: log_exposure(concept, occasion)   // fires once per read per run
```
- **Proximity alone logs NOTHING.** Walking past, standing near, or glancing = a fly-by = zero. This is what makes the occasion **verifiable**.
- **[TUNABLE] READ_RADIUS:** ~**1.5–2 m** + facing the object.
- **Interaction glyph** marks a tracked read as engageable. The **Archive may prompt** it (a light *"worth a look,"* especially if not obvious) — but **prompt ≠ track**; only the player's interact+read counts.
- **Ambient teachable content** (posters, barks, carvings): the Archive **may still prompt** to invite curiosity, but it is **never tracked** and **skipping costs nothing** — a free optional enrichment layer, never load-bearing. Player never sees a "counts / doesn't" tag (positive-only).

---

## 4. NPC encounter model (staged, non-chasing — the Clarke pattern)

**Rationale:** `Day-1.md` §B7; Production §2AA. Reusable for any "posted watcher / gatekeeper" NPC.

### 4.1 Staging & non-pursuit
- NPC is **staged at a fixed spot** (doorway) on a through-route. **Never crosses the street, never chases.**

### 4.2 Trigger ladder (by distance)
```
on enter BARK_RADIUS:       play directional ambient bark (speech glyph)     // atmosphere, no menu
on become ADJACENT:         NPC issues challenge line → OPENS the choice     // this is the gate
```
- **ADJACENT fires on either side of the street** — walking the far side does **not** dodge the challenge (street is narrow; he can see the bag). The **challenge line itself ("what's that you're carrying?") is what opens the decision** — not proximity, not a pre-emptive menu.
- **Only clean avoidance = not being on his street at all** (take an alternate/unlocked route, e.g. the dock route). Then the encounter (and any exposure it carried) **reroutes** (L3).
- **[TUNABLE] BARK_RADIUS:** ~**9 m**. **[TUNABLE] ADJACENT_RADIUS:** ~**4 m**, spanning full street width.
- Intent is carried by **spoken line + turn-toward**, never by subtle gaze/idle animation we can't build (no-mocap rule).

### 4.3 Choice resolution
- Options resolve per §11 effect tags + §9 feedback. A "cover" option may **fold in a gamified conceal** (§6). A "threat" read **arms downstream world-state** (informer → later stop, `Day-1.md` §6/§7) — commit now, reveal when felt.

---

## 5. Camera grammar

**Rationale:** `Day-1.md` §5 camera; Production §2B.
```
1st person  = hands on an object   → read, compare, operate, carry-detail, conceal, tack, construct
3rd person  = player in the world  → move, traverse, evade, crowd, dialogue framing, witnessing
```
- Every beat declares its camera. Transitions are **clean cuts or short framing nudges**, never mid-action swings.
- Gamified executions pick camera **by fit** (see §6).

---

## 6. Gamified execution of action-bearing choices (L17)

**Rationale:** `Day-1.md` §5 (L17); Day-Template L17. **Any choice that involves real movement/animation** (not pure dialogue) gets a short gamified execution. Camera by fit; **effort-tier (unfailable) by default**, graded only where the outcome must mean something.

| Action | Camera | Input pattern | Tier | Notes |
|---|---|---|---|---|
| Operate press (the pull) | 1st | needle **oscillates L↔R, accelerates each pass**; commit in green sweet-spot | **Graded** (crisp/usable/smudged) | waiting is never dominant — window tightens; §8 no time-per-attempt beyond the beat |
| Conceal (fold wrap over bundle) | 1st | drag/hold to fold, 2 tuck motions; **bill face legible while folding** (= tracked read if it carries one) | Effort | reused for any tuck/fold/wrap/handle |
| Tack/post a notice | 1st | line up on board → **press-and-hold, 2 nail taps** | Effort | if concept Understood, the **correct-column pick is folded into the same action** (demonstration); else plain tack |
| Haul/move (cloth) | 3rd | rhythmic **press-and-hold + drag**, repeated | Effort | gross-motor → 3rd person |
| Hand off (rider) | 1st | **press-to-shove** (quick) OR **time-the-gap** press as a passer crosses | Effort | quick = risky if watchers near; gap = safe, costs a beat |
| Climb / push-through / chant (event on-ramps) | 3rd | traverse / crowd-nav + **unfailable dodge** / **hold-to-chant** | Effort | all funnel to one shared witness cinematic |
- **Effort-tier never fails** (embodiment, not a test); the decision was already made by the choice. **Graded** moves a stat/condition, telegraphed before and confirmed after (§9).
- **Accessibility equivalent** for any graded beat (a simple confirm) → "usable" result + same learning.
- **Checks on an already-Understood concept self-correct in-place (forced correction — HARD).** This covers the **same-day demonstration** (sort/flag, correct-column tack, set-the-headline, attribute-the-cause) **and any later-day reassessment** (an Archive Sync question or an in-world reassessment scene). A miss is **not deferred and not shamed**: the beat **holds in the same scene with the interaction still open** (usually 1st-person), the handler/NPC gives a **directional nudge** (never "wrong", and **never the answer** — they've already passed Understanding, so a hint that points the right way or rules out the wrong pick is enough), and the player **must fix it to leave the beat** → then the concept flips to **Demonstrated / re-passes** and the world moves on. The exact distractor just selected is removed/permanently de-emphasized; with the three-option cap, correction terminates in at most two steps. It is **not** re-entered into the reintroduction pool. This keeps these beats a guaranteed closed loop (can't exit with a wrong mental model) **and prevents an infinite loop** on a player who keeps fumbling a reassessment of something they already know. Stays positive-only (§9): a teaching nudge on the exact boundary, no stat penalty.
- **First-understanding miss gets exactly one authentic retry cycle.** The initial miss is silent + positive-only; the Director re-offers one authentic exposure and the check later (§12 reroute). If that retry also misses, the retry holds in place and uses the same directional-nudge/forced-correction pattern, then passes Understanding; it never schedules a second reroute cycle.
- Distinct from **reroute** (§12), which applies only when a demonstration/reassessment beat **never fires** (understanding not ready / beat skipped entirely) — not to an in-scene miss on an already-Understood concept.

---

## 7. Beat pacing — no stacked prompts

**Rationale:** `Day-1.md` §5 beat pacing; §2C Sync spacing.
- **After any discrete beat** (a read, a scene, a tack, a Sync), insert a **free-roam breather before the next prompt/selection surfaces.**
- **[TUNABLE] BREATHER:** ~**7 s** (feel-test 6–8) of ordinary movement, no menu. Pings remain **ambient & pickable** during it (player *may* act sooner); the game just never *shoves* the next prompt in their face.
- **Sync spacing (curriculum):** **≥ 2 interactions between any two Archive Syncs** — they may be relatively close but **never back-to-back**; the Director defers a Sync to the next natural opening if the last was too recent.
- Two UI/assessment beats in immediate succession is the thing to avoid; always put lived world-time between them.

---

## 8. Time model

**Rationale:** `Day-1.md` §4 clock (L18); §B5.5.
- **Traversal is FREE.** Ordinary walking between points costs **zero** day-time. Never pad footsteps.
- **Only *activities* spend time**, on a gradient:
  ```
  deliver-and-leave  <  short dialogue/probe  <  hands-on action (help/detour)
  (least)                (small)                  (most)
  ```
- Time is a **coarse "sun + crowd" clock**, **no numeric timer**. Spent time **accumulates → escalation curve**: watcher-heat, crowd density, character agitation all **rise toward dusk**. So the **same errand is calmer early, tenser late** (danger scales with time-of-day, not beat order).
- Time is **felt, not shown**: lengthening light, thickening crowd, watchers appearing. Routine small costs are **ambient/felt, not tagged**; a `costs time` tag is reserved for **notable** chunks (help, detour).
- **Timed objective (rider):** a **bell deadline**, not an arrival — reachable all day until the bell. Its ☼ glyph **visibly advances as time is spent** (calm sun → low amber → urgent). Miss the bell → missed delivery → reroute (§7 in `Day-1.md`).
- **Diegetic time cues are authored** where useful: e.g. a **freshly-posted broadside** that wasn't there on the way in shows the world (and clock) moved while the player worked a stop.
- **Persistent day-clock (diegetic, non-numeric) — HUD element.** A always-visible element on the Archive strip shows **how much daylight remains** at a glance: a **sun tracking an arc** (dawn → dusk) or a thin depleting daylight sliver. **NON-numeric** — no clock face, no "3:00 PM," no countdown seconds — so it preserves "felt time" while never leaving the player blind to how close dusk (the fixed event) is. **Advances only as activities spend time; traversal never moves it.** [TUNABLE] exact visual (sun-arc vs. light-bar) — feel-test which reads faster.
- **Every interaction carries an authored time-weight, and the clock animates that cost *during* the beat.** Each beat/verb has a designed duration (`timeCost`, in abstract blocks — press-pull, focus-read, help-Thomas, gamified tack, etc. each have a known budgeted weight). The day-clock **advances smoothly across the interaction proportional to that weight** — the sun visibly creeps as you work — rather than snapping a whole block at the end. This makes elapsing time *felt and diegetic* (long actions visibly eat more daylight than a quick probe) and keeps the global clock and the per-beat cost model as one source of truth. [TUNABLE] per-verb `timeCost` table (drives both the clock animation and downstream day-state escalation).
- **Archive time-warnings (polite, escalating) — proactive, tied to the clock.** As the day-clock crosses thresholds toward the event/dusk, the handler gives **supportive, escalating** heads-ups, never nagging: e.g. `calm (none early) → "Light's going." → "The square's near boiling, I'd finish up." → "You're about out of day."` [TUNABLE] thresholds. **Distinct from the idle-nudge** (§ below): idle fires on *wandering*; time-warnings fire on genuine *time-scarcity* regardless of activity. The per-task **bell glyph (☼)** on a timed objective is the local version of this; the day-clock is the global one.
- **Terminal state — the "shops closed / too late" interrupt (must-acknowledge).** When the clock runs out with errands still unfinished, the active interaction first reaches its next declared safe phase/terminal checkpoint and commits its authored complete/partial/interrupted result; then the escalation ends in a **hard interrupt**, not a silent timeout. The handler states it plainly (*"That's it. Light's gone, shops are shuttering. Whatever's not done is done."*) and the player **must acknowledge with a single confirm** before play continues. On confirm, unfinished errands **resolve as missed → reroute + relationship stakes** (their curriculum still lands via the fallback pool — the interrupt never costs learning), and the day funnels into the crowd/fixed-event phase (`Day-1.md` B10.4/B11). This is the UI face of L18's dusk hard-interrupt + L19's time-locked event.
- **Idle handling = the Archive**, never a spawned NPC: if the player wanders/burns time, the handler gives a gentle, slightly-escalating reminder (`Day-1.md` L11).

---

## 9. Feedback: cards & flickers (all non-blocking, positive-only)

**Rationale:** `Day-1.md` §4A, §5 post-commit micro-feedback.

| Feedback | Fires on | Timing | Content |
|---|---|---|---|
| **Stat card** (holographic, = People-card component) | a stat actually moved: a tagged-choice commit **or** a graded-activity outcome | **after** the outcome resolves | realized change + **cause named**, never odds (*"Abigail · respect ▼: thin pull, smudged proof"*) |
| **Unlock flicker (person)** | first meeting of a character | on contact | *"Person added: [name] · [role]"*; silhouette → card; any latent committed delta reveals now |
| **Route flicker** | a route unlocks | on unlock | *"Route unlocked: [name] · opened by [cause]"* |
| **Notes flicker** | a concept reaches **Understanding** (its **first** Archive Sync pass) | on first understanding, **once only** | *"Added to Notes: [concept]"*, the entry appearing **is** the confirmation. **Not re-fired** on the later demonstration or on reassessments (already in Notes → diegetic confirmation only). |
- **Positive-only (HARD):** never "wrong." A miss → **no flicker, nothing added, no negative callout**; the Director re-offers later through the world. Absence of the flicker is the only "not yet," and it's silent/shame-free.
- **Exposure (Learning) is silent** — no card/flicker; tracked invisibly in the backend. Only the concept's **first Understanding pass** promotes it into Notes, exactly once; demonstration and reassessment never re-add or re-notify it.
- **[TUNABLE] card/flicker duration:** ~**2–2.5 s**, auto-dismiss, screen-edge, never blocks input.
- **Pull not push:** Status/Notes are always openable on demand; only assessment moments and scripted flow beats interrupt.

---

## 10. Effect tags on choices

**Rationale:** `Day-1.md` §5 choice types.
- **Consequential option** → **tiny muted sub-label(s) under the option text** naming the *stat + direction*: `costs time` · `saves time` · `builds trust` · `strains trust` · `earns respect` · `loses respect` · `earns a favor` · `warms Abigail` · `cools Abigail` · `reads as a threat` · `reads as harmless` · `risky` · `opens the dock route` · `draws attention`, etc. 1–3 per option. Each tag names the dimension that **fits the targeted character** (Respect for Pike's craft, a favor for Thomas, political read for Clarke, trust for reliability with Abigail/the rider), never a blanket "trust."
- **Tag presence IS the signal.** Free probes / pure look-ask-skill options carry **NO** sub-label → an untagged option always reads as "safe / no strings." `risky` = an outcome draw follows (not a guaranteed fail).
- **Options: 2 min, 3 max (absolute).** A free probe is one of the ≤3 or it's cut — never a 4th appended. Every option must be **role-plausible** (runner, not lawyer) and **distinct/specific**.

---

## 11. Stat model

**Rationale:** `Day-1.md` §4A.
- **Baselines:** each stat inits **low-neutral (~30–40% internal)**, shown as a **band word, never a number** (*wary · guarded · steady · trusted*; political read diverging: *threat ◄ wary ◄ neutral ► curious ► ally*).
- **Causality (HARD):** a stat moves for exactly two visible reasons — a **tagged choice** (tag shown before, card after) or **graded performance** (stake telegraphed before, card after). No ambient drift, ever.
- **State-relative outcomes** (not flat deltas): the same act **recovers / overshoots / holds / drops** depending on current state (e.g. from a lowered band, an apology recovers to baseline, a costly fix overshoots above it).
- **Commit-at-cause, reveal-when-felt:** a delta is decided at its cause but **surfaces only when observable in-fiction** (usually when the affected character is met/reacts). **Contingent** — if the reveal never happens (character never met), the delta is **lost, not deferred**.
- **Per-character dimensions (Day 1):** most = one; anchor **Abigail = Trust + Respect + Warmth**. (`Day-1.md` §4A.)

---

## 12. Curriculum guarantees the UX must respect

**Rationale:** `Day-1.md` §2C/§2D, Day-Template L2/L3/L20.
- **Payload is fixed & path-invariant:** per concept **3 tracked exposures → 1 understanding Sync → 1 day-of demonstration (a game action, not a Sync)**. Day 1: **12 tracked + 3 Syncs**.
- **Reroute (HARD):** a missed *exposure* or an **unfired** demonstration **reroutes** to another beat (demonstrations → next applied opportunity, **B12 catch-all**). Skipping a tracked read (broadside fly-by) or avoiding an encounter (curt Clarke, no conceal) just **shifts the delivery**, never drops the curriculum. Stakes still land (relationships/world). **Note the split:** reroute is for a demonstration that *never fires*; a demonstration that *does* fire but is answered wrong is **not** rerouted — it self-corrects in-place (forced correction, §6).
- **Reroute is TYPE-AWARE (state to track):** per concept, store `{ occasions:int, types:set<scene|convo|article|hands_on> }`. The L2 gate is `occasions ≥ 3 AND |types| ≥ 2`. On shortfall, the Director fires a fallback that **fills the missing *type*** (not just count). Maintain a **typed fallback pool** anchored on unavoidable beats (guaranteed delivery/handling = hands-on, fixed event = scene, day-close = convo, Director-placeable posted read = article). Design & test the **fully-avoidant path**: a player who only reads, only talks, or skips reads must still reach 3 occasions / ≥2 types. Spread is best-effort (degrades to a denser back-half); the guarantee is absolute. (`Day-1.md` §7A.)
- **Choice-gating:** a concept only appears as a demonstrable option **after** it's Understood; else the option is withheld (headline drops to 2) until the Director reroutes the missing occasion.

---

## 13. Changelog
- v0.2 — **playtest-3 additions.** §1: **gold-marker redirect** (§1.2a). §2: **all-day ambient chatter** with speech glyph, never tracked (§2.1). §6: **forced in-place correction** for already-Understood misses with a **directional nudge, not the answer** (demonstration or reassessment), plus the first-understanding exception. §8: **persistent diegetic day-clock** (non-numeric daylight meter), **clock advances during a beat by its `timeCost`**, **escalating time-warnings**, and the **must-acknowledge "shops closing" interrupt.** §9: **Notes flicker fires once at first Understanding only** (no re-notify on demonstration/reassessment). §10/§11: effect-tag vocab expanded (`loses respect`, `earns a favor`, `cools Abigail`) and tied to the **dimension that fits each character** (Respect/Obligation/Political read/Trust), never blanket trust. (Diegetic-voice + no-em-dash + frame-the-ask + discriminate-on-concept live in `Day-1.md` §5 / Day-Template.)
- v0.1 — created from the Day-1 playtest to consolidate every micro-decision into codeable rules + tunable params: marker/strip state machines, glyph grammar, **tracked-read gate (interact→1st person→read)**, **Clarke adjacency-challenge trigger (either side)**, camera grammar, **gamified-execution input table**, **beat-pacing breather (~7s) + ≥2-interaction Sync spacing**, **time model (traversal free, activities cost)**, feedback cards/flickers (positive-only), effect tags, stat model, and the curriculum guarantees the UX must respect.
