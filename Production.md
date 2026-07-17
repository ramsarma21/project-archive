# Production & Art Pipeline

**Working document.** How we actually build and render the game given our tools. The GDD says *what* the game is; `Backend-AI-System.md` defines the concrete backend/runtime/AI setup; `Localhost-Text-Slice-Spec.md` defines the first runnable headless/text implementation and the presenter contract that the later Three.js client must reuse unchanged; `Day-Template.md` says *how any day is authored* (beat archetypes + the reasoning); `Day-1.md` is the worked instance of that template; **`Interaction-Spec.md` is the implementation-ready micro-spec** (marker/strip state machines, glyph grammar, tracked-read gate, encounter triggers/radii, gamified-execution inputs, beat pacing, time model, feedback cards, effect tags, stat model — all parameterized for coding); this doc says *how we make it real* without drowning in animation.

Status: **draft.** Open questions at the bottom.

---

## 0. Locked decisions

- **Perspective:** **hybrid.** Third-person for traversal / world presence; **switch to first-person for fine-skill interactions** (reading & carrying papers, cleaning, press work, hand-offs). See §2A.
- **Platform / runtime:** **web — React + three.js (React-Three-Fiber), WebGPU renderer with WebGL2 fallback.** Runs on school Chromebooks, no install.
- **Quality bar:** **clean, cohesive, stylized — not photoreal, not GTA.** The enemy is jank and visual incoherence, not low fidelity. A consistent stylized look that's well-lit and readable beats "almost-realistic but off." Quality over quantity — the world is small, so every scene gets hero treatment.
- **Animation:** **no motion capture, no bespoke character keyframing.** Ready-made libraries (ActorCore/Mixamo) + prop motion + first-person + camera framing. See §3.
- **Target:** **the full Boston chapter (all 4 Mission Days) shippable — that's the minimum.** Day 1 is the *pattern-complete foundation build*: it exercises every interaction verb and builds every reusable system once, so Days 2–4 are content + review, not engineering. ~4.5 weeks, budget available. Model: build the machine on Day 1, then **automate + review** for the rest.
- **Scope / space:** build **once**, reuse across all 4 days — **one shared district** (a few hero interiors + a street spine + a route network), re-dressed per day (see §6). Space is a **gameplay construct, not a to-scale map**: compress freely, build only gameplay pockets + event set-pieces, stitch them with abstracted routes. The player never runs real distances.
- **Lipsync:** **cutscenes only.** In-game characters do not need lipsync (blink/eye/head motion only).
- **LOD:** yes — we use level-of-detail / streaming (splats + meshes).
- **Budget:** any API is acquirable. Prefer best-in-class where it buys realism.
- **Tools on hand:** Meshy (text/image→3D + auto-rig), Blender, ElevenLabs (voice). Expanded stack in §5.

---

## 1. Core principle — confirm the action, don't simulate it

The expensive, near-impossible part is **bespoke, full-body, fine-motor, multi-character animation** (fingers picking up a sheet, two people folding cloth). We never do that.

We split **input** (what the player does) from **presentation** (what they see). The player triggers an action; the result is shown by a **reusable presentation pattern** = one generic body clip + camera framing + a prop state change. We author animation **once per pattern**, never per object. This is also what the GDD already requires ("reusable mechanics, no one-off minigames").

**Third-person specific:** free movement is third-person. On interact, the camera pushes to a **focused framing** and the body plays one generic "reach"; the prop and camera sell the specifics. This is standard shipped-game practice ("pick up / use" = canned reach + object snaps to hand).

---

## 2. The interaction grammar → body-clip mapping

| Pattern | Player input | Presentation (cheap) | Body clip used |
|---|---|---|---|
| **Focus-Inspect** | tap/drag | camera cuts to close-up of object (hi-res plane), bg blurs, rotate/compare; **the salient difference is authored-surfaced (aligned/highlighted/light-catching), never hidden** | "reach" (barely seen) |
| **Operate** | press/hold/drag | mechanism plays 2–3 baked states | "reach" |
| **Carry-Place** | grab→move→release | prop parents to hand, moves to target, snaps to placed state | "reach" + "carry" additive |
| **Traverse** | move / prompt at marker | canned vault/climb/duck clip w/ root motion, snap to marker | vault-low / climb-up / duck |
| **Talk-Choose** | pick option | framed camera + talk/gesture loop + attributed subtitles; choices in UI (**no in-game lipsync**) | talk/gesture loops |
| **Construct** (Diegetic) | UI | close-up 2D/UI interface (e.g. movable type) | none / "reach" to enter |

