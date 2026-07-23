# BrainLift — Project Archive

A structured context document for the thinking behind *Project Archive*: a cinematic, story-driven game that teaches the required Grade 8 U.S. history curriculum by letting students *live* history instead of studying it.

---

## Owners

This section lists the primary authors and maintainers of the BrainLift.

- **Ram Sarma** — creator and lead designer, *Project Archive*.

---

## Purpose

This section establishes the core mission and boundaries of the BrainLift.

### Purpose

The purpose of this BrainLift is to work out how to make students *durably learn* a fixed, tested curriculum inside a game that feels like lived experience rather than a lesson. It is built on the belief that the bottleneck in education is not coverage or engagement but **retention and transfer** — and that a tightly authored, "invisibly pedagogical" historical simulation can beat both the textbook and the open-ended edutainment sandbox by putting proven learning science underneath a job the player actually wants to do.

Concretely, this BrainLift develops and defends seven design bets behind *Project Archive*: teach **fewer facts but guarantee they stick**; make the game **zero-choice under the hood but give the feeling of choice**; use **AI to direct what the player sees, never to generate it**; make **the fun and the learning the same act**; **ground assessment in real STAAR concepts without letting it feel like a quiz game**; **measure concepts learned, not time spent**; and **cover every required person and concept completely, then make students connect it all**.

### In Scope

- Developing and defending original, "spiky" positions on how games should teach a mandated curriculum (design bets AI cannot generate for me).
- The learning science that makes knowledge durable: retrieval practice, spacing, generation/prediction, self-explanation, feedback, and transfer.
- The discipline-specific pedagogy of *history*: sourcing, contextualization, corroboration, and multiple perspectives.
- How to preserve motivation and immersion without giving the player consequential control over historical truth.
- The role and hard limits of AI at runtime in an educational product (selection vs. generation; determinism; human approval).
- Fair, standards-aligned assessment (Texas Grade 8 U.S. history TEKS / STAAR) that is insulated from personalization.

### Out of Scope

- Using AI to *generate* player-facing facts, questions, dialogue, or history at runtime. *Project Archive* is authored, reviewed, and packaged before release; nothing player-facing is model-generated.
- Free-form, branching alternate history where player choices change recorded outcomes.
- Modeling "the whole child" — emotion, personality, demographics. The learner model is deliberately lightweight and auditable.
- Building general open-world, combat, crafting, inventory, XP, or reputation systems; these are explicitly excluded from the core game.
- Curriculum outside the STAAR-eligible Grade 8 TEKS boundary (contextual history may make a scene coherent but is never a tested target).
- Proving efficacy by narrative assertion. Research claims here are hypotheses to be validated with real students, not guarantees.

---

## DOK 4: Spiky Points of View (SPOVs)

Seven owner-authored, deliberately non-consensus positions — the core design bets behind *Project Archive*. Each states the bet, the research behind it, and how it's built into the game, cited inline by author and year (full citations with links are in the Knowledge Tree below).

### Spiky POV 1 — Peak learning efficiency isn't 100 facts an hour; it's ~50 facts that stick.

You can push ~100 facts/hour, but almost none survives the week, because performance *during* a session is a poor index of durable learning (Soderstrom & Bjork, 2015). What makes facts stick is well established: retrieval practice beats rereading — shown on 8th-grade U.S. history facts specifically (Carpenter et al., 2009; also Roediger & Karpicke, 2006; Rowland, 2014; Yang et al., 2021) — as do spacing (Cepeda et al., 2006; Dunlosky et al., 2013) and generating or predicting answers (Slamecka & Graf, 1978), all of which cost time now to buy memory later. So *Project Archive* caps required concepts per chapter, re-encounters them across Mission Days, Chapters, and Seasons, makes the player predict each event's outcome before it happens, and uses Archive Syncs to force recall of earlier evidence instead of rereading a glossary.

### Spiky POV 2 — Educational games should be zero-choice so they don't waste time — but give the *illusion* of choice so motivation holds.

