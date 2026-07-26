# Project Archive Product Requirements

**Status:** Draft  
**Product horizon:** Full Texas Grade 8 U.S. History course through 1877  
**Validation MVP:** Boston Mission Day 1  
**First content milestone:** Boston on the Brink, four Mission Days and Mission Debrief  
**Primary source documents:** `Project-Archive-v3.md`, `Day-1.md`, `Chapter-Day-Template.md`, `Interaction-Spec.md`, `Backend-AI-System.md`, and `Localhost-Text-Slice-Spec.md`  
**Amendment, 24 July 2026:** Principle 2, FR-11, and §17 amended to permit learning-coupled progression and a bounded asynchronous social layer under the guardrails in §17.1, and to separate adaptive mechanical difficulty from adaptive assessment difficulty in §17.2. Derives from the redesign in `docs/design/Game-Concept-The-System.md`.  
**Amendment, 25 July 2026:** Principle 2, FR-6, FR-11, §17, §17.1, §17.2, and §18 amended to absorb the game restructure. Rank is an integer advancing one step per ten Levels; stat axes, the fixed named set of ability verbs, and Titles are cut; there is one difficulty for everyone and no difficulty dial of any kind; PvE leaderboards and flawless-run tracking are cut and the only leaderboard is PvP; the 3-minute learning module is mandatory and pays no XP; missions carry three attempts with decaying XP and no knowledge checks. The ranking prohibition in §17.1 is deliberately relaxed in one part and retained absolutely in another — see the amendment block at the end of §17.1. Derives from `docs/chapters/boston-1765/Mission-Slate.md` §1 and `.cursor/plans/pvp_and_mastery_redesign_aeaa8e2b.plan.md`; `docs/design/Game-Concept-The-System.md` is superseded and carries a staleness banner.

## 1. Purpose

This document defines the product problem, target users, outcomes, scope, release gates, and product-level requirements for Project Archive.

The canonical Game Design Document remains authoritative for finished game behavior. `Day-1.md` remains the behavioral acceptance fixture for Boston Day 1. The backend and interaction specifications remain authoritative for their implementation contracts. This PRD decides what must be delivered and validated; it does not replace those specifications.

## 2. Executive summary

Project Archive is a cinematic, story-driven history game for Grade 8 students studying United States history through 1877. Students enter a historically grounded city under a believable cover identity, perform ordinary work, make consequential local choices, handle evidence, and witness fixed historical events.

The product is designed to solve a dual problem:

1. Required history instruction is often experienced as passive, abstract, and disconnected from human action.
2. Entertainment-first history games can create engagement without guaranteeing standards coverage, historical accuracy, or valid learning evidence.

Project Archive combines bounded role-playing agency with invariant learning. Routes, relationships, job outcomes, object condition, optional encounters, and support can vary. Recorded history, required curriculum, and assessment standards cannot.

The initial proof point is Boston on 14 August 1765. The student works as a runner for Abigail Mercer’s print shop while opposition to the Stamp Act gathers around the great elm later known as Liberty Tree.

## 3. Product vision

Enable students to master required historical knowledge and reason from evidence while feeling that they lived through the events.

The intended moment-to-moment experience is:

> I am doing a job in Boston while history changes around me.

The product must simultaneously guarantee:

> The student encountered, retrieved, and applied the required causes of colonial resistance under controlled conditions.

Neither engagement without learning nor learning without compelling play is sufficient.

## 4. Target users

### 4.1 Primary student

A currently enrolled Grade 8 U.S. history student who may have mixed:

- prior historical knowledge;
- reading fluency;
- game and keyboard literacy;
- attention and motivation;
- sensory, motor, and cognitive access needs;
- access to reliable home internet.

Student needs:

- a clear purpose and discoverable next action;
- meaningful choices with understandable consequences;
- concise reading and dialogue appropriate for a 13-year-old;
- freedom to recover without shame;
- accessibility options that preserve agency, stakes, information, and consequences;
- automatic progress saving and reliable resume;
- historical explanations grounded in what they just saw or did.

### 4.2 Teacher

A Grade 8 U.S. history teacher who needs:

- visible alignment to current STAAR-eligible Texas Essential Knowledge and Skills;
- confidence that every student receives the required instruction;
- a product that fits classroom time and hardware constraints;
- aggregate, standards-aligned evidence that does not overclaim mastery;
- minimal setup and no need to rescue normal navigation;
- clear distinction between formative in-game evidence and formal assessment.

### 4.3 School or district stakeholder

A curriculum, technology, accessibility, privacy, or research stakeholder who needs:

- defensible historical and curricular provenance;
- predictable deployment and support;
- privacy-minimizing telemetry;
- reliable operation on target school hardware;
- evidence that supported accommodations do not reduce meaningful choice;
- versioned content, assessments, and audit trails.

### 4.4 Secondary users

- Families and independent learners.
- Historians, curriculum reviewers, accessibility reviewers, and researchers.
- Internal narrative, level, content, production, QA, and engineering teams.

## 5. Jobs to be done

### Student

- When history feels remote, let me enter a specific place and role so I can understand why events mattered to people living through them.
- When I make a choice, show me what changed locally without pretending I can rewrite recorded history.
- When I misunderstand something, help me inspect evidence and try again without labeling or embarrassing me.
- When class or a device interrupts me, return me to the same committed state without changing the outcome.

### Teacher

