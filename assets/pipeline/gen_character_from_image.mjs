// Generate a clean, textured, low-poly T-pose character from a reference image.
// Unlike text-to-3D, Image-to-3D preserves the exact pose/outfit silhouette.
//
// Usage:
//   node gen_character_from_image.mjs reference.png output.glb [targetPolycount]
// targetPolycount is optional and defaults to 30000; a higher base count (e.g.
// 50000) preserves more facial detail before the web optimizer decimates it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";

const [, , imageArg, outputArg, polyArg] = process.argv;
if (!imageArg || !outputArg) {
  console.error("usage: node gen_character_from_image.mjs reference.png output.glb [targetPolycount]");
  process.exit(1);
}
const targetPolycount = Number(polyArg ?? "30000") || 30000;
const imagePath = resolve(imageArg);
const outputPath = resolve(outputArg);
const env = readFileSync(resolve(".env"), "utf8");
const key = env.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("MESHY_API_KEY missing");

const ext = extname(imagePath).toLowerCase();
const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
const dataUri = `data:${mime};base64,${readFileSync(imagePath).toString("base64")}`;
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const create = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
  method: "POST",
  headers,
  body: JSON.stringify({
    image_url: dataUri,
    ai_model: "latest",
    pose_mode: "t-pose",
    symmetry_mode: "on",
    should_texture: true,
    enable_pbr: false,
    should_remesh: true,
    target_polycount: targetPolycount,
    topology: "triangle",
    target_formats: ["glb"],
  }),
});
if (!create.ok) throw new Error(`create failed ${create.status}: ${await create.text()}`);
const { result: taskId } = await create.json();
console.log("task", taskId);

let task;
for (let i = 0; i < 360; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const res = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, { headers });
  task = await res.json();
  process.stdout.write(`\r${task.status} ${task.progress ?? 0}%   `);
  if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break;
}
console.log();
if (task?.status !== "SUCCEEDED") {
  throw new Error(`generation failed: ${JSON.stringify(task?.task_error ?? task)}`);
}
const url = task.model_urls?.glb;
if (!url) throw new Error("no GLB result");
const file = await fetch(url);
const bytes = Buffer.from(await file.arrayBuffer());
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, bytes);
writeFileSync(outputPath + ".task.json", JSON.stringify(task, null, 2));
console.log("WROTE", outputPath, bytes.length);
