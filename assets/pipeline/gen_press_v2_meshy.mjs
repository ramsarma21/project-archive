// Convert approved modular press-v2 concepts to imported Meshy components.
// Usage: node assets/pipeline/gen_press_v2_meshy.mjs [--force] [--only key,key]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRESS_V2_COMPONENTS, PRESS_V2_DIRS } from "./press_v2_queue.mjs";

const env = readFileSync(resolve(".env"), "utf8");
const apiKey = process.env.MESHY_API_KEY?.trim() || env.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) throw new Error("MESHY_API_KEY missing");
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const force = process.argv.includes("--force");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0
  ? new Set((process.argv[onlyIndex + 1] ?? "").split(",").filter(Boolean))
  : null;
const concepts = resolve(PRESS_V2_DIRS.concepts);
const raw = resolve(PRESS_V2_DIRS.raw);
mkdirSync(raw, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function run(component) {
  const imagePath = resolve(concepts, `${component.key}.png`);
  const outputPath = resolve(raw, `${component.key}.glb`);
  if (!existsSync(imagePath)) return { key: component.key, status: "NO_CONCEPT" };
  if (existsSync(outputPath) && !force) return { key: component.key, status: "SKIP" };
  const imageUrl = `data:image/png;base64,${readFileSync(imagePath).toString("base64")}`;
  const created = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
    method: "POST",
    headers,
    body: JSON.stringify({
      image_url: imageUrl,
      ai_model: "latest",
      symmetry_mode: "off",
      should_texture: true,
      enable_pbr: false,
      should_remesh: true,
      target_polycount: component.meshyPoly,
      topology: "triangle",
      target_formats: ["glb"],
    }),
  });
  if (!created.ok) {
    return { key: component.key, status: "CREATE_FAIL", error: `${created.status}: ${(await created.text()).slice(0, 300)}` };
  }
  const { result: taskId } = await created.json();
  console.log(`[${component.key}] task ${taskId}`);
  let task;
  for (let attempt = 0; attempt < 360; attempt++) {
    await sleep(5000);
    const response = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, { headers });
    task = await response.json();
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break;
  }
  if (task?.status !== "SUCCEEDED") {
    return { key: component.key, status: task?.status ?? "TIMEOUT", taskId, error: JSON.stringify(task?.task_error ?? "") };
  }
  const url = task.model_urls?.glb;
  if (!url) return { key: component.key, status: "NO_GLB", taskId };
  const response = await fetch(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, bytes);
  writeFileSync(`${outputPath}.task.json`, JSON.stringify({
    key: component.key,
    node: component.node,
    taskId,
    meshyPoly: component.meshyPoly,
    targetTris: component.targetTris,
    conceptPath: `${PRESS_V2_DIRS.concepts}/${component.key}.png`,
    status: task.status,
    model_urls: task.model_urls,
  }, null, 2));
  console.log(`[${component.key}] WROTE ${bytes.length}`);
  return { key: component.key, status: "OK", taskId };
}

const targets = PRESS_V2_COMPONENTS.filter((component) => !only || only.has(component.key));
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const component = targets[cursor++];
    try {
      results.push(await run(component));
    } catch (error) {
      results.push({ key: component.key, status: "ERROR", error: String(error?.message ?? error) });
    }
  }
}
await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
for (const result of results.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(result.status.padEnd(12), result.key, result.taskId ?? "", result.error ?? "");
}
const failed = results.filter((result) => !["OK", "SKIP"].includes(result.status));
process.exit(failed.length ? 1 : 0);

