# Boston Chapter — Gameplay & Engagement Design

**Status: design authority for the gameplay / engagement layer.** This doc owns the *game built around* the learning core: chapter structure, skill, stealth, runs, side-jobs, the reactive world, the two-tier concept ledger, and the checkpoint / debrief assessment cadence.

It is **subordinate** to:
- `PRODUCT-REQUIREMENTS.md` — product guarantees (path-invariance, determinism, accessibility, privacy). Nothing here may override a product principle or FR.
- `Interaction-Spec.md` — interaction & UX micro-rules (markers, glyphs, tracked-read grammar, camera, time model, feedback).
- `World-Design-Bible.md` — look, layout, atmosphere, traversal, multi-era reuse.
- The behavioral fixtures (`Day-1.md`, reframed as **Act 1** — see §15).

When those docs define behavior, this doc bends to them. This doc owns *how the game feels to play* in the spaces they leave open.

---

## 0. Why this doc exists

A full run of the validated slice is ~5 minutes. The target Mission experience is a real, fun game measured in the tens of minutes. The **learning core is solved and validated** — the required carriers, tracked exposures, Syncs, demonstrations, reroutes, and fallbacks all land on every legal path. So the job now is not to protect a tight learning budget; it is to **build a genuinely good game around a learning core that already works.**

The organizing model has four layers:

| Layer | Delivery | Clock | Tracked? |
|---|---|---|---|
| **Passive learning** | the living world: ambient chatter, signage, atmosphere, world-state changing over time | free | never (support only) |
| **Active learning** | dialogue, tracked reads (papers/objects), the fixed-event cinematic | costs time | yes — the carriers |
| **Assessment** | Archive Syncs (formative) + in-world demonstrations + checkpoint debriefs (formal) | costs time | the gate |
| **Gameplay / fun** | traversal, occupational skill, stealth, runs, side-jobs, flavor | mostly free | never |

Gameplay is the fourth layer that *wraps* the other three. It is not a competitor for learning time; it is the connective tissue that makes moving between learning beats feel like play, and it is the primary delivery vehicle for passive learning.

**North star:** *I am doing a real job in a tense, living Boston, with genuine skill and stakes, while history changes around me.* Fun first, with learning woven through — never a lesson wrapped in 3D.

---

## 1. Structure: the continuous Boston Chapter

Boston is **one continuous chapter in four Acts**, not a series of separate "days." Player-facing framing drops all school-schedule language ("Day 1/2/3"). The four Acts are the historical episodes of Boston on the brink:

| Act | Year | Historical episode | District re-dress (Bible §3A) |
|---|---|---|---|
| **Act 1** | 1765 | The Stamp Act crisis | packed street, Liberty Tree pocket, print shop |
| **Act 2** | 1770 | The Boston Massacre | Town House square + Custom House steps; now with soldiers |
| **Act 3** | 1773 | The Tea Party | church meeting → torchlit walk → wharf brig |
| **Act 4** | 1774 | The Port Act / occupation | dead port, manned gates, subdued/occupied street |

### 1.1 Checkpoints = the Archive year-transitions

The Acts are years apart (1765 → 1770 → 1773 → 1774). That is real history and the player-as-time-traveler premise turns the gaps into the structure itself: **each checkpoint is an Archive re-insertion into a later year.** There are exactly **five**:

```
[CP0: intake] → ACT 1 → [CP1: re-insert 1770] → ACT 2 → [CP2: re-insert 1773]
   → ACT 3 → [CP3: re-insert 1774] → ACT 4 → [CP4: chapter finale]
```

Each checkpoint is a full-screen Archive interstitial that does four jobs:

1. **Atomic commit** — world, learner, replay, save, transaction journal, and sync outbox commit together (FR-9). A committed consequence never rerolls after resume.
2. **Debrief** — a few authored, TEKS-tagged STAAR-style questions (§4), including **spaced retrieval** of earlier Acts. Framed as the Archive checking your field knowledge, never a graded pop quiz.
3. **Re-insertion** — sets the new date, re-dresses the world, and re-briefs in-fiction (the handler, not a "Level 2" card).
4. **Carryover** — Abigail's relationship, your standing with the resistance network, whether a Loyalist marked you, routes/favors, and completed learning state all carry forward.

- **CP0** is the intake (the existing Act 1 B0). No debrief (nothing to retrieve yet); just identity, context, first insertion.
- **CP1–CP3** are the between-Act transitions: commit + debrief + re-insertion.
- **CP4** is the **chapter finale** — the big STAAR-style Mission Debrief (FR-11) plus Abigail's whole-arc relationship payoff.

### 1.2 Narrative checkpoints vs. invisible autosave (both, always)

The five checkpoints are the **narrative / commit / debrief** beats. They are **not** the only saves. Invisible autosave continues *within* each Act at mechanic phases, committed outcomes, and event boundaries (FR-9; principle 8 "saving is automatic and invisible"), so a student who loses power mid-Act resumes near where they were. The meaningful, player-legible progression beats are the five Archive transitions; crash-resilience is continuous underneath. Never trade one for the other.

---

## 2. Core laws (load-bearing — every feature obeys these)

