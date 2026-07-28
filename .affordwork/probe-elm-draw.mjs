// What does the renderer actually draw for the elm? Prints every scenery
// placement whose asset is liberty-elm-hero: how many draws, at what size/pos,
// and which collision parts each stands for.
//   node --import tsx .affordwork/probe-elm-draw.mjs
import { sceneryPlacements } from "../packages/mission-m1/src/runtime.ts";

const all = sceneryPlacements();
const elm = all.filter((p) => p.asset === "liberty-elm-hero");
console.log(`liberty-elm-hero draws: ${elm.length}`);
for (const p of elm) {
  console.log(
    `  id=${p.id} kind=${p.kind} fit=${p.fit}\n    pos=[${p.pos.map((n) => n.toFixed(2))}] size=[${p.size.map((n) => n.toFixed(2))}]\n    parts=${JSON.stringify(p.parts)}`,
  );
}

// Sanity: show the declared truth and the elm collision spans.
console.log("\nAll placements total:", all.length);