- When assigning a chapter, let me trust that required standards are covered on every valid path.
- When reviewing progress, separate exposure, formative performance, chapter verification, and independent assessment.
- When students play independently, keep navigation understandable enough that I do not become the game’s controller.

### Product and curriculum team

- When producing a new chapter, reuse a validated gameplay and learning grammar while preserving the chapter’s distinct place, job, anchor character, and historical pressure.
- When evaluating success, require both learning and gameplay evidence rather than using time played as a proxy for either.

## 6. Product principles and non-negotiable constraints

1. **History is fixed; local consequences are real.** The student cannot alter recorded events, but can alter work quality, timing, object state, attention, routes, relationships, and local outcomes.
2. **Required learning is path-invariant.** Every legal route, outcome, accessibility profile, progression state, Level, Rank, mission attempt outcome, spent-attempt state, PvP participation, offline path, and resume boundary must preserve required curriculum obligations. A permanently failed mission removes no obligation and closes no learning surface.
3. **Player-facing content is authored and approved.** Runtime systems may select approved content but may not generate or rewrite history, dialogue, questions, feedback, objectives, or consequences.
4. **The game never waits for runtime AI.** Selection is local and deterministic. Network or model availability cannot block the required experience.
5. **Learning is embedded in action.** Jobs, evidence, conversations, work products, and historical pressure carry instruction before the Archive adds explanation.
6. **Assessment is evidence-based.** Prompts ask students to interpret evidence, cause, consequence, chronology, context, and perspective rather than state personal opinions.
7. **Accessibility preserves meaning.** An accessible presentation may change input or timing but not ownership, information, meaningful options, stakes, or consequence range.
8. **Saving is automatic and invisible.** A committed consequence cannot disappear, reroll, or become a success after resume.
9. **The product models bounded misconceptions, not the child.** Support is non-punitive and never exposes predictive learner labels to students.
10. **Historical accuracy wins.** Dramatic convenience, schedule pressure, and engagement optimization cannot override reviewed history.

## 7. Product structure

### 7.1 Full-course hierarchy

- The full game covers Texas Grade 8 U.S. history through 1877.
- The canonical course contains five Seasons and twenty core Chapters.
- Each Season contains four Chapters and one Season Review.
- Each Chapter contains one compact district, one cover identity and job family, one anchor character, three to five Mission Days, and one Mission Debrief.
- Each Mission Day contains one primary job, one fixed historical event, required learning interactions, a return to the anchor, and an End Day commit.

### 7.2 Core Mission Day loop

1. Archive intake establishes date, cover identity, and historical context.
2. The student arrives in a changed historical district.
3. The anchor character gives a believable work obligation.
4. The student performs occupational mechanics and handles job objects.
5. The student chooses routes and resolves authored encounters or silence.
6. Required evidence and conversations establish curriculum concepts.
7. One fixed historical event unfolds without becoming player-controlled alternate history.
8. Spaced Archive Syncs check first understanding.
9. The student returns to the anchor and creates or completes a work product.
10. End Day atomically commits world, relationship, learning, replay, and progress state.

Typical Mission Day duration is 15–30 minutes. A learning-dense foundation day may use the 25–30 minute range.

## 8. Validation MVP: Boston Day 1

### 8.1 MVP objective

Prove that one complete Mission Day can be:

- compelling as a consequential historical role-playing experience;
- independently navigable by Grade 8 students;
- historically and curricularly correct;
- deterministic, offline-capable, and resumable;
- accessible without reducing meaningful agency;
- measurable without collecting unnecessary student data.

The MVP is a product validation milestone, not evidence that the full course is complete.

### 8.2 Historical and narrative scope

- Date: 14 August 1765.
- Place: Boston.
- Cover: runner for Mercer’s Press.
- Anchor: Abigail Mercer, fictional print shop owner.
- Job: prepare printed work and complete four order-free errands.
- Fixed event: the organized crowd at the great elm and the Andrew Oliver effigy.
- End product: a printed front page connecting taxation, postwar revenue, and representation.

The event must not be conflated with the 26 August attack on Thomas Hutchinson’s house.

### 8.3 Required student experience

The student must:

- complete Archive intake and arrive at Mercer’s Press;
- enter and establish a relationship with Abigail;
- catch a sheet and pull a proof on the press;
- compare stamped and unstamped proofs;
- receive four errands;
- choose errand order;
- encounter meaningful time-versus-risk tradeoffs;
- deliver or resolve Thomas’s circular, Pike’s proof, the Custom House notice, and the rider’s handbills;
- encounter Clarke during the rider route;
- observe the gathering at the great elm;
- experience the fixed historical event;
- return to Abigail;
- demonstrate understanding through the final headline, cause line, and evidence selection;
- pull the final page and reach the Day Record.

### 8.4 Required Day 1 concepts

Every legal completion path must establish, check, and apply:

1. Britain’s postwar debt drove Parliament to seek colonial revenue.
2. The Stamp Act was an internal tax on covered printed and legal paper.
3. Colonists objected that Parliament taxed them without elected colonial representation.

Each concept requires:

- three tracked exposure occasions;
- at least two exposure types;
- one first-understanding check;
- one same-day applied demonstration;
- bounded re-exposure and correction after a miss.

Optional content may reinforce these concepts but may never be their sole carrier.

### 8.5 Current implementation baseline