**L-A. The two-budget model.** Traversal is free on the day-clock; only *activities* spend it (Interaction-Spec §8). This gives two independent budgets:
- **Free budget** — movement, parkour, flavor touches, eavesdropping. Costs zero day-time. Pile fun here without limit; it never competes with errands or Syncs.
- **Activity budget** — press work, help-a-favor, tracked reads, tacking a notice. This is where learning lives.

**L-B. Fun rides the free clock; every costed activity carries learning.** Fun that touches the activity clock must *also* carry learning (embedded in the doing) or be a deliberate, tagged opportunity-cost gamble the player chose. Follow this and gameplay can never eat learning time.

**L-C. The DO → LEARN → PROVE loop.** Each errand is a mini-arc: a **run** (fun, free, passive learning) → arrive → **occupational skill** (fun, costed, embedded learning) → **dialogue / paper** (active learning) → **Sync / demonstration** (assessment) → ~7s breather → next run. Chain these; alternate high-energy runs with quieter learning-dense stops.

**L-D. Real skill, real difficulty, real consequences — bounded.** The game has genuine skill expression and genuine stakes. Messing up costs something you feel and carry forward. Bounded by four hard limits:
- **Fair floor.** Any ordinary, context-suited action has ≥0.70 combined chance of success or useful partial success (FR-3). High-risk plays are clearly signaled and are the player's choice.
- **Never gates learning.** Skill and failure move relationships, world state, routes, object condition, and your record — **never** the required curriculum (principle 7; learning is skill-independent).
- **Never a dead-end.** Every terminal outcome has an authored continuation; a failure reroutes the learning and funnels forward (FR-4). No lose-states, no soft-locks.
- **Always an accessible equivalent.** Every graded mechanic has a preapproved accessibility-equivalent that yields a "usable" result and the same learning (FR-10).
- Failures **persist and are legible** — never silently restored, always cause-named, and carried across Acts (FR-4). Difficulty is challenge, not coin-flip punishment.

