// Generate 1765-Boston concept/reference images through the TrueFoundry AI
// gateway (Gemini image / Nano Banana Pro). Output PNGs feed two workflows:
//   1. Design: street/interior layout sheets that define what the final 3D
//      build should look like before any modeling happens.
//   2. Assets: single-subject reference images piped into Meshy image-to-3D
//      (assets/pipeline/gen_prop_from_image.mjs) then optimize + sync_web.
//
// Usage:
//   node assets/pipeline/gen_concept_image.mjs --check
//   node assets/pipeline/gen_concept_image.mjs \
//     --prompt "..." --out assets/source/concepts/dock.png [--count 2] [--size 1024x1024]
//   node assets/pipeline/gen_concept_image.mjs \
//     --edit assets/source/concepts/dock.png --prompt "same dock at dusk" \
//     --out assets/source/concepts/dock-dusk.png
//   # multiple --edit references (identity + setting held together):
//   node assets/pipeline/gen_concept_image.mjs \
//     --edit backdrop.png --edit npc-a.png --edit npc-b.png \
//     --prompt "the two men on the wharf ..." --out scene.png
//
// Env (.env at repo root): TRUEFOUNDRY_API_KEY (required),
// TRUEFOUNDRY_BASE_URL (default https://tfy.promptlens.trilogy.com/v1),
// NANO_BANANA_MODEL (default gemini-group/gemini-3-pro-image-preview).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";

function readEnv() {
  const envPath = resolve(".env");
  const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const pick = (name) => {
    const fromFile = env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
    return process.env[name]?.trim() || fromFile || "";
  };
  const baseUrl = (pick("TRUEFOUNDRY_BASE_URL") || "https://tfy.promptlens.trilogy.com/v1").replace(/\/$/, "");
  // The /v1 prefix serves /models and /chat/completions on this gateway, but
  // image generation is only routed under /api/inference/openai (verified by
  // probe on 2026-07-21). Allow override via TRUEFOUNDRY_IMAGES_BASE.
  const host = baseUrl.replace(/\/(v1|api\/llm\/v1|api\/inference\/openai)$/, "");
  return {
    key: pick("TRUEFOUNDRY_API_KEY"),
    baseUrl,
    imagesBase: (pick("TRUEFOUNDRY_IMAGES_BASE") || `${host}/api/inference/openai`).replace(/\/$/, ""),
    model: pick("NANO_BANANA_MODEL") || "gemini-group/gemini-3-pro-image-preview",
  };
}

function parseArgs(argv) {
  const args = { count: 1, size: "1024x1024" };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--prompt") args.prompt = argv[++i];
    else if (arg === "--prompt-file") args.prompt = readFileSync(resolve(argv[++i]), "utf8").trim();
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--count") args.count = Math.max(1, Math.min(4, Number(argv[++i]) || 1));
    else if (arg === "--size") { args.size = argv[++i]; args.sizeExplicit = true; }
    else if (arg === "--edit") (args.edits ??= []).push(argv[++i]);
    else if (arg === "--model") args.modelOverride = argv[++i];
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

const { key, baseUrl, imagesBase, model: envModel } = readEnv();
const args = parseArgs(process.argv);
const model = args.modelOverride || envModel;

if (!key) {
  console.error(
    "TRUEFOUNDRY_API_KEY is not set.\n" +
    "Paste your key into .env at the repo root:\n" +
    "  TRUEFOUNDRY_API_KEY=tfy-...\n" +
    `Gateway: ${baseUrl}  Model: ${model}`,
  );
  process.exit(2);
}

const authHeaders = { Authorization: `Bearer ${key}` };

if (args.check) {
  // Cheap connectivity/auth probe: list models (no image billed).
  const response = await fetch(`${baseUrl}/models`, { headers: authHeaders });
  const body = await response.text();
  if (!response.ok) {
    console.error(`gateway check failed: HTTP ${response.status}\n${body.slice(0, 500)}`);
    process.exit(1);
  }
  let hasModel = false;
  try {
    const parsed = JSON.parse(body);
    hasModel = (parsed.data ?? []).some((entry) => entry.id === model);
    console.log(`gateway ok (${(parsed.data ?? []).length} models visible)`);
  } catch {
    console.log("gateway ok (non-JSON model list)");
  }
  console.log(hasModel ? `model available: ${model}` : `note: ${model} not in the visible model list; generation may still work if access is scoped.`);
  process.exit(0);
}

if (!args.prompt || !args.out) {
  console.error("usage: --prompt \"...\" --out path.png [--count N] [--size WxH] [--edit source.png] (or --check)");
  process.exit(1);
}

const outPath = resolve(args.out);
mkdirSync(dirname(outPath), { recursive: true });

async function saveImages(data) {
  const written = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    let bytes;
    if (item.b64_json) {
      bytes = Buffer.from(item.b64_json, "base64");
    } else if (item.url) {
      const file = await fetch(item.url);
      if (!file.ok) throw new Error(`image download failed: HTTP ${file.status}`);
      bytes = Buffer.from(await file.arrayBuffer());
    } else {
      throw new Error(`result ${i} had neither b64_json nor url`);
    }
    const path = data.length === 1
      ? outPath
      : resolve(dirname(outPath), `${basename(outPath, extname(outPath))}-${i + 1}${extname(outPath) || ".png"}`);
    writeFileSync(path, bytes);
    written.push({ path, bytes: bytes.length });
    console.log("WROTE", path, bytes.length);
  }
  // Sidecar records the exact prompt/model for reproducibility.
  writeFileSync(`${outPath}.prompt.json`, JSON.stringify({
    model,
    prompt: args.prompt,
    size: args.size,
    edit: args.edits ?? null,
    generatedAt: new Date().toISOString(),
    files: written.map((w) => basename(w.path)),
  }, null, 2));
}

