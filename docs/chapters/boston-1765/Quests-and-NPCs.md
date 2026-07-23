# Boston — NPC Interactions & Quests (the "stuff to do" layer)

**Status: design authority for the optional interaction + quest layer of the Boston chapter.** This is the Elden-Ring-style *"there is always something to DO"* system — translated to a non-combat, passive-learning history world: discovery-driven, consequence-bearing, and above all **NPCs whose stories persist and change across the years (Acts).**

**The pitch, honestly stated.** The required history runs on a short **forced spine** (the errands that carry the three macro concepts — the "some forced learning parts"). Wrapped around that spine is a dense, optional world you *want* to poke at: people with problems, favors, rumors, dares, and arcs that remember you and evolve as Boston slides toward revolution. You learn history the way ER teaches its world — by *living in it and being curious* — not by being quizzed. The world is **smaller than ER**, but **deeper in time**: the same streets across 1765 → 1775, the same faces aging and radicalizing.

**Hard rules inherited (do not break):**
- **Learning integrity (Gameplay-Design §8):** everything here delivers **micro concepts only** (`Micro-Concepts.md`), **never** a required macro carrier. Skipping all of it still passes every Act.
- **Two-budget model (Gameplay-Design §2):** optional content costs the **escalation clock** (opportunity cost — time + heat), not the required *learning budget*. This *is* the ER risk/reward: wander and you deepen history/relationships/Standing but the town heats up and the bell creeps closer.
- **Micro logs only on a tracked interaction (§3):** talking near someone / overhearing never logs; finishing an encounter, handling a tagged object, or completing a task does.
- **Deterministic + bounded (§L-D):** consequences move relationships, Standing, heat, world flags, and access — never learning, never a hard dead-end.
- **Lean cast (§8, reconciled below):** the 5 named stay the 5 named. Quest-bearing recurring people are a separate, cheap, lightweight category.

**Working chapter timeline** (confirm against chapter structure): **Act 1 — 1765 Stamp Act · Act 2 — 1770 Massacre · Act 3 — 1773 Tea Party · Act 4 — 1774–75 Coercive Acts → war.** Checkpoints are the Archive year-jumps between them.

---

## 1. The interaction model (how you touch the world)

Built on the existing interaction grammar (`Interaction-Spec.md`) and the choreography/first-person camera systems.

**Approach → glyph → engage.** Proximity to an interactable surfaces a single **glyph** (no stacked prompts). Press to engage; the camera frames it (existing choreography grammar). Dialogue is short, in-character, **attributed**; choices are ≤3, mostly free (flavor/relationship), occasionally consequential. Anything that logs micro uses the **tracked-read grammar**.

**The interaction verbs** — the palette of "things to do" with a person or object:

| Verb | What it is | Logs micro? | Touches |
|---|---|---|---|
| **Talk** | exposition / gossip / quest hand-outs | on a finished encounter | relationship, Standing |
| **Help** | do a task — haul, deliver, find, fix, cover | on completion | relationship, Standing, obligation, route |
| **Hand-off / Fetch** | carry an item A→B | on delivery | relationship, world flag |
| **Read / Handle** | knowledge interactable (poster, object, marker, gravestone) | on focus-read | — |
| **Vouch / Blend** | social-stealth (a friendly face tips a patrol, lends cover) | — | heat, suspicion (Part D of Production Plan) |
| **Eavesdrop** | linger on an ambient argument | **never** (pure gravy) | — |
| **Flavor** | ring the bell, work the pump, pet the dog, sit | **never** | ambience; doubles as stealth misdirection |

**Compounded socials.** The 5 named take **multiple inputs across the day** (Gameplay-Design §8) — status accrues from repeated ad-hoc touches, not one scripted beat.

