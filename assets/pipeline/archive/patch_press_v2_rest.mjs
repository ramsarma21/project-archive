// Blender's NLA-track export writes valid absolute animation channels but may
// zero animated nodes' static transforms when reverse and forward tracks share
// an object. Patch only the GLB JSON node rest transforms after export; mesh
// buffers, imported geometry, pivots, textures, and animation accessors remain
// byte-for-byte unchanged.
// Usage: node assets/pipeline/patch_press_v2_rest.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("assets/build/interior-kit-opt/press-common-operable-v2.glb");
const bytes = readFileSync(path);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
const binHeader = 20 + jsonLength;
const binLength = bytes.readUInt32LE(binHeader);
const binType = bytes.readUInt32LE(binHeader + 4);
const bin = bytes.subarray(binHeader + 8, binHeader + 8 + binLength);

// glTF Y-up coordinates. These are the exact local pivot positions authored in
// assemble_press_v2.py after corrected keep-world parenting.
const rest = {
  Press_Frame: [0, 0, 0],
  Press_Carriage: [0, 0.93, -0.02],
  Press_Tympan: [0, 0.105, -0.53],
  Press_Frisket: [0, 0.06, 0.02],
  Press_Lever: [0, 1.62, -0.02],
  Press_Screw: [0, 1.59, -0.02],
  Press_Platen: [0, 1.23, -0.02],
};
for (const node of json.nodes ?? []) {
  if (!(node.name in rest)) continue;
  node.translation = rest[node.name];
  node.rotation = node.name === "Press_Lever"
    ? [0, -0.422618262, 0, 0.906307787]
    : [0, 0, 0, 1];
  node.scale = [1, 1, 1];
}

let jsonBytes = Buffer.from(JSON.stringify(json));
const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
if (jsonPadding) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
const totalLength = 12 + 8 + jsonBytes.length + 8 + bin.length;
const output = Buffer.alloc(totalLength);
output.writeUInt32LE(0x46546c67, 0);
output.writeUInt32LE(2, 4);
output.writeUInt32LE(totalLength, 8);
output.writeUInt32LE(jsonBytes.length, 12);
output.writeUInt32LE(0x4e4f534a, 16);
jsonBytes.copy(output, 20);
const outputBinHeader = 20 + jsonBytes.length;
output.writeUInt32LE(bin.length, outputBinHeader);
output.writeUInt32LE(binType, outputBinHeader + 4);
bin.copy(output, outputBinHeader + 8);
writeFileSync(path, output);
console.log("PATCHED REST POSE", path, output.length);