// Native-Gemini provider accounts do not expose /images/generations through
// the gateway; the image model responds on /chat/completions instead. This
// path sends the prompt as a chat message and extracts image parts from the
// response wherever the gateway put them (message.images[], content arrays,
// or inline data URLs).
function extractChatImages(payload) {
  const images = [];
  const push = (value) => {
    if (!value || typeof value !== "string") return;
    const match = value.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/s);
    if (match) images.push({ b64_json: match[2] });
    else if (/^https?:\/\//.test(value)) images.push({ url: value });
  };
  for (const choice of payload.choices ?? []) {
    const message = choice.message ?? {};
    for (const image of message.images ?? []) {
      push(image?.image_url?.url ?? image?.url ?? (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : null));
      if (image?.image_url?.b64_json) images.push({ b64_json: image.image_url.b64_json });
    }
    const content = message.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        push(part?.image_url?.url ?? part?.url);
        if (part?.inline_data?.data) images.push({ b64_json: part.inline_data.data });
        if (part?.b64_json) images.push({ b64_json: part.b64_json });
      }
    } else if (typeof content === "string") {
      push(content.trim());
    }
  }
  return images;
}

async function generateViaChat(prompt) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`chat generation failed: HTTP ${response.status}: ${text.slice(0, 800)}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`chat generation returned non-JSON: ${text.slice(0, 400)}`);
  }
  const images = extractChatImages(payload);
  if (images.length === 0) {
    writeFileSync(`${outPath}.response.json`, text);
    throw new Error(
      `chat generation returned no image parts; raw response saved to ${outPath}.response.json for inspection`,
    );
  }
  return images;
}

if (args.edits && args.edits.length) {
  // Reference-based generation (style / scene / identity consistency): /images/edits.
  // Multiple --edit sources are supported (e.g. two character concepts + a wharf
  // backdrop) so identity and setting hold together. OpenAI-style `image[]` for
  // more than one source; a plain `image` field for a single source (unchanged).
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", args.prompt);
  const field = args.edits.length > 1 ? "image[]" : "image";
  for (const src of args.edits) {
    const sourcePath = resolve(src);
    const sourceExt = extname(sourcePath).toLowerCase();
    const sourceMime = sourceExt === ".jpg" || sourceExt === ".jpeg" ? "image/jpeg" : "image/png";
    form.append(field, new Blob([readFileSync(sourcePath)], { type: sourceMime }), basename(sourcePath));
  }
  const response = await fetch(`${imagesBase}/images/edits`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });
  if (!response.ok) throw new Error(`edit failed: HTTP ${response.status}: ${(await response.text()).slice(0, 800)}`);
  const result = await response.json();
  await saveImages(result.data ?? []);
} else {
  // Note: no response_format param (this route rejects it and returns
  // b64_json by default); size is passed only when explicitly requested.
  const body = { model, prompt: args.prompt, n: args.count };
  if (args.sizeExplicit) body.size = args.size;
  const response = await fetch(`${imagesBase}/images/generations`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 404) {
    // Route not provisioned; final fallback is chat with image modality.
    const images = await generateViaChat(args.prompt);
    await saveImages(images);
  } else if (!response.ok) {
    throw new Error(`generation failed: HTTP ${response.status}: ${(await response.text()).slice(0, 800)}`);
  } else {
    const result = await response.json();
    await saveImages(result.data ?? []);
  }
}