**Activity tiers (per interaction instance):** any activity verb can be authored as **graded** (input quality changes the outcome and moves stats/object condition — e.g. the press pull) or **effort/unfailable** (a mash/hold input that always completes; embodiment without a fail state — e.g. hauling Thomas's cloth). Same animation/prop machinery; only the outcome logic differs. Author failure only where failing teaches something or creates an interesting consequence.

**Gamify committed-action execution in the camera that fits (Day-Template L17).** When a *decision* is already made, don't cut away or auto-resolve it: give a short effort-tier execution. Use **first person for precise hand/object work** (conceal, fold, tack, pour, operate, focus-read) and **third person for gross-motor/spatial work** (haul, climb, push, evade). First-person interactions reuse the hands + prop-motion machinery and make close-up content readable/tracked; third-person interactions reuse library body clips and state markers. Author these liberally — the decision cost is zero, it's pure engagement + legibility.

---

## 2A. Camera model — 3rd person for movement, 1st person for fine work

- **Third person:** walking, running, traversal, entering spaces, being present in the world. Uses locomotion clips — the easy, well-solved part.
- **First person:** any fine-motor interaction (Focus-Inspect a document, carry papers, fold/conceal a wrap, press work, precise hand-off). Seeing only hands + object removes the full-body fine-motor and hand-to-prop-alignment problem entirely. Gross-motor hauling remains third person.

**Cheapest implementation:** don't author separate first-person arms. **Parent the camera to the character's head bone and play a generic library "reach/hold" pose** — you see through the character's own eyes while the *object* does the visible motion (see §3). Hide the head mesh + set a near-clip plane so you never see inside the body.

**Honest snags:**
- **Fingers.** First person shows hands up close. With no mocap, hands use a small set of **fixed grip poses** (author ~6 once) and the object snaps to the grip; attention is on the task, not finger articulation.
- **Transition.** 3rd→1st must blend or cleanly cut, not whip-pan. Tuned once, standard.
- **Cost:** two camera modes + an interaction state — written once, reused by every interaction.

This *replaces* the earlier "camera pushes to a focused framing" description for interactions: the focused framing is now a true first-person view.

---

## 2AA. Encounter engagement & interaction prompts (UX + camera) — reusable

How the player discovers and enters a world encounter. **Core rule: NPCs never come to the player — the player chooses to enter their space, and the world signals the space is there.** No teleporting, no sprinting across the street to force a beat.

1. **Staged on natural routes.** Encounter NPCs are anchored to a place on a path the player is likely to walk (Clarke in his shop doorway on the main road to the rider). They stay put; engagement is spatial.
2. **Two distinct AR glyphs (never merged):**
   - **Speech glyph + subtitle — always, for any NPC speech outside the player's active dialogue.** Any ambient talker, bark, or crowd line shows a small glyph over the *speaker* plus an **attributed subtitle** (*"Clarke: Liberty, they call it…"*), so the player always knows who spoke and what they said. On by default (core legibility + accessibility), not a toggle.
   - **Interaction glyph — distinct shape/color — marks an engageable NPC** ("you can step in and start something here"). A random grumbling crowd member gets only the speech glyph; Clarke gets both.
   - **Co-occur:** an engageable NPC who is also talking shows both (talking *and* a door). A pure ambient talker shows only the speech glyph (flavor, not a door).
   - **Active partners excepted:** while in a beat with Abigail/Thomas, subtitles stay but the "someone's talking over there" speech glyph is unnecessary — they're who you're with, not background.
3. **Two proximity layers, opt-in:**
   - *Near the zone* → a directional **ambient bark** (world-space audio) draws attention and commits the player to nothing.
   - *Inside the zone* (plus any trigger condition, e.g. an exposed item) → the NPC **addresses the player directly via a spoken line**, opening the choice.
4. **Avoidance is a real route option, not a street-side exploit.** Once the player is adjacent to a staged NPC on that street, the NPC may address them from either side (Clarke calls across the narrow road). The clean avoidance is taking an unlocked alternate route that never enters the encounter's street/zone. Required learning reroutes elsewhere; it never depends on a dodgeable encounter.
5. **Camera:** 3rd-person traversal gets a *gentle* framing nudge toward the NPC on zone entry (never a whip-pan); a clean cut to the Talk-Choose two-shot on engage; return to the traversal cam on exit.

Reads as: *quiet glyph = someone here → bark = they've clocked the street → step into their space = they engage.* The player always closes the distance. Built once, reused by every encounter in every chapter.

**Directing attention in busy witness set-pieces (reusable).** When a big crowd scene must *teach* something specific (e.g. "this protest is organized, led by men with a plan"), never rely on the player happening to spot it in a churning wide shot. Guarantee legibility through direction, layered:
- **Authored vantage** — any "watch from here" option places the player where the key subject is in clear sightline.
- **Short directed camera beat** — a brief scripted push/cut frames the subject, then releases. Fair here because it's a witnessed set-piece, not a skill moment.
- **Salience** — the subject is elevated, lit (torch/fire/lantern), and is the source of the attributed shouted lines (speech glyph + subtitle carry *who* is directing, over the noise).
- **Crowd choreography as cause-and-effect** — the crowd visibly responds to the leader (raise → surge; point → turn), so intent reads from a distance.
- Optional light field tag names the subject once looked at.
The teaching beat is made guaranteed-legible by camera + audio + choreography + salience, never left to whether the player looked.

**Reusable active-witness pattern (build once):** *state-gated Traverse to an authored vantage → gold observation zone → "observe" prompt → detached directed cinematic → release.* The vantage climb is a **state-gated affordance** (the ladder/crates/scaffold exist only for that occasion, same mechanism as a gated route — state, not new geometry), the gold zone reuses the objective-marker system as a "stand here" spot, and the observe-prompt hands off to a short camera-detached cinematic on the subject. Makes witnessing *active* (climb + position + trigger) instead of passive, and guarantees the teaching shot. Reused for every big set-piece across all chapters.

## 2B. Interaction verb catalog (CANONICAL) — the whole pipeline

This is the closed set of everything a player can ever do. We build each verb's presentation **once** (against the §2 patterns), then **all content — every day, every future chapter — is these verbs rearranged with new data.** Authoring becomes composition + review, not engineering. **No new interaction/animation work per day.**

**Organizing principle:** *First person = "my hands on an object." Third person = "me in the world."* Conveniently, the actions that are impossible/janky to animate in 3rd person (fine motor, hand-to-object contact) are exactly the ones that are more immersive in 1st person; and the easy-to-animate ones (locomotion) are more immersive in 3rd (space, danger, scale, social presence). Immersion and buildability point the same way.

**Convey intent through dialogue + staging, never subtle facial/gaze animation.** Without mocap our characters can't reliably carry meaning through a lingering glance, a micro-expression, or an "eyes a second too long" beat — it reads as nothing or as a creepy stare. So any moment that would depend on that instead uses a **spoken line + clear body staging** (a character *asks* "what's that in your bag?" and turns toward you, rather than silently eyeing it). Applies everywhere: suspicion, recognition, doubt, interest — all voiced/staged, not left to the face.

| Verb | Camera | Why this camera | Built as (§2) |
|---|---|---|---|
| Move / traverse world | 3rd | see yourself in the tense city | library locomotion |
| Choose a route | 3rd | spatial/consequence decision | UI + short transition |
| Vault / climb / duck | 3rd | want to see it; animatable | Traverse (canned clip + marker) |
| Evade / sneak | 3rd | tension is spatial | locomotion + visibility state |
| Move through a crowd | 3rd | scale & pressure | crowd + push-through |
| **Read / inspect a document/object** | **1st** | fine motor impossible in 3rd; FP is readable | Focus-Inspect |
| **Compare two documents** | **1st** | same; **surface the delta — never a spot-the-difference hunt** | Focus-Inspect (two objects) |
| **Operate a tool (press, lever)** | **1st** | hand-on-object | Operate (held pose + prop) |
| **Carry / cover / place** | **1st** | hand-on-object | Carry-Place |
| **Conceal an item** | **1st** | tactile, tense | Operate/Carry (FP + prop) |
| **Construct (set headline / sort evidence)** | **1st / UI** | precise work | Construct |
| Talk / dialogue choice | 3rd | social presence | Talk-Choose |
| Free probe (ask/question) | 3rd | conversational | Talk-Choose (no stat/risk cost; small authored day-clock cost) |
| Hand off to a person | 3rd *(1st if tense/concealed)* | see the exchange | "give" clip + object transfer |
| Witness a fixed event | 3rd | spectacle, scale | in-crowd camera |
| Predict / select evidence / attribute perspective | 1st / UI | cognitive | Construct / UI overlay |
| Field tag / Archive sync | overlay | peripheral | UI |

~17 verbs. Build these once and per-day animation/interaction engineering ends.

**Day-1 rule: pattern-complete.** Day 1 must deliberately exercise *every verb at least once*, so when it's built and polished the entire reusable toolkit exists and is proven. That is what turns "Day 1" into the engine for the whole game.

## 3. Animation strategy — NO mocap. Libraries + prop motion + framing

**Decision: no motion capture, no bespoke character keyframing.** We get realistic motion from ready-made libraries and use clever design so the character never has to perform a unique on-camera action.

**Core rule:** *animate the object and control the camera — not the person's fine motion.*

**Where human motion comes from — ready-made libraries (no capture):**
- **Reallusion ActorCore** + **Mixamo** clips: idle, walk, run, turn, talk, gestures, lean, sit, generic pick-up, carry. Retarget onto the shared skeleton. Covers all locomotion + dialogue body language — the bulk of on-screen motion.
- Optional: AI **text-to-motion** for cheap background filler (quality variable — verify before relying).

**Where the "action" comes from — the prop, not the body:**
- Fine interactions play out via **first-person + the object animating** (paper lifts, lever rotates, type-block drops, drawer slides). Prop motion = simple keyframed transforms, trivial, not character animation.
- The character holds a **generic "reach/hold" pose** (library) + a **fixed grip pose**; the object does the visible motion and snaps to the hand attach point.
- **Cutaway / framing** hides anything awkward: reach → quick cut → result state. The hard motion is implied, never animated.
- **Construction tasks** (headline) → UI, no body animation.
- **Background NPCs** → one looping library "working" clip, turned partly away.

**Accepted design constraint (the trade for no mocap):** *no beat may require a unique on-camera full-body action.* Every interaction resolves through first-person + prop-motion + a generic library pose + cutaways. Beat design must live inside this.

**Physical realism for objects:** hero cloth/paper motion = **baked Blender cloth/soft-body sim** exported as vertex animation (zero runtime cost). This is prop work, not character animation.

Everything retargets onto **one shared humanoid skeleton** so every library clip works on every character (Meshy/CC4 rig → shared skeleton).

---

## 4. Getting around the specific hard scenes

- **Inspect / pick up paper** → **first-person** Focus-Inspect. Document held up in FP view; compare two side-by-side. Natural, readable, and no full-body fine-motor. **Legibility rule: the meaningful difference is authored-surfaced — aligned corners, a highlight/light-catching emboss, or a hold-to-compare ghost-overlay — so the player never scavenges to *find* it. Inspection is about meaning, not detection.**
- **Help move / cover cloth** → **third-person effort-tier haul**: rhythmic press/hold + drag while the player uses a reusable carry/haul library clip; the bolt follows authored prop states and snaps to "stacked+covered." Thomas plays a separate working loop nearby. **No cooperative animation.** Cloth = rigid folded states, never runtime sim.
- **Press work (pull the sheet)** → **first-person** operate: generic library hold pose + sheet/lever baked states; object snaps to grip. One pattern reused for all "operate" verbs.
- **Climb watchtower / cart-to-roof** → **third-person** Traverse markers. Prompt at climbable object → climb-up clip w/ root motion → snap to top marker. No procedural IK.
- **Evade watchers** → **third-person** Traverse (duck/press-to-wall) + a visibility state. Getting caught = a Talk-Choose branch, not a physics failure.
- **Set the headline** → Construct. First-person / UI movable-type interface, not full-body animation.

---

## 5. Tooling pipeline

| Job | Tool | Notes |
|---|---|---|
| Stylized hero characters (finger + facial bones for grips/cutscenes) | **Reallusion Character Creator 4 + iClone** (stylized settings) or curated **Meshy** | keep a consistent stylized look; game-ready glTF/FBX |
| Props, background NPCs, quick assets | **Meshy** (text/image→3D + auto-rig) | decimate; export glTF; keep one art style |
| Materials & set-dressing props | **Quixel Megascans** (stylized-graded) | for the 3–4 hero interiors; grade to match style |
| Static environments (interior shells + show street) | **hand-built stylized meshes** (Meshy/Blockbench/Blender) + baked lighting | cohesive stylized look; Gaussian splats optional only if they don't clash with characters |
| All human motion (locomotion, talk, gesture, generic pick-up/carry) | **Reallusion ActorCore** / **Mixamo** libraries | ready-made clips; retarget to shared skeleton. **No mocap.** |
| The "action" itself | **prop keyframes + camera framing** (Blender / in-engine) | object animates, character holds a generic pose; cutaway hides the rest |
| Baked cloth/paper motion | **Blender** cloth/soft-body sim → vertex animation | prop work, not character animation |
| Baked lighting, camera moves, Focus-Inspect lerps, VAT bakes, pre-rendered cutscenes | **Blender** (Cycles/Eevee) | bake lighting to lightmaps — no realtime GI on Chromebooks |
| Voice | **ElevenLabs** | per-line audio |
| Cutscene lipsync | **NVIDIA Audio2Face** or Reallusion **AccuLips** | ElevenLabs audio → facial blendshapes; cutscenes only |
| Runtime | **R3F / three.js r182+ (WebGPU renderer, WebGL2 fallback)** | `ecctrl` (3rd-person controller) + `react-three-rapier` (physics) + `@react-three/drei`; glTF w/ Draco/meshopt; `AnimationMixer`/`useAnimations`; baked lightmaps for the "clean" look |

---

## 6. Environments — ONE shared district, re-dressed 4 times

The four Boston days do **not** get separate environments. We build one district **once** and author four **state-layers** over it. This is the biggest single reason all of Boston fits in the timeline — and it's historically legit (Boston was a small peninsula; the GDD treats the map as *topological, not literal* and discloses the compression; it also matches the GDD's built-in "World Evolution" of the same streets across 1765/1770/1773/1774).

