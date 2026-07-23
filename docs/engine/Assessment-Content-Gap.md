# M5 CP1 production assessment content gate

Status: **engineering implemented; production CP1 content UNBLOCKED via the
owner-provided bank** (`BOS.ACT01.CP1.PRODUCTION@0.1.0-owner.2`).

All three required CP1 macros now have an `OWNER_PROVIDED`, 1765-scope item, so
runtime production mode selects the real owner bank on the student path.
Development fixtures are still rejected in production; QA may opt into them
explicitly with `VITE_CP1_ALLOW_DRAFT_BANK=true`. Note: `OWNER_PROVIDED` is
approved-for-use content, not an SME/TEKS sign-off claim.

## Required from SME/content

1. At least one approved, final variant for each fixed macro:
   - `RCC.DEBT_POLICY_INTRO`
   - `RCC.STAMP_INTERNAL_INTRO`
   - `RCC.REPRESENTATION_CAUSE`
2. Approved optional micro items for any of the 14 durable engaged-micro IDs
   that should be eligible for CP1 enrichment. These remain optional and never
   affect progression, official records, or mastery.
3. Final CP1 Archive/debrief and Act-transition dialogue.
4. Final TEKS tags and approval provenance for every production item,
   especially the three macro variants.

## Acceptance requirements for supplied content

- Stable `bankId`, `bankVersion`, `itemId`, and `itemVersion`.
- Two or three authored options and exactly one valid correct option.
- Correct `MACRO`/`MICRO` tier and concept ID.
- `SME_APPROVED` bank and item status for production selection.
- No route-specific required macro form.
- No score, percentage, predictor, or inferred mastery language.

Run `pnpm --filter @pa/chapter-boston assessment:validate` for the development
and production gate report, including per-macro production eligibility. Add
`-- --require-production` to make the process fail if production selection is
not passing (it now passes).
