# Boston Act 1 — World Content Manifest (build-ready)

**Status: the exact, placeable list of everything there is to DO in the Act 1 world (Boston, 14 Aug 1765).** Every entry has a real location (grounded in `packages/chapter-boston-world/src/world/manifest.ts`), the asset/rig it uses (from the deployed inventory), its trigger, the interaction flow with **authored draft dialogue**, the micro it logs, the state it moves, its animation (no-mocap law), and its build hooks. This is what the world team builds against.

**Companions:** design = `Gameplay-Design.md`; quests/NPC system = `Quests-and-NPCs.md`; **alive-world occupants + activity families (TEMPLATES; build the curated Act-1 subset) = `Activity-Expansion.md`**; **look/feel/distinctiveness = `Activity-Feel.md`**; mechanics = `Mechanics-Spec.md`; found-history inspectables = `Environmental-Lore.md`; systems/assets/anim = `Act-1-Production-Plan.md`; spine beats = `Day-1-Build-Script.md`; micro concepts = `Micro-Concepts.md`.

**Conventions:**
- **Coords** are world `[x, y, z]` from the manifest. Town axis: **west = −x (wharf), east = +x (Liberty elm)**; **north row z ≈ −15, south row z ≈ +15, street center z ≈ 0**; north alley z ≈ −26.5; south alley/boardwalk z ≈ +26.5.
- **Dialogue is authored draft** (final text = the localhost text-slice pass) but concrete — it shows *exactly* what each beat says.
- **Tiers:** 🟩 spine (required, `Day-1-Build-Script.md`) · 🟦 thread · 🟨 side-job/challenge · ⬜ knowledge/flavor/eavesdrop · 🟥 watcher/stealth.
- **Anim** obeys the no-mocap law (object animates; body holds a library clip). New clips flagged.

---

## 0. Zone map (where everything lives)

| Zone | X span | Contents |
|---|---|---|
| **Z1 — Wharf apron** | −160…−118 | warehouses, crane, ships, cargo; dock-haul side-job; gull/dock flavor; dock grumbling eavesdrop |
| **Z2 — Rider pocket (west edge)** | −118…−90 | rider post (`RIDER_POST` [−95,0,−17]); handbill handoff (spine B10); hitching/carts cover |
| **Z3 — West street & market** | −95…−40 | Thomas's counting-house (−70); market cluster (−50…−55); customs checkpoint + officer/**watcher** (−56,−2); Sarah the widow (thread); ropewalk (−103); price-argument eavesdrop |
| **Z4 — Central heart** | −40…+16 | Mercer's Press (0, south); Ned (thread); tavern "Bunch of Grapes" (−18, north); notice board (6); town pump (−8); Clarke's doorway (−32); **patrol watcher**; town crier; misdirection flavor |
| **Z5 — South civic & east** | +16…+72 | Pike's office (30); Custom House (55) + **2 posted watchers**; civic townhouse (53, north); church meeting house (71.5) + bell; church-step debate eavesdrop |
| **Z6 — East gate & Liberty pocket** | +80…+108 | east town gate (80); the great elm (95); the fixed event (spine B11); Andrew Oliver effigy + placard; agitator; roof-vantage challenge |
| **Alleys** | — | North alley (z−26.5, x −118…80): duck/vault/squeeze parkour + `RIDER_BACK_LANES`. South alley/boardwalk (z+26.5): dock route (`THOMAS_DOCK_ROUTE` gate at −40) |

**Rider-run corridors (already defined as `MARKER_ANCHORS`):** `CLARKE_ROUTE` (main street past Clarke, −32) · `CUSTOMS_ROUTE` (checkpoint by market, −56) · `RIDER_BACK_LANES` (mid north alley, −60,−23) · `RIDER_DOCK_GATE` (chained gate, −40, needs Thomas favor).

---

## 1. Master content index