For a subject with fixed truth, real branching is wasted production and a curriculum risk — but strip out choice entirely and motivation collapses. The resolution: self-determination theory shows motivation runs on *perceived* autonomy and competence, not on the actual number of consequential branches (Ryan et al., 2006), and games teach only when objectives and design are aligned rather than free-form (Wouters et al., 2013; Clark et al., 2016; Habgood & Ainsworth, 2011), while every extra branch taxes working memory (Mayer & Moreno, 2003). So *Project Archive* follows a "fixed truth, flexible route" pillar: history never branches and every choice resolves to an approved action or to silence, but the player controls route, order, dialogue, and which evidence they personally encounter — "no two players play the same game, but every player learns the same required history."

### Spiky POV 3 — AI should *direct and decide what you see*, not generate it.

Generating infinite content on the fly is the wrong job for a tested curriculum, because fluent output isn't accurate output: asked for references, ChatGPT fabricated 55% (GPT-3.5) / 18% (GPT-4) outright and got substantive details wrong in many of the real ones (Walters & Wilder, 2023), whereas historical accuracy depends on sourcing and corroboration a model can't guarantee (Wineburg, 1991; Reisman, 2012). So the AI Director only *selects* — it returns allowlisted action IDs, rubric tags, confidence values, and status codes, never prose, facts, or media — while humans author, review, and approve everything player-facing; every AI call has a deterministic fallback, and the required path runs fully offline.

### Spiky POV 4 — Fun isn't the enemy — but it can't come *at the expense* of learning, so make the fun and the learning the SAME thing.

Bolting entertainment onto content makes the two compete for attention, and fun alone doesn't teach (Wouters et al., 2013; Clark et al., 2016); learning sticks when it's *intrinsically integrated* into the core mechanic (Habgood & Ainsworth, 2011) and exercised in authentic activity rather than handed over as decontextualized facts (Brown et al., 1989). So *Project Archive* refuses the trade-off: the player works a believable period job — a printer's apprentice handling the arguments of the Revolution as work products — where the enjoyable loop of moving through the city, talking to people, and witnessing events *is* the act that encodes and applies the curriculum, and engagement metrics never substitute for assessment.

### Spiky POV 5 — Ground assessment in real STAAR concepts, but don't ask STAAR-style questions often, so it never feels like a quiz game.

The test standard should anchor *what* is taught, but surfacing test-style questions constantly turns the game into a worksheet and kills immersion. Stealth assessment shows you can infer what a learner knows continuously from ordinary in-game behavior instead of stopping to quiz (Shute & Ventura, 2013), and low-stakes retrieval helps memory without having to *look* like a test (Roediger & Karpicke, 2006; Carpenter et al., 2009; Hattie & Timperley, 2007; Shute, 2008). So every required concept maps to a STAAR-eligible Grade 8 TEKS node (the Curriculum Graph is the source of truth), most retrieval is disguised as one brief diegetic Archive Sync per Mission Day, and real STAAR-style items are concentrated in the periodic Mission Debrief and Season Review rather than scattered through the world.

### Spiky POV 6 — Don't assess students on time spent; assess on concepts learned — and make them *actually* know the concepts.

Seat time and activity counts aren't learning (Wouters et al., 2013), and in-the-moment performance can look like mastery while leaving little behind (Soderstrom & Bjork, 2015); real understanding shows up as transfer (Barnett & Ceci, 2002) and delayed retention (Cepeda et al., 2006; Roediger & Karpicke, 2006), and mastery-learning programs that hold a real bar while giving strugglers more support raise outcomes (Kulik et al., 1990). So in *Project Archive* progression is state-based, not time-based: the learner model ignores time, speed, and route, and won't call a concept "known" from one isolated click. On its learning day, a required concept needs three tracked exposures across at least two types, a first-understanding check, and an applied demonstration. The **fixed historical event never waits for mastery**, but Mission Day completion waits until that day's closed learning loop is complete; a struggling student receives consequence-consistent support and rerouting, never a false pass or a locked historical event.

### Spiky POV 7 — Teach every required person and concept, then a little more, then make students *connect all of it*.

Coverage isn't the enemy — *incoherent* coverage is; this complements SPOV 1 (cut arbitrary facts) by demanding complete, deliberate coverage of a bounded required set, over-taught and then integrated. Prior knowledge is among the strongest predictors of new learning (Recht & Leslie, 1988; Smith et al., 2021), so a rich, complete base makes each new piece easier to encode — but coverage only builds *nodes*; durable understanding and transfer come from the *edges*, the causal and comparative links between ideas (Bisra et al., 2018; Barnett & Ceci, 2002). So *Project Archive* guarantees 100% coverage through a Curriculum Graph coverage invariant and a Required Historical Figure Manifest — with more than one carrier per concept plus optional reinforcement for the "some more" — then makes *connecting* required: Mission Debriefs have players build an explanation from evidence (cause, consequence, comparison), and Season Reviews force cross-chapter synthesis, e.g. wiring war debt → taxation → representation → enforcement → resistance and applying it to an unseen source.