**L-E. Guided spine + rich optional layer.** The required learning runs on a **guided spine** (the anchor's job — order-free errands that carry the required carriers). Everything else — side-jobs, flavor, deep exploration, micro-concepts — is an **optional layer** that is always safe to skip. The spine guarantees the curriculum; the layer supplies the fun and the fuller history.

**L-F. Authored, approved, deterministic.** The runtime *selects* approved content; it never *generates* player-facing semantic content (principle 3, FR-8). Same package + seed + state ⇒ same selection and outcome. Every interactable, quest, skill outcome, and question is authored and review-gated.

**L-G. The non-goals hold.** No XP, skill trees, collectibles, inventory grind, morality meters, or endless-engagement loops (PRD §17). Fun comes from *doing believable things well in a believable world* and from *meaningful choice* — never from extrinsic point loops. The press-pull model (mastery expressed as relationship + craft quality, never a score) is the template.

---

## 3. The two-tier concept ledger

Learning is tracked in two tiers. Tier 1 is the sacred, invariant core; Tier 2 is additive enrichment.

| | **Tier 1 — Required (macro)** | **Tier 2 — Micro-concepts (enrichment)** |
|---|---|---|
| Examples (Act 1) | debt → revenue; Stamp = internal tax on paper; no taxation without representation | who Andrew Oliver was; non-importation; writs of assistance; the Loyal Nine; Boston as a port town; hard coin vs. paper; the town crier's role |
| Guarantee | **path-invariant, MUST be learned**; gated; ≥3 occasions / ≥2 types; Sync + demonstration | **additive** — learned by engaging; skipping never breaks the Act |
| Delivered by | the guided spine (dialogue, papers, fixed event) | the living world: side-jobs, signage, objects, NPC lines, flavor |
| Tested | in-Act Syncs + demonstrations (existing) | sampled at checkpoint debriefs, **only for what the player engaged** |

**Micro is credited only via a tracked interaction — never proximity or earshot.** Ambient chatter and wall posters *seed* micro-concepts in the air (untracked gravy, Interaction-Spec §2.1 / §3), but a micro-concept only **logs** when the player performs a real tracked interaction: opens a focus-read, finishes an optional encounter, handles a tagged object. This preserves FR-6 (movement / free-roam / earshot never count as learning evidence) while making the reactive world (§8) the delivery engine for Tier 2.

**Curated, not sprawling (locked decision).** The Boston micro set is a **curated dozen-ish per Act**, well-covered and well-tested, with authored STAAR items ready — not 20-30 loosely-seeded facts. Quality of coverage over breadth. The **Act 1 micro list** (14 curated concepts, each mapped to its macro, its tracked delivery surface, and a draft TEKS tag) is authored in **`Micro-Concepts.md`**.

**The same curation law governs *activities*.** The mechanics, activity families, occupant model, and feel-levers (`Activity-Expansion.md`, `Activity-Feel.md`) are a **reusable template library** for the whole game — each Act/Chapter/Season builds a **curated subset** that fits its era and concepts, introducing 1-2 new applications and evolving returning ones via World Turns. Don't cram the whole library into any one Act; spread it wisely (see `Activity-Expansion.md` §0 for the Act-1 curated set and the cross-Act/Chapter/Season distribution rules).

---

## 4. Assessment: the STAAR bank + checkpoint debriefs

**An authored, TEKS-tagged, approved, versioned question bank.** Real STAAR-format items, hand-authored, each tagged to concept(s) — macro and micro. The runtime **selects** deterministically; it never writes a question (FR-8, principle 3). This is a content-authoring investment, sized to cover the whole Boston chapter.

Two distinct surfaces, and the split is a hard rule:

- **Formative, in-Act (the Archive).** The existing Syncs + demonstrations for the required macro concepts. Positive-only, light, spaced (never a quiz block; median Sync ≤20s — Archive pacing gate). **Micro-concepts get no constant in-Act quizzing** — that would blow the pacing gate.
- **Formal, at checkpoints (debriefs) + CP4 (chapter finale).** This is where real STAAR-style questions live (FR-11's home). Each between-Act checkpoint runs a short **field debrief**: a handful of authored questions spanning the required macro concepts *and* the micro concepts the student **actually engaged with**, plus **spaced retrieval** of earlier Acts. CP4 is the full chapter-level assessment.

**Fairness rule (hard).**
- Required **macro** is always tested (guaranteed exposure).
- **Micro** questions are asked only for concepts the student was actually exposed to, and are framed as enrichment / bonus — never pass/fail gates. A kid who explored deeply gets a richer debrief; a kid who ran the spine still passes on the guaranteed core. Nobody is tested on something the world never showed them.

**Guardrails (hard).**
- **Not an official STAAR score / predictor** (PRD §17, FR-11). Debriefs report understanding, never a grade or percentage.
- **The formal record stays route-independent** (FR-11): the *formal* assessment forms don't vary by replay route or learner-state labels. The in-Act formative layer may adapt to what the player did; the official record may not.
- **Telemetry** tracks concept exposure/understanding *states*, never raw answers or inferred mastery labels (§13 analytics).

---

## 4A. Boston as a living place — the world systems

The district is one compact, continuous space (Bible §3). Four systems make it feel alive and, crucially, make *when* you do something matter as much as *what* — which is what makes order-freedom real instead of cosmetic.

### 4A.1 Zones

Each zone carries its own audio bed, population density, watcher pressure, and run flavor.

| Zone | Feel | Watchers (Act 1) | Stealth role |
|---|---|---|---|
| **Wharf** (west) | working port, gulls, hoist | customs (goods focus) | dock route; heavy-haul runs; roof vantage |
| **West street / market** | busy, stalls, chatter | light; informers | crowd-blend; eavesdrop hub |
| **Mid street** (heart, Mercer's) | densest, notice board | patrol passes | main artery, most exposed |
| **Civic square / Custom House** | official, open, watched | stationary posts | chokepoint; spot-checks |
| **Church** (east) | quieter, bell | sparse | interior refuge |
| **East gate + elm pocket** | edge of town, effigy | gate watch | rider stop; the fixed event |
| **Alleys** (both rows) | gloomy, cluttered | none (unseen) | parkour route; the "unwatched" path |
| **Interiors** | candlelit refuge | none | **partial safe zones** — break line of sight, bleed heat; a spot-check/pursuer can still follow you in |

### 4A.2 The escalation curve (the clock is the difficulty dial)

Everything scales on the coarse sun+crowd clock (Interaction-Spec §8), on the *time-of-day*, never on beat order:

- **Morning:** thin street, few watchers, calm. An early run is easy.
- **Midday:** busy, market full, patrols active; crowd thick (cover *and* obstacle).
- **Afternoon:** tension rising, watchers more alert, agitators gathering.
- **Dusk:** crowd surges toward the elm, watchers everywhere, the fixed event fires.

So the *same* contraband run is a calm stroll at dawn and a white-knuckle thread at dusk. Watcher count, cone width, crowd density, and NPC agitation are all functions of the clock (which advances only on activities, never traversal — L-A).

### 4A.3 The crowd (obstacle *and* tool)

Ambient population walks authored paths; density scales by zone and clock. Dual-use: the crowd **blocks watcher sightlines** (blend in to hide) but also **slows you** (crowd-thread runs). Toward dusk it becomes the gathering mob funneling to the elm — the on-ramp to the fixed event.

### 4A.4 World-changes-over-time (observation as reward)

The town visibly tenses across the Act/chapter: fresh broadsides appear, the effigy gets built at the elm, shutters close, watchers multiply. Noticing it is quiet gameplay and it teaches "this was organized and building," which is the fixed event's whole point. It also doubles as the diegetic time-legibility cue (the freshly-posted broadside pattern).

---

## 5. Pillar 1 — Route mastery & the traversal spine

The richest fun already owned, and 100% free on the day-clock. The three physically distinct routes (main street / north-alley parkour / earned dock route) plus the authored traversal markers (vaults, ducks, squeezes, roof vantages, balance beam, puddle hops in `apps/web/src/world/traversalMarkers.ts`) are the backbone.

- **Route choice is skill + knowledge expression, not a corridor swap.** Each route has a distinct feel and payoff: the alley is faster-but-technical (chain clean vaults/ducks), the main street is exposed (watchers — §7), the dock is safe-but-earned (Thomas's favor). Mastering the town's geometry is the fun.
- **Passive learning falls out for free.** Each route runs past different signage, arguments, and world detail. Roofs reveal the effigy being built at the elm; the street carries the boycott argument. Same free clock, different exposure.
- **Cheap to extend** (author-only): more markers, existing clips. New *physical* traversal props follow the asset pipeline (Bible §10–12; imported-visible-world law).

Route mastery and stealth (§7) are the same system: the routes *are* the stealth tools.

---

## 6. Pillar 2 — Compound-the-verb occupational skill

The problem with the current skill beats (e.g. the ~1-second press pull) is that a single timing-commit has no depth. The fix is to **compound the verb**: turn one input into a short *chain* of distinct micro-skills with a composite outcome and a real mastery ceiling.

**Worked example — running a print job (replaces the single press pull):**

1. **Ink the forme** — beat the ink balls across the type in a rhythm. Even coverage = clean; too light = faint; too heavy = blotchy. *(rhythm skill)*
2. **Register the sheet** — lay the damp paper on the points and line it up. Off = crooked print. *(precision skill)*
3. **Pull the bar** — the existing timing/pressure beat, now the *climax* of the sequence, not the whole thing. *(timing skill)*
4. **Peel & read** — lift the sheet, see the composite result.

One job is now ~20-30 seconds of varied, engaged doing; quality is **earned across three skills**, not one lucky frame; and it is historically authentic (this is *why* printing was skilled labor and *why* the Stamp Act hitting printers mattered — passive learning embedded in the mechanic).

**General principles:**
- **Every meaningful activity = a chain of 2-4 distinct micro-skills → one composite outcome.** Hauling for Thomas: load → balance the cart → thread it out. Tacking a notice is more than one tap.
- **Visible mastery ceiling.** Feedback reports *how* well, not just pass/fail. The gap between the accessible floor ("usable," always passes) and the expert ceiling ("crisp") is the fun.
- **Outcomes persist and echo** (L-D). A crisp broadsheet is legible on walls around town; the smudged one is the one Clarke sneers at; Pike's whole demeanor shifts. Craft quality ripples through the rest of the Act and into later Acts.
- **Consequences, bounded.** Skill moves relationship + object condition + world flavor only — never the carrier, never a gate, always an accessible floor (existing press-pull rule, generalized).

---

## 7. Pillar 3 — The watched town (the stealth system)

**Stealth = getting resistance material across a watched town without being caught with it.** Non-violent (no combat — PRD §17); the fun is tension, timing, route-planning, and — when it goes wrong — a skill-based escape. It is the chapter's **signature verb**, it teaches the era's social texture (enforcement, suspicion, how resistance actually moved), and it is **build-once, re-dress four times.**

### 7.1 Watchers

Two kinds, both with **authored, predictable behavior** (a puzzle to read, never a random gotcha):
- **Posted watchers** — stationary at chokepoints (Custom House steps, town gate, square), slowly sweeping a **vision cone** (forward arc: angle + range) on a loop.
- **Patrol watchers** — walk fixed waypoint loops; cone faces their travel direction.

Line of sight is **blocked** by buildings, carts, barrels, the well, and crowds. Per-Act reskin (historically correct): Act 1 (1765) = constables + customs officers + Loyalist informers, **no troops**; Act 2 (1770) adds **soldiers**; Act 4 (1774) = full occupation with manned gate checkpoints.

### 7.2 Detection — graduated suspicion (LOCKED: suspicion + LOS/gap)

Not binary instant-catch. Each watcher accrues **local suspicion** while you're a problem in their cone, as a **deterministic function** of readable inputs:

`suspicion ↑ with:` centrality in the cone · closeness · contraband **exposed** · sprinting/ducking right in front of them · high global heat · **low Standing** (§8) · open ground (no cover)
`suspicion ↓ / decays with:` breaking line of sight · concealed goods · walking calmly · crowd/cover · distance · **high Standing** (§8, social camouflage)

- A brief clip through a cone edge is fine; **lingering exposed in the center gets you challenged.**
- Rising suspicion has a **diegetic tell** (the watcher turns, pauses, a subtle glyph) so it is telegraphed and fair — duck away and it decays. "Reasonable that he won't catch you *if you play well*."
- Fills fully → the watcher **challenges** you → the confrontation branch (7.5).
- Determinism: suspicion is a function of tracked state + attempt seed; no live RNG (FR-8). Not rigged, not random.

### 7.3 Concealment

Contraband states: **exposed → wrapped → hidden.** Wrapping is the existing fold-the-wrap mini-game — proactive, costs a beat. Concealed goods make a passing glance harmless (large suspicion reduction), but a **close spot-check** at a chokepoint can still find them on a seeded, telegraphed draw. Trade: wrapping costs time and you may want speed.

### 7.4 Heat (persistent, town-wide, cross-Act)

Global standing as a band word (never a number, per the stat model): **calm → noticed → watched → hunted.**
- **Rises:** being challenged, getting caught, sprinting past watchers, risky route picks, an informer's tip (Clarke).
- **Falls:** time, distance, blending (crowd/indoors), a clean calm stretch.
- **High heat bites:** wider/faster cones, more spot-checks, some routes gated, more pursuers in a chase.
- **Carries across Acts:** a marked face in 1765 → soldiers already know you in 1770 (existing `clarkeInformed` / watcher-heat carryover).

### 7.5 The confrontation branch

A challenge ("Hold. What's in the bag?") gives three options (the cap):

1. **Comply** — open the bag. Concealed → likely passes (seeded draw); exposed → confiscated + heat.
2. **Talk your way out** — social draw, harder if you're already known.
3. **Run** — `risky · draws attention` → the escape sequence (7.6). Always offered; heat/zone set its difficulty, not whether it appears (LOCKED).

### 7.6 The escape sequence + stamina (3rd person, active, skill-based)

The scariest moment becomes the most skill-expressive, and it plugs directly into the traversal/route layer (Pillar 1).

**Goal — shake the pursuer:** break his line of sight and keep a gap open for a sustained beat (~4-6s), **or** reach a "lose them" refuge (dive into a thick crowd, round enough alley corners, slam an interior door). The whole town is the chase playground: sprint, vault crates/carts/barrels, duck laundry lines, cut alleys, break to the roofs. **Route knowledge pays off** — the explorer knows the shortcuts.

**Stamina bar (the skill gate).** Appears only for effort sequences (chases, the timed rider dash) — never general free-roam, so exploration stays relaxed (LOCKED scope):

| Action | Stamina |
|---|---|
| Sprint | steady drain |
| Vault / climb | a chunk per action |
| Jog / walk / stop | regenerates |

Empty → you drop to a jog and vaults fumble (slow) → the pursuer closes. You can't hold Shift and win. The skill is **pacing**: burst to open a gap, spend a vault to cut a corner and put an obstacle behind you, break LOS, catch your breath.

**The pursuer (fair, deterministic).** Authored speed a hair slower than a *fresh* sprint: distance opens when you're fresh, closes when you're gassed or in open ground. Predictable path-follower — delayed by obstacles you put behind you (a vaulted cart, a slammed door), lost around corners and in crowds. Higher heat = faster and/or more pursuers. The outcome is the sim + your inputs + attempt seed, never a hidden roll.

**Outcomes:**
- **Shake him (success):** keep the goods and the errand; heat spikes toward **hunted**; he's seen your face (carryover). An earned "I got away."
- **Caught** (stamina gone + gap closed, or you dead-end yourself): a short in-world **chewed-out scene** (the inspector reads you off / hauls you in), contraband **confiscated** if that's what you carried, then **released outside his office with the day visibly later** — the clock has jumped forward, so the escalation curve advances (downstream stops tenser, a timed window may now be blown) and heat is up. Never a dead-end: you continue to the fixed event; learning reroutes. The lost time + blown window *are* the real world-state cost. The "released outside, day later" beat also cleanly handles the scene transition and reads as the time-legibility cue.

### 7.7 The toolkit (how you beat it — the fun)

Routes (roofs/dock/alley = unseen) · **blend** into a crowd or step indoors (partial safe zones bleed heat) · **cover** behind carts/barrels/walls · **timing** patrol gaps + sweep cycles · **pace** (walk = quiet, sprint = fast but fills cones + drains stamina) · **conceal** the goods · **misdirection** (LOCKED in): a light "cause a commotion" verb — ring the bell, spook the gulls, knock a barrel — briefly pulls a watcher's attention off your line. Teaches misdirection; reuses existing flavor interactables.

### 7.8 The run taxonomy (so volume ≠ repetition)

Every errand is a *run* with its own obstacle character; no two feel the same:

| Run type | The DOING | Passive learning it carries |
|---|---|---|
| **Timed** (rider) | beat the bell, read the sun; stamina in the dash | how news moved town-to-town |
| **Stealth** (contraband) | patrols, concealment, sightlines, maybe a chase | writs of assistance, the enforcement net |
| **Heavy-haul** | a bulky load blocks the tight alley → forces the exposed route | the working port economy |
| **Crowd-thread** | push/weave through a thickening square | organized (not random) resistance |
| **Environmental** | a tipped cart / flooded gutter / closed lane mid-route | the physical texture of the town |

**Dynamic obstacles** independent of errands (a tipped cart blocks a lane, a spot-check appears on the main drag, a crowd surge shuts the square) make traversal a *live* space. All obstacle/navigation gameplay is free-clock; the destinations carry the learning.

### 7.9 Accessibility & multi-Act reuse

Every stealth run and chase has a preapproved **assist equivalent** (slower cones/pursuer, louder tells, auto-managed stamina, or a confirm-to-resolve yielding the same bounded outcome + identical learning; full keyboard path) — FR-10. **Reuse:** 1770 dodging soldiers, 1773 moving tea to the wharf under watch, 1774 slipping past an occupied port. Build the patrol / sightline / suspicion / heat / chase / stamina system once for Act 1.

---

## 8. Pillar 4 — The reactive world, the named cast & your own card

Two things drive the reactive layer: a **lean named cast that's alive and mobile**, and **the player's own reputation card** that the wider crowd builds. Because interaction is a deliberate action (in-range → interact → dialogue / focus-read), **interacting *is* the tracking** (FR-6: proximity and earshot never count).

**The load-bearing safety rule (HARD): interactables carry MICRO concepts only — never a required macro carrier.** The three required (Tier 1) concepts live exclusively on the guided authored spine (§3). Every ad-hoc NPC chat, poster, and object delivers only **Tier 2 micro** learning. This is *why* the reactive world can be dense at zero risk: no matter what a student engages or ignores, the path-invariant macro guarantee is untouched and the reactive layer stays optional / non-carrier.

**The named cast stays the existing five — Abigail, Thomas, Pike, Clarke, the rider. No more.** (Keeps status meaningful, asset cost low, and a 13-year-old free of social bookkeeping.) The change: they are **out and about in the world**, not frozen at their errand location — you can run into Thomas at the market, pass Clarke on the street, catch the rider prepping at the gate. So each character's status takes **multiple inputs across the day**: every ad-hoc interaction is a small tracked micro + a relationship nudge, while their big scripted beat stays the tentpole. Their standing with you can **help or hurt the day** and feeds the stealth layer — tip you to a patrol, lend cover, vouch (bleed heat), open a shortcut, or inform / refuse / raise suspicion (§7). Boston's habit of everyone reading everyone's loyalties (the **Political read** dimension) becomes a live mechanic.

**The wider crowd is unnamed** (re-tinted archetype rigs — Bible §9). A meaningful subset is **interactable**: they give exposition, can log a **micro-concept** (a deliberate knowledge exchange / read), and — the new part — **they build YOUR card.** They get no per-NPC card of their own; your interactions with the town accrue onto your Standing.

**Your own card — Standing (social camouflage).** The player has a reputation stat: how the town-at-large reads you, built by your unnamed-crowd interactions (help a goodwife, chat a dockhand, take up the crier's call → you read as a familiar, unremarkable local). Shown as a band on a player-facing card, never a number. It is a **reputation / camouflage** stat, **not** a morality meter (PRD §17). **Standing feeds the stealth system directly:** high Standing ⇒ you pass as an ordinary face, so suspicion accrues slower and spot-checks are rarer; low / marked Standing ⇒ watchers are twitchy, suspicion faster, more checks. Being a known, liked, ordinary runner *is itself a stealth tool* — the social counterpart to concealment and routes.
- **Standing vs. heat (§7.4):** Standing is your persistent, town-wide social baseline (built slowly); **heat** is acute authority attention (spikes from stealth failures, decays fast). Standing shifts the suspicion / heat curve; heat is the moment-to-moment state. Both bounded per L-D — they move suspicion, tips, and access, never learning, never a dead-end.
- **Standing is built only by tracked unnamed-crowd interactions and side-jobs.** Archive Syncs and checkpoint debriefs apply **no Standing bonus or ding (not implemented — by design)**: assessment never raises or lowers Standing, and getting an answer right or wrong has no reputation consequence (state landed in `FieldDurableState`, separate from the learner/assessment path).

**Interactable tiers** (a *lot* interactable, never *all*; no-prompt-stack / self-driven rules hold — Interaction-Spec §5, §7):
- **Flavor** (bell, pump, gulls, dog, bench): pure play; may seed micro in the air; no card.
- **Knowledge** (posters, signage, objects): focus-interact ⇒ micro (§3).
- **Named cast** (the 5, mobile): ad-hoc micro + exposition + a multi-input relationship that helps / hurts the day (§7).
- **Thread figures** (≤3 per chapter): quest-bearing recurring people on **cross-Act arcs** — a *lighter* category than the named cast (re-tinted archetype rig + 1 lite scalar + a few flags, no 4-axis bookkeeping). This is the deliberate, bounded expansion that enables Elden-Ring-style questlines without ballooning the cast.
- **Unnamed crowd** (interactable subset): exposition + optional micro + **builds your Standing** → feeds suspicion.

Everything authored, approved, deterministic, and versioned (L-F).

**The full "stuff to do" layer — NPC interactions, side-jobs, Challenges, and the cross-Act Threads — is designed in `Quests-and-NPCs.md`** (the interaction-verb palette, the ER-translated quest taxonomy, the persistent NPC arcs that change across the years, and the concrete Act 1 content). It is the optional world wrapped around the forced learning spine.

---

## 9. Pillar 5 — The side-jobs layer

NPC-given mini-quests nested under the anchor's main job, with one hard guardrail:

> **Side-jobs are optional, additive, and never carry a required carrier.** Skipping them can't break the curriculum (path-invariance holds), so they're free to be pure engagement.

They pay out instead in: relationships / warmth (→ later-Act payoffs like the warmth-gated branch), route/shortcut unlocks (the Thomas dock favor is exactly this pattern), **bonus passive/micro learning** texture, and social density. Act 1 examples:
- Thomas: "run this note to the tavern about the boycott meeting" (non-importation texture).
- A dockhand: "get this barrel up the ramp before the tide" (heavy-haul mini-game).
- A goodwife: "my boy's on the roof again, shoo him down" (pure traversal fun).
- The town crier: take up his cry for a stretch (flavor + spreads news = passive learning).

They obey the two-budget law (free-clock, or clearly tagged opportunity-cost like help-Thomas). Discoverable via an interaction glyph, never forced, always safe to walk past. **Cost to accept:** every side-job is authored, approved, versioned, and validated across all legal paths — but because they're optional and non-carrier, no quantity of them can break the Tier-1 guarantee or required-path validation.

---

## 10. Pillar 6 — Ambient-over-gameplay (talk while you do)

**Ambient period chatter plays over free-clock and skill activities**, ducking under any *active* tracked dialogue / Sync (existing rule). You vault alley crates while two agitators argue the stamp below; you ink the press while Abigail mutters about paper prices. Every gamey minute becomes a passive-learning surface, so "the fun" and "the learning" happen at once. Ambient lines are never tracked (can't be relied on) and cost nothing to ignore. Cheap, always-on, reusable across all four Acts.

---

## 11. Pacing & the Act rhythm

Each Act targets the fuller ~25-30 minute range (PRD §7.1). The DO → LEARN → PROVE loop (L-C) is the anti-sprawl structure:

- Alternate **high-energy** beats (runs, parkour, stealth, dynamic obstacles) with **quieter learning-dense** stops (the clerk, the Custom House). Intensity breathes.
- Insert the ~7s free-roam **breather** after any discrete beat before the next prompt (Interaction-Spec §7); never stack two UI/assessment beats.
- Keep **≥2 interactions between any two Syncs** (existing spacing rule).
- The checkpoint debrief lands at the Act boundary (the Archive re-insertion), not mid-flow.

More DOING actively *helps* pass the gameplay and passive-watch gates (PRD §12) rather than threatening them — the expansion is on-spec.

---

## 11A. Act 1 flow — the build blueprint (segment map)

The validated learning spine (B0–B13 in the behavioral fixture) is **unchanged**; the gameplay layer wraps it. Every new minute is gameplay + passive learning; the required carriers, Syncs, and demonstrations land exactly where they do today. The **per-beat build script** (with explicit animation, input, skill, and code hooks) lives in `Day-1-Build-Script.md`; this is the mid-level map of where everything sits.

| Seg | Name | ~min | Primary systems | Learning that lands (spine) |
|---|---|---|---|---|
| **0** | **CP0 intake** (Archive) | 1 | overlay | **①-exp1** (`RCC.DEBT_POLICY_INTRO`) |
| **1** | **Mercer's Press** — meet Abigail, run a print job | 4-5 | compound-verb skill; reactive shop; free-roam exit | **②-exp1** (B3 compare; `RCC.STAMP_INTERNAL_INTRO` banked) |
| **2** | **Into the street** — the town opens | 1-2 | living world; pick-one-focus; eavesdrop; Standing seeds | **②-exp2** (B4.5 notice-board) |
| **3** | **The four runs** (order-free) | 12-15 | runs, stealth (×2), skill, reactive cast, side-jobs, heat/Standing | **③-exp1/2/3, ②-exp3, ①-exp2/3; Sync 1/2/3; ② & ① demonstrations** |
| **4** | **Dusk & the fixed event** | 3-4 | crowd, on-ramps (climb/push/chant), cinematic | `RCC.ORGANIZED_RESISTANCE_EVENT`; B10.5 synthesis |
| **5** | **Return & headline** | 3 | evidence desk (deficit only), compound-verb final pull | **③ demonstration + ①/② synthesis** (`RCC.REPRESENTATION_CAUSE`) |
| **6** | **CP1** — re-insertion to 1770 | 2 | Archive commit + first checkpoint debrief | STAAR-style debrief (macro + engaged micro) |

### Segment 3 — the four runs (order-free; two carry stealth/chase)

| Run | Type | Stealth/chase? | Spine beats | Learning |
|---|---|---|---|---|
| **Rider's handbills** | Timed + **Stealth** | **yes** (contraband; Clarke; chase-eligible) | B7 conceal, B8 route, B9 caught/chase, B10 handoff | **③-exp3 → Sync 2** |
| **Custom House notice** | Chokepoint + **Stealth** | **yes** (watched zone; spot-check → chase-eligible) | B7.5 read + post | **①-exp3 → Sync 3 → ① demo** |
| **Pike's proof** | Standard + skill payoff | no (heat-dependent tension) | B6 deliver, B6.5 sort | **②-exp3 + ①-exp2 → Sync 1 → ② demo** |
| **Thomas's circular** | Heavy-haul (if helped) | no | B5 haul/talk | **③-exp2**; unlocks dock route |

After the **first** completed run, **B5.5 broadside → ③-exp1** posts at that stop's exit. The rider carries the bell/timed glyph. Danger scales with the clock (§4A.2), so a late stealth run is far tenser than an early one.

### The reactive layer running under Segment 3 (optional, non-carrier)

- **The five named characters are mobile** and interactable ad hoc all day; each ad-hoc touch is a small micro + relationship input (status takes multiple inputs — §8). Their standing can tip/cover/vouch or inform/refuse (feeds stealth).
- **3-4 authored side-jobs** (tavern note, dockhand haul, roof-kid, town crier) — optional, non-carrier (§9).
- **Interactable unnamed crowd + posters/objects** → exposition + optional micro; unnamed interactions build **Standing** → modifies suspicion (§8).

---

## 12. Consequences & carryover (what messing up costs — bounded)

Every failure hits stakes, never learning, and persists (L-D, FR-4). Cause-named, legible, carried across Acts:

| Mess-up | Bounded consequence | Carries to |
|---|---|---|
| Botched job (skill) | craft quality down → relationship (Respect) down a band, visible in the world (smudged sheets on walls, Pike's demeanor) | later Acts (Abigail warier) |
| Missed / late / refused delivery | anchor Trust + Respect down, cause stated ("the rider left without the bundle") | later Acts (less candor / responsibility) |
| Caught with contraband exposed | bundle may be confiscated, heat spikes, network's read sours; **the search itself teaches writs of assistance** | later Acts (network trust) |
| Read as a threat by a Loyalist | informer acts; a known-face / heat state | Act 2 — escalates to *soldiers* |
| Dawdling into dusk | unfinished errands resolve as missed; **learning still reroutes** via the fallback pool | relationship stakes only |

The learning always lands via reroute (§7A of the behavioral fixture); the *stakes* are the real, felt, carried consequence.

---

## 13. Build cost & multi-Act reuse

- **Cheap (author-only, no asset gen):** deeper route payoffs, eavesdropping density, world-tension-over-time, wiring the stealth beats into one system, compound-verb skill chains, side-jobs, checkpoint/debrief structure. Start here.
- **Expensive (asset pipeline — approved by the user; imported-visible-world law):** new flavor props, new ambient NPC archetypes, additional explorable interiors, hero set-pieces.
- **The strategic win:** Pillars 1, 3, and 8 are **build-once, re-dress-per-Act.** The stealth system, the traversal spine, and the reactive-world framework carry across all four Acts with only dressing changes, exactly like the environment reuse map (Bible §3A). Invest in Act 1; amortize across the chapter.

---

## 14. Guardrails checklist (hard lines this design must never cross)

- Required macro learning is **path-invariant** and lands on every legal path (principle 2).
- Runtime **selects, never generates** player-facing content (principle 3, FR-8).
- Skill / difficulty / failure **never gates learning**; every mechanic has an **accessible equivalent** (principle 7, FR-10).
- **No dead-ends** — every terminal outcome has an authored continuation (FR-4).
- Fair skill floor **≥0.70** for ordinary actions; high-risk is signaled and chosen (FR-3).
- **No XP / collectibles / skill trees / inventory grind / morality meter / endless-engagement loops** (PRD §17).
- Formal assessment is **route-independent** and **never an official STAAR score**; formative may adapt (FR-11).
- Telemetry excludes raw answers and inferred mastery labels (§13 analytics).
- New physical assets follow the pipeline; **no procedural visible stand-ins** (imported-visible-world law).
- ≤3 options per decision; no stacked prompts; self-driven / guided / prompted per Interaction-Spec §5.

---

## 15. Impact on existing docs & open items

This reframe and expansion touch other authority docs. To keep the spec honest:

- **PRODUCT-REQUIREMENTS §7 (product structure):** the "Mission Day / End Day" unit is reframed to **Act / checkpoint** for Boston. The atomic-commit, resume, and assessment *mechanics* are unchanged; only the container name and boundary placement change. A PRD revision should record: Chapter → 4 Acts → 5 checkpoints (Archive year-transitions), with invisible autosave continuing within each Act.
- **`Day-1.md` → Act 1:** the behavioral fixture is reframed as **Boston Act 1 (Stamp Act, 1765)**. Beats, carriers, tracked payload, and reroutes are unchanged; B0 becomes **CP0 (intake)** and B13/day-close feeds **CP1 (the 1770 re-insertion + first debrief)**. The **build-ready per-beat implementation script** (explicit animation, input, skill, and code hooks for every beat) is **`Day-1-Build-Script.md`**; it supersedes `Day-1.md` §6 for coding while `Day-1.md` stays the curriculum fixture of record.
- **Naming migration (player-facing):** retire "Day 1/2/3/4"; use "Boston, Act I–IV" and the historical episode names. Internal IDs may stay for continuity.
- **New authoring workstreams:** the curated micro-concept set per Act (§3), the TEKS-tagged STAAR question bank (§4), the side-job content (§9), and the stealth system engineering pass (§7) each need their own detailed pass.

### Open items (to spec next)
1. ~~The stealth system~~ — **designed (§7); Act 1 wiring mapped (`Day-1-Build-Script.md` §0.6, B8/B9); full systems + engineering spec in `Act-1-Production-Plan.md` Part D** (LOS/suspicion formulas, heat state machine, chase/stamina model, foundational refactors, build milestones, initial tuning constants). Remaining: implement + tune in the M0-M2 vertical slice.
2. ~~The compound-verb skill spec~~ — **mapped in `Day-1-Build-Script.md`** (B2 print job, B5 haul, B7.5 tack, B12 final pull, with `pa:mechanic-visual` hooks). Remaining: exact per-stage scoring curves + tolerances.
3. ~~Act 1 flow~~ — **written (§11A segment map + `Day-1-Build-Script.md` per-beat script).**
4. ~~The curated Act 1 micro-concept list~~ — **authored (`Micro-Concepts.md`, 14 concepts + coverage matrix + draft TEKS).** Remaining: the authored STAAR items per concept + the CP1 debrief form + SME TEKS sign-off (with spaced retrieval design once Act 2 exists).
5. The reactive-world interactable tagging pass over the Act 1 district (`ReactiveNpcDirector`, `StandingCard`) — scoped in `Act-1-Production-Plan.md` Part A.5 / D.5, milestone M3.
6. Act-1 side-job bank (optional, non-carrier) + their route/relationship payoffs.

**Production bridge:** `Act-1-Production-Plan.md` maps design → build across four areas — the activity catalog (what to do + build status), the asset build plan (grounded in the real concept→Meshy→Blender→sync pipeline + inventory; reuse-first), the animation plan (per-activity clip needs; net-new bakes are essentially just `jump`/`runJump`), and the stealth/chase systems (Part D), with a milestone order (M0 foundations → M1 chase slice → …).
