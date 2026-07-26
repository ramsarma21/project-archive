# @pa/curriculum

The canonical curriculum registry: one spelling for a student expectation, one id
for an instructional concept, one table mapping every legacy identifier onto them,
and a validator that refuses the rest.

Zero workspace dependencies. This package is the bottom of the curriculum stack
and must stay importable by content, runtime, and tooling alike.

## The problem it fixes

The repository accumulated at least eight ways of writing the same curriculum,
with no referential integrity because the concept id type was `string`:

| Form | Example | Where |
|---|---|---|
| Parenthesized SE | `8.4(A)` | `teks.ts`, item `teksTags` |
| Bare-letter SE | `8.4A` | `ConceptMeta.seIds` |
| Clause-qualified SE | `8.4(A):POSTWAR_POLICY` | item `teksTags` |
| Grade-omitted SE | `(4)(A)` | every design doc |
| Prose-clause SE | `(4)(A)·Stamp Act` | `Concept-Delivery-Map.md` |
| Strand only | `8.12`, `8.29` | `Micro-Concepts.md` draft tags |
| Runtime learner concept | `BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1` | `ids.ts` |
| Checkpoint concept | `RCC.DEBT_POLICY_INTRO` | `cp1Ids.ts` |
| Owner-item concept | `RCL.INTOLERABLE_ACTS_RESPONSE` | `cp1Bank.ts` |
| Field micro | `MICRO.WRITS_OF_ASSISTANCE` | `fieldIds.ts` |
| Bare clause id | `POSTWAR_POLICY` | `TeksClause.id` |
| Review placeholder | `TEKS.PENDING_SME_REVIEW` | `cp1Bank.ts` |

## Layering

```
StudentExpectation      the accountability unit the state publishes
        |               primary key: SeCode, a branded canonical code
        v
InstructionalConcept    the unit a module teaches and a duel question asks
        |               one proposition; 8.4(A) has six of them
        v
ItemConceptMapping      many-to-many; exactly one PRIMARY per item
```

A student expectation is deliberately **not** the assessable unit. 8.4(A) names
six independent causes of the Revolution, and a student can hold four and miss
two. Concepts are the mastery grain.

Concept ids carry **no mission segment**. `BOS.MD01.CONCEPT.*` nailed every
concept to mission day 1, which is wrong for the eighteen spiral standards that
recur across four acts and later chapters. The old ids resolve through the alias
table.

## Using it

```ts
import { requireConcept, resolveConcept, retag } from "@pa/curriculum";

// Retag authored content instead of rewriting it.
requireConcept("RCC.DEBT_POLICY_INTRO");     // -> BOS.CONCEPT.POSTWAR_REVENUE.v1
requireConcept("8.4(A):STAMP_ACT");          // -> BOS.CONCEPT.STAMP_SCOPE.v1
requireConcept("MICRO.LIBERTY_TREE");        // -> BOS.CONCEPT.LIBERTY_TREE.v1

// Unknown, too coarse, and deliberately unmapped are three different answers.
resolveConcept("8.29");            // ALIAS_UNRESOLVED / NOT_AN_SE_CODE
resolveConcept("8.4(A)");          // RESOLVES_TO_SE_NOT_CONCEPT + candidates
resolveConcept("RCC.MADE_UP");     // UNKNOWN_IDENTIFIER
requireConcept("8.29");            // throws CurriculumReferenceError

// Batch a retag work list.
retag(["RCC.DEBT_POLICY_INTRO", "8.13", "TEKS.PENDING_SME_REVIEW"]);
```

## Validation

```sh
pnpm --filter @pa/curriculum curriculum:check              # human report
pnpm --filter @pa/curriculum curriculum:check -- --json    # machine report
pnpm --filter @pa/curriculum curriculum:check -- --strict  # warnings fail too
pnpm --filter @pa/curriculum test
```

Exit codes: `0` clean, `1` referential-integrity errors, `2` warnings under
`--strict`.

`validateCurriculum()` is the same check as a library function.

**Errors** mean the registry is internally wrong: a malformed code, a concept
orphaned from an unknown standard, a clause that quotes words the standard does
not use, a duplicate or colliding alias, an alias whose string parses to a
different standard than it maps to, an item pointing at a concept that does not
exist, a concept owned by a mission that does not teach its standard, or an item
with more than one primary concept.

**Warnings** mean the registry is coherent and the curriculum has a hole:
unverified standards text, a standard with no assessable concept, a standard no
mission claims, a concept nothing delivers, a proposed retag awaiting SME
confirmation, a concept with no items, an item outside the chapter's era window.
Warnings never fail the default run — a check that always fails is a check
nobody reads.

## Honesty rules this package enforces

1. **Standards text is either cited or absent.** One of the 23 standards holds
   verbatim text, because one is all the repository ever held. The other 22 carry
   `officialText: null`, `textStatus: "UNVERIFIED_MISSING"`, and a paraphrase in
   `workingDescription`. `SE_UNVERIFIED_WITH_TEXT` is an error, so nothing can
   quietly acquire uncited standards text. A fabricated standard in a
   teacher-facing mastery report is a compliance problem, not a cosmetic one.
2. **A clause cannot quote words the standard does not use.**
   `SE_CLAUSE_TEXT_NOT_IN_OFFICIAL_TEXT` is an error.
3. **Designations are marked second-hand.** Reporting category and
   readiness/supporting status come from an internal doc transcribing the TEA
   assessed curriculum, so every row is `SECONDARY_INTERNAL` with
   `independentlyReverified: false`.
4. **A retag preserves what it moved from.** `sourceDraftTags` keeps the original
   tag; `parentSeStatus: "PROPOSED_RETAG"` warns until an SME confirms.
5. **Nothing claims SME approval,** because nothing has it.
6. **Where a source document declined to invent an answer, so does this
   registry.** M3 has no assignment.

## Files

| File | Contents |
|---|---|
| `seCode.ts` | Branded `SeCode`, the canonical spelling, and the parser that normalizes or refuses every other form |
| `types.ts` | Registry shapes and the branded `CurriculumConceptId` |
| `seRegistry.ts` | The 23 Boston target standards with provenance |
| `conceptRegistry.ts` | The instructional concepts beneath them |
| `aliases.ts` | Alias table: hand-authored irregulars plus mechanically generated families |
| `items.ts` | Many-to-many item mapping, era windows, per-concept depth |
| `missions.ts` | The fourteen missions and their assigned standards |
| `resolve.ts` | Resolution and refusal |
| `sourceDefects.ts` | Contradictions found in the source docs, as queryable data |
| `validate.ts` | The validator |
| `cli.ts` | The CI check |

Mechanical alias families — grade-omitted, bare-letter, clause-qualified, bare
clause, and `MICRO.*` — are generated from the registries rather than typed out,
so the alias table cannot drift when a standard or concept is added.