---

## Experts

The leading thinkers whose work forms the foundational knowledge for this BrainLift. Following them builds the base needed to defend and extend the SPOVs.

### Expert 1 — Henry L. "Roddy" Roediger III

- **Who:** Cognitive psychologist, Washington University in St. Louis; a founder of the modern "testing effect" / retrieval-practice research program (co-author of *Make It Stick*).
- **Focus:** How the act of retrieving information — not rereading it — produces durable long-term memory.
- **Why Follow:** SPOVs 1 and 5 rest on his finding that testing beats restudy for delayed retention — the mechanism that lets "fewer facts, but they stick" outperform coverage, and that lets *disguised* retrieval do real cognitive work.
- **Where:** Roediger & Karpicke (2006), *Psychological Science* — <https://doi.org/10.1111/j.1467-9280.2006.01693.x>.

### Expert 2 — John Dunlosky

- **Who:** Cognitive psychologist, Kent State University; lead author of the landmark review ranking study techniques by evidence.
- **Focus:** Which learning techniques actually work (practice testing and distributed practice rank highest; highlighting/rereading rank low).
- **Why Follow:** Provides the evidence hierarchy that justifies reallocating time toward retrieval and spacing (SPOV 1), and that ranks elaboration/self-explanation as the way to *connect* ideas (SPOV 7).
- **Where:** Dunlosky et al. (2013), *Psychological Science in the Public Interest* — <https://doi.org/10.1177/1529100612453266>.

### Expert 3 — Robert A. Bjork

- **Who:** Cognitive psychologist, UCLA; originator of the "desirable difficulties" framework and the learning-versus-performance distinction.
- **Focus:** Why conditions that slow *current performance* often *improve* long-term learning, and why performance during training misleads both learners and teachers.
- **Why Follow:** The theoretical backbone of SPOVs 1 and 6 — the reason "100 facts an hour" and "minutes played" measure performance, not learning, and why the bar for "knows it" must be delayed and transfer-based.
- **Where:** Soderstrom & Bjork (2015), *Perspectives on Psychological Science* — <https://doi.org/10.1177/1745691615569000>.

### Expert 4 — Sam Wineburg

- **Who:** Historian and educational psychologist; founder of the Stanford History Education Group (SHEG) and author of *Historical Thinking and Other Unnatural Acts*.
- **Focus:** How historians actually reason — sourcing, contextualization, corroboration — versus how novices read claims as neutral facts.
- **Why Follow:** Defines the discipline-specific reasoning *Project Archive* teaches through occupational perspectives and Perspective Attribution, and grounds SPOV 3's claim that historical accuracy comes from sourcing and corroboration, not fluent generation.
- **Where:** Stanford History Education Group — <https://sheg.stanford.edu>; Wineburg (1991), *Journal of Educational Psychology* — <https://doi.org/10.1037/0022-0663.83.1.73>.

### Expert 5 — Abby Reisman

- **Who:** Education researcher, University of Pennsylvania; designer of the "Reading Like a Historian" document-based curriculum.
- **Focus:** Turning historical-thinking theory into a classroom curriculum that measurably improves student outcomes.
- **Why Follow:** Shows that authored, document-based historical reasoning can move real students in real classrooms (SPOV 3) — the proof-of-concept for embedding source work and evidence synthesis inside gameplay (SPOV 7).
- **Where:** Reisman (2012), *Cognition and Instruction* — <https://doi.org/10.1080/07370008.2011.634081>.

### Expert 6 — Richard Ryan & Edward Deci

