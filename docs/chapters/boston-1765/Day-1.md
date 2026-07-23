# Day 1 — The Stamp Act Crisis (Scene Plan)

**Working document.** How Day 1 actually *plays* — beat by beat, every action and its camera, every choice and its cost, and what each beat quietly teaches. The GDD (`Project-Archive-v3.md`) defines how the systems work; `Backend-AI-System.md` defines the concrete runtime/backend/AI implementation; `Production.md` defines how we build it; this doc is the concrete flow.

**Authority for Boston Day 1:** this is the canonical behavioral acceptance fixture because it is the most thoroughly playtested source. If the GDD, template, interaction spec, production notes, simulator, or backend document disagrees with current Day 1 behavior, that other source is stale and must be corrected to match this one.

**First runnable implementation:** `Localhost-Text-Slice-Spec.md` translates this fixture into exact localhost files, IDs, constants, ActionSpecs, Google-account behavior, text presenters, and tests. Its text UI is disposable; its headless runtime/contracts are the production foundation for the later Three.js game.

**Day 1 is the pattern-complete foundation build.** It deliberately exercises *every* interaction verb (see Production §2B) and instantiates every reusable system once. When Day 1 is done, the whole machine exists — Days 2–4 are the same district re-dressed + these verbs recomposed with new content.

**Implementation-ready micro-rules live in `Interaction-Spec.md`.** Every UX/interaction micro-decision this doc pins down in prose (marker/strip state machines, glyph grammar, the tracked-read interact→1st-person→read gate, the Clarke adjacency-challenge trigger, camera grammar, gamified-execution inputs, beat pacing, the time model, feedback cards, effect tags, stat model) is **consolidated and parameterized there for coding.** When a micro-rule changes here, update `Interaction-Spec.md` too.

**This doc is the *worked instance* of `Chapter-Day-Template.md`.** The template generalizes these beats into reusable archetypes + the design laws (the *why*) behind every decision here, so Days 2–4 replicate the intent rather than being re-perfected. Each beat below maps to a template archetype (B0→A0, B2→A2, … see Chapter-Day-Template §3). When a Day-1 decision is made, its rationale is captured as a law in Chapter-Day-Template §1 — edit both together.

Status: **re-authored for the 12-tracked + 3-Sync learning payload (v0.7).** Ready for a full B0→B13 walkthrough. Remaining unknowns in §11.

---

## 1. What Day 1 has to do

**Date:** 14 August 1765. Boston. You are the new runner in Abigail Mercer's print shop — day one on the job, which is also the player's tutorial.

