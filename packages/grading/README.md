# @pa/grading

Server-authoritative grading for the duel. A student types a free-response answer,
the server mints a binary verdict, and `packages/duel`'s reducer derives three
bullets or one from it. The client never submits a verdict and never submits a
bullet count.

## The shape of it

| Piece | File | What it does |
|---|---|---|
| Rubric format | `src/rubric.ts` | What authors write; compiles to an item bank |
| Item bank | `src/items/` | Reads `content/m1/duel-items.json` through a port |
| Classifier | `src/prompt.ts`, `src/provider.ts` | Strict JSON classification over the TrueFoundry gateway |
| Hot path | `src/service.ts` | Cache → 1.5s deadline → generous fallback |
| Verdict | `src/verdict.ts` | Binary, with provenance and an HMAC receipt |
| Review log | `src/reviewLog.ts` | Every generous grant, attributable |
| Low confidence | `src/lowConfidence.ts` | Grant, count, stop, flag |
| Eval gate | `src/eval/` | 314 labelled cases; blocks shipping |

## The rubric format

Eighteen duel items per mission across fourteen missions is 252 items, and content
is the project's real bottleneck. So everything mechanical is derived: the item id
is namespaced by its pool, the rubric version is a content hash, and there is no
feedback map because the duel shows no feedback.

```ts
{
  id: "WHY_NOW",
  ask: "This town has stood a hundred and thirty years and Parliament never wanted a penny of it. Why is it reaching into Boston for money now?",
  correct: "Because Britain came out of the war with France in 1763 owing more money than it ever had, and Parliament decided the colonies should pay part of that debt.",
  ideas: ["The war left Britain owing money, and that is why money is now being taken from the colonies."],
  accept: ["they're broke from the war and want us to pay for it", "war debt", "to pay for the war"],
  reject: ["because of the Stamp Act", "because they wanted to control us"],
  wrongIfSays: ["Circular. The stamp is the thing being explained; it cannot be its own cause."],
  alsoIgnore: ["Which name the student gives the war: the war with France, the French and Indian War, the Seven Years' War are one war."],
  cards: ["BOS.MD01.CARD.WAR_DEBT.v1"],
}
```

**The line is the author's.** `ideas` lists what has to be present and `needs` says
how many — `"all"` by default. There is no third outcome anywhere in the package,
and `packages/duel` rejects a non-binary verdict at its wire boundary by name.

**Two-part cores.** Twelve of the eighteen M1 items carry a single required
proposition. Six carry a genuine two-part core — two `ideas` with `needs: "all"` —
so a written answer that supplies only one half fails, the prose analogue of the
two-card evidence minimum those items also demand (a cause *and* its consequence, a
mechanism *and* who it burdened, a grievance *and* the town's standing). This is
still binary, not partial credit: the answer is correct only if it carries both, and
a half is wrong. The halves are stated as meanings rather than wordings, so many
phrasings and either order pass — the classifier reports each idea it found and the
code counts. The split lives in `src/items/port.ts` (`TWO_PART_CORES`), because
`ideas` is this package's structure; the content states the requirement in prose.
`wrongIfSays` for those items names the missing half, so the model's guidance and the
eval rationales both say which half a half-answer left out, without quoting the
answer.

**Examples are held out, never prompted.** `accept` and `reject` are verbatim
student-voice answers and they become the evaluation set. `wrongIfSays` is the
prompt-visible negative guidance — it *describes* classes of wrong answer rather
than quoting one. An author writing the next mission's eighteen items grows the
eval set as a side effect of authoring, which is the only way it stays honest at
252 items.

**Versions are derived, never authored.** `rubricVersion` is a hash of everything
that changes grading. An author cannot forget to bump it, and because the cache key
includes it, a verdict cached under an older line is structurally unreachable.

`validateAuthoredPool` refuses an unreachable line, duplicate ids, an example in
both lists, and an idea phrased as a string match; it warns on thin example
coverage, because an item with one example contributes nothing to the gate.

## Calibration

The rubric lines come from `content/m1/duel-items.json`, whose `gradingPolicy` was
read off twelve real TEA-scored Texas eighth-grade responses in
`content/staar/eval`. That evidence does not match intuition:

- TEA scored **zero** a response that correctly named two causes and explained
  neither.
- TEA scored **zero** its longest, best-spelled exemplar, whose content amounted to
  "wasn't being fair to them".
- TEA **credited** `stamp act put texes on paper and other stuff which made the
  poeple mad`.
- TEA credited a response dated "Proclamation of 1863" and one blaming "The British
  Monarchy" for Parliament's act.

So the real bar is far more permissive on form and far stricter on substance than
first principles suggest. The governing question the classifier is given is:
*does the answer contain the substantive proposition in any words at all, or only
the question's own words, a label, or a feeling?*

## Running the gate

```bash
pnpm --filter @pa/grading test          # offline: 238 tests, no model calls
pnpm --filter @pa/grading grading:eval  # the gate: 314 labelled cases, real model
pnpm --filter @pa/grading grading:bench # serial latency and tokens per call
```

The gate fails the build below 95% accuracy, above a 2% false-negative rate, or
when more than a tenth of cases fell back — an outage must not look like a pass.
False negatives are ceilinged an order of magnitude tighter than accuracy because a
student who knew the material and lost a ranked duel to the grader does not come
back.

## Configuration

Follows the names `.env.example` already documents. No new secrets are required to
run locally.

| Variable | Notes |
|---|---|
| `TRUEFOUNDRY_GRADING_API_KEY` | Falls back to `TRUEFOUNDRY_API_KEY` outside production |
| `TRUEFOUNDRY_GRADING_BASE_URL` | Falls back to `TRUEFOUNDRY_BASE_URL` |
| `TRUEFOUNDRY_GRADING_MODEL` | `gemini-group/gemini-3.5-flash-lite` is the measured choice |
| `GRADING_RECEIPT_SECRET` | Optional; otherwise derived from `SESSION_SECRET` by HKDF |

With no credential every round grants the maximum and logs a review entry, which is
loud rather than silent.