- **Who:** Psychologists (Australian Catholic University; University of Rochester); originators of self-determination theory (SDT), and, with C. Scott Rigby, of its application to video games.
- **Focus:** Intrinsic motivation and the basic psychological needs — autonomy, competence, relatedness — including why games satisfy them.
- **Why Follow:** The motivational core of SPOVs 2 and 4: *perceived* autonomy and competence, not consequential branching, drive engagement — so an "illusion of choice" over a fixed spine is enough to hold motivation.
- **Where:** Ryan, Rigby & Przybylski (2006), *Motivation and Emotion* — <https://doi.org/10.1007/s11031-006-9051-8>.

### Expert 7 — Jacob Habgood & Shaaron Ainsworth

- **Who:** Games-and-learning researchers (Sheffield Hallam; University of Nottingham).
- **Focus:** "Intrinsic integration" — delivering learning content *through* the core mechanics and fantasy that make a game fun, rather than beside them.
- **Why Follow:** The empirical backbone of SPOVs 2 and 4: children learned more and chose to play more when the learning was fused with the fun rather than bolted on beside it.
- **Where:** Habgood & Ainsworth (2011), *Journal of the Learning Sciences* — <https://doi.org/10.1080/10508406.2010.508029>.

### Expert 8 — Valerie Shute

- **Who:** Educational psychologist, Florida State University; originator of "stealth assessment" and a leading voice on formative feedback.
- **Focus:** Embedding valid assessment invisibly inside gameplay by inferring competence from ongoing behavior; what makes formative feedback actually work.
- **Why Follow:** The backbone of SPOVs 5 and 6 — measure concepts from in-world action instead of quizzing, so assessment stays rigorous without ever feeling like a test.
- **Where:** Shute & Ventura (2013), *Stealth Assessment* (MIT Press) — <https://doi.org/10.7551/mitpress/9589.001.0001>; Shute (2008), *Review of Educational Research* — <https://doi.org/10.3102/0034654307313795>.

### Expert 9 — John Hattie

- **Who:** Education researcher, University of Melbourne; author of *Visible Learning*.
- **Focus:** What makes feedback powerful — feedback about the task and process (where am I going, how am I going, where to next) far outperforms praise or a bare correctness mark.
- **Why Follow:** Defines the feedback model the Archive uses (SPOV 5): name the present relation and the missing relation, never shame; correction comes in character.
- **Where:** Hattie & Timperley (2007), *Review of Educational Research* — <https://doi.org/10.3102/003465430298487>.

---

## DOK 3: Insights

Original conclusions and connections drawn from the sources below — the bridge between the Knowledge Tree and the Spiky POVs. Grouped thematically.

**On efficiency and coverage (supports SPOV 1)**

- **Insight 1 — Every fact you add quietly erases one you already taught.** Coverage and retention fight over the same fixed minutes, and since retrieval and spacing are what actually make a fact stick (Roediger & Karpicke, 2006; Cepeda et al., 2006), past a low threshold each new item you "cover" steals the consolidation time an earlier one needed. "Facts per hour" measures *performance*; "facts still known next month" measures *learning* (Soderstrom & Bjork, 2015) — and optimizing the first is how a course feels productive while teaching almost nothing.
- **Insight 2 — Rereading feels like learning; mostly it's just the feeling.** Restudy and recall feel equally productive in the moment, then split hard at a delayed test (Roediger & Karpicke, 2006; Rowland, 2014), so fluency lies to the learner. The cheapest upgrade in the whole game is turning any moment where the player *reads* into one where the player *retrieves* — which is all an Archive Sync, a prediction, or a Debrief really is.

**On agency, motivation, and fixed truth (supports SPOVs 2 and 4)**

- **Insight 3 — Players don't need real choices; they need to feel themselves choosing.** Motivation runs on *perceived* autonomy, not on the branch count (Ryan et al., 2006), so the "illusion of choice" isn't a trick you get away with — it's the actual mechanism. Split the axes: total freedom over route, order, and texture; zero freedom over facts and outcomes. Real branching then reveals itself as an expensive, curriculum-risking way to buy motivation you could have had for free.
- **Insight 4 — A fun wrapper around dull content just teaches the wrapper.** Learning transfers only when the enjoyable verb *is* the cognitive work (Habgood & Ainsworth, 2011; Brown et al., 1989) — a printer weighing a real argument, not a quiz with a mascot. So the design question isn't "is this fun?" but "is the *learning* the fun part?"; if those are two separate activities, players will gladly do one and skip the other.
- **Insight 5 — Make players guess the past, and they remember it better for having been wrong.** Predicting an outcome you can't change (Slamecka & Graf, 1978) buys the memory boost of *generating* an answer without bending a single fact of history — the cleanest proof that the illusion of choice does real cognitive work, not just emotional babysitting.

