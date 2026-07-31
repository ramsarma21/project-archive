// Poll an existing Meshy image-to-3d task by id and download the GLB when done.
// Usage: node assets/pipeline/poll_meshy_task.mjs <taskId> output.glb
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const [, , taskId, outputArg] = process.argv;
if (!taskId || !outputArg) {
  console.error("usage: node assets/pipeline/poll_meshy_task.mjs <taskId> output.glb");
  process.exit(1);
}
const outputPath = resolve(outputArg);
const env = readFileSync(resolve(".env"), "utf8");
const key = env.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("MESHY_API_KEY missing");
const headers = { Authorization: `Bearer ${key}` };

let task;
for (let i = 0; i < 360; i++) {
  const response = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, { headers });
  task = await response.json();
  process.stdout.write(`\r${task.status} ${task.progress ?? 0}%   `);
  if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break;
  await new Promise((r) => setTimeout(r, 5000));
}
console.log();
if (task?.status !== "SUCCEEDED") throw new Error(`task not done: ${JSON.stringify(task?.task_error ?? task?.status)}`);
const url = task.model_urls?.glb;
if (!url) throw new Error("no GLB result");
const file = await fetch(url);
const bytes = Buffer.from(await file.arrayBuffer());
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, bytes);
writeFileSync(outputPath + ".task.json", JSON.stringify(task, null, 2));
console.log("WROTE", outputPath, bytes.length);