| ID | Tier | Zone | Where | One-line |
|---|---|---|---|---|
| NPC-abigail | 🟩🟦 | Z4 | Mercer's (0,15) | printer; spine + cross-Act arc |
| NPC-thomas | 🟩🟦 | Z3 | counting-house (−70) | merchant; boycott economics |
| NPC-pike | 🟩🟦 | Z5 | office (30) | court clerk; the stamp on law |
| NPC-clarke | 🟩🟦 | Z4 | doorway (−32) | Loyalist; the divided town |
| NPC-rider | 🟩🟦 | Z2 | post (−95) | news network |
| THR-ned | 🟦 | Z4 | Mercer's | the apprentice (opener) |
| THR-sarah | 🟦 | Z3 | market (−50) | the wharf widow (opener) |
| SJ-tavern-note | 🟨 | Z3→Z4 | Thomas→tavern | carry the boycott-meeting note |
| SJ-dock-haul | 🟨 | Z1 | apron (−134) | barrel up the gangplank |
| SJ-roof-kid | 🟨 | Z4 | scaffold (13.5) | shoo the boy off the roof |
| SJ-crier | 🟨 | Z4 | notice board (6) | take up the cry |
| CH-agitator-dare | 🟨🟥 | Z4→Z5 | market→Custom House | run contraband past the watch |
| CH-rooftop-run | 🟨 | Z1–Z6 | roofs | reach the elm by roof only |
| CH-lose-the-watch | 🟨🟥 | Z4 | central street | provoke + shake a patrol |
| KN-noticeboard | ⬜🟩 | Z4 | (6,8.8) | revenue proclamation + stamp schedule |
| KN-liberty-bill | ⬜ | Z6 | elm pocket | Liberty Tree / effigy |
| KN-nonimport | ⬜ | Z3 | Thomas wall | non-importation |
| KN-townmeeting | ⬜ | Z4 | tavern wall | Loyal Nine / meeting |
| KN-noconsent | ⬜ | Z4 | central wall | representation |
| KN-wharfage | ⬜ | Z1 | apron | port economics |
| KN-signs | ⬜ | all | shopfronts | the trades |
| KN-coinpaper | ⬜ | Z4 | Mercer's interior | hard-coin scarcity |
| KN-typecase | ⬜ | Z4 | Mercer's interior | printers' role |
| KN-effigy | ⬜🟩 | Z6 | elm | Andrew Oliver |
| EAV-market | ⬜ | Z3 | market (−50) | paper prices / boycott |
| EAV-dock | ⬜ | Z1 | apron | wages / trade slump |
| EAV-church | ⬜ | Z5 | church steps (71.5) | "no vote in London" |
| EAV-customs | ⬜ | Z3 | checkpoint (−56) | the watch, searches |
| FLV-bell | ⬜ | Z5 | church corner | ring the bell (exists) |
| FLV-pump | ⬜ | Z4 | pump (−8) | work the pump (exists) |
| FLV-bench | ⬜ | Z4 | tavern (−20) | sit (exists) |
| FLV-gulls | ⬜ | Z1 | apron | spook the gulls (new) |
| FLV-dog | ⬜ | Z4 | a doorway | pet the dog (new) |
| WATCH-customs | 🟥 | Z3 | checkpoint (−56,−2) | posted watcher (reuse officer) |
| WATCH-patrol | 🟥 | Z4 | main street | patrol watcher |
| WATCH-house-1/2 | 🟥 | Z5 | Custom House (55) | 2 posted watchers |

---

## 2. Named cast — mobile ad-hoc interactions (🟩🟦)

The 5 are **mobile** (roam between their scripted beats) and interactable ad hoc: one `talk` exchange each = a micro + a relationship nudge (multi-input status), and their standing can help/hurt the day + feed stealth (Gameplay-Design §7-8). Rendered by their production rigs; `talk`/`talk2` clips; camera = existing dialogue framing.

| NPC | Home anchor | Roams to | Ad-hoc micro | Sample ad-hoc line | Standing effect |
|---|---|---|---|---|---|
| **Abigail** (`abigail-rigged`) | Mercer's [1.4,0,15.1] | notice board (6) | printers' role | "Mind the wet sheets — and mind your mouth on the street today." | vouch at Mercer's |
| **Thomas** (`thomas-rigged`) | counting-house [−71,0,−15] | market (−50) | non-importation | "It's not the shilling. It's the not being asked." | favor → dock route; can tip a patrol |
| **Pike** (`pike-rigged`) | office [31,0,15.7] | Custom House (55) | vice-admiralty courts | "Come November, half of what I file is worthless without a stamp." | respect → smoother Custom House |
| **Clarke** (`clarke-rigged`) | doorway [−32,0,10.4] | main street (−32…−8) | Loyalist view | "You young ones cheer the mob. You won't cheer where it ends." | curt → informs → **heat + marked** |
| **Rider** (`rider-rigged`) | post [−96.8,0,−18.2] | — (prepping) | news networks | "Bell rings, I ride. Late bundles stay in Boston." | on-time → network trust |