**On the role of AI (supports SPOV 3)**

- **Insight 6 — A model that writes the history is a liability; a model that *picks* the history is an asset.** Generation drags back exactly the errors the curriculum exists to kill — roughly 55% of ChatGPT's cited references were flat-out fabricated (Walters & Wilder, 2023). Cage the model as a chooser over human-approved options and you keep personalization's upside with none of the hallucination — and it still runs offline and deterministic.

**On assessment that doesn't feel like a test (supports SPOVs 5 and 6)**

- **Insight 7 — The best test doesn't look like a test.** You can read a student continuously from how they *act* instead of stopping to quiz them (Shute & Ventura, 2013), so scatter hidden retrieval through the world (Roediger & Karpicke, 2006; Carpenter et al., 2009) and save STAAR-style items for a few real checkpoints. Then flip the feedback: teach with instant in-world correction, but *measure* with feedback withheld until submission, so early answers can't coach the later ones.
- **Insight 8 — Time-on-task is the metric you reach for once you've given up on measuring learning.** Minutes and clicks track nothing that lasts; transfer (Barnett & Ceci, 2002) and delayed recall (Cepeda et al., 2006) do. So the learner model refuses time, speed, and route as signals and won't trust one lucky click. Borrow mastery learning's bar (Kulik et al., 1990) — but aim it at *evidence*, not *progress*: fall short and you get more help, never a locked door.

**On coverage and connection (supports SPOV 7)**

- **Insight 9 — Facts are nodes, understanding is the edges — and school grades the nodes.** Knowing more of the required set makes each new piece easier to hold (Recht & Leslie, 1988; Smith et al., 2021), but a full bag of facts still isn't understanding until they're wired together (Bisra et al., 2018; Barnett & Ceci, 2002). So cover *everything* required, over-teach a little, then make drawing the causal edges a required move in Debriefs and Reviews — not extra credit.

---

## DOK 2: Knowledge Tree

The structured, sourced foundation: facts (DOK 1) and summaries (DOK 2) organized from broad category to specific source. Every source is named, linked to the original, and tied to an actual game feature or SPOV.

### Category 1: The science of durable memory

#### Subcategory 1.1: Retrieval practice (the testing effect)

- **Source 1: Roediger & Karpicke (2006), "Test-Enhanced Learning."**
  - **DOK 1 – Facts:**
    - Students who were tested on material retained more at a delayed test than students who restudied it for the same time.
    - Restudy produced better performance on an *immediate* test, which reverses at a delay — creating an illusion that restudy is superior.
    - Repeated retrieval produced the largest long-term gains.
  - **DOK 2 – Summary:**
    - The act of pulling information out of memory strengthens it more than putting it back in; short-term feelings of fluency mislead learners into preferring the weaker technique.
  - **Link to source:** <https://doi.org/10.1111/j.1467-9280.2006.01693.x>

- **Source 2: Carpenter, Pashler & Cepeda (2009), "Using Tests to Enhance 8th-Grade Students' Retention of U.S. History Facts."**
  - **DOK 1 – Facts:**
    - Tested directly on the target population and subject: 8th-grade U.S. history.
    - Taking tests (with feedback) improved later retention of history facts relative to not testing.
  - **DOK 2 – Summary:**
    - The retrieval effect is not a lab curiosity; it holds for exactly the students and content *Project Archive* targets — the strongest single citation behind SPOV 1.
  - **Link to source:** <https://doi.org/10.1002/acp.1507>

- **Source 3: Rowland (2014), meta-analytic review of testing vs. restudy.**
  - **DOK 1 – Facts:** Across many studies, testing reliably beats restudy for retention; effect sizes vary with feedback and format.
  - **DOK 2 – Summary:** The testing effect is robust on average, with the size moderated by design choices — so implementation details (feedback, format) matter.
  - **Link to source:** <https://doi.org/10.1037/a0037559>

