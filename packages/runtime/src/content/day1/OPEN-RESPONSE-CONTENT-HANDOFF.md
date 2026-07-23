# Open-response authored-content handoff

The engineering fixtures are intentionally marked
`FIXTURE_NOT_SME_APPROVED`. Do not change that status without recorded
historical/curriculum review.

Authoring integration points:

1. Add immutable source records to
   `packages/runtime/src/content/provenance.ts`. Use one canonical source ID
   for the in-world artifact, dialogue claim, Archive connection, and source
   packet. Add aliases only for legacy field IDs.
2. Add prompt, source packet, rubric, authored feedback, source requirements,
   and spacing in
   `packages/runtime/src/assessment/openResponseRegistry.ts`. Import-time Zod
   validation fails closed on malformed packages.
3. Keep prompts to one of the four contract operations: source comparison,
   concept transfer, historical perspective, or strategy justification.
4. Keep expected responses within the authored 35–90 word range. Criteria,
   labels, evidence IDs, and feedback IDs must be finite allowlists. Feedback
   is reviewed prose; model prose is never displayed.
5. Connect selected NPC/poster/Archive interactions by completing their
   canonical source IDs. The scheduler waits at least two committed
   interactions and offers only during a safe `FREE_ROAM` boundary. Act 1 is
   capped at two completed open responses.
6. The runtime view exposes eligible prompts and prior formative evidence.
   The web submits `FIELD_OPEN_RESPONSE_STARTED`, then only an opaque response
   reference plus a package-valid deterministic resolution. It must leave the
   interrupt active until feedback is read.

Normal Syncs and CP1 core must not call these APIs. CP1's required form ID is
macro-only; optional micro enrichment has a separate supplement ID.

Before enabling student-visible classification, replace fixtures with
SME-approved packages and run a human-scored calibration/bias corpus across
dialect, spelling, ELL, and accessibility modalities. The engineering
provider benchmark is not that approval.

