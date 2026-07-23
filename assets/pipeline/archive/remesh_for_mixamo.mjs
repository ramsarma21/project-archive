// Rebuild a Meshy task as clean quad topology for Mixamo auto-rigging.
// Usage:
//   node remesh_for_mixamo.mjs task.json outputBase
// Produces outputBase.glb and outputBase.fbx.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const [, , taskArg, baseArg] = process.argv;
const sourceTask = JSON.parse(readFileSync(resolve(taskArg), "utf8"));
const outputBase = resolve(baseArg);
const env = readFileSync(resolve(".env"), "utf8");
const key = env.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("MESHY_API_KEY missing");
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const create = await fetch("https://api.meshy.ai/openapi/v1/remesh", {
  method: "POST",
  headers,
  body: JSON.stringify({
    input_task_id: sourceTask.id,
    topology: "quad",
    target_polycount: 30000,
    target_formats: ["glb", "fbx"],
    auto_size: true,
    origin_at: "bottom",
  }),
});
if (!create.ok) throw new Error(`create failed ${create.status}: ${await create.text()}`);
const { result: taskId } = await create.json();
console.log("remesh task", taskId);

let task;
for (let i = 0; i < 360; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const res = await fetch(`https://api.meshy.ai/openapi/v1/remesh/${taskId}`, { headers });
  task = await res.json();
  process.stdout.write(`\r${task.status} ${task.progress ?? 0}%   `);
  if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break;
}
console.log();
if (task?.status !== "SUCCEEDED") throw new Error(JSON.stringify(task?.task_error ?? task));
mkdirSync(dirname(outputBase), { recursive: true });
for (const format of ["glb", "fbx"]) {
  const url = task.model_urls?.[format];
  if (!url) continue;
  const r = await fetch(url);
  const bytes = Buffer.from(await r.arrayBuffer());
  writeFileSync(`${outputBase}.${format}`, bytes);
  console.log("WROTE", `${outputBase}.${format}`, bytes.length);
}
writeFileSync(`${outputBase}.remesh-task.json`, JSON.stringify(task, null, 2));
