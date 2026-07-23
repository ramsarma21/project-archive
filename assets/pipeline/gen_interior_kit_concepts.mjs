// Generate concept/reference images for the interior FURNISHING/TRADE kit via
// the TrueFoundry -> Gemini image gateway (same route as gen_concept_image.mjs).
// Writes assets/source/concepts/interior-kit/<key>.png (+ .prompt.json sidecar).
//
// Usage:
//   node assets/pipeline/gen_interior_kit_concepts.mjs [--only key,key] [--force] [--size 1024x1024]
//
// Skips keys whose concept PNG already exists unless --force. This makes the
// factory resumable and lets QA regeneration target single keys via --only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { QUEUE, promptFor } from "./interior_kit_queue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const OUT_DIR = resolve(ROOT, "assets/source/concepts/interior-kit");

function readEnv() {
  const envPath = resolve(ROOT, ".env");
  const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const pick = (name) => {
    const fromFile = env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
    return process.env[name]?.trim() || fromFile || "";
  };
  const baseUrl = (pick("TRUEFOUNDRY_BASE_URL") || "https://tfy.promptlens.trilogy.com/v1").replace(/\/$/, "");
  const host = baseUrl.replace(/\/(v1|api\/llm\/v1|api\/inference\/openai)$/, "");
  return {
    key: pick("TRUEFOUNDRY_API_KEY"),
    baseUrl,
    imagesBase: (pick("TRUEFOUNDRY_IMAGES_BASE") || `${host}/api/inference/openai`).replace(/\/$/, ""),
    model: pick("NANO_BANANA_MODEL") || "gemini-group/gemini-3-pro-image-preview",
  };
}

function parseArgs(argv) {
  const args = { size: "1024x1024" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--size") { args.size = argv[++i]; args.sizeExplicit = true; }
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  return args;
}

const { key, baseUrl, imagesBase, model } = readEnv();
const args = parseArgs(process.argv);
if (!key) { console.error("TRUEFOUNDRY_API_KEY missing in .env"); process.exit(2); }
const authHeaders = { Authorization: `Bearer ${key}` };

function extractChatImages(payload) {
  const images = [];
  const push = (value) => {
    if (!value || typeof value !== "string") return;
    const m = value.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/s);
    if (m) images.push({ b64: m[2] });
    else if (/^https?:\/\//.test(value)) images.push({ url: value });
  };
  for (const choice of payload.choices ?? []) {
    const message = choice.message ?? {};
    for (const image of message.images ?? []) {
      push(image?.image_url?.url ?? image?.url ?? (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : null));
      if (image?.image_url?.b64_json) images.push({ b64: image.image_url.b64_json });
    }
    const content = message.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        push(part?.image_url?.url ?? part?.url);
        if (part?.inline_data?.data) images.push({ b64: part.inline_data.data });
        if (part?.b64_json) images.push({ b64: part.b64_json });
      }
    } else if (typeof content === "string") push(content.trim());
  }
  return images;
}

async function firstBytes(images) {
  const item = images[0];
  if (item.b64) return Buffer.from(item.b64, "base64");
  const file = await fetch(item.url);
  if (!file.ok) throw new Error(`image download failed HTTP ${file.status}`);
  return Buffer.from(await file.arrayBuffer());
}

async function generate(prompt) {
  // Primary route: /images/generations. Fallback: chat with image modality.
  const body = { model, prompt };
  if (args.sizeExplicit) body.size = args.size;
  const gen = await fetch(`${imagesBase}/images/generations`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (gen.status !== 404 && gen.ok) {
    const result = await gen.json();
    const data = result.data ?? [];
    if (data.length) return firstBytes(data.map((d) => ({ b64: d.b64_json, url: d.url })));
  } else if (gen.status !== 404) {
    throw new Error(`generation HTTP ${gen.status}: ${(await gen.text()).slice(0, 400)}`);
  }
  const chat = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] }),
  });
  const text = await chat.text();
  if (!chat.ok) throw new Error(`chat HTTP ${chat.status}: ${text.slice(0, 400)}`);
  const images = extractChatImages(JSON.parse(text));
  if (!images.length) throw new Error("no image parts returned");
  return firstBytes(images);
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = QUEUE.filter((q) => !args.only || args.only.includes(q.key));
let done = 0, skipped = 0, failed = 0;
for (const entry of targets) {
  const out = resolve(OUT_DIR, `${entry.key}.png`);
  if (existsSync(out) && !args.force) { console.log(`SKIP ${entry.key} (exists)`); skipped++; continue; }
  const prompt = promptFor(entry);
  try {
    const bytes = await generate(prompt);
    writeFileSync(out, bytes);
    writeFileSync(`${out}.prompt.json`, JSON.stringify({ key: entry.key, model, prompt, generatedAt: new Date().toISOString() }, null, 2));
    console.log(`WROTE ${entry.key} ${bytes.length}`);
    done++;
  } catch (e) {
    console.error(`FAIL ${entry.key}: ${e?.message ?? e}`);
    failed++;
  }
}
console.log(`\nconcepts: wrote ${done}, skipped ${skipped}, failed ${failed}`);
process.exit(failed > 0 ? 1 : 0);