As of 20 July 2026, the repository contains a playable internal Day 1 prototype:

- the deterministic Day 1 flow runs in a headless Web Worker behind a typed presenter boundary;
- the 3D client presents movement, objectives, NPCs, interiors, mechanics, choreography, and fallback destination controls;
- the three-concept learning loop, local profiles, event-stream saves, onboarding, Google sign-in, and basic cloud persistence exist;
- workspace type checks, the current runtime test, a temporary production web build, and limited autoplay paths pass.

This baseline is not student-pilot ready. Release-blocking gaps include:

- full OIDC and session hardening;
- encrypted local storage, cold offline account unlock, atomic sync outbox, conflict preservation, and recovery journal;
- signed compiled content packages and approval records;
- exhaustive legal-path, avoidant-path, account-isolation, save-boundary, offline, model, and end-to-end tests;
- complete behavioral support for captions, audio description, keyboard-only mechanics, Archive Assist, and other declared accessibility settings;
- target-Chromebook performance and bundle budgets;
- privacy policy, consent, telemetry, export/deletion, and audited access controls;
- reproducible asset packaging and clean-clone release tooling.

The current prototype proves feasibility. It must not be represented as a certified offline product, a secure student deployment, a validated accessibility experience, a replay-uniqueness system, or teacher-grade assessment evidence until the corresponding gates pass.

## 9. Functional requirements

### FR-1: Identity, profiles, and onboarding

- Support a student profile with a stable, non-email ownership identifier.
- Support Google account sign-in where configured.
- Validate Google identity-token signature, trusted issuer, audience, expiry, nonce, and authorization-code/PKCE state before creating a profile or session.
- Keep local test profiles clearly separate from authenticated production profiles.
- Give every profile its own variation seed, save state, learner evidence, and replay state.
- Provide first-run calibration for reading pace, captions, audio description, input method, contrast, reduced motion, and Archive Assist offers.
- State that onboarding preferences do not change assessment or historical outcomes.
- Preserve profile and save data across logout while revoking the active application session and offline grant as policy requires.

### FR-2: Clear objectives and navigation

- Present the current job objective in one sentence.
- Couple world markers and the Today strip so they cannot disagree.
- For order-free required errands, allow the student to select focus while keeping all unresolved required objectives visible.
- Escalate route guidance without immediately revealing the route.
- Offer Archive Assist after sustained inactivity; reveal the route only after acceptance.
- Never leave a student without a legal, discoverable next action.

### FR-3: Occupational gameplay

- Use reusable mechanic families for press work, effort, sorting, placement, object handling, traversal, handoff, and diegetic construction.
- Teach controls by performing real job actions rather than through detached menus.
- Use third-person presentation for movement and social presence, with first-person presentation for close object handling and fine work.
- Present two or three materially distinct options at ordinary decisions; disclose relevant effect dimensions without revealing hidden outcome rolls.
- Allow normal work to produce complete, partial, damaged, late, missed, or failed local outcomes where authored.
- Make mechanical and contextual causes legible after resolution.
- Ensure ordinary context-suited actions have at least 0.70 combined probability of success or useful partial success unless clearly signaled and approved as high-risk.

### FR-4: Consequential local agency

- Choices must change at least one authored local state when presented as consequential.
- Persist job-object custody and condition.
- Persist relationship changes, route unlocks, attention, timing, and recognized local outcomes.
- Show prompt feedback for significant consequences without turning every choice into a blocking report.
- Never silently restore a missed objective or erase a failure to satisfy curriculum needs.
- Reroute the missing learning carrier through a historically valid equivalent instead.

### FR-5: Historical invariance

- Fixed historical events must occur at their authored state or activity-clock boundary.
- The student may choose viewpoint and non-conflicting local action where supported.
- No legal action may create an alternate recorded outcome.
- Every named historical figure, quotation, place, event, and material claim must have reviewed provenance.
- A fictional composite may not satisfy a required real-person obligation.

### FR-6: Learning lifecycle

- Track exposure, first understanding, demonstration, and later reassessment as distinct states.
- Require the learning module before a mission's first attempt and again before every retry. It is always exactly 3 minutes, is never skippable, and pays no XP.
- Keep every required-learning surface uncapped. The module may be repeated, and the mastery assessment retries with a shrinking scope and fresh items until every concept reaches 100 percent. Attempt economies belong to missions, never to learning (§17.1).
- Do not count movement, reaction time, route choice, accessibility use, or free-roam duration as learning evidence.
- Trigger first-understanding checks only after the required evidence threshold.
- Space Archive Syncs so they do not feel like a quiz block.
- After an initial miss, provide one approved re-exposure and one retry.
- After a second miss, correct in place without looping or shaming.
- Complete a Mission Day only when all due learning contracts and demonstrations are satisfied.
- Keep formative support separate from official Chapter and Season assessment records.

### FR-7: Archive experience

- Present the Archive as an in-fiction field system, not a classroom dashboard.
- Keep Archive language concise, calm, procedural, and supportive.
- Use the Archive for identity, context, field tags, optional assistance, first-understanding checks, notes, and records.
- Keep at least 90 percent of active play in the historical setting.
- Avoid exposing mastery predictions, deficit labels, or experimental metrics to students.

### FR-8: Runtime direction and content safety