**Build once (the reusable district):**
- **Hero interiors:** Abigail's print shop + Thomas's counting-house + Pike's office (+ maybe one more). Hand-built stylized meshes + **baked lighting** (this is what sells "clean"); **interactables are separate meshes.**
- **A street spine** with the key nodes hanging off it, and the **route network** between them (including obligation/favor-unlocked shortcuts like Thomas's dock route).
- **Four event set-pieces** (Liberty Tree/Fort Hill, King Street/Customs House, Griffin's Wharf, dead port) — hero spots that reuse the same building/street kit.

**Author four times (state, not geometry — cheap):**
- **Lighting / time / weather** — 1765 summer day → 1770 winter snow at King Street → 1773 meeting-day → 1774 closed-port gloom.
- **Set dressing** — Stamp notices → sentries & guarded Customs House → tea notices & meeting traffic → shuttered shops & relief notices.
- **Crowd + NPC population**, which routes are open/blocked, and where that day's fixed event stages.

**Spatial compression (locked):** space is a **gameplay construct, not a map.** Build only the pockets where gameplay happens; stitch them with **abstracted routes** (a short walk / route choice / transition), never real distances. Route choice (fast-exposed / slow-safe / secret) is where encounters, watcher-heat, and trust-shortcuts live. **Guardrail:** compress freely, but never assert a *false geographic fact* the game teaches (STAAR doesn't test street distances anyway).

**Routes are state, not geometry (special-feeling + cheap).** A "secret route" is the **same built world** with a **cheap blocker toggled on/off by state** (a chained gate, piled cargo, a dockmaster shooing people off, a posted sentry) — never separate geometry. It's passable only when the occasion/relationship calls for it (e.g. the favor Thomas owes removes the blocker); otherwise it's visibly blocked and the world reads identically for everyone. Two wins: **production** (a route = one blocker prop + a state flag, zero new level), and **feel** (because it's usually blocked, getting through feels *earned and special*, not a shortcut that was always there). Open/closed is just another authored state-layer, same as lighting or crowd.

**Spend the art budget on the iconic image.** Each day needs **one unmistakable "this is THAT moment" shot** (effigy on the elm; King Street in snow; the wharf at night; the dead port). Those are the memory hooks; the rest of the shared district works quietly in the background.

**Cohesion rule:** everything shares one art style. Don't mix photoreal (Gaussian splats, raw Megascans) with stylized characters — the mismatch is what reads as "cheap." Splats optional, only if graded to match.

**LOD / streaming:** mesh LODs; keep the current interior + adjacent street loaded, lazy-load the rest.

## 7. Known gotchas (Chromebook + web)

1. **WebGPU on Chromebooks.** Splats and modern rendering run far better on the WebGPU renderer; low-end Chromebooks may fall back to WebGL2 (slower splats). `TODO: verify WebGPU support on the exact target Chromebook models — do this in the vertical slice.`
2. **Crowds (Aug 14 protest, meetings).** Individual skinned meshes will kill a Chromebook.
   - Use **instanced low-poly + Vertex Animation Textures (VAT)** or heavily instanced loops; stage crowds at distance; frame the fixed event to limit on-screen animated agents. `TODO: crowd tech spike.`
3. **Performance budget.** Baked lighting, few/no dynamic lights, Draco/meshopt compression, texture atlasing, instancing, LODs, per-device splat budget. Target a low-end Chromebook. `TODO: set concrete poly/draw-call/splat/texture budgets after the test scene.`
4. **Cutscenes decision + budget rule (three tiers — ration hard).**
   - **Pre-rendered Blender cutscene** (film-quality, lipsync, larger download): **only STAAR-named landmark events** a student must identify by name — Boston Tea Party, Boston Massacre, Lexington & Concord, and the like. The marquee moments, nothing else.
   - **In-engine directed camera beat** (camera detaches through the *live* scene using existing crowd/character anim + baked staging; no bespoke render, no lipsync): **every other curriculum-carrier moment**, including Day 1's Aug 14 effigy event (a required carrier, but the *vehicle* for "organized resistance," not a named marquee event, so it gets the cheap treatment).
   - **In-engine staging + barks:** all ambient/flavor/encounters.
   - **The test:** *is this a named event on STAAR?* Yes → pre-render. Teaches a concept only → in-engine directed. Ambient → staging + barks. Route-invariant set-pieces are authored **once** (all on-ramps funnel in), so cost is paid a single time.
5. **Load times.** Stream per-scene asset bundles.

---

## 8. Build order (proposed)

1. **Vertical-slice test scene:** one interior, one stylized character, `ecctrl` movement with library locomotion, one Focus-Inspect (read a document), running on an actual target Chromebook. Proves the whole pipeline + perf before we build content.
2. **Pull the library clip set** (ActorCore/Mixamo: locomotion + talk + gestures + generic pick-up/carry); retarget onto the shared skeleton. Build the prop-motion + cutaway pattern for one interaction.
3. Build the shared district (hero interiors + street spine + routes) and the print shop as the Day 1 playground.
4. Layer Day 1 beats onto the verb catalog — **make Day 1 pattern-complete** (every verb + every system proven).
5. Then Days 2–4 = re-dress the district (state-layers) + compose existing verbs with new content → **automate + review**, no new engineering (except the crowd spike).

---

## 9. Open questions

1. **WebGPU on target Chromebooks** — verify in the vertical slice; decides how hard we lean on splats.
2. **Crowd tech** (VAT vs. instanced loops vs. framing-avoidance) — needs a spike.
3. **Lock the art style early** — one cohesive stylized direction (reference board) that Meshy/CC4/props all conform to. Cohesion is the whole game for "not looking like shit."
4. **Character consistency** — same NPC identical across scenes (CC4 project files handle this; Meshy needs a seed/reference workflow for background NPCs).
5. **Concrete perf budgets** — set after the vertical slice.
6. **Realism vs. Chromebook** — how photoreal can we push characters before frame rate drops on low-end hardware? The vertical slice answers this.

---

## 10. Changelog
- v0.1 — initial pipeline from tooling constraints (Meshy/Blender/ElevenLabs) + locked 3rd-person/R3F decisions.
- v0.2 — realism upgrade: mocap-driven animation (Move.ai/DeepMotion/Cascadeur), Gaussian-splat photoreal environments, Character Creator 4 humans, cutscene-only lipsync (Audio2Face), WebGPU runtime. Scope: 3–4 hero interiors + show street.
- v0.3 — hybrid camera locked: 3rd person for traversal, 1st person for fine-skill interactions (camera parented to head bone). Removes full-body fine-motor + hand-to-prop-alignment risk.
- v0.4 — **no mocap.** Animation strategy switched to ready-made libraries (ActorCore/Mixamo) + prop motion + camera framing. Accepted design rule: no beat requires a unique on-camera full-body action. Removed Move.ai/DeepMotion/Rokoko/Ultraleap/glove options.
- v0.5 — quality target reset to **cohesive stylized (not photoreal / not GTA)**. De-emphasized Gaussian splats + hyper-real characters in favor of one consistent stylized art style + baked lighting. Enemy is jank/incoherence, not low fidelity.
- v0.6 — **pipeline framing.** Target = full Boston chapter shippable; Day 1 = pattern-complete foundation, then automate+review. Added canonical §2B interaction verb catalog (~17 verbs, camera per verb, "hands-on-object=1st / me-in-world=3rd"). §6 rebuilt around ONE shared re-dressed district + spatial compression (gameplay pockets, abstracted routes, one iconic image/day).