- **Source 4: Yang, Luo, Vadillo, Yu & Shanks (2021), "Testing Boosts Classroom Learning: A Systematic and Meta-Analytic Review."**
  - **DOK 1 – Facts:** Across classroom studies, low-stakes testing/quizzing reliably improved learning versus no testing; effects were larger with feedback and with repeated testing.
  - **DOK 2 – Summary:** The testing effect holds specifically in real classrooms, not just the lab — reinforcing frequent, low-stakes retrieval as a core mechanic (SPOVs 1 and 5).
  - **Link to source:** <https://doi.org/10.1037/bul0000309>

#### Subcategory 1.2: Distributed practice (spacing)

- **Source 1: Cepeda, Pashler, Vul, Wixted & Rohrer (2006), quantitative synthesis of distributed practice.**
  - **DOK 1 – Facts:**
    - Spacing study across time produces better long-term recall than massing it together.
    - The optimal gap grows with the desired retention interval.
  - **DOK 2 – Summary:**
    - Returning to a concept after a delay beats cramming; this justifies re-encountering concepts across Mission Days, Chapters, and Seasons rather than teaching each once.
  - **Link to source:** <https://doi.org/10.1037/0033-2909.132.3.354>

#### Subcategory 1.3: Generation, prediction, and self-explanation

- **Source 1: Slamecka & Graf (1978), "The Generation Effect."**
  - **DOK 1 – Facts:** Information a learner generates is remembered better than the same information simply read.
  - **DOK 2 – Summary:** Making the student *produce* (predict, complete, explain) rather than receive improves memory — the basis for predicting an event's outcome before it happens.
  - **Link to source:** <https://doi.org/10.1037/0278-7393.4.6.592>
- **Source 2: Bisra, Liu, Nesbit, Salimi & Winne (2018), self-explanation meta-analysis.**
  - **DOK 1 – Facts:** Prompting learners to explain material to themselves improves learning across domains; effects are positive when prompts target meaningful relationships.
  - **DOK 2 – Summary:** Brief, targeted "explain why" prompts help — but must be scarce and well-aimed, which is why the game reserves open explanation for meaningful synthesis and for *connecting* concepts in the Debrief (SPOV 7).
  - **Link to source:** <https://doi.org/10.1007/s10648-018-9434-x>

#### Subcategory 1.4: Learning versus performance

- **Source 1: Soderstrom & Bjork (2015), "Learning Versus Performance: An Integrative Review."**
  - **DOK 1 – Facts:**
    - Current *performance* during instruction (what a learner can do right now) frequently diverges from *learning* (the relatively permanent change measurable only at a delay).
    - Conditions that speed up performance now (massing, blocking, heavy cueing) often *reduce* long-term retention and transfer; "desirable difficulties" do the reverse.
  - **DOK 2 – Summary:**
    - The efficiency you can see inside a session is largely a mirage; the only efficiency that counts is measured later — which is why "facts per hour" (SPOV 1) and "minutes played" (SPOV 6) are the wrong targets.
  - **Link to source:** <https://doi.org/10.1177/1745691615569000>

### Category 2: Learning history as a discipline

#### Subcategory 2.1: Historical thinking — sourcing, contextualization, corroboration

- **Source 1: Wineburg (1991), "Historical Problem Solving."**
  - **DOK 1 – Facts:**
    - Historians evaluate documents by source, context, and corroboration before treating claims as fact.
    - Novices (even high-achieving students) tend to read textbook claims as neutral, authorless truth.
  - **DOK 2 – Summary:**
    - Historical thinking is an "unnatural act" that must be taught; embodying it through occupational perspectives (a soldier, a merchant, a printer) is a way to make sourcing and corroboration a lived activity.
  - **Link to source:** <https://doi.org/10.1037/0022-0663.83.1.73>
- **Source 2: Reisman (2012), "Reading Like a Historian."**
  - **DOK 1 – Facts:** A document-based curriculum intervention improved historical thinking, and also transferred to reading comprehension, in urban high schools.
  - **DOK 2 – Summary:** Authored document-work at scale produces measurable gains — evidence that the game's evidence-comparison and Perspective Attribution can teach, not just decorate.
  - **Link to source:** <https://doi.org/10.1080/07370008.2011.634081>

### Category 3: Cognitive load — why simpler beats richer