- The Event Manager must determine the complete legal action set.
- The local deterministic Director may return only one eligible authored action ID or typed `NO_ACTION`.
- The Director may not choose mechanic outcomes.
- The runtime may not generate or rewrite player-facing semantic content.
- The same approved package, state, revisions, and attempt seed must produce the same selection and outcome.
- Invalid or stale selections must fail closed and be recomputed locally.

### FR-9: Save, resume, offline, and synchronization

- Save automatically at mechanic phases, committed outcomes, event boundaries, Syncs, and End Day.
- Commit world, learner, replay, save, transaction journal, and synchronization outbox state atomically.
- Resume at the last valid phase without rerolling uncertainty or consequences.
- Make the complete required chapter path playable without network or runtime AI.
- After an authorized online login, allow policy-bound offline resume for that profile.
- Resolve cloud/local synchronization through idempotent versioned transactions, exact revision rules, and preserved conflict branches rather than last-write guesswork.
- Keep active attempts pinned to an immutable content package.

### FR-10: Accessibility

- Support keyboard and pointer input plus a keyboard-only path for every required action.
- Support captions, high contrast, reduced motion, reading pace, and configurable Archive assistance.
- Provide accessibility-equivalent completion for each required mechanic.
- Do not infer learner weakness from accessibility settings.
- Validate parity of meaningful choices, information, ownership, stakes, and consequence range across supported profiles.
- Prevent subtitle collisions and provide user-controlled pauses where required.

### FR-11: Assessment and teacher evidence

- Use Mission Debriefs for chapter-level claim, evidence, and reasoning.
- Use Season Reviews for common STAAR-style verification and transfer.
- Keep assessment forms, item difficulty, and the correctness bar independent of replay route, support history, learner-state labels, mission attempt history, Level, Rank, PvP standing, and any other progression or social state.
- Treat mission outcomes and duel verdicts, in PvE and PvP alike, as gameplay results rather than assessment evidence. They may not enter the formal record, be reported as mastery, or reach teachers as standards evidence.
- Provide teachers aggregate standards-aligned evidence appropriate to their role.
- Separate exposure, formative interaction, Chapter verification, Season verification, and independent research measures.
- Do not infer or market an official STAAR score from internal telemetry.

### FR-12: Content production and governance

- Package all runtime content as versioned, immutable, approved artifacts.
- Cryptographically verify package signatures, schemas, source hashes, compiler versions, assets, and compatibility before execution.
- Require historical, curriculum, narrative, cultural, accessibility, privacy, legal, and production review before content lock.
- Compile executable ActionSpecs from reviewed source definitions; generated ActionSpecs are not hand-edited.
- Validate graph reachability, required-carrier completion, historical order, fallbacks, assets, accessibility paths, save/resume parity, and deterministic golden vectors before release.
- Permit production AI to draft candidates only; no generated candidate reaches a player without human approval.

## 10. Non-functional requirements

### Reliability

- No deadlock on any legal completion path.
- No unrecoverable save corruption.
- No historical or curriculum state corruption.
- A blocking asset or network failure must have an approved recovery path.

### Performance

- Deliver the student experience through the web without a required local installation.
- Target managed school Chromebooks, using WebGPU where available and a supported WebGL2 fallback.
- Player choice commit must produce a visible or audible world reaction within the interaction target defined by the engine specification.
- No immediate gameplay boundary may block on a remote model, network selection, or non-local asset generation.
- The target hardware and browser matrix must be defined before student pilot recruitment.

### Determinism

- Online, offline, uninterrupted, and resumed executions must remain equivalent for selected actions, committed outcomes, clock, learning evidence, relationships, and continuation.
- QA must be able to reproduce a run from package version, selector version, seed, and committed state.

### Privacy and security

- Collect the minimum data needed for profile ownership, save synchronization, product reliability, and approved research.
- Exclude raw student responses, direct identifiers, and inferred learner-state labels from general telemetry by default.
- Apply role-based access, tenant boundaries, retention policy, export, and deletion controls.
- Complete child/student privacy, school policy, consent, and research review before deployment.
- Protect sessions, OAuth state, offline grants, content packages, and save transactions against replay and unauthorized mutation.

### Content quality

- Zero critical historical-accuracy defects at content lock.
- Zero runtime-generated player-facing semantic content.
- All required content must have accessible fallback coverage.
- Dialogue must pass age-appropriateness and 13-year-old paraphrase review.

## 11. Scope by milestone

### Milestone A: Day 1 internal vertical slice stabilization

Includes:

- one complete Boston Day 1 path from Archive intake through Day Record;
- deterministic headless runtime;
- typed presenter boundary;
- student profile and onboarding preferences;
- local save and resume;
- the core 3D presenter and required accessible controls;
- all Day 1 learning carriers, Syncs, demonstrations, and fallbacks;
- automated path, determinism, and save-boundary tests;
- development telemetry sufficient to diagnose pacing and deadlocks.

Excludes:

- teacher reporting portal;
- official scored assessment;
- runtime generative AI;
- open-ended response classification;
- production-scale content delivery;
- full localization;
- commercial learning claims.

### Milestone B: Day 1 student validation build

Adds:

- target school hardware optimization;
- production-quality Boston Day 1 art, audio, captions, camera, and accessibility treatment;
- secure account and offline-grant behavior;
- privacy-approved pilot telemetry;
- unprompted student usability and agency testing;
- specialist historical, curriculum, accessibility, and cultural review.

### Milestone C: Boston chapter pilot

