#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [sidecarArg, outputArg] = process.argv.slice(2);
if (!sidecarArg || !outputArg) {
  throw new Error(
    "usage: generate_from_prompt_sidecar.mjs prompt.json output.png",
  );
}
const sidecar = JSON.parse(readFileSync(resolve(sidecarArg), "utf8"));
if (typeof sidecar.prompt !== "string" || !sidecar.prompt.trim()) {
  throw new Error("prompt sidecar has no prompt");
}
process.argv = [
  process.argv[0],
  resolve(import.meta.dirname, "gen_concept_image.mjs"),
  "--prompt",
  sidecar.prompt,
  "--out",
  outputArg,
  "--size",
  sidecar.size ?? "1024x1024",
];
await import("./gen_concept_image.mjs");