- **Source 1: Mayer & Moreno (2003), "Nine Ways to Reduce Cognitive Load in Multimedia Learning."**
  - **DOK 1 – Facts:** Working memory is the bottleneck in learning; coherence, signaling, and spatial/temporal contiguity reduce extraneous processing, while added, unaligned material competes for it.
  - **DOK 2 – Summary:** Every extra branch, mechanic, or spectacle spends the same scarce working memory the learning action needs — the load argument for a *zero-choice* spine and a single core interaction (SPOVs 2 and 4), and for compact districts and concise subtitles.
  - **Link to source:** <https://doi.org/10.1207/S15326985EP3801_6>

### Category 4: Games, motivation, and situated learning

- **Source 1: Wouters, van Nimwegen, van Oostendorp & van der Spek (2013), serious-games meta-analysis.**
  - **DOK 1 – Facts:** Serious games were more effective for learning and retention than conventional instruction, but were **not** reliably more motivating; games worked best when supplemented and played over multiple sessions.
  - **DOK 2 – Summary:** "Games teach" is conditional on design and support — engagement is not the mechanism, and can't be assumed.
  - **Link to source:** <https://doi.org/10.1037/a0031311>
- **Source 2: Habgood & Ainsworth (2011), "Motivating Children to Learn Effectively."**
  - **DOK 1 – Facts:** Children learned more, and chose to play longer, when learning content was *intrinsically integrated* into the core mechanics — versus the same content presented separately.
  - **DOK 2 – Summary:** The fun verb and the learning verb should be the same verb; this is the empirical core of "make the fun and the learning the same thing" (SPOV 4) and the "illusion of choice" (SPOV 2).
  - **Link to source:** <https://doi.org/10.1080/10508406.2010.508029>
- **Source 3: Brown, Collins & Duguid (1989), "Situated Cognition and the Culture of Learning."**
  - **DOK 1 – Facts:** Knowledge is bound to the activity, context, and culture in which it is used; "authentic activity" produces usable knowledge, decontextualized facts often don't.
  - **DOK 2 – Summary:** Learning by doing an authentic period job (situated cognition) is why the print shop, not a fact card, is the delivery vehicle.
  - **Link to source:** <https://doi.org/10.3102/0013189X018001032>
- **Source 4: Ryan, Rigby & Przybylski (2006), "The Motivational Pull of Video Games."**
  - **DOK 1 – Facts:** Across four studies, players' *perceived* in-game autonomy and competence predicted enjoyment, immersion, and continued play; SDT's three needs (autonomy, competence, relatedness) independently predicted motivation.
  - **DOK 2 – Summary:** Games motivate by satisfying *felt* autonomy and competence — not by handing over consequential control — the mechanism behind the "illusion of choice" (SPOV 2) and the fused fun-and-learning loop (SPOV 4).
  - **Link to source:** <https://doi.org/10.1007/s11031-006-9051-8>
- **Source 5: Clark, Tanner-Smith & Killingsworth (2016), "Digital Games, Design, and Learning: A Systematic Review and Meta-Analysis."**
  - **DOK 1 – Facts:** Digital games improved learning outcomes relative to non-game conditions on average; value-added comparisons showed that specific *design* features — not mere "game-ness" — drove the gains.
  - **DOK 2 – Summary:** Games help when their design is deliberate; aligned objectives, feedback, and mechanics (not spectacle) are what teach (SPOVs 2, 3, and 4).
  - **Link to source:** <https://doi.org/10.3102/0034654315582065>

### Category 5: Feedback and assessment

- **Source 1: Hattie & Timperley (2007), "The Power of Feedback."**
  - **DOK 1 – Facts:** Effective feedback answers three questions — where am I going, how am I going, where to next; task/process feedback beats feedback about the self (praise).
  - **DOK 2 – Summary:** Name the gap and the next step, in specific terms; a bare "correct/incorrect" or praise does little — which is why the Archive names the present relation and the missing relation without shame.
  - **Link to source:** <https://doi.org/10.3102/003465430298487>
- **Source 2: Shute (2008), "Focus on Formative Feedback."**
  - **DOK 1 – Facts:** Good formative feedback is specific, timely, and nonevaluative; overly evaluative feedback can undermine learning.
  - **DOK 2 – Summary:** Formative feedback should guide, not grade — reinforcing the separation of in-play correction from official scored assessment (SPOV 5).
  - **Link to source:** <https://doi.org/10.3102/0034654307313795>