Adds:

- four Mission Days: Stamp Act, Boston Massacre, Tea Party, and Port Closure;
- a target chapter runtime of approximately 55–75 minutes plus a 3–5 minute Mission Debrief;
- persistent Abigail relationship and district state changes;
- a reviewed Living Historical Encounter bank;
- Mission Debrief and approved independent learning measures;
- classroom deployment workflow;
- aggregate teacher-facing standards evidence;
- Boston chapter completion, reliability, learning, and retention studies.

### Milestone D: Season 1

Adds:

- Colonies, Boston, Independence, and War for Independence Chapters;
- cross-chapter retrieval and Archived Conversation callbacks;
- one common Season Review;
- validated content production throughput for multiple districts and jobs.

### Milestone E: Full course

Adds:

- five Seasons and twenty Chapters covering the current STAAR-eligible Grade 8 U.S. History scope through 1877;
- complete assessed-curriculum coverage ledger;
- mature teacher administration and reporting;
- production, validation, support, privacy, and content-update operations.

## 12. Success metrics and release gates

Every metric must receive a stable definition before collection, including population, numerator, denominator, exclusions, missing-data rules, instrument version, time window, uncertainty interval, subgroup analysis, and release threshold.

### Day 1 gameplay and agency gate

- At least 90 percent of at least 24 Grade 8 students across two classrooms complete the press, route/handoff, crowd, and headline mechanic families without adult takeover.
- At least 80 percent can identify two local consequences of their actions and one recorded historical outcome they could not change.
- At least 75 percent positively report that their choices changed their work or relationships.
- No required sequence exceeds the preregistered passive listen/watch limit except a historically necessary fixed event or accessibility-controlled pause.

### Navigation gate

- At least 90 percent complete the tested Mission Day without adult navigation rescue.
- No student remains more than 60 continuous seconds without a legal discoverable next action after Archive Assist is used or offered.

### Archive pacing gate

- At least 95 percent of reached Sync administrations are committed.
- Median completed Sync duration is at most 20 seconds.
- Ninetieth-percentile completed Sync duration is at most 30 seconds, excluding time explicitly added by the active accessibility profile.

### Boston chapter completion gate

- At least 80 percent of at least 40 Grade 8 students commit Chapter completion without researcher navigation rescue in one 90-minute block or two 45-minute sessions, excluding setup.

### Runtime reliability gate

- At least 98 percent of started pilot administrations reach their assigned terminal state without blocking technical failure.
- Zero unrecoverable save corruptions.
- Zero historical or curriculum state corruptions.

### Learning and retention gate

- Use an independently authored matched-form pretest, immediate post-test, and delayed test 14–28 days later.
- Use an active TEKS-aligned comparison condition and a preregistered power analysis with no fewer than 100 students.
- The adjusted immediate difference-in-change must have a standardized point estimate of at least 0.20 with the two-sided 95 percent confidence interval lower bound above zero.
- The delayed adjusted contrast must remain positive and retain at least 60 percent of the immediate adjusted contrast under the preregistered noninferiority analysis.

### Production guardrails

- 100 percent of due required semantic obligations complete on every legal path.
- 100 percent of required historical events have fallback coverage.
- 100 percent of legal mechanic terminal outcomes have an authored continuation and due-carrier path.
- Zero deadlocks or invalid Director selections escaping revalidation.
- Zero same-profile system-selection signature repeats in the first five certified Chapter completions when a support-equivalent alternative exists.
- Zero critical historical-accuracy defects at content lock.

### Access review

Any preregistered demographic or accommodation subgroup with at least 20 participants that shows a greater than 10-point gap in completion, navigation rescue, meaningful-choice availability, consequence range, outcome legibility, or agency rating triggers a blocking access review.

## 13. Analytics requirements

Telemetry exists to validate product claims and diagnose defects, not to optimize compulsion.

Required product signals include:

- Mission Day and Chapter starts, resumes, and terminal states;
- objective selection, completion, miss, failure, and recovery;
- mechanic family completion, partial outcome, recovery, and accessibility-equivalent completion;
- time to first valid objective;
- time without a discoverable next action;
- Archive Assist offer, acceptance, and resolution;
- Archive Sync open, response, retry, correction, completion, abandonment, and duration;
- save checkpoint, resume, synchronization, and recovery result;
- blocking technical failure category;
- selected authored action and local consequence identifiers;
- optional encounter frequency, opt-out, route resumption, and replay novelty;
- content package, selector, assessment, and instrument versions.

General telemetry must not contain:

- raw student answers;
- free-text conversation content;
- direct identifiers;
- inferred misconception or mastery labels;
- email addresses as gameplay ownership keys.

## 14. Key risks and mitigations

### The game becomes a lesson wrapped in 3D

Mitigation:

- enforce a mechanical-action share target;
- limit passive sequences;
- require each foreground interaction to serve gameplay, story, character, curriculum, or pacing;
- test student-rated agency and desire to continue.

### Agency feels false because history is fixed

Mitigation:

- make local outcomes persistent and visible;
- vary routes, object condition, relationships, access, and consequences;
- explicitly test whether students can distinguish what they changed from what history fixed.

### Variation breaks learning consistency

Mitigation:

- make required carriers explicit contracts;
- model-check all legal paths;
- reroute by missing carrier type without reversing world consequences;
- keep assessment standards independent of route and support.

