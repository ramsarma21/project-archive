// Would the proposed fix (make the bough decks collision-only, asset:null) work?
// Pass a modified level to the SAME renderer entry and see what it draws for the
// elm. No source edit.
//   node --import tsx .affordwork/probe-null-boughs.mjs
import { sceneryPlacements } from "../packages/mission-m1/src/runtime.ts";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.ts";

function draws(level, label) {
  const elm = sceneryPlacements(level).filter((p) => p.asset === "liberty-elm-hero");
  console.log(`\n${label}: ${elm.length} draw(s)`);
  for (const p of elm) {
    console.log(`  ${p.id} kind=${p.kind} size=[${p.size.map((n) => n.toFixed(2))}] pos=[${p.pos.map((n) => n.toFixed(2))}] parts=${JSON.stringify(p.parts)}`);
  }
}

draws(M1_EFFIGY_RUN, "CURRENT (boughs carry liberty-elm-hero)");

const nulled = {
  ...M1_EFFIGY_RUN,
  decks: M1_EFFIGY_RUN.decks.map((d) =>
    d.id.startsWith("BOUGH_") ? { ...d, asset: null } : d,
  ),
};
draws(nulled, 'PROPOSED (boughs asset:null -> "collision-only")');
