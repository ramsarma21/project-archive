# Boston Act 1 — Look, Feel & Distinctiveness Bible

**Status: the presentation authority for how every activity *looks, feels, and stays distinct* while it teaches.** The other docs say *what* each activity does and *what concept* it carries; this one says *how it plays on screen* — camera, tempo, input feel, the one unmistakable sight-and-sound, the period flavor, and how the teaching is **visible in the doing**. Its job is to guarantee that ~80 things to do read as ~80 *different* moments, not one verb reskinned.

**Companions:** activities = `Activity-Expansion.md`; mechanics = `Mechanics-Spec.md`; camera/feedback grammar = `Interaction-Spec.md` §5/§9 + `Production.md` §2A; rigs = `apps/web/src/world/MechanicRigs.tsx`; audio = `apps/web/public/audio/` (`press-shop`, `church-bell`, `market-clatter`, `gull-cry`, `harbor-lap`, `cart-passby`, `street-murmur`, `door-creak`, `dog-bark`, `wind-gusts`, `rain-bed`, `room-tone`, `church-hush`).

**Anti-sameness law:** no two adjacent activities may share the same *camera + tempo + primary-input* triple. If they do, one must change a lever. Distinctiveness is a **design requirement**, tracked in the variety matrix (§2).

---

## 1. The distinctiveness levers (the palette we deliberately vary)

Every activity is composed by choosing a value on each lever. Varying these is how we keep the world from feeling repetitive.

| Lever | Options | 
|---|---|
| **Camera** | 3rd-person free · 1st-person fine-work · over-shoulder · locked cinematic · high vantage · low/tense (stealth) |
| **Tempo** | burst (1-3s beat) · sustained (held effort) · deliberate (careful/quiet) · day-spanning (project) |
| **Primary input** | hold · rhythm/timing · drag-aim · choice · sort/place · traverse · sneak |
| **Sensory signature** | the one sight+sound that IDs it instantly (see per-card) |
| **Stakes** | flavor-only · Standing · heat/danger · clock/timed |
| **Flavor hook** | the period detail that makes it charming/memorable |
| **Teaching-in-view** | the concept made *visible* in the act itself (diegetic, not a text pop) |

---

## 2. The variety matrix (proof of no-sameness)

| Activity | Camera | Tempo | Input | Sensory signature | Stakes |
|---|---|---|---|---|---|
| Press job | 1st-person | sustained | rhythm | ink roll + iron *thunk* (`press-shop`) | Standing |
| Customs search | over-shoulder, held | deliberate | choice | bag paw-through, `door-creak` hush | heat |
| Contraband ferry | low/tense | deliberate | sneak | muffled steps, cone shimmer | heat/danger |
| Boycott sign-drive | over-shoulder | burst | choice | quill scratch, ledger snap | Standing |
| Town rally | high vantage → cinematic | day-spanning→cinematic | traverse+timing | crowd roar over `street-murmur`, effigy hoist | heat |
| News relay | 3rd-person free | timed | traverse | hoofbeats, bundle slap (`cart-passby`) | clock |
| Trades: ropewalk | 3rd-person tracking | sustained | drag (walk-the-line) | long rope creak, fibre dust | Standing |
| Trades: chandlery | 1st-person | sustained | hold (dip) | wax drip + tallow smell-cue steam | Standing |
| Trades: bakery | 1st-person | rhythm | timing (peel in/out) | oven roar + flour puff | Standing |
| Trades: fish flakes | 3rd-person | burst | sort/place | gull-cry (`gull-cry`), briny slap | Standing |
| Dock haul | over-shoulder | sustained | hold+balance | plank groan, `harbor-lap` | Standing/clock |
| Postering | 1st-person | burst | timing (tack up) | hammer taps / chalk scrape, paper rustle | heat |
| Broadside assembly | 1st-person (Press) | day-spanning | collect→rhythm | type clicks → the same press *thunk* | Standing |
| Loyal-Nine investigation | over-shoulder | day-spanning | choice/read | hushed tavern murmur (`church-hush`-style) | none |
| Stamp/customs/ledger sorts | top-down over-table | burst | sort/place | paper fan *riffle*, stamp *clack* | Standing |
| Inspectables (Found History) | 1st-person zoom | burst | look | focus vignette + soft chime | none |
| Eavesdrops | passive over-shoulder | sustained | none | two-voice bark over ambience | none |
| Flavor verbs | contextual | burst | one-press | bell toll (`church-bell`), pump splash, `dog-bark` | none |