### Historical compression creates inaccuracies

Mitigation:

- require reviewed dossiers and fixed historical spines;
- prohibit composite characters from standing in for required real people;
- stop asset production when source or chronology review fails.

### Reading load or navigation blocks Grade 8 students

Mitigation:

- use concise dialogue and age-appropriate paraphrase testing;
- teach controls through work;
- keep objective guidance coupled and escalating;
- test without gameplay coaching on school hardware.

### Required learning overloads Day 1 pacing

Mitigation:

- test both the representative path and the fully avoidant fallback path before scaling content;
- measure Sync duration, late-day fallback density, passive intervals, and abandonment;
- keep fallback carriers embedded in authentic print-shop or street work rather than presenting a remediation block.

### 3D asset production outpaces validated content

Mitigation:

- lock standards, history, text, graphs, and fallback behavior before expensive media;
- keep the headless runtime and presenter boundary replaceable;
- validate Day 1 before scaling environment and character production.

### School deployment and privacy delay pilots

Mitigation:

- define the school identity model, consent path, data map, retention, deletion, and research protocol before recruitment;
- minimize telemetry and keep general product analytics separate from approved research data.

### Full-course scope overwhelms production

Mitigation:

- gate expansion on a validated Boston chapter;
- measure chapter authoring and validation throughput;
- reuse stable engine contracts while allowing distinct chapter content;
- preserve the core path and fallbacks before optional breadth.

## 15. Dependencies

- Current STAAR-eligible Grade 8 Texas Social Studies standards and assessment guidance.
- Historical dossiers, primary-source provenance, quotation and media rights.
- Cross-disciplinary historical, curriculum, narrative, cultural, accessibility, privacy, legal, and research review.
- Target school hardware, browser, network, audio, and identity requirements.
- A deterministic runtime, content compiler, validation suite, save system, and presenter.
- Production pipelines for environments, props, characters, animation, voice, subtitles, camera, music, and sound.
- Independent assessment instruments and an approved pilot protocol.
- Teacher and school partners for unprompted classroom testing.

## 16. Product acceptance criteria for Boston Day 1

Boston Day 1 is product-complete for student validation only when:

1. A new student can authenticate or use an approved pilot profile, complete calibration, and start the day.
2. The day runs from Archive intake through Day Record without developer intervention.
3. All four errands can be selected in any order and resolve through authored outcomes.
4. The fixed event becomes mandatory at the authored activity-clock boundary even when errands remain.
5. Missed errands remain missed while due learning reroutes through valid fallbacks.
6. Every legal path completes all three Day 1 learning lifecycles.
7. A first understanding miss produces one re-exposure and one retry; a second miss corrects without looping.
8. Choices create visible local consequences while recorded history remains invariant.
9. Every required action has a supported keyboard-only and configured accessibility-equivalent path.
10. Save and resume at every checkpoint produce the same continuation as uninterrupted play.
11. The complete required path works with the network and any remote model service unavailable.
12. A cold offline reload after approved initial account authorization can resume and finish the required path.
13. Corrupt, unsigned, stale, or incompatible content packages are rejected.
14. Two authenticated Google subjects receive isolated identities, seeds, saves, and learner state and cannot access one another.
15. Production builds hide test profiles, seed values, internal learner labels, and debug controls.
16. Automated lint, type, build, unit, property, model, path, account-isolation, offline, save/resume, and end-to-end suites pass from a clean clone without placeholder commands.
17. Historical, curriculum, narrative, accessibility, privacy, security, and age-appropriateness reviews are approved.
18. The student build emits only the approved metric registry and excludes prohibited data.
19. The Day 1 gameplay, navigation, Archive pacing, and reliability gates pass before Boston chapter expansion is declared validated.

## 17. Non-goals

Project Archive is not:

- a free-form historical sandbox;
- alternate history;
- a combat-centered game; the authored duel that closes a mission, and the same format in PvP, are permitted because knowledge is the resource that wins them and the mission itself is traversal, stealth, and precision work, but combat may not spread beyond that bounded beat, may not become the product's centre of gravity, and may not carry gore;
- a crafting, inventory-grind, or morality-meter product; experience points, Levels, an integer Rank advancing one step per ten Levels, abilities unlocked at Level milestones, and a Codex collection are permitted only as learning-coupled progression bound by §17.1. The lettered E-through-S Rank ladder, stat axes, the fixed named set of ability verbs, and Titles are cut and may not return;
- a multiplayer, cooperative, shared-session, or open social game; a friends list and opt-in 1v1 PvP duels with a PvP-only ladder are permitted only as the bounded social layer defined in §17.1. No required curriculum may run through them, and PvE has no competitive layer of any kind;
- a general-purpose AI tutor;
- a chatbot that invents historical dialogue;
- a textbook or quiz sequence rendered in 3D;
- a literal city-scale or photorealistic open world;
- a simulation where student motor skill determines learning evidence;
- a system that changes required knowledge, assessment difficulty, or the mastery bar based on inferred ability, measured motor skill, accessibility profile, calibration result, Level, Rank, or PvP standing; there is one difficulty for everyone and no difficulty dial of any kind, mechanical or otherwise (§17.2);
- an official STAAR score predictor;
- a replacement for a teacher or the complete classroom curriculum without validated evidence;
- an engagement product optimized for endless play, streaks, or compulsion loops.