- **Source 3: Shute & Ventura (2013), *Stealth Assessment: Measuring and Supporting Learning in Video Games*.**
  - **DOK 1 – Facts:** Assessment can be embedded invisibly in a game, continuously inferring competencies from ongoing player behavior (an evidence-centered model) instead of interrupting play with overt tests.
  - **DOK 2 – Summary:** You can measure rigorously without a quiz feel — the direct basis for disguising retrieval as in-world action and inferring concept mastery from what the player does (SPOVs 5 and 6).
  - **Link to source:** <https://doi.org/10.7551/mitpress/9589.001.0001>
- **Source 4: Kulik, Kulik & Bangert-Drowns (1990), "Effectiveness of Mastery Learning Programs: A Meta-Analysis."**
  - **DOK 1 – Facts:** Mastery-learning programs — require demonstrated mastery before advancing, and give strugglers corrective support and more time — raised achievement substantially over conventional instruction on average, with larger effects for weaker students.
  - **DOK 2 – Summary:** Holding a genuine bar for "knows it" and answering shortfalls with support (not a pass-along) improves outcomes; the game adapts this as a multi-occasion evidence bar that never delays fixed history, but does gate the Mission Day's learning-complete close and official scoring (SPOV 6).
  - **Link to source:** <https://doi.org/10.3102/00346543060002265>

### Category 6: Transfer, prior knowledge, and integration

- **Source 1: Barnett & Ceci (2002), "When and Where Do We Apply What We Learn?"**
  - **DOK 1 – Facts:** Transfer depends on shared structure and context between where knowledge is learned and where it is applied; far transfer is difficult and often fails without deliberate design for it.
  - **DOK 2 – Summary:** To demonstrate learning you must assess in a *new* context; re-testing identical wording measures retention, not transfer — which is why the Season Review moves the reasoning to unseen authenticated sources (SPOV 6), and why *connecting* concepts by their underlying structure matters more than surface facts (SPOV 7).
  - **Link to source:** <https://doi.org/10.1037/0033-2909.128.4.612>
- **Source 2: Recht & Leslie (1988), "Effect of Prior Knowledge on Good and Poor Readers' Memory of Text" (the "baseball study").**
  - **DOK 1 – Facts:** Junior-high students with high topic (baseball) knowledge recalled and comprehended a passage better than low-knowledge students — *regardless* of general reading ability; weaker readers with high knowledge outperformed stronger readers with low knowledge.
  - **DOK 2 – Summary:** Prior knowledge scaffolds new learning more than generic skill does; the more of the required set a student holds, the more each new piece sticks and connects — the case for *complete* coverage plus a margin (SPOV 7).
  - **Link to source:** <https://doi.org/10.1037/0022-0663.80.1.16>
- **Source 3: Smith, Snow, Serry & Hammond (2021), "The Role of Background Knowledge in Reading Comprehension: A Critical Review."**
  - **DOK 1 – Facts:** A review of 23 studies found that higher background knowledge consistently improved comprehension, and let weaker readers partly compensate for weaker skills.
  - **DOK 2 – Summary:** Confirms the prior-knowledge effect generalizes across studies — support for over-teaching the required core so students have the connective base to integrate it (SPOV 7).
  - **Link to source:** <https://doi.org/10.1080/02702711.2021.1888348>

### Category 7: The limits of generative AI

- **Source 1: Walters & Wilder (2023), "Fabrication and Errors in the Bibliographic Citations Generated by ChatGPT."**
  - **DOK 1 – Facts:** Asked to generate references, ChatGPT fabricated 55% (GPT-3.5) / 18% (GPT-4) of citations outright; of the citations to *real* works, 43% (GPT-3.5) / 24% (GPT-4) still contained substantive errors.
  - **DOK 2 – Summary:** Fluent, confident output is routinely and undetectably wrong — so a tested curriculum cannot let a model author player-facing content; AI may *select* among approved options, never *generate* (SPOV 3).
  - **Link to source:** <https://doi.org/10.1038/s41598-023-41032-5>

---

### Note on evidence discipline

Consistent with the game's own stance: the research above *informs constraints and hypotheses; it does not license guaranteed claims.* Effects are averages with moderators, and *Project Archive* must measure whether its implementation works with its actual students, content, and classroom conditions before asserting outcomes.
