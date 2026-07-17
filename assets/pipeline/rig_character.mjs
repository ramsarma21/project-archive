// Submit a prepped character GLB to Meshy's rigging API and download the
// rigged result. Reads MESHY_API_KEY from the repo .env.
// Usage: node assets/pipeline/rig_character.mjs <input.glb> <output.glb> <heightMeters>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [, , inputArg, outputArg, heightArg] = process.argv;
const input = resolve(inputArg ?? "assets/build/characters/abigail-prepped.glb");
const output = resolve(outputArg ?? "assets/build/characters/abigail-rigged.glb");
const height = Number(heightArg ?? "1.65");

const envText = readFileSync(resolve(".env"), "utf8");
const key = envText.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) {
  console.error("MESHY_API_KEY missing from .env");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function main() {
  const glb = readFileSync(input);
  const dataUri = `data:model/gltf-binary;base64,${glb.toString("base64")}`;
  console.log(`submitting rig task: ${input} (${glb.length} bytes), height ${height}m`);

  const createRes = await fetch("https://api.meshy.ai/openapi/v1/rigging", {
    method: "POST",
    headers,
    body: JSON.stringify({ model_url: dataUri, height_meters: height }),
  });
  if (!createRes.ok) {
    console.error("create failed:", createRes.status, await createRes.text());
    process.exit(1);
  }
  const { result: taskId } = await createRes.json();
  console.log("rig task id:", taskId);

  let task;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`https://api.meshy.ai/openapi/v1/rigging/${taskId}`, { headers });
    task = await res.json();
    const pct = task.progress ?? 0;
    process.stdout.write(`\rstatus=${task.status} progress=${pct}%   `);
    if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELED") break;
  }
  console.log();
  if (task?.status !== "SUCCEEDED") {
    console.error("rigging did not succeed:", JSON.stringify(task?.task_error ?? task, null, 2));
    process.exit(1);
  }

  const url =
    task.result?.rigged_character_glb_url ??
    task.result?.character_glb_url ??
    task.result?.model_urls?.glb;
  if (!url) {
    console.error("no rigged glb url in result:", JSON.stringify(task.result, null, 2));
    process.exit(1);
  }
  const fileRes = await fetch(url);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, buf);
  console.log("WROTE", output, buf.length, "bytes");
  writeFileSync(output + ".task.json", JSON.stringify(task, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