**Read:** camera, tempo, and input rotate constantly; the sensory signatures are all different objects/sounds. Adjacent activities in a play-session never share the triple.

---

## 3. Moment cards — how each one plays

Each card: **the moment (what you see) · the feel (how it plays) · signature · flavor · teaching-in-view.** All obey the no-mocap law (object animates; body holds a library clip) and the non-blocking positive-only feedback rule (`Interaction-Spec` §9).

### Mechanics

**Press job** — *The moment:* camera drops to **1st-person** over the press bed, hands enter frame. *Feel:* a **rhythm** of three deliberate pulls; the bar resists, then gives with a heavy *thunk*. *Signature:* ink roller sheen + the iron *thunk* (`press-shop` loop). *Flavor:* a wet proof lifted and pegged to dry; smudged fingers. *Teaching-in-view:* the fresh sheet is stamped "1 penny duty" — you *see* the tax land on the thing you just made.

**Customs search** — *Moment:* camera swings **over-shoulder**, the officer steps into your space, the street noise ducks (`door-creak`/hush). *Feel:* **deliberate, agency removed** — you *hold* while he paws the bag; the only input is the comply/talk/run **choice**. *Signature:* the slow rummage + a held silence. *Flavor:* his ledger, the writ waved without a name on it. *Teaching-in-view:* the writ is blank where a name should be — the general warrant, shown not told.

**Contraband ferry** — *Moment:* **low, tense** camera; watcher cones shimmer faintly at the edge of legibility. *Feel:* **deliberate sneak** — read the cones, use crowd cover, time the gap. *Signature:* muffled footfalls, your own breath, a heartbeat swell near a cone. *Flavor:* the bundle clutched under a coat. *Teaching-in-view:* you *are* moving goods in secret because the watch can stop anyone — the covert tactic is the lesson.

**Boycott sign-drive** — *Moment:* **over-shoulder** at a shop counter, the agreement slid across. *Feel:* **burst choice** — present / cite evidence / press. *Signature:* the quill scratch of a signature, or the ledger snapping shut on a refusal. *Flavor:* each shop's goods say their politics (English china vs. bare shelves). *Teaching-in-view:* the list of names grows or stalls — collective action, made a tally you can watch.

**Town rally** — *Moment:* start on a **high vantage** over the gathering crowd, resolve to a brief **cinematic** as the effigy rises. *Feel:* **day-spanning build** (spread word, carry the note) then a **timing** press to join the chant. *Signature:* a crowd roar swelling over `street-murmur`; the effigy hoisted on the elm. *Flavor:* torchlight, a drum, the placard "A.O." *Teaching-in-view:* it's *organized* — marshals, a plan — not a riot.

**News relay** — *Moment:* **3rd-person free** run through the streets to the rider. *Feel:* **timed traverse**; owned shortcuts shave the clock. *Signature:* hoofbeats and a bundle *slap* into the saddlebag (`cart-passby` texture). *Flavor:* "Bell rings, I ride." *Teaching-in-view:* you are the physical link press→post→next town — the network embodied.

### Activity families

**Trades (A) — kept distinct from each other, not just from other families:**
- **Ropewalk:** **3rd-person tracking** as you *walk the line* laying cordage — a long **drag** down the 22m ropewalk; rope creak, fibre dust in shafts of light. *Teaching:* the port's signature industry, its length made physical.
- **Chandlery:** **1st-person** candle **dip-and-hold**; wax sheeting off, steam. Intimate and slow.
- **Bakery:** **1st-person rhythm** — peel the loaves in and out on the beat; oven roar, flour puff. Warm, quick.
- **Fish flakes:** **3rd-person burst sort** — flip drying cod; gull-cry (`gull-cry`), briny slap. Half the racks bare = the slump, seen.
- **Dock haul:** **over-shoulder sustained** carry + a **balance** beat on the plank groan over `harbor-lap`.
> Same "work" family, five different cameras/tempos/inputs — that's the anti-sameness law at work.

