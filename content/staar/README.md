# `content/staar` — real released TEA items for Grade 8 Social Studies

Research and data capture only. **Nothing in this directory is wired into any code**, and this pass
changed no code anywhere in the repo.

Our design documents promise the chapter assessment is built on real STAAR items for district
accountability. Before this pass, that claim was backed by nothing: 16 items labelled
`OWNER_PROVIDED` and "STAAR-style", nine of them still tagged `TEKS.PENDING_SME_REVIEW`, and zero
with released-item provenance. This directory is the evidence base for making that claim honest per
item instead of as a blanket assertion.

---

## 1. Headline findings

**Real released items exist, and there are more of them than expected.** TEA has published data for
**296 Grade 8 Social Studies items** across **seven administrations** (2018, 2019, 2021, 2022, 2023,
2024, 2025). **53 items are captured here verbatim with full provenance**, 50 of them on one of
Boston's 23 student expectations.

**The three concepts of mission one are covered by real released items, including 8.4(A).** Six
released 8.4(A) items exist and TEA published usable text for all six. One of them —
`STAAR.2023.G8SS.07`, a short constructed response — covers postwar British debt policy, the Stamp
Act's scope on documents and paper, and taxation without representation in a single official item,
with an official rubric.

**The repo's 16 "owner-supplied" items are not STAAR-*style*. Fifteen of them are paraphrased real
STAAR items.** Every one of the 15 matches a released item's published position, its official answer
key, and its option-letter set. This resolves all nine `TEKS.PENDING_SME_REVIEW` placeholders with
TEA's own labels, and it exposes two real mis-tags. See `owner-item-provenance-map.json`.

**One item is untraceable.** `BANK.BOSTON.USER.STAMP.v1` matches nothing TEA ever published. It is
also the item currently carrying Boston's `RCC.STAMP_INTERNAL_INTRO` macro, which means the
mission-one Stamp Act concept is today held up by the *one* owner item with no released provenance.

**There is a licensing problem, and it is not small.** TEA's stated terms appear to require express
written permission and a license agreement before a non-Texas-district party reproduces this
material. Read §4 before anything here ships. This applies to the *existing* bank too, since
paraphrases of TEA items are derived from TEA items.

**Twelve of Boston's 23 standards require in-house authoring regardless.** Not as an optional
depth exercise — as the only way to cover what Boston actually teaches. See §5.

---

## 2. What is in here

| File | What it is |
|---|---|
| `sources.json` | All 33 TEA documents consulted: URL, `sha256`, byte size, retrieval time, and what each provides. Hashes let a later pass detect a changed or withdrawn document. |
| `item-index.json` | **Metadata for all 296 items**, 2018–2025: position, item type, TEA's TEKS label, reporting category, official key, readiness/supporting. No item text. Transcribed mechanically from TEA's own tables. |
| `items/*.json` | **53 items captured verbatim** with full provenance, one file per administration (2023–2025 share one file). |
| `boston-coverage.json` | Per-standard coverage and the machine-readable gap list for all 23 Boston SEs, with TEA's verbatim SE statements. |
| `owner-item-provenance-map.json` | The retagging map: each of the repo's 16 owner items traced to its released source, with the action to take. |
| `eval/scr-8.4A-2023-scored-student-responses.json` | 12 real TEA-scored student responses to the 8.4(A) constructed-response item, with each scorer's written reason. |
| `schema/staar-released-item.schema.json` | Shape of the item files, deliberately close to `AssessmentItem`. |

### Deliberate scope decision

Item **text** is captured only for items on a Boston SE (plus three items the repo already
paraphrases). Everything else is metadata-only in `item-index.json`. Two reasons: it is what was
asked for, and item positions, keys, item types and standard labels are facts about the test rather
than TEA's expressive content, so the metadata index is far safer to hold than 296 verbatim items
would be. `items/*.json` files list what they skipped and why under `notCapturedButPublished`.

---

## 3. Provenance fields

Every captured item carries a `provenance` object. **Every field in it is copied from a TEA
document. None is inferred.** An item missing any required field does not belong in this dataset.