**Discovery, not waypoints (the ER lesson, age-adjusted).** The **spine errands** get gold markers (they're the guaranteed curriculum). **Optional content is discovered** — subtle glyphs, an NPC who flags you down, a rumor that points you somewhere. The Archive holds an **optional "Threads" log** (below) with a *soft* breadcrumb ("Ned mentioned the tavern"), never a map waypoint. Guardrail for a 13-year-old (Interaction-Spec): if the player is idle/lost, the Archive nudges toward the **spine** — it never spoils optional content, but it never strands them either.

---

## 2. The quest taxonomy (Elden Ring, translated to non-combat history)

| ER concept | Our translation | Scope | Payoff |
|---|---|---|---|
| NPC **questlines** (find them, they move, remember, branch, can be missed) | **Threads** (§3) — cross-Act NPC arcs | chapter-spanning | narrative + micro + world/relationship consequence |
| **Side dungeons / catacombs** (optional skill challenges) | **Challenges** (§4.3) — optional stealth/traversal/skill set-pieces | single-Act, local | Standing, micro, bragging cosmetics, route unlocks |
| **Merchants / gossip NPCs** | **Figures who trade information** (§4.4) — tavern keeper, gossips | recurring | rumors that *point to* other content + micro |
| **Item descriptions / environmental storytelling** | **Knowledge interactables** (§4.5) — posters, objects, graffiti, gravestones | everywhere | micro + worldbuilding, zero commitment |
| **World changes after a boss** | **World turns** (§5) — Act boundaries + player-action ripples | structural | the town visibly reacts to history *and* to you |
| **"No quest markers" discovery** | **Threads log + soft hints** (§1) | UI | reward curiosity without stranding kids |

**Four tiers of "stuff to do," by commitment:**
1. **Errands (spine)** — required, carry macro. *(covered in `Day-1-Build-Script.md`)*
2. **Threads** — optional, multi-step, **cross-Act**, real narrative payoff. *The centerpiece.*
3. **Side-jobs & Challenges** — optional, short, single-Act, local.
4. **Ambient/reactive** — flavor verbs, eavesdrop, knowledge interactables. Zero-commitment texture.

---

## 2A. The living route — quests are journeys through an alive world

**The core shape of a quest is fetch-and-ferry:** an NPC sends you to *get* an item or *carry* one somewhere (a type-tray, a proof-sheet, a ledger, coins, a folded meeting-note, a barrel). **Getting the thing is never a teleport to a menu** — it's a journey through the town, and the journey is where the game lives.

**Three things are always true of a fetch route (the triple bind applies — `Concept-Delivery-Map.md`):**

**1. The route is a gamified gauntlet (fun).** Between you and the item stands the world: a patrol you must *avoid* (stealth — `WatcherDirector`, concealment, Standing), a cart or fence to *vault*, a low awning or cellar hatch to *duck* under, a scaffold or crates to *climb*, a plank to *balance*. Fetch quests reuse the traversal markers (`CLIMB`/`VAULT`/`DUCK_ZONE`, `traversalMarkers.ts`) and the full stealth stack already specced — **the errand is the skill expression.** A safe main-street stroll and a risky alley shortcut are both viable; the alley is faster but tighter (more parkour), the street is open but watched.

**2. The route is populated (learning, on the way).** You don't pass through dead space. A fetch path is deliberately routed *past* optional density — an interactable NPC to bump, a knowledge object to focus-read, an eavesdrop to catch (`World-Content.md` §5-7). None of it is required; all of it is there. This is the **saturation law** made spatial: even a straight-line delivery drags you through paper-price chatter, a non-importation notice, a Loyalist's doorway. You learn by *traveling*, not just by arriving.

**3. Perspective is live on the route (learning + state).** *Who* you pass — and how they read you — matters, because the town is politically split. Clarke the Loyalist (doorway −32) will *report* a suspicious pass; the movement's people (agitator, tavern crowd) will *blend* you if your Standing is high; the widow's sympathy is neutral cover. So the same street is a threat or a shelter **depending on the item you carry and the standing you've built** — the map is filtered through point of view (a live, playable version of TEKS "identify points of view," `MICRO.LOYALIST_VIEW`). The Archive's **decision-frame** (`Concept-Delivery-Map.md`) fires here: *"(Clarke reports what he sees.)"* — one clause that makes the POV legible before you choose your path.

**Everything ties together (the alive world).** One fetch ripples outward: delivering Thomas's meeting-note unlocks the tavern keeper's rumors → which point to the agitator's dare → which needs the roof shortcut you opened by fetching the goodwife's boy. Threads feed challenges feed knowledge feed Standing; the world remembers each. That interconnection *is* the "there's always something to do" feeling — density by linkage, not by content volume.

**Worked example — SJ-tavern-note as a living route (build-ready).**
- **Goal:** Thomas (counting-house −70) → carry the folded meeting-note → tavern keeper (Bunch of Grapes interior ~−18). Item rides in the bag (visible fold, `RiderBundle`-style).
- **The gauntlet:** the open main street runs *past Clarke (−32) and the WATCH-patrol loop (−32…+6)* — carrying a "meeting note" past a Loyalist with any heat = a spot-check risk. The intended solve is the **north alley** (`RIDER_BACK_LANES`, z≈−26.5): duck the low awning, vault the hand-cart, squeeze the gap — real parkour, out of the patrol's cone.
- **Populated on the way:** the alley/market fringe passes **EAV-market** (paper-price argument), the **KN-nonimport** notice on Thomas's wall (−70), and the **gossiping goodwife** (−24) — each optional, each a micro or ambient payload.
- **Perspective:** high movement-Standing → the tavern crowd waves you through; flaunt the note near Clarke → he informs → heat↑ and you're *marked* for later runs. Same note, opposite outcomes, driven by POV + Standing.
- **Payoff/linkage:** delivery unlocks the tavern keeper (info hub) → rumor points to **CH-agitator-dare**; Thomas warms; `NON_IMPORTATION` + `LOYAL_NINE` micros log on delivery.

**Rules kept:** fetch quests carry **micro only**, never a macro carrier; route density costs the **escalation clock**, not the learning budget; micro logs only on the **tracked** fetch/read (not on walking past); everything **deterministic + bounded** — a botched stealth pass means heat/marked/lower Standing, never a dead-end or a failed delivery. Build: `ReactiveNpcDirector` owns givers/items; routes reuse existing `MARKER_ANCHORS` corridors + traversal markers + watchers; no new systems beyond Production Plan M0-M5.

### Owned routes — exploration that compounds

Every route you *discover the hard way* becomes **owned knowledge you keep and reuse** — the reward for learning the town's geography and its social map.

- **What gets owned:** the **north back lanes** (`RIDER_BACK_LANES`, from any alley run), the **roof network** (`CH-rooftop-run`), the **dock gate** shortcut (`RIDER_DOCK_GATE`, earned via Thomas's favor), the **scaffold shortcut** (from `SJ-roof-kid`). Each flips from "unknown" to a persistent flag in the runtime contract and appears in the Archive's **Routes** log (beside People/Notes/Threads).
- **The Archive reminds you (contextually, not naggingly):** approach a watched checkpoint you have a bypass for and the Archive offers one clause — *"You know a back lane that skips this."* It surfaces a capability you earned; it never hands you a route you haven't discovered, and it obeys the annoyance budget.
- **Why it matters mechanically (state):** a known route **lowers the clock/heat cost** of every future run through that stretch and gives you **options under pressure** — an owned refuge or roofline is an escape in a chase (`CH-lose-the-watch`, the escape sequence). Exploration in Act 1 literally makes Act 1's later errands (and stealth) easier. That's the compounding.
- **Why it matters historically (learning + the alive world):** owned routes **persist across Acts, and the World Turns (§5) take them away.** The dock route you mastered in 1765 is *gone* when the port closes under the Coercive Acts in Act 4 — you *feel* the blockade as the loss of a capability you'd earned, not as a paragraph. Knowing the town, and watching that knowledge get constrained by history, is the lesson.

---

## 3. Threads — the cross-Act NPC arcs (the heart of it)

A **Thread** is one person's story told across the whole chapter. You meet them in one Act; they **remember you, move, change, and pay off years later** based on what you did. This is where "history as lived experience over time" lives — and it's the strongest engagement hook we have.

**How a Thread works mechanically:**
- A small **state machine per Thread**, persisted across Acts in the runtime contract: flags like `met`, `helped`, `choiceA/B`, `present/fled/gone`, plus a `trust`-lite scalar. **Not** the 4-axis named-cast relationship model — deliberately lighter (see §6).
- Each Act exposes **1 step** of the Thread (sometimes optional, sometimes just a "check in and see how they changed" beat). Missing a step doesn't break the Thread; it branches it (ER-style — neglect has consequences).
- Every step carries **micro** (tracked) + moves a **world/relationship flag**. Never macro.
- **Every step is a living route (§2A), not a menu.** A Thread beat almost always sends you to *fetch or ferry* something — and getting it means running the populated, perspective-filtered gauntlet (avoid the wrong people, climb/vault/duck the world, pass optional NPCs/objects on the way). Ned's "grab the tray of sorts from the back" and his Act-2 "hide a proof from the watch" are the same shape at rising stakes: the errand gets harder to *travel*, not just longer to read.
- The figure is rendered by a **re-tinted archetype rig**, **re-dressed/aged per Act** (tint, scale, prop swap) — cheap, no new character commission.

**Curated set for the chapter: 3 recurring-figure Threads + the 5 named cast's own cross-Act arcs.** Curated, not sprawling — quality over count.

### Thread A — "The Apprentice" (Ned, the printer's boy)  [starts Act 1]
| Act | Where he is | Beat | Micro taught | Your lever |
|---|---|---|---|---|
| 1 (1765) | Mercer's shop / running errands | eager apprentice, apolitical, wants to learn the trade; asks you to fetch type / cover for him | printers' role; how the press works; hard coin vs paper | encourage his craft / rope him into a run |
| 2 (1770) | setting inflammatory type, rattled after the Massacre | scared, radicalizing; asks you to help hide a proof from the watch | the press as propaganda; the Massacre's shock | steady him / push him harder / protect him |
| 3 (1773) | courier for the committees of correspondence | confident organizer now | how the news networks became committees | vouch for him / warn him off |
| 4 (1774-75) | **chooses**: enlist, keep the press, or flee with a Loyalist uncle | payoff — his path reflects your influence across the years | ordinary people's radicalization; the human cost of choosing sides | the accumulated Thread state decides which ending is offered |

**Why it lands:** a kid the player's own age, growing up into the Revolution. Teaches radicalization *as a process*, not a fact.

### Thread B — "The Widow at the Wharf" (Goodwife Sarah, a market/stall woman)  [starts Act 1]
| Act | Beat | Micro taught | Your lever |
|---|---|---|---|
| 1 (1765) | runs a stall, pinched by the trade slump; pragmatic, neutral — "politics don't feed my children" | non-importation's **human cost**; port-town economics | buy from her / help haul / hear her out |
| 2 (1770) | squeezed harder by the occupation & boycotts; joins the spinning bees | the **Daughters of Liberty** / women in the boycott | join the effort / stay out of it |
| 3 (1773) | quietly defiant, supplies the movement | women's domestic economy as resistance | — |
| 4 (1774-75) | displaced by the port's closure, or standing firm | the Coercive Acts' toll on ordinary Bostonians | Thread state → defiant vs. broken ending |

**Why it lands:** the counterweight voice. Resistance isn't free; regular people pay. Critical-thinking balance + women's history, which the spine underweights.

### Thread C — "The Redcoat" (a young British soldier)  [starts Act 2, 1768/70]
| Act | Beat | Micro taught | Your lever |
|---|---|---|---|
| 2 (1770) | billeted in town, homesick, human; tension building toward the Massacre | the **occupation**; the Massacre's *ambiguity* (not a simple slaughter) | ease tensions / inflame / trade words |
| 3 (1773) | reassigned or still posted; the town's hatred has hardened | propaganda vs. lived reality | — |
| 4 (1774-75) | on the road to Lexington, or shipped home | the war's human face on "the other side" | your accumulated stance colors the farewell |

**Why it lands:** humanizes "the enemy," teaches the Massacre's contested nature and the power of propaganda. **Starts Act 2** — Threads don't all begin in Act 1 (keeps each Act fresh).

### The 5 named cast as cross-Act arcs (tentpole, already ours)
The named five (Abigail, Thomas, Pike, Clarke, the rider) each carry a **relationship arc across all four Acts** using the existing 4-axis model — the tentpole version of a Thread. Highlight: **Clarke the Loyalist** (staunch → pressured → tarred/fled) is the definitive Loyalist-experience arc; **Thomas the merchant** rides the boycott economics; **Abigail's press** becomes a revolutionary organ. These are authored as part of each Act's spine-adjacent content, not new figures.

---

## 4. Act 1 concrete content (what's live in 1765)

### 4.1 Named-cast ad-hoc interactions
The 5 are **mobile** and interactable between scripted beats (Day-1-Build-Script appendix): each touch = a `talk` exchange + micro + a relationship nudge; their standing can tip a patrol, lend cover, vouch (heat bleed), or inform/refuse (feeds stealth). Multi-input status.

### 4.2 Thread openers (Act 1 steps)
- **Ned intro** at Mercer's (B1-B4 window): he asks you to fetch a type-tray or cover a small errand → logs `printers' role` micro, opens Thread A.
- **Sarah intro** at the market/wharf: buy/haul/hear-her-out → logs `non-importation`/`port-town` micro, opens Thread B.

### 4.3 Side-jobs & Challenges (optional, single-Act)
| Id | Type | Giver | Do | Verb | Micro | Reward |
|---|---|---|---|---|---|---|
| **SJ-tavern-note** | side-job | Thomas | carry a note about the boycott meeting to the tavern keeper | Hand-off | non-importation; Loyal Nine | Standing↑, warmth, unlocks gossip |
| **SJ-dock-haul** | side-job | dockhand | get a barrel up the ramp before the tide (heavy-haul mini-game, effort) | Help | port-town economics | Standing↑ |
| **SJ-roof-kid** | side-job | goodwife | shoo her boy off a roof (pure traversal fun) | Help/traversal | — (flavor) | Standing↑, opens a roof shortcut |
| **SJ-crier** | side-job | town crier | take up the cry for a stretch | Help | news networks; town crier's role | Standing↑, spreads a rumor |
| **CH-agitator-dare** | **Challenge** | agitator | run a bundle across the watched square without a spot-check | stealth | Loyal Nine; effigy protest | Standing↑, micro, respect from the movement |
| **CH-rooftop-run** | **Challenge** | (discover) | reach the elm-pocket vantage by roof only | traversal | — | cosmetic/vantage, opens event on-ramp early |
| **CH-lose-the-watch** | **Challenge** | (discover) | provoke then shake a patrol for sport | stealth/chase | writs of assistance | Standing↑ (or heat if you fail) |

All: discoverable via glyph or NPC flag-down, safe to skip, obey the two-budget law, non-carrier.

### 4.4 Information figures (gossip / merchants)
- **Tavern keeper** — after SJ-tavern-note: trades **rumors** that point to challenges/threads + micro (`Loyal Nine`, `news networks`). The chapter's info hub.
- **Gossiping goodwife** — micro on `Daughters of Liberty` seeds (pays off in Thread B, Act 2); points to Sarah.
- **Wharf dockhand** — micro on `port-town`, points to SJ-dock-haul.

### 4.5 Knowledge interactables (environmental storytelling)
Map the **existing 11 posters/signs** + world objects to micro (all focus-read/handle, tracked):
| Interactable | Asset | Micro |
|---|---|---|
| Revenue proclamation | `poster-revenue-proclamation` | salutary-neglect-end (also reinforces ①) |
| Stamp schedule | `poster-stamp-schedule` | what-counts (②) |
| Liberty Tree bill | `poster-liberty-tree` | Liberty Tree; effigy protest |
| Non-importation notice | `poster-nonimportation` | non-importation |
| Town-meeting notice | `poster-town-meeting` | Loyal Nine; news networks |
| No-consent broadside | `poster-no-consent` | representation (③ support) |
| Wharfage notice | `poster-wharfage` | port-town economics |
| Trade signs (printer/tavern/baker/chandler) | `sign-*` | the trades of a port town |
| Shop coin/paper object | (place) | hard-coin scarcity |
| Effigy placard | (new texture) | Andrew Oliver |
| Type case | `type-cases` | printers' role |

### 4.6 Eavesdrop & flavor (zero-commitment)
- **Eavesdrop set-pieces** (ambient, never tracked): market price argument, dock grumbling, church-step debate — attributed subtitles, pure passive gravy.
- **Flavor verbs** (existing `INTERACT_FLAVOR`): bell, pump, gulls, dog, bench — pure play; double as stealth misdirection tools.

---

## 5. World turns — the reactive, changing town

**At Act boundaries** the world re-dresses to the year (soldiers arrive in Act 2, shuttered shops & tea crates in Act 3, the closed port & barricades in Act 4). NPCs age; Threads advance; new posters replace old.

**Within an Act, the town reacts to YOU:** heat changes watcher density/temper and NPC lines; Standing changes how the crowd greets you; boycott participation and favors set flags that NPCs reference; a Thread choice ripples into that figure's next-Act state. Small, deterministic, bounded — but enough that the place feels like it's paying attention.

---

## 6. Reconciling with the lean-cast decision (§8)

§8 locks "the named cast stays the existing five" to keep status meaningful, asset cost low, and a 13-year-old free of social bookkeeping. Threads **honor this** by being a *distinct, lighter* category:

| | Named cast (5) | Thread figures (≤3) | Unnamed crowd |
|---|---|---|---|
| Rig | bespoke production rig | **re-tinted archetype rig** | archetype rig |
| Relationship model | full 4-axis (trust/respect/warmth/obligation + political-read) | **1 lite scalar + a few flags** | none (feed Standing only) |
| Bookkeeping load on the kid | tentpole, tracked in People | **light — a name + a story you bump into** | invisible |
| Cost | high (already paid) | **low** (tint + text) | ~free |

**Plus a fourth, lighter tier — interactive occupants (many):** the explorable interiors and street corners are populated with archetype-rig NPCs that give tasks with **deterministic preset dialogue + ≤3 state-gated options** (no AI, no 4-axis — quest flags only). They are the delivery vehicle for the activity families and make the town feel *populated*. Full spec: **`Activity-Expansion.md`**.

So the chapter has **5 deep relationships + ~3 memorable recurring faces + many interactive occupants + a living crowd** — ER-like density of "someone to find" without ER's cast size or a bookkeeping burden. **Decision to confirm:** approve this ≤3 Thread-figure category as an explicit, bounded expansion of §8 (recommended — it's what makes cross-Act arcs possible and it's cheap).

---

## 7. Authoring & asset budget

- **Threads reuse archetype rigs** (`agitator`/`dockhand`/`goodwife`/`towncrier` + tint/age/prop). **No new character commissions** for Threads. Cross-Act reuse *amortizes* the cost — one figure, four dressings.
- **Cost is mostly text** (localhost text slice) + a handful of textures (effigy placard, `sign-watchhouse`) + placement. This is authoring, not the expensive Meshy/Blender pipeline.
- **Deterministic dialogue/quests** — authored branches keyed to state, no generation of quest logic at runtime (FR-8).

---

## 8. Build hooks (ties to the Production Plan)

- **`ReactiveNpcDirector`** (Production Plan A.5, M3) owns: mobile named cast, Thread figures, unnamed interactables, the verb palette, and micro logging.
- **`StandingCard`** (Production Plan D.5) — the social currency these interactions build.
- **Threads state** persists in the runtime contract beside heat/Standing (Production Plan D.0.5).
- **Threads log** = a new Archive overlay tab (soft breadcrumbs), beside People/Notes/Routes.
- **Milestone:** M3 (reactive world + Standing) delivers Act-1 named ad-hoc + 1-2 side-jobs + the 2 Thread openers + knowledge tagging; Challenges and the info-figure web follow.

---

**The exact, placeable Act 1 content** — every NPC, thread opener, side-job, challenge, knowledge object, eavesdrop, flavor verb, and watcher with real coordinates, assets, triggers, authored dialogue, states, and build hooks — is in **`World-Content.md`**. That is the build manifest; this doc is the system behind it.

## 9. Open items

1. **Confirm the ≤3 Thread-figure category** (§6) as a bounded §8 expansion. *(Recommended.)*
2. Confirm the **chapter Act timeline** (1765/1770/1773/1774-75) so Thread steps map to the right years.
3. Author the **Act 1 dialogue** for named ad-hoc lines, the 2 Thread openers, side-jobs, and info figures (text slice).
4. Design the **Archive Threads-log** UI (soft-hint rules; no waypoints).
5. Threads C+ and named-cast arcs get authored per-Act as those Acts are built.