**Fixed history (cannot change):** an effigy of stamp distributor **Andrew Oliver** (with a boot punning on Lord Bute) hangs on the great elm on Newbury St (later "Liberty Tree"). By dusk an organized crowd parades it, beheads and burns it, pulls down a small building on Kilby St believed to be Oliver's stamp office, carries the timbers to a bonfire on **Fort Hill**, and stones Oliver's house. Oliver resigns the next morning. The player moves *through* this; they never alter it. (Distinct from the Aug 26 attack on Hutchinson's house — do not conflate.)

**Feel:** a real first day at work in a city about to boil over. You do actual work, carry real things through a crowd that's turning, make human calls with people who remember them, and by nightfall you understand *why* people are this angry — because you handled it, not because anyone lectured you.

**Onboarding:** every input is taught by doing a real task (pull a sheet, read a proof, carry a bundle, duck a watcher), never by a menu.

**Diegetic framing — the HUD is your AR overlay, the Archive AI is your handler.** Everything the player sees on screen — the gold markers, the Today strip, stat cards, field tags, route flickers, the full Archive overlay — is *your personal AR layer,* projected by the Archive tech, invisible to everyone in 1765. This makes every UI element in-world: there's no game-y overlay bolted on top, it's simply what *you* see. The **Archive AI is a calm, dry, capable handler (JARVIS-style homage — period-serious, not Marvel-quippy)**: it briefs the mission, names things via field tags, and — critically — **drives assessment diegetically** by asking you to *confirm your read before filing the report* ("Before we file, what actually changed here?"). A valid read is what flips a concept to *Understood.* The voice is **economical** — a clipped line, never a paragraph; supportive, never a lecturer. It is the player-facing voice of the backend AI Director (Director = what/when to reinforce; Archive AI = how it's spoken to you).

---

## 2. Required carriers — the four things that MUST land

All four commit on **every** path, including failed deliveries (they reroute — see §7). Everything else is agency, perspective, or flavor.

| Carrier ID | Concept | Player experiences it as | Camera | Due by |
|---|---|---|---|---|
| `RCC.DEBT_POLICY_INTRO` | War debt → new revenue policy | 20s Archive context card on arrival + causal arrow; reinforced by Pike's "war to pay for" (B6) and the Custom House revenue proclamation (B7.5) | overlay / 1st | leaving the shop (reinforced by B7.5) |
| `RCC.STAMP_INTERNAL_INTRO` | Stamp Act = internal tax on paper, effective Nov 1 | Working the press, then comparing the stamped legal proof to the unchanged plain form | 1st | before the fixed event |
| `RCC.REPRESENTATION_CAUSE` | Not just cost — taxed **without representation** | Setting tomorrow's headline from the evidence you gathered | 1st / UI | end of day |
| `RCC.ORGANIZED_RESISTANCE_EVENT` | The Aug 14 protest was **organized**, aimed at the stamp distributor | Witnessing the fixed event (or its approved recap) | 3rd | end of day |

**Carriers (required *experiences*) vs. the day-gate (required *understanding*).** These carriers guarantee the player *receives* the content on every path. The **day-gate** (§2C) is the narrower STAAR-scored set that must additionally pass all three learning stages. Carriers ①–③ map to the three gated concepts; `RCC.ORGANIZED_RESISTANCE_EVENT` is a **required experience but not a Day-1 gated concept** — witnessing the organized event is guaranteed, but "organized resistance" is scene context here (it's formally assessed via Samuel Adams on Day 3), so it never has to pass a Day-1 assessment.

---

## 2C. Concept objectives, 3-stage ledger & the day's learning timeline (the day-end gate)

Day 1's gated concepts are **STAAR-assessed only** — the three 8.4(A) items that make up the Stamp Act crisis (GDD §36 Per-Day Required-Concept Ledger). The day **cannot end** until each clears all 3 stages and no required correction interaction remains open (GDD "Concept Learning Lifecycle"). Per concept, on the learning day: **Learning** (≥3 **tracked** occasions, ≥2 types) → **Understanding** (one Archive Sync passes) → **Demonstrating** (an applied *game action*, the day-of "reassessment" — **NOT another Sync**). Types: **scene**, **convo**, **article** (broadside/poster/document/handled object), **hands-on**.

*Day 1 is the first day, so nothing is reassessed via Sync here — sync-based reassessment of these concepts begins Day 2+ (spaced repetition lives across days; a prior-day topic can be re-tested in-world or in a Sync).*

**The hard payload (§2D): 12 tracked (9 exposures + 3 demonstrations) + 3 understanding Syncs, all path-invariant.** The matrix places every one; the timeline below shows them spread across the day.

| Concept (STAAR 8.4(A)) | 3 tracked exposures (Learning) | Understanding Sync | Demonstration (day-of game action) |
|---|---|---|---|
| **① Post-war economic policy — war debt → colonial revenue** | **B0** guaranteed Archive intake using a real article (**directed scene** type) · **B6** Pike "London had a war to pay for" (convo) · **B7.5** Custom House Crown **revenue proclamation** (article, tracked focus-read) | **Sync 3** — fires when ① completes (typically at B7.5) | **B7.5** — post Abigail's notice **under the correct cause** (applied); reroutes to the **B12 cause-line** if ① isn't yet Understood |
| **② Stamp Act = internal tax on printed/legal paper** | **B3** compare the proofs (read; stamp revealed here, field tag) · **B4.5** town notice-board posted **Stamp notice** (article, tracked) · **B6** Pike "a tax on the very paper" (convo) | **Sync 1** — fires when ② completes (post-B6) | **B6.5** — **flag which of Pike's papers need the stamp** after Nov 1 (applied sort); reroutes to the **B12 evidence pick** |
| **③ Lack of representation — "no taxation without representation"** | **B5.5** broadside read after the 1st delivery (article, tracked) · **B5** Thomas "it's the not being asked" (convo) · **B7** anti-Stamp handbill you conceal/focus-read (article/object) | **Sync 2** — fires when ③ completes (post-B7) | **B12** — **set the headline** from the cause (applied construct) |

**The day's learning timeline (representative order: run Thomas → Pike → Clarke → rider → Custom House, then the event).** Order is player-chosen; this shows the intended spread, with the rider run *between* Clarke and the Custom House so Sync 2 and Sync 3 aren't back-to-back.

- **Morning · shop:** B0 → **①-exp1** (context card + a real period article flashed in the intake hologram) · B3 → **②-exp1** (compare proofs, field tag).
- **Early street:** B4.5 → **②-exp2** (town notice-board Stamp read).
- **Deliveries (order-free):**
  - after the 1st delivery → B5.5 **③-exp1** (broadside).
  - Thomas B5 → **③-exp2** (convo).
  - Pike B6 → **②-exp3** + **①-exp2** (his two lines) ⇒ **② completes → Sync 1 (Stamp understanding)** ⇒ **B6.5 → ② demonstration** (sort the papers that need stamping).
  - Clarke B7 → **③-exp3** (conceal/read the handbill) ⇒ **③ completes → Sync 2 (representation understanding)**.
  - *(≥2 interactions here: the street, then the rider.)* B8 street → B10 **rider handoff**.
  - Custom House B7.5 → **①-exp3** (revenue proclamation) ⇒ **① completes → Sync 3 (policy understanding)** ⇒ **① demonstration** (post the notice under the right cause).
- **Wind-down:** **B10.5** short synthesis (fuses the three, tees up the event — no new Sync in the representative run; **catch-all** for any concept whose exposures completed late) · B11 fixed event · **B12 → ③ demonstration** (set the headline) + the evidence/cause lines re-exercising ①/② as synthesis · B13 close.

**Spread check (what the stretch buys):** the **3 Syncs** fire at three different moments (post-Pike, post-Clarke, Custom House). They can sit **relatively close but never back-to-back** — the Director enforces **at least 2 interactions between any two Syncs** (a delivery, a probe, a conceal, a handoff — any tracked interaction counts), deferring a Sync to the next natural opening if the last one was too recent. In the representative order the **rider handoff runs between Clarke (Sync 2) and the Custom House (Sync 3)**, so those two are separated by the rider + travel + the Custom House proclamation read. The **3 demonstrations** sit at **Pike (mid), Custom House (mid-late), the night headline (B12)** — no longer crammed into one beat. Exposures span morning → mid-late.

**Path-invariance (L3, L20).** Delivery order is free, so exposures and their Syncs fire *whenever* each threshold completes. The Director **reroutes any missed exposure** through another beat, and **reroutes each demonstration to the next applied opportunity** — its home beat if the concept is Understood by then, else the next one, with **B12 as the guaranteed catch-all** (the headline construct can host ①'s cause-line and ②'s evidence-pick as well as ③'s headline). So all **12 tracked + 3 Syncs land on every path**; order only changes *when* and *where*, never *whether*.

**Tracked vs. ambient (hard — only tracked exposures count).** Every occasion in the matrix is a **tracked interaction** (a focus-read the player opened, an engaged conversation, a handled object, a directed scene). The world *also* carries **ambient support** — decorative wall posters (e.g. a "NO TAXATION WITHOUT REPRESENTATION" bill near the shop), background NPC barks, crowd chants — which enrich the setting and reinforce for whoever notices but **never count toward the 3-occasion threshold**, because we can't verify the kid read/heard them. If a reading is meant to count, it's authored as a trackable read (B4.5, B5.5, B7.5), not left on a wall.

**The Archive may prompt ambient teachable content too — invite, never require.** For ambient-but-teachable bits (a poster, an overheard argument, a carving), the **Archive handler can gently nudge** — a light *"worth a look"* — to make it **easier and more inviting** for a curious player to engage. This is pure courtesy: **it still never counts** (it wasn't authored as a tracked, verifiable read), and **skipping it costs nothing.** The point is to let the world be *richly* teachable without any of that richness becoming load-bearing — the guaranteed curriculum stays entirely on the tracked set, while ambient content is a free, optional layer the Archive can spotlight. (The player never sees a "this counts / this doesn't" tag — positive-only; they just explore, and the backend only ever gates on tracked occasions.)

**Tracked read = an explicit player action, never a fly-by (hard).** A tracked read (even an authored-tracked one the Archive prompted, like the B7.5 proclamation) logs its exposure **only** on the full deliberate action: **step into range → press interact → camera cuts to 1st person → the read opens.** The Archive's prompt only *invites*; walking past, or being near it, tracks **nothing**. So even a "worth a look" the handler flags is silent unless the player chooses to stop and read it. This is exactly what makes the occasion **verifiable** — the engine logs the interact + focus-read, not proximity. (Focus-Inspect grammar, Production §2B.)

**Demoted to scene context (NOT day-gates — only STAAR concepts gate the day):** organized resistance and non-importation/boycott. They still appear as rich world flavor — Thomas's boycott line (B5), the coordinated handbills (B4), the organized Aug 14 event (B11) — and the **organized-event carrier still fires** as a required *experience* (§2), but neither is a Day-1 3-stage gated concept. They feed the later assessed roles (Samuel Adams, Day 3) and the chapter causal chain, not a Day-1 quiz.

## 2D. Day 1 learning payload — the hard count (path-invariant guarantee)

Per topic, on the learning day: **3 tracked exposures** (Learning) → **1 understanding Archive Sync** (assessment) → **1 demonstration via a day-of game interaction** (stage-3; the "reassessment" — **never a Sync on the learning day**). With 3 topics that is a **fixed payload**:

> **12 tracked learning moments** = 9 exposures (3×3) + 3 demonstrations (1×3) · **plus 3 understanding Syncs.**

- **Guaranteed, path-invariant.** All 12 tracked + 3 Syncs **must land no matter what the player picks or how world-state / relationships shift** — the closed learning loop. Missed or avoided beats **reroute** the missing exposure/demonstration through another path (L3). Choice changes *how* it's delivered, never *whether*.
- **Sync cadence — spread, never batched.** Each topic's understanding Sync fires only after its 3 exposures have landed and the ≥2-interaction spacing rule is satisfied. Representative order: **② Stamp after Pike**, **③ representation after its Clarke/typed-fallback threshold**, and **① postwar revenue policy after the Custom House/Pike threshold** (or at the next legal late-day/Abigail safe point if order/spacing delays it). Threshold completion and spacing, not delivery ordinal, control placement.
- **Demonstration cadence — day-of, via interactions (not Syncs), and spread.** The 3 applied demonstrations are **distributed across the day's applied/construct moments**, *not* all crammed into the B12 headline. This is the day-of "reassessment" the user specified as a *daily interaction*; **later days may reassess prior topics via world events OR Syncs.**
- **Day sizing — Day 1 is stretched to fit (done in v0.7).** The compressed 3-errand day couldn't hold this spread, so Day 1 is now sized toward the **fuller ~25–30 min** end with **a 4th stop (the Custom House, B7.5)** and **two mid-day applied demonstrations (B6.5, B7.5)** so the 12 tracked + 3 Syncs + 3 demonstrations land **naturally spread** rather than crammed. See the §2C matrix + timeline.
- **Gaps this count exposed — now resolved (v0.7):**
  - ~~**① Economic policy under-exposed**~~ → 3rd tracked exposure added: the **Custom House Crown revenue proclamation (B7.5)**, a tracked read distinct from the B0 overlay and Pike's convo.
  - ~~**Demonstrations batched at B12**~~ → split three ways: **② sort at Pike (B6.5)**, **① post at the Custom House (B7.5)**, **③ headline at B12**.
  - ~~**Only B10.5 was a Sync**~~ → the three understanding Syncs now fire on threshold-completion (post-Pike, post-Clarke, Custom House); **B10.5 is repurposed** as the day-synthesis wind-down + late-completion catch-all.

---

## 3. Objects the day tracks (custody + condition are live state)

- `OBJ.THOMAS_CIRCULAR` — merchant circular for Thomas Bell. Custody → Thomas on delivery.
- `OBJ.PIKE_LEGAL_PROOF` — legal proof for clerk Pike. Custody/condition tracked till delivered / missed / damaged.
- `OBJ.SHOP_LEGAL_PROOF_COPY` — retained shop copy showing unchanged form wording + the new paid-stamp line. Never leaves the shop. **Fallback source for the Stamp carrier.**
- `OBJ.CARRIER_HANDBILLS` — anti-Stamp handbill bundle for the departing rider. Custody, condition, concealment, recognition, and timed handoff tracked separately.
- `OBJ.SHOP_STAMP_COPY` — retained shop/source copy; never leaves; can't be silently swapped for a failed delivery.
- `OBJ.PLAIN_WRAP` — packing/waste sheets for concealment. Available regardless of circular custody.
- `OBJ.CUSTOMHOUSE_NOTICE` — Abigail's notice to post at the Custom House board (B7.5). Custody → posted (under a chosen heading) / missed. The heading choice is ①'s applied demonstration.

---

## 4. Live day-state (what the world remembers)

- **Clock — "sun + crowd," no numeric timer.** The day advances in discrete beats, not seconds. There's room for morning press work + the four errands + the evening headline, plus a couple of free probes. Each optional detour / helping / failed-risky action spends **one block** (~4 blocks of slack). When the crowd at the elm reaches critical mass, **dusk begins the fixed event**; any undelivered errand at that point resolves as **missed** and reroutes. Time is *felt*: lengthening shadows, a growing crowd, watchers appearing, NPCs saying "the street's turning." *(The 4th stop + two mid-day applied beats are why Day 1 sits at the fuller ~25–30 min end — §2D.)*
- **A persistent day-clock is on the HUD (diegetic, non-numeric) + Archive gives polite time-warnings.** So the player is never *blind* to how close dusk is, the Archive strip carries an always-visible **daylight meter** — a **sun tracking an arc** / depleting-light sliver, **not a countdown number** (keeps "felt time" intact). As daylight runs short the **Archive handler gives supportive, escalating heads-ups** (*"Light's going." → "The square's near boiling, I'd finish up." → "You're about out of day."*), proactive and tied to the clock (distinct from the wandering idle-nudge). The per-task **bell glyph** is the local timer; this is the global one. (Interaction-Spec §8.)
- **The clock moves *during* an interaction by its authored time-cost.** Because every beat has a known budgeted weight (press-pull, a focus-read, helping Thomas, the gamified tack, etc.), the sun visibly **creeps across the arc as you perform the action** — a slow/careful choice eats more daylight than a quick probe, felt in real time — rather than snapping a block at the end. Same time-cost table that drives day-state escalation drives the clock. (Interaction-Spec §8.)
- **Danger scales with time-of-day, not beat order (deliveries are order-free).** Watcher-heat, crowd density, and how agitated characters like Clarke are all rise as the day advances toward dusk. So the **same delivery is calmer done early and tense done late** — an early rider run meets a light street; a late one threads customs men massing near the elm. This is what makes order-freedom real instead of cosmetic: *when* you do the risky stop matters. The escalation is a world-state curve on the clock, never scripted to "the rider is last."
- **The timed rider is reachable all day, up to the bell.** The post rider is prepping at the town edge and can be handed the bundle at any point until the **evening bell** (the bell is the deadline, not his arrival) — so doing him first is a valid, calmer play, and doing him last is a tense dash. Miss the bell → missed delivery → reroute (§7).
- **Time is a spent resource that reshapes the day (L18).** The core trade is **time vs. risk**: a `saves time` option is usually `risky`; a `safe` option usually `costs time`. Time **accumulates**, and the running total is what drives the escalation curve above — so **every "safe but slow" choice pushes the day forward and makes later interactions tenser** (more watchers, crowd massing, characters more on edge, some options closing), while a brisk run keeps them calmer. The game continuously **adapts downstream beats to the current time-state**; it's not a fixed script.
- **Nothing you *do* is free — time is a gradient over interactions (L18).** Because the clock is coarse (discrete beats, not a 24h timer), *every interaction* advances the day a non-negligible amount. The gradient: **deliver-and-leave (least) < short dialogue/probe (small, may carry a learning line) < hands-on action like helping Thomas (most).** So chatting Thomas costs a little; helping costs more but unlocks the dock route; leaving saves the most but opens no route. **Only traversal/movement is cheap** (walking between points), and idle *wandering* is the Archive's nudge (L11), not a clock cost. Routine small costs are **ambient/felt** (sun, crowd), **not tagged**; a `costs time` tag is reserved for **notable** chunks (helping, a detour) so tags never spam every probe.
- **Traversal is cheap — don't pad it.** The district is compressed; the rider is ~20s away. **Ordinary walking costs nothing** — blocks are spent on *choices* (helping, detours, risky plays), never on footsteps.
- **Idle handling = the Archive, not the world.** If the player stalls/wanders and burns learning time, the **Archive AI gives a gentle, slightly-escalating task reminder** (*"Rider's still waiting. Bell won't."*) — cheap and calm. It is **never** handled by spawning an NPC to approach. Living-world events (NPC approaches, world-state shifts) exist to **reinforce a fact or show a perspective** on meaningful triggers — they are precious authored content, never an anti-idle guard. *Archive handles idleness; the living world handles teaching.* Never conflated.
- **Relationships:** `Abigail`, `Thomas`, `Pike`, `Clarke`. Bands: strained / neutral / raised. Only consequential choices move them (see §4A).
- **Object custody + condition** (§3).
- **Visibility / watcher heat:** how much attention you've drawn from customs men / the constable. Affects encounter outcomes, never learning.

---

## 4A. Relationship & world-consequence system (the living world)

Standing with people reshapes the map and the danger — not just tone. Only consequential choices move relationships; free probes never do.

**Relationships are dimensional, not one universal trust bar (people feel more than that) — but most people track just one thing.** The rule: **most characters carry exactly one dimension** — the one that actually has consequences for dealing with them — while the **chapter anchor (Abigail) carries a few**. Cheap (one rich character per chapter), and it deepens the relationship you live in most. Warmth with a Loyalist informer is noise; a favor owed by Thomas is the whole thing. Shared dimension set:

- **Trust** — do they think you're honest/reliable.
- **Respect** — do they think you're *competent* (this is where skill outcomes like the press pull feed in).
- **Warmth** — do they personally like you.
- **Political read** — do they see you as *ally / harmless / threat.* The era-defining one: pre-Revolution Boston ran on everyone sizing up everyone's loyalties, and modeling it *teaches that social texture.*
- **Obligation** — does someone owe someone a favor.

**Different dimensions unlock different things:** Respect → harder/more responsible work (and Pike taking your work seriously); Trust → candor, secrets, and responsibility (Abigail next day; the rider trusting you as courier); Obligation → a favor repaid (Thomas's dock route); Political read → the resistance network opens up **or** a Loyalist turns you in; Warmth → **extra options and personal access** — she likes you enough to bend the rules for you (confides where the network meets, hands you the spare shop key for after-hours, vouches for you to a wary contact), and it compounds across Boston Days 2–4 into a real ally who'll stick her neck out.

**Warmth isn't bought with free chatter.** A quick free probe stays free (no tag, no movement). Warmth moves only when you *spend* something on Abigail as a person — a considerate choice, a small kindness, choosing to linger and hear her out (`costs time · warms Abigail`). The personal stuff is a real tagged decision, never a dialogue-tree grind. **Day 1 payoff:** enough warmth opens an **extra day-close (B13) branch** where she lets you in on the real risk she's running and hands you something that seeds Day 2 — a colder run never sees it.

**Baselines: everyone starts guarded, not blank, not hostile.** Each stat initializes low-neutral — about a third of the way up (~30–40% internally; shown as a **band, never a number**: "guarded / unproven"). Nobody inherently trusts or dislikes you; the world errs slightly toward caution until you prove yourself. Political read starts near neutral with a faint lean to wary. Early game = *earning* your way up from cautious, which fits a stranger dropped into 1765 Boston.

**Causality rule (hard — a stat NEVER moves arbitrarily).** Exactly two legal causes, both legible to the player:
1. **A choice you made** — you saw the effect tag before clicking; the card confirms after. You know why.
2. **Your performance on an activity** — e.g. a clean press pull earns Abigail's respect; a smudged one costs it. The stake is **telegraphed before** ("clean earns respect") and the card **confirms after with the reason** ("clean proof, steady hands").

No ambient drift, no "she just likes you now," no moving a stat for narrative convenience. If there's no player-visible cause (a tagged choice or a graded activity), the stat may not move.

**Cascading consequences (keep this — it's what makes the world real).** One action can ripple to **multiple** stats / characters / world-state over time. The clean proof you pulled this morning lifted **Abigail's respect** *and* shaped **Pike's first impression** hours later. A good pull, a botched delivery, a snubbed Loyalist, each fans out rather than resolving in one tidy spot.

**Record the cause; realize the stat only when it's felt.** The cause is durably recorded when the player acts, but if the affected person cannot understand/react yet, the **relationship band does not move yet**. At the authored reveal scene, the current state is reduced into the actual delta and the flicker/card appears in the same moment. Botch the proof and you don't get a mystery "Pike disapproves" card or hidden Pike-band change back at the press before you've met him; if you reach Pike, the Respect effect realizes at the handoff and names the cause ("the smudged proof from this morning"). **Archive People cards unlock on first meeting** — before that the character is a locked silhouette at baseline. Causality still holds: the reveal always states *why*, even hours later.

**Cascades and unlocks are contingent — if the reveal never happens, the delta never lands.** A committed delta only *realizes* if the player reaches the moment it's felt. If you dawdle, get swept into the fixed event (L19), and **never reach Pike**, then Pike **stays a locked silhouette at baseline** — no card, his stat unchanged — and the morning smudge→Pike cascade **simply doesn't land.** It is **lost, not deferred**: that proof was today's job, so an unmet Pike means the consequence never occurs (meeting him on Day 2 is a *fresh* first interaction at baseline). Character unlocks, cascades, routes, and relationship shifts are all part of the **dynamic, contingent world-state** — never guaranteed. Learning is the opposite: the Stamp carrier banked at B3 regardless, so a missed Pike costs **stakes, never curriculum.** (World-state dynamic; learning + fixed events guaranteed.)

**Per-character dimension (Day 1) — one each, except the anchor. Each is the dimension that genuinely fits that person, so no two beats lean on the same "trust" catch-all:**
- **Abigail** (anchor) → **Trust + Respect + Warmth** (reliability · competence · personal regard). Which one moves is beat-specific: **completing/missing errands → Trust** (did you do what you said); the **press-pull skill → Respect** (competence at the craft); **considerate personal choices → Warmth**.
- **Thomas** → **Obligation** (you haul his load / do him the solid, so *he owes you* → he repays with the dock route; it's a favor banked, not him judging your honesty)
- **Pike** → **Respect** (competence — the smudged proof reads as *sloppy work*, not dishonesty; a clean/reprinted proof reads as capable. This is why the press-pull outcome surfaces on his card)
- **Clarke** → **Political read** (threat vs. harmless → informs or doesn't; warmth is irrelevant to him)
- **Rider/network** → **Trust** (a discreet, reliable courier — the one relationship where plain reliability/discretion genuinely *is* the axis)

**The Archive is the mirror (reinforces changed state).** It surfaces relationship/world shifts in **plain human language, not numbers**, and only on meaningful change: *"Abigail thinks you're careful, but green." "Clarke's watching you now."* It is also the home for **delayed-consequence callbacks**: e.g., when the constable stops you, the Archive notes *"flagged by a Loyalist informant,"* connecting it back to the Clarke choice. Peripheral, human, change-triggered.

**Unlock flicker on first meeting (immediate feedback — every character).** The first time the player meets a character, a brief non-blocking holographic **flicker** fires (same style as the route-unlock flicker / stat card), e.g. *"Person added: Abigail Mercer · Mercer's Press."* The silhouette in the People panel resolves into a real card at that moment. This fires for **every** character on first contact (Abigail at the press, Thomas/Pike/Clarke on arrival at their beats), so meeting someone always registers. Any latent stat delta already committed against them (commit-at-cause) reveals on this same unlock.

**Archive → People panel (openable anytime).** The player can open the Archive whenever they want — a free pause view that does **not** advance the world, cost a time block, or reveal hidden outcome rolls. It holds a per-chapter **"People"** list: every character met gets a card; unmet ones show as a locked *"not yet met"* silhouette (a tease). Each card shows that character's dimension(s) as a **bar, never a number:**
- **Magnitude dims** (Trust, Respect, Warmth, Obligation) → a **fill bar**, low→high, labeled with a plain band word instead of a value — e.g. Trust: *wary · guarded · steady · trusted*; Respect: *green · capable · sound · relied-on*; Obligation: *nothing owed · a small favor · in your debt*.
- **Political read** → a **diverging bar** centered on neutral: *threat ◄ wary ◄ neutral ► curious ► ally*.
- Most cards = one bar; **Abigail = three** (Trust · Respect · Warmth). Bars can fall, not just rise. A shifted bar gets a subtle highlight on next open.
- **Relationship view only** — never a learning-progress or mastery bar. That lives in the separate Notes tab below.

**Archive → Notes (the concept journal — you're an archivist, so this is in-fiction).** Openable anytime alongside People. **It displays only concepts the player actually understands** — no "encountered / not-understood" checklist. A concept earns its Notes entry the moment it reaches **Understanding — its first Archive Sync pass** — and the entry (with its "Added to Notes: [concept]" flicker) is created **exactly once, then**. The later **demonstration** and any subsequent-day **reassessment** do **not** re-add or re-announce the entry — it's already in Notes; they're confirmed diegetically (the world reacting), never a duplicate flicker. Notes is a growing record of things you've *earned*, not a to-do list of gaps. Each entry = the **concept name + a short plain description** written for recall (so opening Notes later actually helps you remember it, not just ticks a box).

**No right/wrong feedback — positive-only (anti-deterrence, hard rule).** Never tell the player they're "wrong." **Reaching Understanding** (the first Sync pass) fires a quiet **"Added to Notes: [concept]"** flicker; that appearance *is* the confirmation (the handler never says "correct"). A first-understanding miss produces **no flicker and no negative callout** — the concept just isn't earned yet, and the Director gives one authentic re-exposure plus one later retry. If that retry also misses, it holds in place, gives a directional nudge (not the answer), and requires correction; it never starts another reroute cycle. **The flicker fires only on that first entry**; the later demonstration and reassessments get **diegetic confirmation only** (the NPC/world reacts), never a duplicate "Added to Notes." The absence of the first flicker is the only "not yet," and it's silent and shame-free.

**Why not show encountered-but-not-understood?** Because the player can't clock it yet — surfacing a concept they haven't grasped is just noise/nag. **Encountered is tracked invisibly in the backend**: it's the AI Director's private signal for which concepts to reintroduce through the story for another authentic chance. The player only ever sees what they've earned.

**Field tag ≠ Notes entry.** The fleeting field tag (the momentary edge-of-screen "that mark is the Stamp Act") names a thing in the moment on its earned trigger; it does **not** drop a half-understood entry into the journal. Notes fills only on demonstrated understanding.

**Integrity rule (hard):** an entry appears only on valid demonstration — the same evidence contract the backend Coverage Ledger uses; never from exposure or from being told the answer. Entry is **silent** (no popups, no numeric scores). Reinforcement happens by the Director replaying the world, not by quizzing. (See GDD §16.)

**Archive → Routes (third tab beside People & Notes).** A persistent, per-chapter list of every alternate path the player has unlocked (dock route, back lanes, secret passages), each showing **how it was opened** ("opened by a favor from Thomas") and whether it's **currently usable**. So mid-chase the player can open the Archive and see the options they've earned.
- **Unlock flicker (immediate feedback).** When a route opens, a brief non-blocking holographic flicker fires in the same style as the stat card / field tag, e.g. *"Route unlocked: Waterfront dock route · opened by a favor from Thomas."* Auto-dismisses.
- **Causality holds:** a route unlocks only from a clear player-visible cause (a relationship band, a choice, a discovery), and the flicker names it. No route ever appears without an attributable reason.

**Archive HUD — "Today's Tasks" strip = the Archive's collapsed state.** The always-on strip is not a separate widget; it's the **Archive in its collapsed form.** Expand it (click / hold / hotkey) and it blooms into the full overlay with its tabs — **Today · People · Notes · Routes** — landing on Today since that's what you were glancing at. Collapse it and you're back to the glance. One surface, two states; no separate "open Archive" button. Expanded = the free pause view (world/clock don't advance, no hidden rolls shown); collapsed = the unobtrusive strip.

The collapsed strip mirrors the world markers 1:1 (strip = what's left, markers = where), and follows the same **pick-one-focus** rule:
- **At a selection point** (e.g. just outside Abigail's with 3 deliveries pending) the strip lists the **full pending set** — one line per stop, each matching a blue world ping — so you can choose.
- **Once you pick**, the strip **collapses to the single active target** (matching the one gold ping); the others hide until this one is done, then the remaining set resurfaces (**4→1→3→1→2→1→1**, per §B0). The **expanded Today tab always shows everything** for a full look.
- Completed tasks check off / dim as you go — progress visible without opening anything.
- **Timed tasks carry the waning-sun/bell glyph** in their line (the rider's does; Thomas / Pike / the Custom House don't) — this is the primary way the player knows an errand is on a clock.
- **Anti-clutter (hard):** glyphs over words; collapses to a thin tab during action/cutscenes; expands on hover/hold; never covers the world; never more than a few lines. A glance, not a panel.

**World consequences:**
- **Standing opens the world up.** Enough **Obligation** with **Thomas** (you did him a favor, he owes you) → he reveals a **private waterfront "dock route"** bypassing a watched street later (and recurring in later Boston days). Trust with **Abigail** → more candor and responsibility next day.
- **Routes are state, not geometry (special-feeling + cheap).** The dock route is the *same* built waterfront, normally **blocked** (chained gate, piled cargo, a dockhand shooing people off); the favor Thomas owes you just toggles the blocker off for you. Same world for everyone otherwise, so getting through feels earned, and a route costs only a blocker prop + a flag, never new level. Open/closed is an authored state-layer like lighting or crowd (Production §6).
- **A bad read turns the world against you.** If **Clarke** reads you as a threat (you snap at him, or flash the handbills), he **informs an authority** and you must **avoid/evade** them to finish the run (feeds the §6 caught-anyway branch).
- **Period-correct authority (hard historical rule).** In **1765 there are NO British troops in Boston** (they arrive 1768). Day 1 enforcers = **customs officers, the sheriff/constable, and Loyalist informers.** The *same* mechanic escalates to **redcoats and sentries in the 1770 day** — itself a teaching beat about the occupation.
- **Guardrails.** Cap 2–3 dimensions per character; surface in words not numbers; move only on consequential choices. **No required carrier depends on any dimension** — missing Thomas's route just means a slower/riskier path; being informed on just means an evasion beat. Learning always lands.

---

## 5. Conventions (locked)

**Choice types (shown differently so cost is honest):**
- **Consequential** → short effect tags naming the *stat* and *direction* touched: `costs time` · `saves time` · `builds trust` · `strains trust` · `earns respect` · `loses respect` · `earns a favor` · `warms Abigail` · `cools Abigail` · `reads as a threat` · `reads as harmless` · `risky` · `uses the proof` · `opens the dock route` · `draws attention`. (Each names the dimension that fits the character it targets — Respect for Pike's craft, a favor for Thomas, political read for Clarke, trust for reliability with Abigail/the rider — never a blanket "trust.") Tags name the *kind* of effect, not the hidden roll (`risky` = an outcome draw follows, not a guaranteed fail). **Every stat-affecting option must carry the matching tag** — the player always knows which stat and which way before clicking.
  - **UI treatment:** each tag is a tiny, muted sub-label directly *under* the option text (e.g. under "Help Thomas move the cloth" → *· earns a favor · costs time*). Small, non-shouty, 1–3 per option.
  - **The tag's presence is the signal.** Free probes and pure look/ask/skill options carry **no** sub-label, so an untagged option always reads as "safe / no strings." Players tell a real decision from idle curiosity at a glance.
- **Free probe** → *no stat/risk tag.* Ask, read, inspect: moves **no stat** and carries **no risk** — but it is **not free of time.** Like everything you *do*, a probe nudges the coarse day-clock a small, non-negligible amount (felt via sun/crowd, not tagged per probe). "Free" = free of stat/relationship/risk consequences, **never free of time** (L18).
- **Skill action** → no cost tag; stakes shown in the world (a closing lane, a scanning watcher).

**Two tiers of activity (not everything is failable):**
- **Graded** — outcome varies with performance and moves stats/object condition (e.g. the press pull: clean/usable/smudged). Use only where the outcome *means* something.
- **Effort (unfailable)** — a tactile input (mash a key, press-and-hold) that always completes; the point is embodiment, not a test. E.g. helping Thomas haul the cloth: you mash/hold to drag the bolt across, it can't fail, and the favor is earned by *choosing to help* (the tagged decision), never by how well you mashed.
- **Rule:** failure only belongs where failing *teaches something* or creates an interesting consequence. Otherwise use the effort tier — engagement without pointless frustration.

**Post-commit micro-feedback (holographic character card).** When a click actually moves a stat, a small holographic card — the **same component as the Archive People card**, slides in at the screen edge and reports the realized change (*"Abigail: respect ▲"*). Brief, non-blocking, auto-dismisses.
- Fires **only** on a stat-affecting cause — a tagged choice commit **or** a graded activity outcome that moved a stat (e.g. the press pull). Never a random interrupt, never ambient.
- For a `risky` choice or a graded activity, it appears **after the outcome resolves** and reports what actually happened, with the cause clear ("clean proof, steady hands"), never the odds.
- **Relationship stats only.** Notes promotion (Encountered → Understood) stays **silent**. Status and Notes are always accessible on demand (pull), never forced popups (push); assessment moments and scripted game-flow beats still interrupt as normal.

**Camera:** *1st person = hands on an object* (read, compare, operate, carry, conceal, construct). *3rd person = the player in the world* (move, traverse, evade, crowd, dialogue framing, witnessing). Every beat labels its camera. See Production §2B for the full verb catalog.

**Writing style (hard rules):**
- **No em dashes, no "AI-sounding" dialogue.** NPC lines are natural and human, the way a real person talks. Use plain punctuation (commas, periods, short sentences). No em-dash pileups, no over-balanced "not X, but Y" constructions, no essayistic phrasing.
- **Short, oblique, never a lecture.** NPC lines are one or two short lines, max. People *imply* the point instead of explaining it. Kids don't want nuance or historical talk, they infer meaning from how someone offhandedly says something. The character never spells out the concept or dumps context; naming the concept is the field tag's job, not the character's. If a line reads like exposition, cut it down until it sounds like a person just saying a thing.
- **Probe/choice labels aren't on-the-nose.** Free-probe labels are phrased the way a 13-year-old would actually think, casual and on-topic, a little vague, not analytical. Say "ask him about the prints," not "ask who's paying to print and carry all this." The *learning* comes from the answer; the label just gets you there naturally.

**NPC speech & interaction glyphs (Production §2AA):** two distinct AR glyphs. A **speech glyph + attributed subtitle** appears over *any* NPC speaking outside your active dialogue (ambient talk, barks, crowd lines) — always on, so you always know who said what. A separate **interaction glyph** marks an NPC you can actually engage. They co-occur on an engageable talker (Clarke); a pure ambient talker shows only the speech glyph. Your active partner (Abigail/Thomas) needs neither — they're who you're with.

**Curriculum-integral cinematics: author once, all routes funnel in, every route keeps a gameplay element (game-wide law).** A cinematic or set-piece that carries required curriculum is **authored a single time.** Every legal route the player can take **funnels into that same cinematic** — the required content can never be missed by choosing a different path. What the route changes is the **interactive on-ramp**: each path keeps its own gameplay (climb a roof, push through a crowd + an unfailable dodge, hold-to-chant, etc.), failable or unfailable as fits, and each ends by handing off to the shared cinematic (a gold "observe/look" zone, a camera pan, a trigger). This is the presentation-layer form of the carrier guarantee: **choice varies the approach and the doing, never whether you receive the required moment.** Cheap (one cinematic, many light on-ramps) and airtight (no route escapes the curriculum). Apply to every integral set-piece in the game.

**When defined objectives run out, the Archive drives the close (never leave the player aimless).** The day has a finite set of authored objectives (the four errands + the fixed event). The moment those are exhausted, the world has nothing left to *pull* the player, so the **Archive handler proactively steps in** to run the synthesis/assessment beat (the "confirm your read / set the headline" moment). This both consolidates the day's learning (flips concepts to Understood) and **sequences the wind-down** (headline → day close). The player is never dropped into an open world with no defined next action after the tasks are done.

**Self-driven vs. guided vs. prompted — read the room (three cases).**
- **Self-driven (no prompt, no marker)** — the next action is **obvious with no distractors** (a quiet room, one door: leaving after Pike). The player just does it; that triggers the next beat. Never wrap it in a "1. Leave" button.
- **Guided (no choices, but a marker)** — there's genuinely only **one thing to do but it's unclear *where*** (drop off a roof into an open street; the only task is "get to Abigail's" but the way isn't obvious). Not a choice menu — instead a **gold marker** goes on the destination (single objective = gold, per §6 markers), and if the player wanders, the **Archive nudges** them. Guidance, not a decision.
- **Prompted with options** — the world is **open/busy/distracting AND there's a real decision** (stepping into the chanting crowd). Present explicit options (2–3) to move the story, never "figure it out yourself."

**Beat pacing — never stack prompts back-to-back (breathe first).** A decision prompt (a task selection, an Archive Sync, a choice menu) **must not land the instant another beat resolves.** After a discrete beat — reading a broadside, tacking a notice, finishing a scene — insert a short **free-roam breather (~7s of just moving through the world)** before the next prompt surfaces. The pick-one-focus markers are **ambient and pickable anytime** (the player *can* choose the moment a stop resurfaces), but the game never *shoves* the next selection in their face; it lets them take a few steps first, then the strip/markers quietly settle into "pick your next stop." Two UI/assessment beats in immediate succession is the thing to avoid — always put lived world-time between them. *(This is distinct from, and finer-grained than, the ≥2-interactions Sync spacing in §2C — that's about Syncs specifically; this is about any two prompts feeling consecutive.)*

**Options: 2 minimum, 3 maximum — the cap is absolute.** Every decision point shows **at least two** and **never more than three** choices. **A free probe is NOT a bonus extra appended after the choices** — if a probe belongs, it *is* one of the ≤3 (like Thomas's "ask what he makes of this"), or it's folded into a choice, or it's cut. Never present "3 options (or a probe)" — that's 4. If the NPC already volunteers the learning in their own lines (like Pike), no probe is needed at all. Three is a ceiling, not a quota — **never pad to reach three, and never force an encounter/extra option when the world doesn't call for it.** A quiet moment gets two plausible choices; a charged one can get three. If a scene has more possibilities they collapse into ≤3 (e.g., "look at the papers" bundles reading everything on the bench). **Every option shown must be something a real person in that moment would actually consider** (no filler like "take a breath" for a player who isn't tired). **And it must fit the player's *role*** — you're a print-shop runner, not a lawyer, magistrate, or expert. A runner can't "advise a clerk on a lawful step" or "explain the Stamp Act" to someone who knows it better; those are role-implausible and break immersion. Ground every choice in what *this character, in this job,* could plausibly do or say (own a bad delivery, offer a reprint, run a route, ask a question). **Expertise/learning flows from the NPCs to the player, never the reverse.** Keeps every option meaningful and readable for a 13-year-old. Applies globally, every beat.

**Options must be distinct and specific.** No two options overlap (e.g., never both "work" and "talk while working" — it's *either* get to work *or* chat). Every label names the concrete thing: not "talk to Abigail" but "ask her about the shop." The player always knows exactly what each choice does.

**Frame the ask diegetically (make every decision legible).** Never present a decision, and especially a **multi-step construct/demonstration**, as bare options with no context. The relevant NPC or the Archive **states in-character what the player is being asked to do** right before the choice, so the player understands the *job* (e.g. Abigail: *"Now the line under it. Why did London lay this on us?"*). Frame the task, never hand them the answer. A player should never stare at options wondering what the question even is.

**Options in a knowledge check must discriminate on the *concept*, never a surface trait.** The correct answer has to be separable *by the idea being tested*, not by an incidental feature all options share. Bad: "which of these is what they're taxing?" when every option is a piece of paper (the surface trait "paper" doesn't test anything). Good: "which is the sort of *document* the stamp must go on?" with options that split on **kind** — a legal document vs. private handwriting vs. a non-paper good. If the distractors don't cleanly separate on the concept, rewrite them until they do; a check that can be passed (or failed) on a surface cue teaches nothing.

**Gold marker unattended → Archive redirects (rule of thumb).** Any time a **gold** (selected/urgent) marker is live and the player heads away from it or idles, the **Archive warmly redirects them back to it** (the gold stays lit; the line escalates only if ignored, merging with the time-warning as dusk nears). This is the general form of the crowd-steer and the shop-exit nudge, one rule for every gold objective. Blue (available, unselected) pings never redirect, only gold does. (Interaction-Spec §1.2a.)

**Ambient background chatter runs the whole day (soft exposition, never tracked).** All day long, background NPCs trade short overheard lines carrying real period exposition (the stamp, paper prices, "no vote in London," the watch), each with a **speech glyph + attributed subtitle** so you always know who spoke. It's **ambient support, not tracked** (Interaction-Spec §2.1/§3): it never counts toward the learning gate and ignoring it costs nothing, it just makes the street live and rewards a curious ear beneath the authored/tracked curriculum. Ambient lines duck under any active dialogue, Sync, or Archive line.

**Two separate voices — NPCs live in 1765, only the Archive handler knows the meta (hard rule).** In-world characters (Abigail, Pike, Thomas, Clarke, the rider) **know nothing of the Archive, the AR overlay/HUD, "filing," Syncs, Notes, field tags, stats, or that the player is a time-traveler** — that layer is the player's private overlay, invisible to everyone in the world (B0 framing). So an NPC can **never** reference those systems (e.g. Abigail must not say "what you filed with the Archive"). NPC lines, including any in-beat correction, are grounded **only in what that person could plausibly know in 1765** (Abigail knows the tax, the war, her own trade). The **Archive AI handler is the only voice that speaks in meta/assessment terms** (Syncs, "before we file," Notes). When a demonstration needs a correcting tell, the NPC gives it *in-world* ("that's my fee, not why the Crown wants the money"); if a meta nudge is ever needed, the handler delivers it separately. Never blur the two.

**Dialogue & Archive voice — human, plain, NO em dashes (hard rule).** Every line of in-fiction text — NPC dialogue, Archive/handler lines, field tags, flicker/card labels, in-world signage — is written the way a real person (or a terse handler) actually talks: short, concrete, unfussy. **Never use em dashes (—) in any in-fiction text**; use a period, comma, or colon instead. Avoid "AI-tells": no over-hedged, over-balanced, or lecture-y phrasing, no stacked clauses, no "it's not just X, it's Y" cadence. If a line sounds like a chatbot wrote it, rewrite it. (Design *prose* in these docs can use dashes freely; this rule governs only text the player sees or hears.)

**Gamify the execution of any action-bearing choice (L17).** If a choice involves real movement/animation (not just talking), don't cut away or auto-resolve it — give a short gamified execution in the fitting camera: **1st person for precise hands** (tuck, fold, clean, pour, operate, read) and **3rd person for gross-motor/spatial** (dodge, vault, climb, push-through, evade). Effort-tier by default, the decision already made. Pure dialogue/cognitive choices are exempt. Author these liberally — it's free engagement and, in 1st person, free legibility.

**Player-authored, not game-imposed (core principle).** Wherever the game would script a beat (a fumble, a stumble, a slip), convert it into a player action instead. Same seconds, same content — passive becomes active, at zero time cost. Critically, **failure must be self-attributable:** a smudged proof because *you* rushed the pull is fair and motivating; a smudge the game forces on you to move the plot is a cheat and deters. Immediate world-reaction is the legibility mechanism for tight loops (mistime → the world reacts *now*). For **delayed** consequences (a trust choice paying off beats later, an informer triggering a later stop), add a small **callback** so the player connects effect to cause.

**Field tags** (Archive naming a term): fire only right after you personally did/heard/saw the thing, once per concept per run, peripheral, ≤2 per scene.

---

## 6. Beat sheet

> Per beat: **Camera → Setting → Shown → Verb/mechanic → Choices (tagged) → Consequences → Field tag → Teaches → Carrier.**

### B0 — Archive intake & temporal insertion
- **Camera:** Archive UI overlay → transition to 3rd person on the ground.
- **Setting:** the game opens *inside the Archive interface* as the player is being transported, not already in the street.
- **Shown (intake sequence, ≤25s):**
  1. Identity synchronization — mission window (Boston, 14 Aug 1765), cover identity (Abigail Mercer's print-shop runner).
  2. Context record (the only opening exposition): *War with France ended 1763 · Britain deep in debt · Parliament turns to the colonies for revenue.* One map, one causal arrow. **Flash an actual period article in the hologram (not just a summary card).** As the context plays, the Archive projects a **real source document** into the holo, a period newspaper column or a Crown notice on the war debt and the new revenue plan, brought up large enough to read a line or two before it fades. This grounds **①-exp1** in an actual artifact the player *sees*, not an abstract bullet, and it previews the tracked reads to come (the B7.5 Custom House proclamation echoes this same source-type). It's part of the authored intake carrier (still counts as ①-exp1 via `RCC.DEBT_POLICY_INTRO`); the player doesn't have to interact, the intake shows it.
  3. Assignment (diegetic, NOT a thesis): *Report to Abigail Mercer, print shop owner.* The academic "driving question" stays a backend curriculum artifact — **never shown on-screen as a leading prompt.** Curiosity comes from the tense street, not from the Archive stating the lesson.
  4. **TEMPORAL INSERTION** → the UI dissolves and the player materializes into the 1765 street.
- **Objective marker + Today strip are one system (couple them).** Every "place to go" is simultaneously a **world ping** (where) and a **Today-strip line** (what's left); they're the same objective shown two ways and always agree. Diegetic AR pings, Fortnite-style, subtle — never a full quest arrow. Two colors:
  - **Gold ping = the active target right now** — the selected destination, or the sole/urgent objective. The strip promotes it to the active line. A timed gold ping also carries the waning-sun/bell glyph.
  - **Blue ping = an available, not-yet-selected objective**, with a **live distance readout** (`20m`) that updates as you move.
  - **Strip evolves with the task set.** On insertion the strip shows a **single line — "Go to Abigail's shop"** — gold, because it's the only task. After Abigail loads the bag it becomes **today's four errands**; then whatever follows. The strip is never stale.
  - **Two multiplicity cases (this is the key distinction):**
    - **Must-do-all, order-free — pick one, focus, repeat (the four deliveries).** Leaving Abigail's is **self-driven** (obvious: exit the door, like leaving Pike's — no choice menu). The moment you're **outside**, all pending stops show: **N blue pings + N strip lines** (start of day = 4 & 4). You **pick one** (click its ping/strip line) and the field **collapses to that one: 1 gold ping + 1 strip line** — the others **hide** so you have a single focus, no clutter. Finish it → it checks off and the **remaining stops resurface**: 4&4 → pick → **1&1** → done → **3&3** → pick → **1&1** → done → **2&2** → pick → **1&1** → done → **1&1** (the last, straight to gold). The pending set always returns after each completion until every stop is done.
    - **Mutually-exclusive choice** (e.g. which *route* to take): selecting one makes it gold and the **alternatives vanish for good** (only one was ever going to happen). Same collapse visual as above, but the unchosen options never come back.
  - **Why the collapse either way:** the world only ever shows blue when you genuinely have several live options to choose *between*; once you've chosen, it's a single gold target + a single strip line, so guidance is never cluttered.
- **Shop sign:** a carved hanging sign that reads like a real period storefront — **"MERCER'S PRESS"** — ideally with a small printing-press emblem (period shops used pictorial signs). Not a modern directory label.
- **Verb:** Field tag / Archive (intake), then Move / traverse world (teaches movement) toward the shop.
- **Choices:** none consequential.
- **Teaches:** postwar British debt → revenue policy (via the context record; the world supplies the "why").
- **Carrier:** `RCC.DEBT_POLICY_INTRO` commits during intake.

### B1 — Entering the shop
- **Camera:** 3rd (approach) → transition inside.
- **Setting:** the shop door; press thumping inside.
- **Verb:** Move + a small choice of how you enter.
- **Choices:** knock / walk in / glance in the window first *(free — sets Abigail's first line only, no delta)*.
- **Teaches:** — (framing).

### B2 — The press (tutorial + Stamp carrier, part 1)
- **Camera:** **1st.**
- **Setting:** ink, damp paper, Abigail mid-run. She needs hands, not conversation: *"You the new runner? Good, catch."*
- **Shown:** sheets coming off the press; the bench holds a legal proof stamped with the **new paid-stamp line** beside the shop's unchanged plain form.
- **Verb:** **Operate — as a real skill mechanic.** The press pull is a **timing/pressure action**: a needle **oscillates back and forth** across a bar with a green "sweet spot," and **each pass gets faster** — so you can't sit and wait for a perfect frame; the rising speed forces a commit within a few sweeps. The player commits the pull (press-and-release / click) to land it; the tighter window on later passes means hesitating actually *lowers* your odds. Buildable with no mocap — it's UI + the prop (bar/platen) animating, character holds a pose. *(Reusable timing-Operate pattern: oscillate + accelerate is the default for any timed skill beat, so waiting is never the dominant strategy.)*
- **Graded outcome (skill expression, ripples forward):**
  - **Crisp** (sweet spot) → clean impression.
  - **Usable** (near) → passable.
  - **Smudged/faint** (miss) → spoiled sheet.
  The **paying job — Pike's deed proof — is the high-stakes pull.** Its quality carries downstream: a crisp proof → Pike is satisfied (+Respect) and Abigail notes you're careful (+Respect); a smudged proof → problem at Pike's (he complains / it's questioned) and Abigail is more supervisory. Broadside quality is minor flavor (how presentable the handbills look).
  - **Abigail never pre-instructs a reprint.** A smudged proof isn't redone at the shop — she's harried, the street's turning, so it **goes in the bag as-is** and becomes *your* problem to answer for at Pike's. Reprinting exists **only as a choice at B6** (and it's the full loop back here, per B6). So the smudge is a live consequence you carry, not a chore Abigail hands you.
- **Learning is never gated by skill.** The Stamp Act comparison (B3) and its carrier commit regardless of how well you pull. Skill affects relationship + local object condition only. Accessibility equivalent (e.g., a simple confirm) yields a "usable" result and the same learning.
- **Choices:** the pull itself is the interaction; timing is the skill. *(≤3 framing if we surface intent, e.g., quick/steady/hard pull.)*
- **Teaches:** the printer is directly hit by the Stamp Act — this is her livelihood; and that the craft has real technique.

### B3 — Compare the proofs (Stamp carrier, part 2)
- **Camera:** **1st.**
- **Verb:** **Read / compare** — the stamped proof and the plain form sit **side by side** on the bench, stamp corner next to no-stamp corner. The difference is obvious in half a second — no spot-the-difference hunt. (Focus-Inspect legibility rule, Production §2B/§4.)
- **Choices:** *(free probe)* read them closely — same wording, same kind of document; the only difference is the **required stamp, effective Nov 1**, now demanded on ordinary legal paper.
- **Field tag:** → **"Stamp Act: an internal tax on printed and legal paper. Takes effect 1 Nov 1765."**
- **Teaches:** it's an *internal* tax reaching everyday documents, not just a port duty.
- **Carrier:** `RCC.STAMP_INTERNAL_INTRO` commits here (banked in the shop, so a failed Pike delivery can never lose it).

### B4 — The assignment & the street
- **Camera:** 3rd (Abigail), 1st (load bag / read broadside).
- **Shown:** Abigail loads the bag — **four errands**: Thomas's circular, Pike's proof, the handbill bundle for the rider leaving at the evening bell, and **a notice to post at the Custom House** (plus a subscription to collect there). Short, human: *"Four stops. Rider goes at the bell, don't miss him. Street's already ugly."*
- **Leaving is free-roam + self-driven — NEVER a "go / look around" menu.** When the Abigail scene ends, the player simply has control back: they can walk the shop freely (examine the press, shelves, drying line — ambient flavor, no listed options) and **step out the door whenever they want.** There is no choice prompt for leaving. If they linger too long and burn time, the **Archive gives a gentle nudge** (*"Bell won't wait. Four stops."*) — idle handling is the Archive's job (L11), never a menu and never a spawned NPC. This is the model for every "the only real next action is leave" moment (L10 self-driven).
- **Ambient wall bills (support only — do NOT count).** The walls near the shop are papered with bills; one reads **"NO TAXATION WITHOUT REPRESENTATION"** in bold block type. This is **atmosphere, not a tracked exposure** — the player may walk right past it, so it can't count toward representation's threshold (see §2C tracked-vs-ambient). It just seeds the slogan in the air. The *tracked* representation read is B5.5.
- **Pick-one-focus deliveries (no route-order menu).** Stepping outside, all **four** stops show as **blue pings + strip lines** (§B0). The player **picks one** → it goes gold, the others hide till it's done, then resurface (**4→1→3→1→2→1→1**). This *is* the first time/exposure decision; it is not presented as a numbered "choose route order" list — it's the marker/strip selection itself. Only the **rider carries the bell/waning-sun glyph** (the one timed stop).
- **Teaches:** — (agency / sets the run); the slogan is in the air, to be *earned* as a tracked read shortly.

### B4.5 — Town notice-board (Stamp exposure ②-exp2, tracked) — on the early street
- **Camera:** 3rd (approach) → **1st** (focus-read).
- **Trigger:** passing the town square / public notice-board on the way to the first stop. An **interaction glyph** marks an **official posted Stamp Act notice** — a real tracked read, not wall-dressing.
- **Verb:** **Read (Focus-Inspect).**
- **Choices (≤3):**
  1. Read the posted Stamp notice — *(free probe, but **tracked**)* → the schedule of stamp duties on legal papers and newspapers, **"to be in force the First of November."** A second, *official* framing of the tax (distinct from the shop proof at B3). Logs **②-exp2**.
  2. Keep moving — *(free)* skip it (Stamp then leans on B3 + Pike's convo, and the Director reroutes the missing occasion if needed).
- **Why here (not at Pike):** pulling this official read onto the early street **de-clutters Pike** (his stop is already the day's learning-dense hub) and gives Stamp two occasions by early street, so its Sync fires cleanly once Pike's convo lands.
- **Teaches:** the Stamp Act as *official law with a hard start date*, in the Crown's own words — reinforces B3's "it's a tax on the paper."

### B5.5 — First-stop tracked read (representation, occasion 1) — anchored to the stop you just finished
- **Camera:** 3rd (notice it) → **1st** (focus-read).
- **Trigger:** the moment the **first** of the four errands completes, a tracked **broadside is posted right at that stop's exit** (on the wall by the door you're leaving). Fires once per run. **Order-agnostic by design:** because delivery order is free, we can't know which way "en-route" points — so it's anchored to *where you already are* (the stop you just left), not to an unknown next leg. Broadsides are plastered all over town anyway, so one by the exit is plausible, not contrived.
- **Diegetic justification — it wasn't there when you arrived.** The wall was bare on the way in; **someone pasted it up while you were inside** (paste still wet). This does double duty: it explains the fresh appearance *and* makes the **living world + the passing clock legible** — the stop's activities (the read, the gamified tack, collecting) **took time** (L18: activities cost time, traversal doesn't), and the world visibly moved on while you worked. The day is now a touch later than when you went in — felt in the light and the thickening street, not a timer.
- **Verb:** **Read (Focus-Inspect)** — a **real, tracked interaction**, not wall dressing: an interaction glyph marks it; a tracked read only logs on the full action (**in range → interact → 1st person → read**, per §2C). The Archive may prompt it if it's not obvious, but proximity alone tracks nothing.
- **Choices (≤3):**
  1. Step in, interact, read the broadside — *(free probe, but **tracked** on the read)* → the focus-read: "no taxation without representation" spelled out plainly. Logs representation exposure ①.
  2. Keep moving — *(free)* skip it (representation then leans on Thomas + the handbill to reach its 3 tracked occasions; the Director reroutes if one is short).
- **Why here:** honors "make the poster a tracked option after the 1st task" — verifiable, order-independent, and respects the ≤3-option cap without cluttering the opening street.
- **Teaches:** representation as an explicit slogan (tracked), before anyone explains *why* it matters.

### B5 — Thomas Bell, merchant
*(Help-Thomas is an **effort-tier, unfailable** activity — mash/hold to haul the bolt; always completes; the favor is earned by the choice to help, not by performance. See §5 activity tiers.)* (circular)
- **Camera:** 3rd (talk); 1st (help / read notice).
- **Setting:** his counting-house off the square; he's pulling good cloth off the shelves before the street turns.
- **Shown:** on the wall, an official **port-duty notice** (duties he already pays) vs. the new stamp everyone's furious about. His line: *"It's not the shilling. It's the not being asked."*
- **Verbs:** Talk-Choose; optional Carry (help move cloth); Read (the notice).
- **Choices:**
  1. Help move & cover the cloth — `costs time` · `earns a favor` *(Thomas now owes you → opens his dock route)*
  2. Beg off, you've got a clock — `saves time` · `no favor earned` *(Thomas owes you nothing → his dock route stays closed)*
  3. *(free)* Ask: "You think it comes to real trouble?" — his read on the boycott
- **Consequences:** delivers `OBJ.THOMAS_CIRCULAR`; sets Thomas band; may unlock dock route.
- **Field tag:** if he explains the boycott → **"non-importation: merchants refusing British goods to pressure Parliament."**
- **Teaches:** cost vs. authority; the merchant response (non-importation).
- **Tradeoff note (L18/L19 — helping is a gamble, not a freebie).** Option 1 is genuinely good (Thomas **Obligation** + the dock route) but it **spends time**. If it tips you past the crowd's critical mass with **Pike still undelivered**, the **fixed event interrupts and sweeps you in (L19)** before you reach him → Pike **misses** → **Abigail's Trust and Pike's Respect drop** (§7), carried to Day 2. Learning still reroutes (Stamp banked at B3); the *stakes* land. "I'll help, I've got time" is a bet on the clock — the real-life opportunity cost the game runs on. *(You did the rider first, so you have slack here — but the mechanic is always live.)*
- **Thomas's line is representation's tracked convo exposure** (occasion ②); with the broadside + handbill (article) that meets the ≥3-occasions/≥2-types threshold, arming representation's understanding Sync before B12.
- **Learning is embedded in the action, not gated behind a separate option (§0 corollary).** Options stay distinct — **help / beg-off / ask** — never "help" vs "help and talk." But choosing **help** *includes* Thomas's teaching dialogue (non-importation, "it's the not being asked") delivered **while you haul the cloth**, so the extra time you committed also carries the learning. **Ask** gets the same content cheaper (small time, no favor earned). **Beg-off** skips it here (reroutes, L3). No committed time is wasted on pure non-learning action.

### B6 — Pike, court clerk (proof; Stamp reinforcement)
- **Camera:** 3rd (talk); 1st (hand off / verify proof / read notice).
- **Setting:** a cramped clerk's office near the courthouse. Pike is practical, apolitical, harried — he just wants his documents to *work*. **This is the day's learning-dense hub stop** — Stamp completes here and its Sync + demonstration land here — so it's deliberately kept clean (two spoken lines, one delivery choice, one short sort), with the *official* Stamp read pulled out to B4.5.
- **Shown — Pike's two lines carry two exposures (convo), grumbled, never a lecture:**
  - **②-exp3 (Stamp):** he needs the legal proof finished; come Nov 1 every deed and writ needs costly stamped paper he can't get yet. *"A tax on paper. On the very paper the law's written on. How's a man supposed to do business?"*
  - **①-exp2 (economic policy):** the *why*, said flat and practical, not political: *"London had a war to pay for. Guess who they sent the bill to."*
- **② completes here → Sync 1.** With B3 (compare) + B4.5 (town board) + this convo, Stamp hits its 3 tracked occasions. The **Archive interjects one short question — Sync 1 (Stamp understanding)** — right after the handoff (*"Before I file, what is that stamp, really?"*, kid-natural options; positive-only). Passing it flips ② to *Understood* and arms **B6.5** (the ② demonstration).
- **Verbs:** Hand off; Consequential Social.
- **Choices (a runner's real decision — how you answer for the *smudged proof you just handed over*, NOT legal advice).** The player is a delivery boy; the plausible tension is standing behind your own work, not lecturing a clerk about the law he knows better than you:
  1. **Own it, offer a clean reprint** — "That one's on me. I'll run you a fresh copy." — `costs time` (**a full loop**) · `earns respect` → **overshoots *above* baseline** (going out of your way to make the work right leaves Pike rating you *more* capable than a clean-but-indifferent delivery would have)
     - **The reprint is a real traversal loop, not a menu tick.** Choosing it sends you **back to Mercer's Press, re-runs the B2 press-pull mechanic** (a fresh chance to land it crisp), then **back to Pike** to hand over the clean copy. That's a genuine chunk of the clock — enough that a late-day reprint can tip you past the crowd's critical mass (L18/L19) and cost you a *different* stop. Real opportunity cost, self-chosen.
  2. **Own it, let it stand** — "That's my rush, sorry. It'll still serve." — `earns respect` → **recovers to ~baseline/neutral**, no **extra time block** beyond the routine short-dialogue clock nudge (owning it undoes the ding)
  3. **Brush it off / blame the rush** — "Whole street's slammed today. It reads fine." — `loses respect` → **stays low / drops further**
- **Outcomes are dynamic, relative to Pike's *current* lowered Respect (not flat deltas).** Because the smudge already put him low, owning it *recovers* and the reprint *overshoots* — a mistake + a real fix can end **higher** than never erring. The post-commit card confirms the resulting band with the cause. (If the proof had been crisp, there's no deficit to recover, so a clean handoff simply sits at the raised baseline.)
- **Learning is in Pike's lines, never in a player lecture.** The Stamp reinforcement + economic-policy exposure come from *Pike* grumbling (he's the expert here); the player's choices only handle the delivery + optionally probe. So learning lands on every branch (L3).
- **Proof-quality branch (adapts to B2).** The above is the **smudged** path (this run). If the proof came **crisp**, there's no smudge to answer for: Pike's satisfied (+Respect from clean work, the B2 cascade lands *positive* here), and the beat is a quick warm handoff + the same optional probe. Either way, same learning.
- **Consequences:** `OBJ.PIKE_LEGAL_PROOF` delivered (or missed/damaged → reroute; Stamp carrier already banked in B3).
- **Pike's card unlocks here (cascade payoff).** Meeting Pike is the first time his People card exists, so his **Respect** reveals *now* — carrying the effect of the **morning press pull** (a clean proof reads as capable, competent work; a smudged one surfaces here as sloppy craft, naming the cause: "the smudged proof from this morning"), plus the delivery choice above. This is the concrete example of commit-at-cause / reveal-when-felt (§4A).
- **Teaches:** the Act reaches ordinary legal life, not just politics.

### B6.5 — Pike's papers (② Stamp *demonstration*, applied) — fires right after Sync 1
- **Camera:** **1st** (hands on the documents).
- **Trigger:** immediately after **Sync 1** (② Stamp understanding) passes at Pike — so it only appears once Stamp is *Understood*. If ② isn't Understood here (e.g. an exposure rerouted late), this beat is skipped and the demonstration reroutes to the **B12 evidence pick** (L3/L20 catch-all).
- **Setup (role-plausible — a runner sorting under the clerk's eye, not giving legal advice):** Pike, grumbling, shoves a short stack at you: *"Come November these all need the stamp, or they're worthless. Sort me the ones that'll need it."*
- **Verb:** **Sort / flag (applied Inspect)** — a small pile of items (a deed, a court writ, a printed newspaper, a **personal letter**, a **wooden tool**). Drag each into **needs-stamp** / **doesn't** — the demonstration is recognizing the Stamp Act hits **printed & legal paper**, not everything and not goods.
- **Effect (positive-only, but the correction is *forced in-place* — closed loop).** A clean sort flips ② to **Demonstrated**, confirmed **diegetically** (Pike's nod / the world moving on) — **no "Added to Notes" flicker here**, since Stamp already entered Notes at its Understanding Sync. A miss is **never** deferred and never shamed: the beat **stays in the same 1st-person scene with the pile still open**, and Pike gives a **directional nudge, not the answer** (he's not scolding, and since you already showed you get the Stamp Act he only jogs you: *"That one? Would the Crown fuss over what a man writes to his own sister? Think which of these is printed, or made official."* — rules out the letter and points the way without naming the sort). The mis-sorted item sits half-placed, waiting; the player **must move it to the correct pile to leave the beat**, at which point ② flips to Demonstrated and the world moves on. So you can't exit carrying a wrong mental model. (The B12 catch-all reroute is only for when this beat **never fires at all** — ② not yet Understood when you reach Pike — not for an in-scene miss.) This is ②'s **day-of demonstration** (a game action, not a Sync).
- **Teaches (by doing):** the Act's *scope* — legal documents and printed matter, effective Nov 1 — is a concrete, bounded thing, not a vague "tax on everything."

### B7 — Clarke, Loyalist shopkeeper (perspective + mistrust risk)
- **Camera:** 3rd (talk); 1st (conceal handbills).
- **Setting:** you pass Clarke's shop on the way toward the town edge. He's tense, watchful, no friend of the crowd.
- **Engagement (reusable encounter model — Production §2AA).** Clarke is **staged in his shop doorway on the main road to the rider** — he never crosses the street or chases you. A quiet AR interaction glyph marks him as engageable; nearing him triggers a directional **bark** (*"Liberty, they call it…"*). **His challenge is what opens the choice, and it fires the moment you're adjacent to him — on *either* side of the street.** Walking the far side does **not** dodge him: as you come level, he calls across — *"Hold a moment. What's that you're carrying?"* — and *that question* prompts the decision. (He's near enough to see the bag; the street's narrow.) **The only clean avoidance is not being on his street at all — Thomas's dock route.** Take the water and he never gets the chance to ask; the handbill exposure then reroutes (L3). But if you're on his road, far side or near, you get the question.
- **Trigger via dialogue, not subtle animation.** Intent is carried by his spoken line + turning toward you, never a subtle gaze-linger we can't animate (Production rule). His Loyalist view surfaces in his lines whichever way you answer: *"this 'liberty' is just mobs and broken windows. The Crown feeds this town."*
- **Camera:** gentle framing nudge toward Clarke on zone entry → clean cut to Talk-Choose two-shot on engage → back to traversal cam on exit.
- **Verbs:** Talk-Choose; **Conceal** (the committed-action execution, gamified per L17); free probe.
- **Conceal = a first-person tactile mini-mechanic (not a cutaway).** When the player chooses to hide the bundle, the decision's done — but the *doing* is a short **1st-person effort-tier** action: you **fold the plain wrap over the handbills** (drag/hold to fold the paper across, a couple of tuck motions), unfailable. It's built with no mocap (1st-person hands + prop-fold), it's a small fun beat, and crucially the **bill's face is legible as you fold it over** — that up-close read is what makes this a **tracked representation exposure (occasion 3)**. Result: `OBJ.CARRIER_HANDBILLS` condition → concealed-in-wrap. *(Same 1st-person-execution pattern reused for every tuck/fold/wrap/handle beat, learning or not — L17.)*
- **Choices (Clarke's dimension = political read: threat vs. harmless):**
  1. Give a calm cover and wrap the bundle ("overruns for the rider") — `reads as harmless` · triggers the **gamified conceal/focus-read** above, logging ③-exp3
  2. Get curt / tell him to mind his own — `risky · reads as a threat` (suspicion up → may inform → feeds §6 caught-anyway; bundle remains exposed, no tracked read here)
  3. *(free)* Hear him out — his fear of disorder and loyalty to the Crown (teaches: not all colonists were patriots; bundle remains exposed, no tracked read here)
- **Consequences:** sets Clarke band; concealment state on the handbills; may arm the informer path.
- **③ completes here only on the conceal branch → Sync 2.** If option 1 fires, the concealed-handbill focus-read is representation's **③-exp3**; with B5.5 (broadside) + B5 (Thomas's line) it hits 3 occasions. On leaving Clarke's zone the **Archive interjects Sync 2 (representation understanding)** — one short question drawing on the slogan the player has now read/heard three times (positive-only). Passing it flips ③ to *Understood*, so **B12's headline option is legitimately available** (the validity gate). If the player chooses option 2/3, skipped an earlier exposure, or avoided Clarke through the dock route, the Sync holds until the Director supplies the missing typed fallback; the headline remains gated until then.
- **Teaches:** **not all colonists were patriots** — fear of mob rule, attachment to empire (kills the "everyone agreed" misconception).

### B7.5 — The Custom House (① policy exposure ①-exp3 + ① *demonstration*) — order-free stop
- **Camera:** 3rd (enter) → **1st** (read proclamation / post the notice).
- **Setting:** an **indoor location** — the Custom House hall: clerks' counters, ledgers, the Crown's arms, and a **public posting board** inside where official notices go up. This is the day's **4th errand**: post Abigail's notice, collect the subscription. (No new named NPC — a harried clerk barks ambiently; the beat is you + the board + the notice.)
- **Reusable interior (multi-day setting reuse).** Like the print shop, Thomas's counting-house, and Pike's office, the Custom House is a **built interior we re-dress and repurpose across Boston Days 2–4** (a duties dispute, a seizure hearing, a place to be questioned in 1770). Adding it now pays for itself — it's another authored room in the shared district, not a one-day set (Production §6 shared-environment).
- **①-exp3 — the revenue proclamation (tracked read).** Beside the board, an official **Crown proclamation** carries an interaction glyph: *"…for defraying the expenses of defending and securing the colonies… such duties and taxes…"* A focus-read the engine logs — the *why* of the tax in the Crown's own words (war debt → colonial revenue), distinct from the B0 overlay and Pike's offhand line. Logs **①-exp3**; with B0 + Pike this **completes ①** ⇒ **Sync 3 (policy understanding)** fires here.
- **Posting the notice is a gamified 1st-person execution (L17).** It's a real hand-action, not a menu tick: camera to 1st person, **line the notice up on the board and press/hold to tack it** (a couple of nail taps), effort-tier/unfailable. Reused tuck/handle-execution pattern.
- **① *demonstration* — choose the right column as you post (applied).** When ① is Understood (Sync 3 passed), the posting board has **headed columns**, and the *same tacking action* requires you to place the notice under the correct one: *"By order of Parliament, to raise revenue from the colonies"* (**target**) vs. distractors *"By the printers' guild"* / *"For the town's own use."* The cause-pick is folded **into** the gamified post — hand-action + attribution in one beat — and a valid placement flips ① to **Demonstrated**, confirmed **diegetically** (the notice sits under the right column, the clerk moves on) — **no "Added to Notes" flicker**, since policy already entered Notes at Sync 3.
  - **Reroute (L20):** if you reach the Custom House **before Pike** (① not yet Understood), the proclamation still logs as the tracked read and the post is the **plain** gamified tack (no column choice); **①'s demonstration reroutes to the B12 cause-line.**
- **Consequences:** notice posted (or missed → reroute, §7); subscription collected (minor — affects nothing but flavor/Abigail).
- **Note (order-free placement).** Like Thomas/Pike/rider, this is one of the four order-free stops; it's written here for readability, not to fix its sequence. Its position in the timeline is wherever the player chooses to run it.
- **Teaches (by doing):** attributing the tax to its **actual cause** — postwar debt and a Parliament deciding the colonies should pay — over plausible-but-wrong causes (the printer's fee, local use).

### B8 — The street turns (traversal / evasion to the rider)
- **Camera:** 3rd (traverse/evade); 1st (re-conceal if needed).
- **Setting:** the square fills toward the elm; effigies visible; customs men and the constable working the crowd's edge, checking bags.
- **Verbs:** Choose route; Move-through-crowd; Vault/duck (if a lane closes).
- **Choices:**
  1. Cross fast past the watchers — `saves time` · `risky` (visibility draw)
  2. Back lanes — `costs time` · safe
  3. Thomas's dock route — `saves time` · safe *(only if Thomas owes the favor / route is unlocked)*
- **Consequences:** watcher heat; if `risky` fails **or** Clarke informed → **B9**. Otherwise → **B10**.
- **Teaches:** how resistance material moved through a watched town; the enforcement net.

### B9 — Caught anyway (fair, unlucky, still teaching) — conditional
- **Camera:** 3rd (the stop); 1st (bag inspection).
- **Trigger:** failed `risky` route, or Clarke informed, or high watcher heat.
- **Setting:** a **customs officer / constable** blocks you: *"Hold. What's in the bag?"*
- **Verbs:** Consequential Social; Read (bag inspect); optional Skill (slip away).
- **Choices:**
  1. Comply, open the bag — if handbills are concealed in plain wrap (B7), likely passes *(risky draw)*; if exposed → **confiscated** (bundle lost → reroute), heat up
  2. Talk your way out — "just shop errands" *(social draw; harder if Clarke informed)*
  3. Slip away — duck into an alley (skill) — `risky` · `draws attention`
- **Field tag:** → **"writs of assistance: general search warrants letting customs officers search for smuggled goods."**
- **Teaches:** customs search power (a live grievance since Otis, 1761) **and** the nuance that the Act isn't even in force yet and handbills aren't contraband — so this is intimidation and suspicion, not clean law. **Never a dead end:** you still reach the event; learning reroutes.

### B10 — The rider handoff (handbills)
- **Camera:** 3rd (approach); **1st** (the tense handoff).
- **Setting:** a post rider at the town edge/Neck, about to leave with news for other towns.
- **Verb:** **Hand off** — **1st-person gamified execution** (L17), not a cutaway. The pass is a tactile hand action:
  - **Quick/open** → a fast **press-to-shove** the parcel across; snappy, but if watchers are near it draws a risky visibility draw.
  - **Wait for a gap** → a short **1st-person timing beat**: a passer-by/patrol crosses the frame, and you **press to pass on the gap** (effort-tier; miss just means you hold and wait for the next gap — safe, costs a beat).
- **Choices:**
  1. Open, quick handoff — `saves time` · `risky` if watchers near
  2. Quiet, wait for a gap — `costs time` · safe
- **Consequences:** `OBJ.CARRIER_HANDBILLS` delivered / missed / lost → §7 reroute; resistance network's read on the runner (carryover).
- **Teaches:** ideas and organized resistance spread through informal news networks between towns (precursor to committees of correspondence).

### B10.4 — Step out into the gathering crowd (free-roam) + the high-visibility representation board (③ reroute opportunity)
- **Camera:** **3rd** (free-roam) → **1st** (focus-read the board, if taken).
- **Trigger is the *hour*, not "errands done" (L18/L19).** The crowd forms at this time of day **no matter what the player got through** — the fixed event is a time-locked anchor and everything funnels into it. Two ways the player arrives at this free-roam-into-the-crowd phase:
  1. **Errands finished in time (this run).** The player wraps their last stop and simply **walks out — free-roam, never a menu** (self-driven exit, L10/L11). By this hour the **crowd is already forming toward the square** (distant chant, people all drifting one way, light gone amber). That pull *is* the draw toward B11.
  2. **Still mid-errand when it's too late.** If the player dawdled and the clock runs out with stops unfinished, the active interaction reaches its next authored safe phase/terminal checkpoint (complete, partial, or interrupted as that action declares), then the **Archive interrupts**: *"That's it. Light's gone, shops are shuttering. Whatever's not done is done."* The player must **acknowledge** it (a single confirm — see Interaction-Spec §8); any unfinished errand **closes as missed → reroute + relationship stakes** (§7). Then the *same* crowd-forming free-roam takes over. **Learning is untouched** either way (L3): a missed errand only changes *how* its carrier is delivered (fallback pool, §7A), never *whether*.
- **Either path lands here**, and both feed B11 — the point is that *whatever* shape the day took, the crowd + fixed event are waiting at this hour, and the required learning still arrives.
- **The board is impossible to miss visually, but its read remains optional.** On the one sensible path toward the crowd stands a **posted broadside / notice-board** with an interaction glyph, sited so the player sees/passes it (unlike the earlier B5.5 broadside). If ③ is short an occasion/type, it offers a tracked article exposure — *"no tax laid on us but by our own consent…"* — but the player still has to interact and focus-read for it to count. If earlier tracked reads landed, it stays ambient flavor.
  - **Verb:** **Read (Focus-Inspect)** — in-range → interact → 1st person → read (Interaction-Spec §3). Blowing past it commits nothing; B11 plus the mandatory B11.5 evidence desk close any remaining deficit. The guarantee never depends on voluntarily reading this board.
- **Free-roam, then an encouraging nudge — not a prompt-stack.** After a **breather** (~7s free-roam; Interaction-Spec §7) the player is free to wander; if they don't head toward the crowd, the **Archive gives a warm, inviting steer**, *"The crowd's gathering, let's go check it out."*, and **a gold marker drops on the crowd/square the moment that line fires** (gold = the now-active objective; pick-one-focus, Interaction-Spec §1), so the steer comes with a clear where-to-go. Escalates to a **time-warning** only if they still linger (Interaction-Spec §8). Gentle and encouraging, never a forced walk.
- **Not hard-locked to any stop or to "all errands done."** Written here for readability, but its real trigger is the **crowd-forming hour** — it lands wherever the player is when the day tips late, whether they finished clean or got the shops-closed interrupt.
- **Teaches (if read):** the core grievance in the colonists' own words — being taxed **without their consent / representation** — the ③ thread the headline (B12) will resolve.

### B10.5 — Archive day-synthesis & catch-all (fires when the errands complete / dusk nears)
- **Camera:** overlay (Archive), whatever view the player is in.
- **Trigger:** the moment the errands are done (order-free, so this fires off the *last* one) or the clock nears dusk. Designed to land as the world runs out of authored pulls.
- **Why here:** authored objectives are now exhausted; the world has nothing left to pull the player, so the **handler steps in** rather than leaving them idle (see §5 "defined objectives run out").
- **Two jobs (not a fresh understanding Sync in the normal run):**
  1. **Synthesis / tee-up.** In the representative run all three concepts already reached Understanding earlier (Syncs 1–3 fired at Pike/Clarke/Custom House). So B10.5 is a *short synthesis*, not a new quiz: the handler ties the threads and points at the unresolved half — *"Cost, the paper, the war to pay for it. But something's got them angrier than a fee. Hold that."* — then the street erupts (→ B11), and that held thought is what the headline (B12) resolves.
  2. **Catch-all Sync (only if a threshold completed late).** If some concept's exposures completed only just now (an unusual order), its understanding **Sync fires here** instead — one short, kid-natural question, positive-only. This is the safety net that guarantees each concept gets its Understanding Sync before day-end regardless of path (L20).
- **Effect (no right/wrong — ever):** any Sync here is **positive-only and implicit**. If it's a concept's **first understanding** pass, a valid read fires the quiet **"Added to Notes"** flicker (its one-time entry); the initial miss gets one re-exposure/retry cycle, and a second miss on that retry corrects in place. If it's instead a **synthesis/reassessment** of already-understood concepts, there's **no Notes flicker** — a miss gets immediate in-place correction (already-Understood rule, §Concept lifecycle). This is also the standalone **Predict/attribute** beat §10 tracks.
- **Drives what comes next:** assessment/synthesis → the fixed event, then the headline. Never a dead stop.

### B11 — The fixed event (Aug 14) — one authored cinematic, every route funnels to it
- **Camera:** **3rd** (route/approach) → **detached cinematic** (observe).
- **Setting:** dusk. The organized protest proceeds — the effigy paraded and burned, the Kilby St building pulled down, the Fort Hill bonfire, Oliver's house.
- **Time-locked anchor — always fires (L19).** This event is the day's immovable fixed point. When the clock hits critical mass it **triggers no matter what**, and if the player is still mid-errand it **interrupts and sweeps them in** (L18), closing any unfinished delivery as missed (→ §7 stakes). The variable day never changes *whether* it happens — only the **state the player meets it in**: which stops they finished, their bands, watcher heat, and which on-ramp (climb/push/chant) they take. History on schedule; the player chooses only how they're standing when it lands.
- **One authored cinematic, three on-ramps (route-invariant required delivery).** The "observe the march" directed shot (organizers elevated & lit, shouting *"To Fort Hill!"* via speech glyph + subtitle; crowd visibly obeys — raise → surge, point → turn) is **authored once.** Whichever crowd choice the player made at step-out, they funnel into the *same* cinematic, so the required carrier can never be dodged by route. Each route keeps its own gameplay:
  - **Watch → climb (Traverse):** a **state-gated** climb (crates/ladder exist only for this event, not a normal day — affordance is state, not geometry, like the dock route) to a rooftop vantage → walk into the **gold observation zone** (marker system reused as "stand here") → press **"Observe the march"** → cinematic.
  - **Push through → crowd navigation + unfailable dodge:** you shoulder through the crowd yourself; mid-push someone hurls something → brief **slow-mo, press to dodge** (*effort-tier, unfailable* — he was never going to hit you; no lesson in getting beaned). Then right before Abigail's door a second **gold "look back at the crowd" zone** triggers the same cinematic.
  - **Chant → hold-to-chant:** hold a key to take up the chant (your character's chant animation plays); as it starts the **camera pans off you to the men at the front** → same cinematic.
- **Carrier** `RCC.ORGANIZED_RESISTANCE_EVENT` commits on the cinematic (any route). **In-engine directed beat, NOT a pre-rendered cutscene.** Test: *is this a STAAR-named landmark event (Tea Party / Massacre tier)?* No — it's the *vehicle* for teaching "organized resistance," a required carrier but not a named marquee event. So it gets the cheap in-engine directed treatment (camera detaches through the live scene using existing crowd/char anim + baked staging; no bespoke render/lipsync). Pre-rendered cutscenes are reserved strictly for STAAR-named events. Route-invariance → authored/paid once, covers all three on-ramps. (Production §7.)
- **Reusable pattern:** state-gated Traverse / crowd-nav+dodge / hold-to-chant are interchangeable on-ramps to one shared witness cinematic (Production §2AA + §5 route-invariant law).
- **Field tag:** → **"Liberty Tree: the elm where the crowd hung the effigy of Andrew Oliver, the stamp distributor."**
- **Teaches:** this was **organized** (not a random riot) and **aimed at the stamp distributor** — resistance with a target and a message.
- **Carrier:** `RCC.ORGANIZED_RESISTANCE_EVENT` commits (or approved reduced-intensity / skip recap).

### B11.5 — Abigail's evidence desk (mandatory deficit closure, only when needed)
- **Camera:** 3rd (return/Abigail consequence line) → **1st** (handle/focus-read the source tray).
- **Trigger:** on return to Mercer's Press after B11, before B12. The Event Manager audits every Day 1 concept's tracked occasion count/type set and any pending post-Sync re-exposure obligation.
- **Normal run:** if all three concepts already have 3 occasions / ≥2 types and no post-Sync re-exposure is owed, this beat collapses to Abigail's consequence-specific return line and flows directly into B12. No redundant source work.
- **Avoidant/shortfall run:** B12 stays locked while the **minimum authored source-desk actions needed to close the exact deficits** become gold, one at a time. These are mandatory occupational actions, not optional wall reads: Abigail needs the source tray checked before she sets the page, the player must interact, the camera enters 1st person, and the relevant source is handled/read. Ignoring the gold invokes the normal Archive redirect.
  - **① policy fallback set:** handle/focus-read the retained war-debt/revenue article (**hands-on/article occasion**); Abigail can add one short in-world line about London needing colonial revenue after the war (**conversation occasion**).
  - **② Stamp fallback set:** compare a retained legal form requiring the Crown's stamp with an uncovered private note/good (**hands-on occasion**); Abigail can add one short line separating the Crown's stamp from her own printing fee (**conversation occasion**).
  - **③ representation fallback set:** handle/focus-read the authenticated town-instruction/handbill excerpt about consent and elected representatives (**hands-on/article occasion**); Abigail can add one short line about Boston having no elected member in Parliament (**conversation occasion**). B11 already supplies the unavoidable **scene** occasion.
- **Hard guarantee:** the compiler chooses the fewest of these pre-authored carriers that make each deficient concept reach **3 occasions across ≥2 types**. Because B0/B3/B11 provide unavoidable starting occasions and B11.5 can supply both handled-source and conversation types, even the player who skipped every optional read/conversation, missed the rider, and avoided Clarke/Thomas reaches the gate.
- **Post-Sync re-exposure reserve:** each concept has a second, distinct authenticated source-desk item reserved for the one permitted re-exposure cycle after an initial Understanding miss. It must commit after the miss transaction; the original 3/2 occasions cannot satisfy it. The retry then fires after its authored spacing boundary. A second miss corrects in place and cannot create another cycle.
- **Pacing:** this is intentionally denser only on an avoidant path. Source actions, Abigail return/consequence lines, and press setup provide the committed interactions used to separate any late Sync moments; Syncs are still never back-to-back.

### B12 — Set the headline (Representation carrier)
- **Camera:** **1st / UI.**
- **Setting:** night, back at Abigail's. She needs tomorrow's headline set from what you saw and carried.
- **Day-completion relationship realization on entering the shop (cause recorded earlier; stat takes effect here).** The errand outcomes were committed when they happened, but Abigail's **Trust band has not moved yet**. When you walk back in, she can finally assess the full day's reliability: the backend reduces those recorded outcomes into the actual Trust delta, Abigail reacts, and the matching card fires in the same moment. Nothing changes silently on the street:
  - **All errands done (this run):** a warm, approving line (*"All of it. The rider, Pike, the Custom House. You'll do."*) and a visible **trust ▲** card.
  - **Some missed:** a cooler, disappointed line (*"The rider left without the bundle. That was needed."*) and a **trust ▼** card, naming the miss as the cause.
  - Either way the delta is **legible and self-attributable** (it names *what* you did), and it never surfaced mid-errand, only here where it lands in-fiction. (Missed errands still had their curriculum rerouted, L3, so this is a relationship consequence, not a learning one.)
- **B12 is representation's demonstration + a synthesis of the day** (not three fresh quizzes crammed together). In the representative run, **② demonstrated at Pike (B6.5)** and **① at the Custom House (B7.5)** already — so B12's **formal stage-3 demonstration is ③ representation** (setting the headline). The **evidence pick** (stamped proof) and **causal source line** ("to pay for the war") beneath it **re-exercise ② and ① as synthesis**, tying the whole day into one artifact.
- **B12 is also the demonstration catch-all (L20).** If ② or ① did *not* demonstrate earlier (their home beat was reached before the concept was Understood, or skipped), its stage-3 demonstration **lands here**: the evidence pick formally demonstrates ②, the cause-line formally demonstrates ①. So every concept's demonstration is guaranteed by end of B12 on every path — spread when order allows, funneled here when it doesn't.
- **Validity gate (why representation can be an option here).** Representation appears as a headline option only because it cleared **Learning (broadside B5.5 + Thomas B5 + handbill B7) AND its Understanding Sync (Sync 2, post-Clarke)** by now (§2C). If those stages aren't met on a given run, representation is withheld and B12 drops to 2 options until the Director reroutes the missing occasion; the earlier "hold that thought" is the tee-up while it's still pre-Understanding.
- **Verb:** **Construct** — arrange movable type + choose the evidence line beneath, then ink and pull the proof.
- **Abigail frames each step diegetically (make the ask legible).** The player is never handed a bare set of options; **Abigail says, in character, what she needs before each pick**, so the player understands what they're being asked to decide. Headline step: *"What's tomorrow's front page? Set it from what you saw."* Source-line step: *"Now the line under it. A good story says why. Why did London lay this on us in the first place?"* The prompt names the *job* (the front page, the reason beneath it), never the answer. This is the general rule for any multi-step construct/demonstration (see §5).
- **Headline options (3 max — target + the two biggest misconceptions):**
  - "MOB WRECKS STAMP OFFICE" — spectacle/"random mob" only → **miss** → correction
  - "BOSTON WON'T PAY THE TAX" — cost only → **partial miss** (feeds cost-only misconception) → correction
  - "TAXED WITHOUT A VOICE" — representation → **target**
  - *(Dropped "Oliver quits as stamp man" — a true-but-not-cause distractor — to respect the 3-option cap; keep it as a rotable alt for replay variation.)*
- **Two backing picks under the headline (keep each ask crisp and single-purpose):**
  - **Cause line (① why it exists).** *"Why did London lay this on us?"* Target: **"By order of Parliament, to raise revenue after the war."** Distractors that are *clearly* wrong: **"a printing fee added by the shop"** (that's Abigail's own charge, not the Crown's) and **"after a mob burned the stamp man"** (that's the effect, not the cause). This is ①'s demonstration (or reinforcement if ① demonstrated at B7.5).
  - **Evidence pin (② what kind of thing is taxed).** Ask it as the *real* distinction, not "which is paper" (they're all paper): *"Which of these is the sort of document the Crown's stamp has to go on?"* Options differ by **kind**, echoing Pike's sort (B6.5): **a court deed** — a generic official legal document, *not* the specific proof already handled at Pike's (**target**); **Thomas's personal letter** — a merchant you met, his own private handwriting (not taxed); **a carpenter's wooden ruler** — a good, not paper at all. (Recognizable distractor + a fresh generic target, so nothing's a stale repeat of the Pike beat.) Target = the legal document, reinforcing "Stamp Act = printed & legal paper, not private writing and not goods." Reinforcement if ② demonstrated at B6.5; the formal ② demonstration if not (catch-all).
  - **Design note:** every pick must be **discriminable by the concept**, never by a trivial surface trait. If the distractors don't cleanly separate on the *idea* being tested (as "which is paper" failed to), rewrite them.
- **Correction flow (forced in-place, nudge not answer).** A miss holds the beat and triggers an **in-world Abigail nudge that points the direction without handing the answer** — e.g. off the shop-fee pick: *"That's my fee, not the Crown's reason. Why would London suddenly need money from the likes of us?"* (steers toward the cause; never states "the war debt"). Since the player already passed this concept's Understanding, a hint is enough. They re-pick until right, then it flips to Demonstrated. (Applies per demonstrated concept; a wrong evidence pick creates a transient correction-required state for that concept inside the same beat, never a later remediation loop. Abigail stays in-world — she never references the Archive/filing, §5.)
- **Teaches:** distinguish the **cause** (taxed without representation) from the **spectacle** (destruction) and from **cost alone**, and tie the tax back to *what* it hit (paper) and *why* it existed (war debt).
- **Carrier:** `RCC.REPRESENTATION_CAUSE` commits on `HEADLINE_CAUSE_COMPLETE` **or** `HEADLINE_EDITORIAL_CORRECTION_COMPLETE`. ③ reaches its stage-3 demonstration on the headline; ① and ② reach theirs at B6.5/B7.5 in the normal run, or here on the matching evidence-line pick (or its correction) as the catch-all.

### B13 — Day close
- **Camera:** 3rd.
- **Setting:** the shop settles; the headline you set is drying on the line. Abigail's end-of-day read reflects how you ran the day. Auto-save (invisible).
- **Warmth-gated extra branch (Abigail).** If you banked enough **warmth** during the day (via costed, considerate choices — never free chatter), an extra option opens that a colder run never sees: Abigail drops the wry front, lets you in on the **real risk she's running** by printing what she prints, and **hands you something that seeds Day 2** (e.g., the spare shop key / where the network meets / a standing "I'll vouch for you"). Purely additive — it grants access and flavor, never required learning. A low-warmth run simply gets her plain sign-off.
  - **Current localhost fixture:** no completed Day 1 beat presently carries a Warmth tag, so Warmth remains at baseline and this branch stays closed. The implementation must not invent a warmth choice. Opening it later requires an explicit Day 1 content revision/playtest, not backend autonomy.
- **Archive full-screen day-end card (the close).** After Abigail's final line, the **Archive UI blooms to fill the screen** (rising out of the always-on strip, same overlay language, now full-bleed) with a warm, celebratory **end-of-day summary** — the diegetic "day filed" moment. It's the one time the overlay goes full-screen rather than peripheral. Content: a short congratulatory handler line (*"Day one, filed. You held together better than most first days."*), the **day's headline you set** shown as the artifact of record, the **concepts moved into Notes today** (the three, as earned entries, not a score), and a light **relationship/route read** (who you met, what opened). Positive, encouraging, never a grade or a percentage. A **"Continue"** dismisses it into the save. This is the authored day-close screen every Mission Day ends on (generalized in Chapter-Day-Template).
- **Carryover into Day 2:** Abigail bands (Trust → candor/responsibility · Respect → harder work she'll trust you with · Warmth → the vouching/after-hours access above); Thomas **Obligation** band (dock-route favors); whether **Clarke marked you** (Day 2 starts with a known-face/heat state — which in 1770 escalates to *soldiers*); handbill outcome (did the resistance network come to trust the runner).

---

## 7. Consequence → carrier reroute matrix

| Player state | What happens to learning |
|---|---|
| Handbills delivered | shop copy + your event notes → headline source |
| Handbills missed / refused / lost / damaged | undelivered state stays true; retained shop copy + posted town notice → headline source |
| Pike proof delivered | Pike reinforces Stamp carrier; his reaction = relationship only |
| Pike proof missed / damaged | no fake delivery; B3 press comparison already banked the Stamp carrier |
| Custom House notice posted | ①-exp3 read + ① demonstration (correct-cause posting) land here |
| Custom House stop missed (swept into the event) | ①'s 3rd exposure reroutes to the retained shop copy / B0 recap; ① demonstration reroutes to the **B12 cause-line** — ① still completes; notice-not-posted is the relationship stake |
| Caught & handbills confiscated (B9) | bundle lost → posted-notice source; the search itself teaches writs of assistance |
| A demonstration's home beat reached before its concept is Understood, or skipped | that demonstration **reroutes to the next applied opportunity, B12 as catch-all** (② evidence pick, ① cause-line, ③ headline) — every concept demonstrates by end of B12 (L20) |
| Fixed event skipped (accessibility) | only the exact contract-bound recap satisfies it; traversal skill never counts |
| Any accessibility path | preapproved mechanic/presentation equivalent; same evidence + same headline demand |

**Reroute protects the learning, NOT the stakes (L3).** The column above is only "what happens to the curriculum" — it always lands. Separately, every miss/failure still carries its **relationship + world consequence**, legible and cause-named:
- **Missed / late / refused delivery** → **Abigail (employer) trust + respect down**, cause stated ("the rider left without the bundle," "Pike's proof never came") — and it **carries into Day 2** (she starts warier, less candor/responsibility). Taking too long (L18) is a live way to cause this.
- **Handbills confiscated (B9)** → the network's read on you sours (carryover), heat up.
- **Clarke read as a threat** → informer acts (the world turns, §6), independent of learning.
So dawdling into a missed delivery is never "free because the lesson is safe" — it costs you with the people who were counting on you. Everything connects.

### 7A. Type-aware reroute & the guaranteed fallback pool (HARD)

**Reroute tracks types, not just count.** L2 requires **≥3 occasions across ≥2 types** (scene / convo / article / hands-on). So the Director maintains, per concept, **both** `occasions` *and* the **set of types seen** — and when it reroutes a shortfall it **fills the missing *type*, not merely the missing count.** This is the real guarantee: a kid who **coincidentally** (not even deliberately) keeps choosing the non-expository option — only ever reads posters, or only ever talks, or skips reads entirely — still finishes the day with 3 occasions and 2+ types. We design for the fully-avoidant path even though a curious kid is unlikely to hit it; "unlikely" isn't "handled."

**Best-effort spread, guaranteed delivery.** Engaged players get the nice spread (the primary beats, interleaved Syncs). A maximally-avoidant player forces the fallbacks to fire, which means a **denser back-half** — that's the acceptable cost of skipping the spread-out chances. The *spread* degrades gracefully; the *guarantee* never bends.

**Guaranteed fallback pool — anchored on beats the player cannot skip**, spanning types so the missing type is always coverable:

| Concept | Primary (skippable) | Guaranteed fallbacks (type) |
|---|---|---|
| **① policy** | B0 scene · Pike convo · Custom House proclamation | **B11.5 evidence desk:** retained war-debt/revenue source (**hands-on/article**) + Abigail's short cause line (**conversation**), only as many as the deficit requires |
| **② Stamp** | B3 compare · B4.5 board · Pike convo | **B11.5 evidence desk:** retained legal-form comparison (**hands-on**) + Abigail's Crown-stamp/shop-fee distinction (**conversation**), only as many as the deficit requires; B9 remains an earlier consequence-compatible fallback when it naturally fires |
| **③ representation** | B5.5 broadside · Thomas convo · B7 handbill conceal | B10.4 visible board (**article**, if explicitly read); unavoidable B11 message (**scene**); **B11.5 evidence desk** town-instruction/handbill source (**hands-on/article**) + Abigail's representation line (**conversation**) as required |

**The unavoidable anchor beats** are **B0/B3**, the **fixed event** (L19 — always fires, a directed scene), and the **B11.5 evidence desk/day-close with Abigail** (mandatory handled sources + conversation types when a deficit exists). The Director uses the **fewest** fallbacks needed to reach 3 occasions / ≥2 types, always preferring the spread primary path. The rider, Clarke, Thomas, B4.5, B5.5, and B10.4 board improve spacing but are never required for the proof of completion.

---

## 8. Cast on Day 1 (1765)

- **Abigail Mercer** — anchor/employer. Busy, wry, not a lecturer. Assigns work; reads you at day's end. (Fictional composite; never presented as Abigail Adams.)
- **Thomas Bell** — merchant. Cost-vs-authority + non-importation. **Obligation** (a favor owed) unlocks the dock route. Optional carrier.
- **Pike** — court/notary clerk. Practical, apolitical; the Stamp Act's reach into everyday legal life. Optional carrier.
- **Edward Clarke** — Loyalist shopkeeper. Fear of disorder, loyalty to Crown; the mistrust-informer; kills the "all colonists were patriots" misconception.
- **Historical figures:** none physically depicted Day 1 beyond the fixed event's public target (Andrew Oliver, via effigy). Samuel Adams and others enter later days via documented public action. **No British troops in 1765.**

---

## 9. Historical grounding & accuracy notes

- **Stamp Act:** passed 1765, **effective 1 Nov 1765**; internal tax on newspapers, legal documents, pamphlets, licenses, playing cards; stamped paper bought with hard coin. Hit printers and clerks hardest.
- **Core grievance:** not merely cost — **no taxation without representation** (colonists had no seats in Parliament; the virtual-vs-actual representation dispute). This is the headline target.
- **Non-importation:** merchant boycotts of British goods to pressure Parliament.
- **Aug 14 1765 (FIXED):** effigy of **Andrew Oliver** + Bute boot on the elm (later Liberty Tree); organized by the "Loyal Nine" (crowd led by Ebenezer Mackintosh); effigy paraded/burned; building on Kilby St (thought to be the stamp office) pulled down; **Fort Hill** bonfire; Oliver's house stoned; Oliver resigns next day. **Distinct from the Aug 26 Hutchinson attack.**
- **Writs of assistance:** general customs search warrants; a live grievance since James Otis argued against them in 1761 — grounds the B9 bag search, with the nuance that handbills aren't contraband and the Act isn't yet in force.
- **Guardrails:** no British troops in 1765; compress geography freely but never teach a false distance/adjacency as fact (STAAR doesn't test street distances); fictional composites (Abigail, Thomas, Pike, Clarke) are never presented as real named individuals.

---

## 10. Pattern-completeness check (every verb exercised → Days 2–4 need no new interaction work)

| Verb | Beat |
|---|---|
| Move / traverse | B0, B1 |
| Choose a route | B4, B8 |
| Vault / climb / duck | B8 (lane closes) |
| Evade / sneak | B8 |
| Move through crowd | B8, B11 |
| Read / inspect | B3, B4.5, B7.5 |
| Compare documents | B3 |
| Sort / flag (applied inspect) | B6.5 (which papers need the stamp) |
| Place / post an item | B7.5 (post the notice under the right cause) |
| Operate a tool | B2 |
| Carry / cover / place | B5 |
| Conceal an item | B7 |
| Construct | B12 |
| Talk / dialogue choice | B5, B6, B7 |
| Free probe | B5, B7 |
| Hand off | B6, B10 |
| Witness fixed event | B11 |
| Predict / evidence / attribute | B6.5 (sort), B7.5 (cause-post), **B10.5** (synthesis/catch-all), B12 (headline + evidence line) |
| Field tag / Archive | B0, B3, B4.5, B5, B7.5, B9, B10.5, B11 |

Every verb fires at least once. The former soft gap (a standalone **Prediction** beat) is closed by the spread demonstration/assessment beats (B6.5, B7.5, B10.5).

---

## 11. Open questions (remaining)

1. ~~Prediction verb~~ — **resolved:** the spread demonstration/assessment beats (B6.5, B7.5, B10.5, B12) cover Predict/attribute.
1b. ~~12-tracked payload / spread~~ — **resolved (v0.7):** §2C matrix + timeline place 9 exposures + 3 spread Syncs + 3 spread demonstrations; day stretched with the Custom House (B7.5) + B6.5. **4 errands confirmed fine**, and the Custom House is a **reusable indoor location** repurposed across Boston Days 2–4 (a virtue, not overhead).
2. ~~**Route-order tags**~~ — **resolved for the localhost fixture:** exact labels, clock costs, risk weights, and state deltas are locked in `Localhost-Text-Slice-Spec.md`; the later Three.js presenter must emit the same semantic route results.
3. ~~**Clarke placement**~~ — **resolved:** B7 is staged on the main road; adjacency triggers from either side of that narrow street. The only clean avoidance is the unlocked Thomas dock route, which never enters Clarke's street.
3b. ~~Sync 2/Sync 3 proximity~~ — **resolved:** they can be relatively close but never back-to-back; the Director enforces **≥2 interactions between any two Syncs**, and the representative order runs the rider between them. (Playtest to confirm it *feels* spaced, not just counts spaced.)
4. ~~**Headline correction depth**~~ — **resolved:** each miss holds the construct, gives a directional nudge (not the answer), and removes/de-emphasizes that exact distractor. With three options there are at most two correction steps before only the valid construction remains; no later remediation loop.
5. **Reduced-intensity fixed event:** the exact localhost recap and semantic contract are locked in `Localhost-Text-Slice-Spec.md`; historical/accessibility approval is still required before a student pilot.
6. **Day-2 carryover presentation:** Day 1 now persists Clarke's Political Read, `clarkeInformed`, watcher heat, route/object/relationship results, and completed learning state exactly. The later Day 2 beat sheet still needs to decide how those already-locked fields are presented in 1770; that is not part of the Day 1 localhost implementation.
7. **Days 2–4 beat-level ledgers (outside this slice):** the per-day *concept set* is locked (GDD §36: D2 Attucks + John Adams; D3 mercantilism + Samuel Adams; D4 Intolerable Acts/Port Act). Each later day still needs its own beat sheet with exposures/understanding-Sync/demonstration **plus** spaced cross-day reassessment. Their absence cannot change or block the Day 1 localhost fixture.

---

## 12. Changelog
- v0.8 — **playtest-3 (full B0→B13 walkthrough, avoidant run) + globalization.** **Day-clock** added: a persistent diegetic non-numeric daylight meter on the strip that **advances during a beat by its authored `timeCost`**, plus **polite escalating Archive time-warnings** and a **must-acknowledge "shops closing" interrupt**; the crowd/fixed event now forms **by the hour, not by "errands done."** **Forced in-place correction** for any miss on an **already-Understood** concept (same-day demonstration *or* later-day reassessment): held in scene, **nudge not the answer**, never re-pooled (stops infinite loops); *first-time* understanding misses still silent + re-offered. **Notes entry fires once at first Understanding** (demonstration/reassessment give diegetic confirmation only, no duplicate flicker). **Gold-marker redirect** rule (unattended gold → warm Archive redirect). **All-day ambient background chatter** with speech glyph (soft, never tracked). **Diegetic voice (hard):** NPCs never reference the Archive/overlay — handler is the only meta voice; **no em dashes in any in-fiction text** (swept the doc). **Nuanced stat attributions** (labels only, behavior unchanged): **Thomas → Obligation**, **Pike → Respect**, Clarke → Political read, rider → Trust, Abigail → Trust/Respect/Warmth by beat. **Frame every ask diegetically**; **knowledge-check options must discriminate on the concept, not a surface trait** (fixed the "which is paper" evidence pin → legal doc vs. private writing vs. a good, using met characters). **B0** now flashes a **real period article** in the intake hologram (grounded exposure, not a summary card). **B10.4** added: free-roam step-out into the forming crowd with the **guaranteed unmissable representation board** (③ reroute) on the funnel to the square. **Day-completion relationship reveal** happens on return to Abigail's (commit-at-cause / reveal-when-felt). **B13** ends on a **full-screen Archive day-end congratulation card.** All of the above mirrored globally into Chapter-Day-Template, Interaction-Spec, and the GDD.
- v0.7 — **learning-payload re-author (stretched day).** Locked Day 1's hard payload at **12 tracked (9 exposures + 3 demonstrations) + 3 understanding Syncs**, path-invariant (§2D). Rewrote §2C into a **concept matrix + representative timeline** showing the spread. Closed the three gaps the count exposed: ① economic policy got a genuine 3rd tracked exposure (**Custom House revenue proclamation, new B7.5**); the three demonstrations were **un-batched from B12** and spread to **② sort at Pike (new B6.5)**, **① correct-cause posting (B7.5)**, **③ headline (B12)**; the three understanding Syncs now fire on **threshold-completion** (post-Pike, post-Clarke, Custom House), with **B10.5 repurposed** as synthesis wind-down + late-completion catch-all. Added a **4th errand** (Custom House) → markers/strip **4→1→3→1→2→1→1**; moved the official Stamp read to a **town notice-board (new B4.5)** to de-clutter Pike. Demonstrations now **reroute like carriers** (home beat → next applied opportunity → B12 catch-all), guaranteeing all 12 tracked + 3 Syncs land on every path (L3, L20). Day sized to the fuller ~25–30 min.
- v0.7.1 — **Custom House = reusable indoor location** (re-dressed across Boston Days 2–4, not a one-day set); 4 errands confirmed. **Sync spacing rule:** Syncs may be relatively close but never back-to-back — Director enforces **≥2 interactions between any two Syncs**; representative order runs the rider between Sync 2 (Clarke) and Sync 3 (Custom House). Mirrored into Chapter-Day-Template L20.
- v0.2 — full first pass. Complete beat sheet B0–B13 with camera per beat, tagged choices, consequences, field tags, "teaches," and carriers. Added the relationship & world-consequence system (Thomas dock route; Clarke informer; period-correct authority). Resolved time economy, route order, Pike, Clarke, caught-anyway branch, headline options + correction, carryover. Added historical grounding notes and a pattern-completeness check (every verb exercised).
- v0.6 — **playtest-2 refinements.** Character **unlock flicker** on first meeting (every character, not just Abigail). Marker↔Today-strip coupling with **pick-one-focus** (must-do-all deliveries: 3→1→2→1→1 count-down, hidden ones resurface; mutually-exclusive choices vanish for good) + strip evolves from single task. Press pull mechanic = **oscillate + accelerate** (no waiting for a perfect frame); generalized as default timed-skill pattern. Shop exit is **free-roam + self-driven** (no "go/look around" menu; Archive nudges if idle). **Tracked vs. ambient exposures (hard):** only tracked interactions count toward the 3-occasion threshold; ambient wall posters/NPC barks are support only. Added **B5.5** tracked en-route representation read (the former B4 wall bill is now ambient-only); B7 handbill conceal is an explicit tracked read. **L17 — gamify the execution of any action-bearing choice** (camera by fit: 1st for precise hands, 3rd for gross-motor/spatial; pure dialogue exempt): B7 conceal = 1st-person fold-and-tuck mini-mechanic (readable); B10 rider handoff = 1st-person press-to-pass / time-the-gap.
- v0.5 — **STAAR-only day-gate + fair portioning.** Day 1's gated concepts are now the three 8.4(A) Stamp-crisis items only: ① post-war economic policy (war debt → revenue), ② Stamp Act (tax on paper), ③ representation. **Demoted** organized resistance and non-importation from the gate to scene context (they still appear + the organized-event carrier still fires, but aren't Day-1 assessed) — this dissolves the non-importation-demonstration gap. **Resolved the representation timing gap:** added the "NO TAXATION WITHOUT REPRESENTATION" street broadside at B4 so its 3 exposures complete by B7 (before the B12 demonstration). Added Pike's economic-policy line (B6). B12 now demonstrates all three gated concepts in one construct (headline = ③, evidence pick = ②, causal source = ①). Added the chapter-wide per-day set list to GDD §36 (Days 1–4: 3/2/2/1 new concepts, all 8.4(A)/8.4(B) items tied to their event). §2 now distinguishes required *carriers* (experiences) from the *day-gate* (assessed understanding).
- v0.4 — **concept learning lifecycle.** 3 stages per concept: Learning (≥3 occasions / ≥2 types) → Understanding (one same-day Archive Sync) → Demonstrating (an applied *game action*, not a Sync). The original revision used persistent regression; **v0.8 supersedes that behavior** with immediate in-place correction for already-Understood misses and no future remediation loop. Day can't end until every required concept clears all 3 stages and no correction remains open. Cross-day spaced repetition: prior-day topics reassessed in-world or via Sync on later days. Notes = the assessment pool for synthesis. Added §2C Day-1 concept ledger + day-end gate; aligned B10.5 (Stamp understanding Sync) and B12 (applied demonstration). Open TODOs: move a representation exposure earlier than B11; add non-importation demonstration; classify debt→policy. ~15–30 min/day budget.
- v0.3 — playtest-driven systems pass. Multi-dimensional relationships (per-character single dimension; Abigail = Trust/Respect/Warmth; guarded baselines; hard causality — no arbitrary stat moves; cascading consequences w/ commit-at-cause/reveal-when-felt). Archive as unified AR overlay: collapsible **Today** strip ↔ full overlay (Today/People/Notes/Routes), holographic stat cards, route-unlock flickers, blue/gold objective pings w/ distance, always-on speech glyph + subtitles vs. interaction glyph. **Notes** shows only Understood (Encountered is invisible backend). JARVIS-style Archive handler drives diegetic assessment. Activity tiers (graded vs. effort/unfailable). Routes = state not geometry. Writing rules (short/oblique/no-em-dash lines; kid-natural labels). Flow rules (2–3 options, no fake single-option prompts, self-driven only when obvious, Archive drives the close). Added **B10.5** Archive day-synthesis (closes the Predict-verb gap).