| Field | Meaning |
|---|---|
| `publisher` | Always `Texas Education Agency`. |
| `administration` | Year and month as TEA labels it, e.g. `2019 May`. |
| `testForm` | TEA's form title, verbatim, e.g. `STAAR Grade 8 Social Studies, Administered May 2019, RELEASED`. |
| `itemNumberAsPublished` | Item position exactly as TEA numbered it. Never renumbered. |
| `itemType` | TEA's own string: `Multiple Choice`, `Multiselect`, `Drag and Drop`, `Short Constructed Response`, etc. |
| `maxPoints` | 1 for multiple choice, 2 for the redesign-era non-multiple-choice types. |
| `teksAsPublished` | **The tested student expectation exactly as TEA labels it, in TEA's notation for that year.** Never normalized. |
| `processStudentExpectationAsPublished` | The process SE TEA paired with the content SE. Published for 2018–2022 only. |
| `reportingCategory` | 1 History, 2 Geography and Culture, 3 Government and Citizenship, 4 Economics/Science/Technology/Society. |
| `readinessOrSupporting` | TEA's designation. Published 2023 onward. |
| `correctAnswerFromOfficialKey` | **From TEA's answer key or student-expectations table.** Never derived by reading the item and picking the option that looks right. |
| `sourceUrl` | The TEA document the item text came from. |
| `keySourceUrl` | The TEA document the answer came from — often a *different* document, which is the point. |
| `provenanceCaveat` | Present when provenance is weaker than "appeared on a released operational form". |

`studentExpectation` is `teksAsPublished` normalized to the `8.N(L)` form the repo uses. **That
normalization is the only transformation applied to any TEA label.**

### Two traps in TEA's labels

**TEA's notation changed three times.** `8.4(A)` in 2018–2022, `8.4.A` in 2023–2024, a bare `4.A` in
2025, and `RC.SE` form such as `1.4.B` in the 2023 sampler key (where the leading digit is the
reporting category). Both forms are preserved.

**Some SE codes were retired or redefined.** Nine codes used on the 2018 and 2019 forms are no
longer in TEA's current assessed curriculum: `8.4(E)`, `8.6(D)`, `8.11(C)`, `8.12(D)`, `8.19(D)`,
`8.19(E)`, `8.20(C)`, `8.26(C)`, `8.27(D)`. And at least one surviving code changed meaning —
`8.4(C)` covered the Articles of Confederation in 2018 but covers only Revolution battles, Valley
Forge and the Treaty of Paris today.

Where this happens the item carries a `labelNote` or `labelReviewFlag`. **TEA's label is recorded as
published and never silently "corrected."** Any remapping we suggest is explicitly marked as our
reading, needing sign-off. One item (`STAAR.2019MAY.G8SS.43`, the John Adams item TEA labelled
`8.20(B)` where `8.20(A)` fits the content better) is flagged and deliberately left unresolved.

### `usableAsIs`

Separate from licensing. `false` means the item cannot be used *as captured* — almost always because
it depends on a map, photograph or cartoon TEA did not publish as text, or because TEA published only
the correct placements of a drag-and-drop and not its distractor pool. **7 of 53 items are
`usableAsIs: false`.**

---

## 4. Licensing — what TEA's terms actually say

**Read this before using anything here.** Quoted verbatim; nothing below is paraphrase or inference.

### 4.1 On every released document

Every released form, key, rationale and scoring guide carries this notice:

> Copyright © \[year], Texas Education Agency. All rights reserved. Reproduction of all or portions
> of this work is prohibited without express written permission from the Texas Education Agency.

Note "**or portions**". Lifting a single item is what that phrase addresses.

### 4.2 TEA's Copyright and Terms of Service

From <https://tea.texas.gov/about-tea/welcome-and-overview/site-policies>, verbatim:

> All content on this site is copyrighted by the Texas Education Agency and cannot be used without
> the express written permission of TEA, except under the following conditions:
>
> - Texas public school districts, charter schools, and education service centers can copy materials
>   for district and school educational use.
> - Residents of the state of Texas can copy materials for personal use.
>
> Do not alter or make partial copies of web content. Do not charge for the reproduced materials or
> any document containing them except to cover the cost of reproduction and distribution.
>
> If you are in Texas but are not an employee of a Texas public school district or charter school,
> you must get written approval from TEA to copy materials and enter into a license agreement that
> may involve paying a licensing fee or a royalty fee.

Contact for permissions: `Copyrights@tea.texas.gov`.

### 4.3 What that means for us, and what it does not

**What the terms say, read plainly:**

- The material is copyrighted and All Rights Reserved. It is **not** public domain and **not** openly
  licensed. There is no Creative Commons or equivalent grant anywhere on TEA's site that we found.
- The two carve-outs are **Texas districts / charters / ESCs for district and school educational
  use**, and **Texas residents for personal use**.
- "Do not alter or make partial copies" and "Do not charge for the reproduced materials or any
  document containing them" both cut directly against embedding individual items in a product.
