# M5 CP1 production assessment content gate

Status: **engineering implemented; production assessment content blocked**.

The repository does not contain an SME-approved CP1/STAAR item bank. Runtime
production mode therefore refuses to select the development fixtures. QA may
opt in explicitly with `VITE_CP1_ALLOW_DRAFT_BANK=true`.

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

Run `pnpm --filter @pa/runtime assessment:validate` for the development and
production gate report. Add `-- --require-production` when approved content is
installed and production selection must pass.