The Boston Day 1 MVP does not attempt to validate:

- the complete Grade 8 course;
- teacher reporting at district scale;
- open-ended response classification;
- equivalent Season Review forms;
- commercial learning or STAAR-improvement claims;
- localization beyond the approved pilot language;
- production throughput for twenty Chapters.

### 17.1 Progression and social guardrails

Progression and social features are permitted only under every constraint below. These constraints replace the withdrawn non-goal text, bind at the level of §6, and derive from the restructure recorded in `docs/chapters/boston-1765/Mission-Slate.md` §1. A feature that fails any one of them is out of scope rather than out of tune. There are seven, and other documents cite them by that count.

- **Every reward is coupled to learning or skill demonstration.** No XP, Level, Rank, ability unlock, or Codex entry may be granted decoupled from demonstrated learning or demonstrated mission performance. XP has exactly one payer, completing a mission; modules and assessments pay none. Codex cards are minted only at 100 percent per concept. No reward for time spent.
- **No dark patterns.** No penalty zones, streak shaming, loss-aversion mechanics, artificial scarcity, compulsion or endless-engagement loops, or monetization hooks. Rewards are carrot only. The finite three-attempt mission economy and its decaying XP are the one bounded exception, and they are bounded to the game layer: a spent attempt costs score and nothing else, a failed mission still advances the player, and no attempt economy, decay, or expiry may ever touch a module, an assessment retry, or any other required-learning surface.
- **The only leaderboard is PvP, and it ranks duel outcomes, never the learning record.** *Relaxed and re-tightened 25 July 2026; the reasoning and the mitigations are recorded in the amendment block at the end of this section.* PvE leaderboards, flawless-run tracking, ghosts, times, and scores are cut outright, so no public ordering of mission performance exists. The PvP ladder may rank match results and Rank. It may never rank, display, publish, or derive from mastery state, concept coverage, assessment scores, module completion, remediation history, or per-question answer accuracy. Ranking learners by their formal learning record remains prohibited absolutely.
- **The social layer is bounded.** Friend-by-code only, with no user search and no discovery; no free-text chat of any kind; display names must not be real names and no surface may resolve one to a roster identity; opt-in 1v1 duels in the boss-duel format, bracketed by Rank, are the only interaction channel. A duel's free-response answer is grader input, not a message: it is submitted to rubric classification and is never relayed, displayed, or stored as text an opponent can read.
- **The formal assessment record stays route-independent and private.** Progression state, social state, PvP standing, and ladder position do not alter it, appear in it, or derive from it (FR-11).
- **Required learning stays path-invariant, ungated, and retryable without limit,** with an accessible floor. This survives the three-attempt mission cap, because **missions are not required learning**: they carry no knowledge checks, and no required concept, exposure obligation, or mastery judgement runs through a mission's win condition. The required-learning surfaces are the mandatory 3-minute module and the mastery assessment, and both stay uncapped — the module is re-run before every attempt and may be repeated, and the assessment retries with a shrinking scope and fresh items until every concept reaches 100 percent. Interposing required instruction before a retry is teaching, not rationing. What may never exist is a limit on how many times a student may attempt to reach mastery, or a spent-attempt economy anywhere on the learning spine. There is one difficulty for everyone (§17.2), so no progression, Rank, or PvP state may gate, ration, or delay required learning.
- **Accessibility equivalents are preserved for every graded or skill-based beat** (FR-10). Using one carries no progression, grade, ladder, or match penalty and supports no inference about ability.

**Amendment, 25 July 2026 — the PvP ladder and the ranking prohibition.**

The restructure cuts PvE leaderboards and flawless-run tracking outright and leaves exactly one competitive surface, the PvP ladder. That ladder strains the original prohibition harder than a mission-time board ever did. The strain is recorded here rather than resolved by quietly deleting the guardrail.

**The strain is real, and calling it something else would be a word game.** A PvP duel pauses before each of six rounds and asks a free-response history question. A correct answer grants three bullets and a wrong one grants one, so knowledge converts directly into the resource that wins the match. Matchmaking is bracketed by Rank, Rank is Level divided by ten, and Level is driven only by mission XP. A student's standing on that ladder is therefore influenced by what they know. This is materially closer to ranking students by their knowledge than anything the original guardrail contemplated.

**What is relaxed, stated plainly.** Exactly one thing: the product now permits a public standing whose outcome is *partly* determined by history knowledge. What is being ordered is a set of match results — events with winners — not a measurement of a student.

**What is retained, absolutely.** The formal learning record may never be ranked, compared, published, or made visible to another student. Mastery state, concept coverage, assessment scores, first-attempt scores, module completion, remediation history, and per-question answer accuracy sit outside every leaderboard, profile view, and social surface. No ladder may be derived from them, and none may be reverse-inferred from a ladder: a board that published duel accuracy rates, or ordered students by questions answered correctly, would be the prohibited thing wearing the permitted thing's name.

**Why the retained half is the half that protects students.** The harm this guardrail was written against is a child's deficit becoming publicly legible — a durable, unambiguous, school-sanctioned statement that this student knows less than that one. A duel result does not carry that. It is one match, multi-causal, and deniable; the bullet economy is deliberately built so that a mechanically strong player can still win on a single bullet, and a wrong answer costs a round rather than a label. A mastery ranking carries it exactly, permanently, and in the same currency the school already uses to grade. Losing a duel says you lost a duel. Standing last on a mastery board says what you are.