**Postering (C)** — *Moment:* **1st-person** at a wall, bill held up. *Feel:* **burst timing** to tack it straight (or scrape chalk). *Signature:* three quick hammer taps / gritty chalk drag, paper rustle; a glance over the shoulder for the watch. *Flavor:* wheat-paste, a torn Loyalist notice underneath. *Teaching-in-view:* the printed word as a weapon — and the heat meter ticking says the Crown agrees.

**Broadside assembly (E1)** — *Moment:* collect fragments around town (each a small **look/choice**), then the payoff returns to the **Press 1st-person**. *Feel:* **day-spanning** gather → the familiar press rhythm. *Signature:* type clicks assembling into a headline, then *your* press thunk. *Teaching-in-view:* raw sources → a printed argument; you watch propaganda get *made*.

**Loyal-Nine investigation (E2)** — *Moment:* **over-shoulder** hushed conversations, a **look** at tagged objects. *Feel:* **deliberate discovery**, tracked softly in Notes. *Signature:* lowered voices, a tavern hush. *Teaching-in-view:* names connect on the Notes web — the plan behind the "mob."

**Sorts (F)** — *Moment:* camera to a **top-down over-the-table** frame. *Feel:* **burst sort/place** — fan the papers/goods, drop each in a bin. *Signature:* paper riffle + a stamp *clack* / a crate thud. *Flavor:* Pike's fussy tidiness; the officer's suspicion. *Teaching-in-view:* the boundary itself (needs-a-stamp vs. not) is the puzzle — you learn the rule by applying it.

### Texture layers (distinct *as texture*, deliberately quiet)

- **Inspectables:** **1st-person zoom** + a focus vignette and a soft chime; one line of meaning. Reads as "noticing," never as a menu.
- **Eavesdrops:** camera stays free; two attributed voices rise out of `street-murmur`/`market-clatter`. No glyph, no stop — you just *catch* it.
- **Flavor verbs:** one-press, instant, toy-like — bell toll (`church-bell`), pump splash, gull scatter (`gull-cry`), `dog-bark`. Pure delight; doubles as stealth misdirection.

---

## 4. Shared presentation rules (so distinctiveness is consistent, not chaotic)

- **Camera ownership** is boolean-gated (`CameraDirector`/`FirstPersonCamera`): free-roam → the activity's framing → back. Fine-work = 1st-person; effort/traverse = 3rd/over-shoulder; marquee = brief cinematic. One owner at a time.
- **Feedback is non-blocking & positive-only** (`Interaction-Spec` §9): a small card/flicker on completion (micro logged, Standing nudge). Never a modal, never a "wrong" buzzer — sorts nudge back, they don't fail out.
- **No-mocap law** (`Production.md` §3): every card above = a library body clip (`work1/work2/carry/handoff/cheer/argu/idle`) + **object/prop motion** + **camera framing** doing the expressive work. The *prop and the camera* sell the distinctiveness, not new skeletal animation.
- **Audio is the cheapest distinctiveness lever:** each activity gets a **signature sound** from the existing bank; ambient beds (`street-murmur`, `harbor-lap`, `wind-gusts`, `rain-bed`, `room-tone`) place you; a one-shot IDs the action. Sound alone makes two similar verbs feel different.
- **Teaching-in-view over text pops:** wherever possible the concept is *visible in the object* (the stamped sheet, the blank writ, the growing name-list, the bare fish racks) — the Archive only labels it later if needed (R5 bridge).

---

## 5. Build hooks & open items

- **Build:** most cards = a camera-framing preset + an existing `MechanicRigs` rig + a signature SFX + a completion card. The lift is **choreography data + audio wiring + text**, not new systems or characters.
- **New audio (if any):** the bank covers most signatures; flag any missing one-shots (e.g., quill scratch, stamp clack, hammer tap, rope creak) as small SFX adds — cheap, not the Meshy pipeline.
- **Open items:**
  1. Confirm the **signature-SFX list** and which one-shots need authoring vs. exist.
  2. Confirm **camera presets** per activity against `CameraDirector` capabilities (any new framings needed?).
  3. Pacing pass (once playable): verify the anti-sameness triple holds across a real play-session order, not just on paper.