**Build:** `ReactiveNpcDirector` gives each a home + roam waypoint set (reuse the `sampleRoute` pattern) and an ad-hoc interaction glyph gated to "not mid-scripted-beat." Micro logs on a **finished** exchange only.

---

## 3. Thread openers (🟦) — full spec

### THR-ned — "The Apprentice" (opens Thread A)
- **Where:** Mercer's Press interior (around [−2,0,14]) during the B1-B4 window; afterward roams the shopfront/notice board.
- **Rig:** young `townsman-rigged` re-tint (small scale ~1.55) — **no new commission**; ages/redresses across Acts.
- **Trigger:** first entry to Mercer's; Ned flags you down (glyph) after Abigail's assignment.
- **Flow (Talk → optional Fetch):**
  - Ned: "You're the new runner? Lucky. I'm stuck setting type till my fingers are black." → (choice) **"Show me the press."** / **"What do you set?"** / **"Later."**
  - "Show me": logs **MICRO.PRINTERS_ROLE**; Ned demoes the type case (points to KN-typecase). Optional micro-fetch: "Grab me the tray of sorts from the back?" → hand-off inside the shop → +Ned(lite), opens Thread A `met+helped`.
- **Micro:** `PRINTERS_ROLE` (tracked on finished exchange).
- **State:** Thread A → `met` (or `met+helped`); tiny Standing bump.
- **Anim:** object = type case / tray (existing `type-cases`); body `work2`/`talk`; FP hands on tray for the fetch.
- **Reward/consequence:** seeds his Act 2 radicalization; helping now → warmer later.
- **Hooks:** `ReactiveNpcDirector` (thread figure), Thread state in runtime contract.

### THR-sarah — "The Wharf Widow" (opens Thread B)
- **Where:** market cluster, at the stall [−50,0,−6.5] (existing `market-stall` + `market-awning`).
- **Rig:** `goodwife-rigged`.
- **Trigger:** proximity glyph at the stall, or she calls out as you pass the market.
- **Flow (Talk → optional Buy/Help):**
  - Sarah: "Fish and thread, love — what's left of it. Half my trade's gone since the new duties." → **"Why gone?"** / **"Buy something."** / **"Sorry, running."**
  - "Why gone": logs **MICRO.NON_IMPORTATION** + **MICRO.PORT_TOWN_BOSTON** — "Folk won't buy English goods to spite the Crown. Noble, till it's my children going without." (the human-cost counterweight)
  - "Buy": tiny Standing bump; she remembers you (Thread B `met+favored`).
- **Micro:** `NON_IMPORTATION`, `PORT_TOWN_BOSTON`.
- **State:** Thread B → `met`/`met+favored`; points to EAV-market and the Daughters-of-Liberty seed (pays off Act 2).
- **Anim:** object = stall goods; body `talk`/`work1`; FP none.
- **Hooks:** as above.

---

## 4. Side-jobs & Challenges (🟨) — full spec