- A Texas party that is not a district or charter employee is told explicitly to get written approval
  **and** enter a license agreement that may carry a fee or royalty.

**What we are not asserting.** Whether this product qualifies under the district carve-out depends on
facts about the publishing entity and its relationship to the districts we sell to — facts this pass
does not know. We are not offering a legal conclusion, and we are not asserting a license we did not
read. What we can say is that **the carve-outs are narrow and conditional, and shipping released item
text without resolving this would be shipping on an assumption.**

**Concrete recommendation:**

1. Email `Copyrights@tea.texas.gov` describing the use — an educational game embedding released
   Grade 8 Social Studies items, sold to or used by Texas districts — and ask what is required. This
   is a cheap email with a decisive answer.
2. Until that answer is in hand, treat every item here as **research and blueprint evidence, not
   shippable content.**
3. Note that the safest and still very valuable use needs no permission at all: `item-index.json`
   plus `boston-coverage.json` are *facts about the test* — which standards get tested, how often,
   at what reporting category, with what item types and point values. That is a blueprint we can
   author our own items against without reproducing TEA's expression.
4. This applies to the **existing bank too.** The 15 traced owner items are paraphrases of
   copyrighted TEA items. Whatever answer comes back covers them.

We also deliberately **did not vendor the TEA source PDFs into this repo.** `sources.json` records
their URLs and hashes so anything here can be re-verified against the originals.

### 4.4 Third-party content inside released tests

This is a real and separate risk, and TEA's published statement does **not** cover the social studies
case.

TEA's only statement on third-party material, from the released-test-questions page, verbatim:

> STAAR RLA tests contain varying amounts of authentic published texts. Copyright permission for
> these texts is obtained from publishers by the testing contractor on behalf of TEA. These copyright
> agreements may or may not include permission for a wider, non-secure release after testing. If
> material that was used during testing could not be included in a released test form due to specific
> copyright permissions, text is provided in the form that indicates where the source material
> originated.

**That statement is scoped to RLA — Reading Language Arts — not social studies.** We found no
TEA statement specific to third-party material in social studies released tests.

**But social studies released tests do contain third-party copyrighted material.** Observed directly
on the 2019 Grade 8 form: item 5 quotes a PBS film resource by Judith E. Harper, and item 11 quotes
*The New York Times* (Mary Frances Berry, 13 September 1987). Neither is Boston-relevant and neither
was captured, but both prove the category exists.

To make this triageable, every captured stimulus carries an `attributionParty`:

| Value | Meaning | Notes |
|---|---|---|
| `PUBLIC_DOMAIN_PERIOD_SOURCE` | Period document — the Declaration, the *Boston Gazette* 1773, the Mayflower Compact, Samuel Adams 1772 | The underlying text is almost certainly public domain, though TEA's selection and excerpting are TEA's. **Most Boston-relevant stimuli fall here, which is fortunate.** |
| `THIRD_PARTY_US_FEDERAL` | Library of Congress, NARA, U.S. Census Bureau, U.S. Department of State | Usually unproblematic, but the credit line must be carried. |
| `THIRD_PARTY_COPYRIGHTED` | A commercial or institutional rightsholder | Needs its own clearance, separate from TEA's. |
| `UNKNOWN` | Rightsholder not determinable | Applies to `STAAR.2024.G8SS.37`, whose mercantilism cartoon credit did not survive text extraction. Treat as unclear. |

**These classifications are ours, not TEA's.** They are a triage aid, not a rights determination.

---

## 5. The gap list

`boston-coverage.json` is the machine-readable version with TEA's verbatim SE statements. Summary:

- **22 of 23** Boston SEs have at least one item in TEA's published data.
- **21 of 23** have at least one item TEA published *text* for.
- **12 of 23** need in-house authoring as the only way to cover what Boston teaches.

### Mandatory authoring — 12 standards

