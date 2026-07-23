// Day-1 target-id tables (chapter data). Engine modules import these tables;
// they must never hardcode BOS.* ids themselves (boundary lint).

// Every leg of the rider errand is part of the same timed run (bell-bounded):
// the board selection plus the authored travel legs of all three routes.
export const TIMED_RUN_TARGETS = new Set([
  "RIDER_HANDBILLS",
  "CLARKE_ROUTE",
  "CUSTOMS_ROUTE",
  "RIDER_BACK_LANES",
  "RIDER_DOCK_GATE",
  "RIDER_POST_ROUTE",
]);