### SJ-tavern-note (side-job)
- **Giver:** Thomas, counting-house [−70]. **Deliver to:** the tavern keeper, "The Bunch of Grapes" interior (tavern building −18, interior anchor ~[−18,0,−13]).
- **Trigger:** talk to Thomas (offered after his B5 beat or ad-hoc). Glyph + Threads-log breadcrumb ("Thomas → the tavern").
- **Flow:** Thomas hands a folded note ("The meeting's tonight. Keeper needs to know. Quiet-like."). Carry it (item in bag) → enter tavern → hand-off to keeper (`townsman-rigged` behind the bar). Keeper: "Tell him we'll be ready. And you didn't hear it from me." Unlocks the **tavern keeper as an info figure** (§5).
- **Micro:** `NON_IMPORTATION`, `LOYAL_NINE` (on delivery).
- **Verb/anim:** Hand-off; body `handoff`; object = note plane travels to keeper (reuse `RiderBundle`-style tween).
- **Reward:** Standing↑, Thomas warmth, tavern rumors open.
- **Consequence:** if a watcher sees the pass with high heat → minor suspicion (it's a "meeting note").
- **Hooks:** `ReactiveNpcDirector`; bag item flag; tavern-keeper unlock.

### SJ-dock-haul (side-job)
- **Giver:** dockhand at the wharf apron, near the crane/cargo [−134,0,0.5] (`dockhand-rigged`).
- **Trigger:** proximity glyph on the apron.
- **Flow:** "Tide's turning and this barrel's got to be aboard. Lend a back?" → heavy-haul mini-game: pick up barrel (existing `barrel-group`/`crate` asset) → carry up the **gangplank** ([−140,0,14.2]) → set on deck. Effort chain (load → balance on the plank → set down).
- **Micro:** `PORT_TOWN_BOSTON` (on completion).
- **Verb/anim:** Help/haul; body `carry`/`carryWalk`; object = barrel staged then snapped to deck (reuse `HaulBoltStaging` pattern). Balance on gangplank = the existing `WHARF_BALANCE_BEAM` feel.
- **Skill:** Effort (unfailable); a clean balance = a Standing bonus.
- **Reward:** Standing↑; dockhand becomes an info figure (dock rumors).
- **Hooks:** `THOMAS_HAUL`-style mechanic reused w/ a barrel.

### SJ-roof-kid (side-job)
- **Giver:** a goodwife near the central homes ~[−24,0,10] (`goodwife-rigged`; distinct from Sarah).
- **Trigger:** she frets aloud; glyph. The boy (`townsman` child tint) sits on the **scaffold platform** roof (rowN9 scaffold, [13.5,0,−15], platform y≈3.05).
- **Flow:** "My Jonah's up on the painters' scaffold again — fetch him down before he breaks his neck!" → climb the existing `SCAFFOLD_FACADE_CLIMB` → reach the boy → "Aw, I can see the whole harbor!" → escort/shoo → he climbs down. Pure traversal fun.
- **Micro:** none (flavor) — but the vantage seeds ambient harbor exposition.
- **Verb/anim:** traversal (`climbUp`/`climbDown`); body existing; the boy uses `idle`→`climbDown`.
- **Reward:** Standing↑; the goodwife thereafter **leaves the scaffold route "known"** (a discovered roof shortcut toward the east) → feeds CH-rooftop-run.
- **Hooks:** reuse scaffold traversal marker + a boy actor + completion flag.

### SJ-crier (side-job)
- **Giver:** the town crier at the notice board [6,0,8.8] (`towncrier-rigged`).
- **Trigger:** glyph; "My voice is gone, lad. Take up the cry down the street — folk need to hear the meeting's called."
- **Flow:** hold-to-call at 3 marked spots along the central street (x −8, 6, 24) → a `cheer1`/`argu1` posture + a shout SFX + a subtitle each. Spreads the news (world flavor).
- **Micro:** `NEWS_NETWORKS`, `TOWN CRIER's role` (on completion).
- **Verb/anim:** Help; body `cheer1`/`argu1` (reuse); object none; SFX pulse.
- **Reward:** Standing↑ (you read as a familiar local — social camouflage); crowd greets you warmer.
- **Hooks:** 3 call-spot markers + hold input; Standing accrual.

### CH-agitator-dare (Challenge — stealth)
- **Giver:** the agitator near the market/tavern ~[−16,0,6] (`agitator-rigged`).
- **Trigger:** glyph after you've met the movement (tavern note or Ned). "Think you're quick? Get this bundle to my man by the Custom House — and don't let the watch paw through it."
- **Flow:** carry a wrapped bundle from the market across the **watched Custom House stretch** (Z5, the 2 posted watchers) to a contact at [50,0,8] — **without triggering a spot-check** (uses concealment + Standing + timing, Production Plan D). Success by stealth, not required.
- **Micro:** `LOYAL_NINE`, `EFFIGY_PROTEST` (on delivery).
- **Verb/anim:** Hand-off + stealth traversal; conceal fold reused; body walk/crouch.
- **Skill:** stealth (graded by whether you drew a check); clean run = big Standing + movement respect.
- **Reward:** Standing↑↑; a rumor to CH-rooftop-run; if caught → heat↑ but **no dead-end** (contact still takes it later).
- **Hooks:** full stealth stack (`WatcherDirector`, concealment); deterministic.

### CH-rooftop-run (Challenge — traversal)
- **Giver:** discovered (glyph on the scaffold after SJ-roof-kid, or self-found).
- **Trigger:** stand on a roof zone; a ghost-line goal appears: "Reach the great elm without touching the street."
- **Flow:** chain the existing roof zones/verbs west→east where they connect (scaffold platform 13.5 → … → elm sheds 95), using the minimal roof-board bridges (Production Plan B#5) to close gaps. Pure traversal challenge.
- **Micro:** none.
- **Verb/anim:** climb/vault/hop/balance (existing markers + new boards).
- **Reward:** a vantage cosmetic + early access to the B11 event observe perch; bragging.
- **Hooks:** enable `BALANCE`/`JUMP_GAP` where used; new roof-board placements.

### CH-lose-the-watch (Challenge — stealth/chase, optional)
- **Giver:** discovered near the patrol (Z4); a street kid dares you, or self-initiated by provoking.
- **Trigger:** deliberately raise suspicion on the patrol watcher, then a "Shake them!" goal.
- **Flow:** the escape sequence (Production Plan D.7) as sport — break LOS + hold the gap, or reach a refuge. No contraband at stake (it's a dare).
- **Micro:** `WRITS_OF_ASSISTANCE` (framed: why the watch can chase at all).
- **Reward:** Standing↑ if shaken cleanly; **heat↑** if caught (real cost — teaches the risk).
- **Hooks:** `ChaseDirector`, stamina.

---

## 5. Information figures (gossip / rumor hubs)
| Figure | Where | Unlocked by | Gives | Micro |
|---|---|---|---|---|
| **Tavern keeper** | Bunch of Grapes (−18 interior) | SJ-tavern-note | rumors → points to CH-agitator-dare, Sarah, meeting | `LOYAL_NINE`, `NEWS_NETWORKS` |
| **Dockhand** | apron (−134) | SJ-dock-haul | dock rumors → wharf economics, CH-rooftop-run hint | `PORT_TOWN_BOSTON` |
| **Gossiping goodwife** | central homes (−24) | ad-hoc | seeds Daughters of Liberty (Act 2 Thread B payoff); points to Sarah | `NON_IMPORTATION` |

**Build:** an info figure = a Talk NPC whose lines *point* the player at other content (soft breadcrumbs into the Threads-log), each logging one micro.

---

## 6. Knowledge interactables (⬜) — placements
All are **focus-read/handle** (tracked). Assets = the 11 deployed posters/signs + placed objects.
| ID | Asset | Placement | Micro |
|---|---|---|---|
| KN-noticeboard | `poster-revenue-proclamation` + `poster-stamp-schedule` | notice board [6,0,8.8] (front face) | `SALUTARY_NEGLECT_END` (+①); `STAMP_WHAT_COUNTS` (spine B4.5) |
| KN-liberty-bill | `poster-liberty-tree` | elm-pocket wall ~[100,2,−22] | `LIBERTY_TREE`, `EFFIGY_PROTEST` |
| KN-nonimport | `poster-nonimportation` | Thomas counting-house front [−70,2,−10.5] | `NON_IMPORTATION` |
| KN-townmeeting | `poster-town-meeting` | tavern front [−18,2,−10.5] | `LOYAL_NINE`, `NEWS_NETWORKS` |
| KN-noconsent | `poster-no-consent` | central wall (mercer/rowS5 face) [−4,2,10.5] | representation (③ support) |
| KN-wharfage | `poster-wharfage` | warehouse front, apron [−139,2,−10] | `PORT_TOWN_BOSTON` |
| KN-signs | `sign-printer`/`sign-tavern-grapes`/`sign-baker-sheaf`/`sign-chandler-anchor` | Mercer's, tavern, shops | the trades of a port town |
| KN-coinpaper | new small object (place `storage-chest`+coins) | Mercer's interior [2,0,16] | `HARD_COIN_SCARCITY` |
| KN-typecase | `type-cases` | Mercer's interior (existing) | `PRINTERS_ROLE` |
| KN-effigy | new placard texture on the event effigy | elm [95] (B11) | `ANDREW_OLIVER` |

**Build:** poster/sign textures already exist; place as decals/planes on the named faces; wire each to focus-read → micro log. `KN-coinpaper` + effigy placard need 1 texture each.

---

## 7. Eavesdrops (⬜, ambient, never tracked)
Attributed subtitles; pure passive gravy; two ambient rigs each, looping `argu1`/`argue2`/`talk`.
| ID | Where | Who | Content (draft) |
|---|---|---|---|
| EAV-market | market [−50,0,−6.5] | two townsfolk | "A shilling a ream now, and a stamp on top come fall!" / "Then we buy naught from England — let *them* feel it." |
| EAV-dock | apron [−140,0,3] | two dockhands | "Half the ships idle. No trade, no wage." / "Thank the Crown's collectors for that." |
| EAV-church | church steps [71.5,0,−9] | two men | "We've no vote in London, yet London taxes us." / "Careful who hears you, friend." |
| EAV-customs | checkpoint [−56,0,−2] | officer + townsman | "Open the bag." / "On whose warrant?" / "The King's. That's warrant enough." |

**Build:** reuse `PopulationDirector` conversation-pair pattern at these anchors; no tracking, no glyph.

---

## 8. Flavor verbs (⬜) — free play / stealth misdirection
| ID | Where | Status | Note |
|---|---|---|---|
| FLV-bell | church corner ~[69,0,−9] | **exists** (`CHURCH_BELL_ROPE`) | misdirection: draws a patrol's attention |
| FLV-pump | pump [−8,0,−1.5] | **exists** (`TOWN_PUMP_SPLASH`) | — |
| FLV-bench | tavern [−20,0,~10] | **exists** (`TAVERN_BENCH_SIT`) | watch a vignette |
| FLV-gulls | apron [−145,0,6] | **new** | spook the gulls (SFX + flock); misdirection |
| FLV-dog | a doorway ~[−30,0,11] | **new** | pet the dog |

**Build:** bell/pump/bench are live `INTERACT_FLAVOR` markers. Gulls/dog = 2 new flavor markers (SFX + simple particle/actor); both double as misdirection tools in stealth (§7.7 of Gameplay-Design).

---

## 9. Watchers & stealth placement (🟥) — the ≤4 active (locked)
| ID | Type | Anchor | Cone | Guards |
|---|---|---|---|---|
| WATCH-customs | posted | [−56,0,−2] (**reuse the existing `officer` NPC**) | 35°, 12m, scans the street | `CUSTOMS_ROUTE` rider leg; EAV-customs here |
| WATCH-patrol | patrol | main street loop x −32…+6, z≈2 | 28°, 10m | `CLARKE_ROUTE`; CH-lose-the-watch; the central square |
| WATCH-house-1 | posted | Custom House steps [52,0,8] | 35°, 12m | Custom House notice run (spine B7.5); CH-agitator-dare |
| WATCH-house-2 | posted | Custom House steps [58,0,8] | 35°, 12m | (paired spot-check) |

Cone *length* grows with the escalation clock (dusk). Concealment + crowd + Standing lower suspicion (Production Plan D.3). Rendered as tinted `officer-rigged`.

---

## 10. Per-zone build checklist

- **Z1 Wharf:** SJ-dock-haul (dockhand + barrel + gangplank haul), EAV-dock, FLV-gulls, KN-wharfage. *(all reuse existing apron assets)*
- **Z2 Rider pocket:** spine B10 handoff (exists); rider ad-hoc.
- **Z3 West/market:** THR-sarah (goodwife@stall), SJ-tavern-note giver (Thomas), EAV-market, WATCH-customs (reuse officer), KN-nonimport, gossiping goodwife.
- **Z4 Central:** THR-ned (Mercer's), SJ-crier (crier@board), SJ-roof-kid (goodwife + boy@scaffold), CH-agitator-dare giver, CH-lose-the-watch, WATCH-patrol, KN-noticeboard/townmeeting/noconsent, KN-coinpaper/typecase (interior), FLV-pump/bench/dog, Clarke ad-hoc, tavern keeper info hub.
- **Z5 Civic/east:** WATCH-house-1/2 (Custom House), Pike ad-hoc, EAV-church, FLV-bell, CH-agitator-dare drop-off.
- **Z6 Liberty pocket:** spine B11 event (exists), KN-effigy placard, KN-liberty-bill, agitator (dare giver), CH-rooftop-run goal.

---

## 10A. Living-route annotations (per quest)

Every Thread/side-job/challenge is a **living route** (`Quests-and-NPCs.md` §2A), not a point-to-point errand: an **item to get/carry**, a **gauntlet** of traversal + stealth on the way, **optional density passed** en route, and (sometimes) an **owned route** it unlocks. Lore ids reference `Environmental-Lore.md`; corridors reference the `MARKER_ANCHORS`.

| Quest | Item / target | Gauntlet (verbs on the route) | Passed on the way | Owned route unlocked |
|---|---|---|---|---|
| **THR-ned** | fetch the tray of sorts (`LORE-typecase`) from Mercer's back | interior nav; hand-off | `LORE-coinpaper`, `LORE-pressbed` | — |
| **THR-sarah** | buy/haul at the stall | market approach; optional haul | `EAV-market`, `LORE-marketstall`, `LORE-nonimport` | — |
| **SJ-tavern-note** | carry the meeting-note → keeper | **north alley** (`RIDER_BACK_LANES`): duck awning, vault hand-cart, squeeze gap — *avoid Clarke (−32) + WATCH-patrol* | `LORE-nonimport`, `LORE-drydinglaundry`, `EAV-market`, gossiping goodwife | learns the north back-lane |
| **SJ-dock-haul** | barrel → up the gangplank to the deck | heavy-haul + **balance** on the gangplank | `LORE-wharfage`, `LORE-fishflakes`, `EAV-dock` | — |
| **SJ-roof-kid** | reach the boy on the scaffold roof | **climb** `SCAFFOLD_FACADE_CLIMB` | harbor vantage (seeds ambient) | **opens the scaffold roof shortcut** → feeds CH-rooftop-run |
| **SJ-crier** | take up the cry at 3 street spots | hold-to-call; move the central street | `LORE-noticeboard`, `LORE-townmeeting`, FLV props | — |
| **CH-agitator-dare** | ferry the bundle → Custom House contact | **stealth carry** past 2 posted watchers (cones/conceal/Standing) | `LORE-customhouse`, `LORE-vicecourt`, WATCH-house-1/2 | rumor → CH-rooftop-run |
| **CH-rooftop-run** | reach the elm by roof only | **climb/vault/hop/balance** chain (scaffold→elm), roof-board bridges | rooflines over the whole street | **owns the roof network** |
| **CH-lose-the-watch** | shake a provoked patrol | **escape sequence** — break LOS, hold the gap, or reach a refuge (stamina) | refuge doorways, FLV misdirection (bell/gulls) | learns refuge points |

**Rules kept:** items/gauntlets carry **micro only**; route density costs the **escalation clock**; micro logs only on the **tracked** fetch/read/complete; deterministic + bounded (a blown pass = heat/marked/lower Standing, never a dead-end). Owned routes persist in the runtime contract → surfaced by the Archive **Routes** reminder (`Archive-Spec.md` R3) → and are taken away by later **World Turns** (the port closes in Act 4).

---

## 11. What's genuinely new to build (vs. reuse)

- **New actors (reuse rigs + tint):** Ned (young townsman tint), the boy (child tint), tavern keeper, gossiping goodwife, 4 watchers (tinted officer). *No new character commissions in Act 1* (constable rig deferred to M4 per locked decision).
- **New textures (small):** `KN-coinpaper` object, effigy placard, `sign-watchhouse` (watch-house landmark). Posters already exist.
- **New markers/data:** watcher patrol/posted defs; crier call-spots; roof-board bridges (1-2, Production B#5); FLV-gulls/dog; refuge tags on doorways.
- **New systems:** all of Part D (stealth/chase/Standing) + `ReactiveNpcDirector` + Threads state + Threads-log UI + engaged-micro tracker. *(Production Plan milestones M0-M5.)*
- **Everything else is placement** on the 122-prop / 14-rig inventory already in the world.