| SE | Boston needs | What exists | Why it is still a gap |
|---|---|---|---|
| **8.4(B)** | Samuel Adams, John Adams, Crispus Attucks, Mercy Otis Warren, Abigail Adams, King George III, Washington | **Zero items on any of the seven summative forms.** Only the 2023 sampler item 7 (Jefferson / Washington / Paine / Attucks). | The hardest gap in the chapter. The one existing item has weaker provenance (sampler, not confirmed administered), and **no released item anywhere names Samuel Adams, Warren or Abigail Adams as the answer** — Samuel Adams is Boston's Act 3 gated individual. |
| **8.4(C)** | Lexington and Concord (M13, M14) | Yorktown 1781, Valley Forge 1777 | **No released item is about Lexington and Concord**, the only 8.4(C) clause Boston carries. |
| **8.10(A)** | Archive map framing, the Lexington corridor | One item with text (2018 #2) | Map-dependent and about 1819 Florida. No usable item at all. |
| **8.10(C)** | The harbor; committees of correspondence | Oglethorpe 1733; Louisiana Purchase; Civil War railroads | Released items treat waterways as transport or defense, **never as a news network**. |
| **8.11(A)** | Geography drives economy: the port | Proclamation boundary; where to farm tobacco | **No item where a natural harbor is the correct answer.** 2021 #8 offers "Natural harbors for whaling" only as a distractor. |
| **8.15(E)** | Locke and Montesquieu (M4) | Exactly one item in seven administrations: Thomas Hooker (2021 #29) | The SE names Hooker, Montesquieu and Locke. **Only the Hooker branch is covered.** |
| **8.19(C)** | Juries, the Massacre trial (M7) | One item indexed (2024 #17), **text not published** | We know it exists and keys D. That is all. |
| **8.21(A)** | Patriot versus Loyalist | 1850s party comparison | **No colonial-era point-of-view item exists.** |
| **8.21(B)** | The Press, colonial printers (M5) | One item with text, image-dependent, modern scenario | Nothing about a printer, a broadside, or the press as a political instrument — Boston's entire M5 premise. |
| **8.22(A)** | Washington at the Siege of Boston (M14) | Lincoln's inaugural; Washington's presidency | **Every released Washington item is about his presidency**, never his military command. |
| **8.23(B)** | Urban conflict, the 1770 Massacre | 1854 and 1857 nativism | Neither touches crowding, billeted soldiers, or friction in a port. |
| **8.23(E)** | Daughters of Liberty (M12) | Dorothea Dix ×2, 19th-century reformers | **All three are 19th-century reform.** Warren and Abigail Adams appear nowhere, compounding 8.4(B). |

### Covered — 8 standards

`8.3(A)` is the best covered after 8.4(A): four of five text-published items are colonial or
era-neutral, and 2022 #26 quotes Samuel Adams in 1772, inside Boston's own window. Then `8.1(A)`
(via the 2024 revolution-era drag-and-drop naming mercantilism and Thomas Paine), `8.4(A)`,
`8.12(A)` (2018 #22 keys *Massachusetts* for shipbuilding and fishing), `8.15(C)` (two Declaration
grievance items), and thin single-item coverage on `8.15(A)`, `8.15(E)`, `8.19(A)`.

### 8.4(A) in detail — mission one

Six released items; TEA published text for all six. All six named clauses have some coverage.

| Item | Administration | Type | Key | Clause | Usable |
|---|---|---|---|---|---|
| `STAAR.2023.G8SS.07` | 2023 #7 | Short Constructed Response | rubric | Proclamation, Stamp Act, representation, postwar policy — **four clauses in one item** | yes |
| `STAAR.2018MAY.G8SS.05` | 2018 #5 | Multiple Choice | C | postwar British economic policies | yes |
| `STAAR.2019MAY.G8SS.24` | 2019 #24 | Multiple Choice | H | lack of representation in Parliament | yes |
| `STAAR.2021MAY.G8SS.38` | 2021 #38 | Multiple Choice | H | Intolerable Acts (names Boston Harbor's closure) | yes |
| `STAAR.2022MAY.G8SS.04` | 2022 #4 | Multiple Choice | J | Intolerable Acts | yes |
| `STAAR.2024.G8SS.37` | 2024 #37 | Multiselect | B, C | mercantilism | **no** — cartoon stimulus unpublished |

**Two residual gaps inside a well-covered standard.** No released *multiple-choice* item asks about
the Stamp Act's scope on printed and legal paper — mission one's actual concept. The only released
source that states it is the 2023 rubric bullet: *"All colonists had to pay taxes on documents and
paper."* And the mercantilism clause's only dedicated item is the unusable one.

Worth noting: that same rubric's second Stamp Act bullet is *"Taxes had to be paid in silver, which
was difficult to acquire"* — TEA treats the hard-coin problem as acceptable content, which is exactly
the `HARD_COIN_SCARCITY` micro-concept the repo already has.

---

## 6. The redesign changed what is obtainable

The single most important structural fact. TEA, verbatim:

> Beginning with the 2022–2023 school year, STAAR assessments are administered primarily online. …
> Since STAAR is now an online assessment with technology enhanced items, PDF versions of STAAR
> released tests are no longer available.

| Era | Administrations | What TEA publishes |
|---|---|---|
| Pre-redesign | 2018, 2019, 2021, 2022 | **Full PDF form with every item's text**, plus key, rationales, SE table. 44 items, all multiple choice. |
| Redesign | 2023, 2024, 2025 | Key, rationales and SE table for all 40 items — but **item text only for the non-multiple-choice items**, reproduced in an answer-key Appendix and the constructed-response scoring guides. |

So for 2023–2025, **every multiple-choice item is permanently metadata-only.** Those items are in
`item-index.json` with their standard, reporting category, readiness designation and official key,
and their text does not exist outside the secure online platform.

Item types expanded well beyond multiple choice: Multiselect, Multipart, Drag and Drop, Inline
Choice, Hot Text, Hot Spot, Match Table Grid, and Short Constructed Response. The current blueprint
is 40 questions / 49 points: 31 one-point and **9 two-point non-multiple-choice** items.

**The short constructed response is the format that matters most to us**, because it is the only
released format that matches the boss duel's free-response-graded-against-pre-authored-answers
design. TEA has published one on 8.4(A), with an official rubric and scored student exemplars.

Two other notes: **there is no 2020 administration** (STAAR was cancelled), and **2025 tested no
8.4(A) item at all** — its two constructed responses are 8.5(H) and 8.23(D), neither a Boston SE.

---

## 7. Marked unverified, and why

Nothing here is fabricated. Where verification failed, the item is either omitted with the reason
recorded or explicitly flagged. The complete list:

| Thing | Status | Why |
|---|---|---|
| **2023 full-length practice test** (~40 items with complete text) | **Omitted entirely** | TEA publishes the practice test but **no answer key and no TEKS alignment for Grade 8 Social Studies.** (It publishes practice-test keys for Math, RLA, Science, Biology, Algebra I, English I and English II — just not this one.) With no official key and no official standard label, capturing these items would mean inventing keys and standard codes. That is the one thing this dataset must never do. |
| `STAAR.2023.SAMPLER.G8SS.07` (the only 8.4(B) item) | **Captured, flagged** `SAMPLER_NOT_CONFIRMED_ADMINISTERED` | TEA distinguishes released *forms* from *sample questions* and says samplers "**may have been** previously administered." So it is genuinely TEA-published and genuinely TEA-keyed, but we cannot assert it was administered. Kept because 8.4(B) is otherwise a total gap; flagged rather than mixed in. |
| The `1.4.B` notation in the sampler key | **Inference, marked as such** | Read as "reporting category 1 + SE 8.4(B)". Corroborated across all 16 sampler items — every prefix matches the correct reporting category for its SE. Still our reading, flagged for confirmation. |
| `STAAR.2019MAY.G8SS.43` label | **`labelReviewFlag`, unresolved** | TEA published `8.20(B)`; the content (John Adams, civic virtue) fits `8.20(A)` better, and TEA labelled very similar 2022 content `8.20(A)`. Left for a reviewer. |
| `STAAR.2018MAY.G8SS.39` label | **Recorded as published, remapping marked as ours** | TEA published `8.20(C)`, a retired code. Content maps to today's `8.20(B)`. Needs sign-off. |
| `STAAR.2018MAY.G8SS.04` label | **`labelNote`** | TEA published `8.4(C)`; content is the Articles of Confederation, which today is `8.15(B)`. A vintage difference, not a TEA error. |
| `STAAR.2024.G8SS.02` option pool | **`optionPoolComplete: null`** | Four options confirmed by TEA's key; TEA never states the pool size and the appendix image did not extract. Unconfirmed rather than assumed. |
| `STAAR.2024.G8SS.18` option pool | **`optionPoolComplete: false`** | Prompt says "Not all answers will be used" but TEA reproduces only the correct placements. The distractor pool is unpublished, so the item is not reconstructible. |
| `STAAR.2023.G8SS.37` (8.22(A) hot text) | **Listed, not captured** | TEA published it, but the excerpt's PDF text layer is too damaged by overprinting to transcribe faithfully. Recorded in `notCapturedButPublished` rather than guessed at. |
| `BANK.BOSTON.USER.STAMP.v1` | **`UNTRACEABLE_TREAT_AS_AUTHORED`** | Searched all four released forms, the sampler, all three redesign answer-key appendices, all scoring guides, and the practice test. No match. Its option shape also differs from every released item. |
| 2023/2024 appendix OCR artifacts | **Corrected, disclosed** | Those appendices have character overprinting and OCR damage (e.g. `Bcsed` for `Based`). Obvious artifacts were corrected; anything not recoverable with confidence is `null` and flagged. |
| `STAAR.2021MAY.G8SS.14` options | **`optionTranscriptionNote`: reconstructed pairing** | The only item where a captured string is not one contiguous run of source text. TEA lays its four options out in two columns, so the text layer interleaves them. All eight fragments are individually verbatim and the column pairing is unambiguous, but each option's halves were rejoined during transcription. |

### Verbatim fidelity, measured

Every captured stem, option, period-source stimulus and attribution from the four PDF-form
administrations was machine-checked back against TEA's document text: **265 strings checked, 261
found byte-for-byte** after Unicode and whitespace normalization. The 4 exceptions are the four
options of `STAAR.2021MAY.G8SS.14` described in the row above, and each of their eight fragments does
appear verbatim. The 6 redesign-era items are not covered by this check because their source is an
answer-key appendix or scoring guide rather than a form PDF.

Two further integrity properties hold across the dataset. **No correct answer was ever derived by
reading an item and deciding which option looked right** — every key comes from a TEA key document,
often a different document from the one the text came from (`sourceUrl` vs `keySourceUrl`). And **all
53 captured items have every required provenance field populated**; there are no partial records.

---

## 8. Using this from code

Nothing is wired in, on purpose. When a retagging pass picks this up:

**Field alignment is intentional.** `itemId`, `itemVersion`, `stem`, `options[{optionId, text}]`,
`correctOptionId` and `era` all mean what they mean in `AssessmentItem`. `optionId` preserves TEA's
own letter (`A`–`D`, `F`–`J`, `A`–`E`) so ids stay keyed to the published item. `stimulus` is kept
separate from `stem`; `AssessmentItem.stem` is their concatenation.

**Four things `AssessmentItem` cannot represent today:**

1. **`approvalStatus` has no value for this.** The union is `DRAFT | SME_APPROVED | OWNER_PROVIDED`.
   These items are neither. Widening it — say to `TEA_RELEASED` — is a contracts change that belongs
   to whoever owns `packages/contracts`, so **no `approvalStatus` is set on any item here** rather
   than picking a wrong one. On what such a status would mean, TEA's blueprint states verbatim:
   *"Every passage and question on STAAR is created for Texas students with the review and approval
   of Texas educators."* That is TEA's claim about TEA's process, quoted, and it is **not** a
   substitute for our own SME sign-off.
2. **Non-multiple-choice item types.** `AssessmentItem` assumes one `correctOptionId`. Redesign-era
   items need `correctOptionIds` (multiselect), `correctPlacements` (drag-and-drop, match grid), or a
   `rubric` with no keyed option at all (short constructed response). Those fields are populated here
   and `correctOptionId` is `null`.
3. **Provenance is one string.** `AssessmentItem.provenance` is `"user-supplied 2026-07-23"`. Real
   provenance is structured, and the whole point of this task. It will either need to become an
   object or be flattened into a citation string.
4. **Licensing gating has nowhere to live.** Given §4, an item needs a "cleared for distribution"
   bit that selection respects. There is no such field today.

---

## 9. Reproducing this

Everything came from `tea.texas.gov`, no authentication, over plain HTTPS. `sources.json` has every
URL with a `sha256` so a later pass can tell whether TEA changed or withdrew a document.

Entry points:

- Released test questions index — <https://tea.texas.gov/data-reports/staar/staar-released-test-questions>
  (the per-year document links are inside JavaScript accordions, so fetch the raw HTML to enumerate them)
- STAAR Social Studies Resources — <https://tea.texas.gov/data-reports/staar/staar-social-studies-resources>
  (assessed curriculum, blueprint, constructed-response scoring guides)
- Copyright and Terms of Service — <https://tea.texas.gov/about-tea/welcome-and-overview/site-policies>

The authoritative SE statements in `boston-coverage.json` are verbatim from *STAAR Grade 8 Social
Studies Assessment Eligible Texas Essential Knowledge and Skills*, **Revised August 2024**. That
document confirms 8.4(A) reads exactly as `packages/chapter-boston/src/teks.ts` already has it.

Boston's 23 SEs are taken from `docs/chapters/boston-1765/Concept-Delivery-Map.md`, section
"All 23 SEs — classified": 6 gated facts, 14 load-bearing patterns, 3 ambient.
