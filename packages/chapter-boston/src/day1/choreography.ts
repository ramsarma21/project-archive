// Serializable presentation-only choreography cue ids for Boston Day 1.
// These cues never mutate world state, learner state, outcomes, or the
// event log.
export const DAY1_CUES = {
  ARCHIVE_INTAKE: "BOS.MD01.CUE.ARCHIVE_INTAKE.v1",
  ARRIVE_BOSTON: "BOS.MD01.CUE.ARRIVE_BOSTON.v1",
  ENTER_MERCER: "BOS.MD01.ACT.ENTER_MERCER.v1",
  CATCH_SHEET: "BOS.MD01.ACT.CATCH_SHEET.v1",
  PRESS_PIKE_PROOF: "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
  STAMP_PROOF_COMPARE: "BOS.MD01.CUE.STAMP_PROOF_COMPARE.v1",
  LEAVE_MERCER: "BOS.MD01.CUE.LEAVE_MERCER.v1",
  // Street-level day ending (design1 feature 3): the walk from the final
  // pull out to the town board, and the pin-the-page beat where the crier
  // shouts the player's chosen headline.
  STREET_HEADLINE_WALK: "BOS.MD01.CUE.STREET_HEADLINE_WALK.v1",
  POST_HEADLINE_BOARD: "BOS.MD01.ACT.POST_HEADLINE_BOARD.v1",
} as const;