**Mitigations. Each is load-bearing, and none may be dropped without reopening this amendment.**

1. **The formal assessment record stays private, route-independent, and unaffected by PvP standing** (FR-11). PvP results do not enter it, alter it, or derive from it, and they never reach teachers as standards evidence.
2. **The mastery assessment, not PvP, gates curriculum progression.** Progression is bought with a private, deterministic, multiple-choice gate requiring 100 percent per concept, and that gate has no effect on Rank. Nothing a student does or fails to do in PvP opens or closes a mission set.
3. **PvP is opt-in and unlocks only after a full chapter is complete.** A student may finish the entire curriculum, reach full mastery, and never appear on a ladder at all.
4. **Matchmaking is bracketed, not a global ordering.** A student meets peers inside their own Rank bracket. There is no all-class, all-school, or all-product ranking of children, and no bracket may expose the population's full ordering.
5. **Display names are not real names,** and no social surface resolves one to a roster identity.
6. **The answer field is not a chat channel.** Typed free-response answers go to rubric classification and are never shown to an opponent as text, so the no-free-text-chat rule holds without exception.
7. **Rank measures mission performance only.** Level is driven solely by mission XP, and the assessment pays none, so the seed of matchmaking is play rather than knowledge. If XP ever becomes payable for learning, this amendment must be reopened: that one change would convert Rank itself into a public mastery ordering, which is the prohibited thing.

### 17.2 One difficulty, and no knowledge dial

**Rewritten 25 July 2026.** This section used to govern two adaptive axes and permit movement on one of them. The restructure removes the difficulty dial entirely, so what remains is one rule about an axis that no longer moves and one prohibition that was always absolute. The guardrail's intent is unchanged; it is simply now enforced trivially.

- **There is one difficulty for everyone.** No Easy mode, no difficulty bands, no mission levels, no player-minus-mission delta, and no hidden or adaptive per-player easing of any kind. The input bar is authored once, low enough for a school trackpad, and never moves. Detection radii, cone angles, patrol speed, pattern density, timers, and error tolerance are authored constants, not per-player variables. Later missions are harder because their bosses and floors are authored harder, never because a dial turned for one student.
- **Forbidden, the knowledge axis, unchanged and absolute.** Required concepts, exposure obligations, item and check difficulty, the correctness bar, the number of gating knowledge checks, and how mastery is judged may never adapt to inferred ability, measured motor skill, accessibility profile, calibration result, Level, Rank, or PvP standing. No knowledge dial exists.

The original purpose of the two-axis rule was to stop a mechanical accommodation from quietly becoming a curricular one. That purpose is retained and is now satisfied by construction: with no mechanical dial to turn, there is no adaptive pathway into the knowledge bar at all. Authored difficulty is identical for every student, committed, deterministic, and reproducible (FR-8, FR-9), and no difficulty or performance state is ever exposed to a student as a learner label (principle 9, FR-7).

Failure diagnosis is correspondingly single-axis: a mission attempt either clears or it does not. Nothing infers which axis failed, because the mission no longer measures knowledge. Knowledge is measured per question and per concept in the duel and, for the record that counts, on the mastery assessment.

Accessibility equivalents (FR-10) are not a difficulty setting and are unaffected by this section. They may change input or timing; they may not change information, stakes, meaningful options, consequence range, or the knowledge bar (principle 7).

## 18. Open product decisions

The following decisions must be closed before the corresponding milestone:

### Before student validation

- Minimum supported school hardware, browser, resolution, and audio setup.
- Pilot identity and consent workflow.
- Required accessibility profile matrix.
- Passive listen/watch limit.
- Choice-to-world-reaction latency target.
- Whether production Day 1 uses recorded voice, licensed synthesis, or a mixed approach.
- Exact content and asset quality bar for testing presence without overproducing the prototype.

### Before Boston chapter pilot

- Teacher assignment and launch workflow.
- Minimum teacher-facing progress and standards evidence.
- Classroom session model: one 90-minute block, two 45-minute periods, or both.
- Independent assessment partner, instrument ownership, and research protocol.
- Support and recovery workflow for school administrators.
- Content update and rollback policy during a study.
- Whether PvP ships in the pilot at all, since chapter completion is the first point at which it unlocks, and if it does, whether the ladder is live or asynchronous against stored answers. Live duelling suits friend-arranged matches, but same-Rank live matchmaking needs a population a class of 25 cannot supply.

### Before Season 1

- Student roster and district tenancy model.
- Season Review administration, accommodations, scoring, and reporting.
- Content download, installation, and storage strategy for offline schools.
- Voice, localization, and media-rights strategy at multi-chapter scale.
- Validated authoring throughput and staffing model.

### Before full-course release

- Commercial packaging and licensing.
- District implementation, support, data processing, retention, export, and deletion commitments.
- Full assessed-curriculum coverage sign-off.
- Longitudinal learning, retention, access, and reliability evidence required for product claims.

## 19. Release decision rule

A milestone advances only when its required experience, learning, reliability, accessibility, historical, privacy, and research gates are met.

High engagement cannot waive a learning or historical gate. Learning gain cannot waive unusable navigation, inaccessible mechanics, unreliable saves, or false agency. Any waiver must be explicit, evidence-based, time-bounded, approved by the accountable discipline owner, and recorded with its affected population and mitigation.
