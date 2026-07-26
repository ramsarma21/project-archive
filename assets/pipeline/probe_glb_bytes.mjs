// Where does a GLB actually spend its bytes? Attributes every bufferView to
// images, animation samplers, mesh attributes/indices or skin data, so a size
// regression is diagnosed by measurement instead of by guessing at geometry.
//
// The player rig's 10.71MB -> 4.60MB pass turned on exactly this distinction:
// the bulk was a single PNG albedo, not the mesh. Run this before reaching for
// a decimator.
//
// Usage: node assets/pipeline/probe_glb_bytes.mjs file.glb [more.glb ...]
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function glbChunks(data) {
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a binary glTF");
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trim());
  let binLength = 0;
  let cursor = 20 + jsonLength;
  while (cursor + 8 <= data.length) {
    const length = data.readUInt32LE(cursor);
    const type = data.readUInt32LE(cursor + 4);
    if (type === 0x004e4942) binLength = length;
    cursor += 8 + length;
  }
  return { json, jsonLength, binLength };
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

for (const file of process.argv.slice(2)) {
  const path = resolve(file);
  const data = readFileSync(path);
  const { json, jsonLength, binLength } = glbChunks(data);
  const views = json.bufferViews ?? [];
  const accessors = json.accessors ?? [];

  // Claim each bufferView for exactly one role. Roles are assigned in priority
  // order so a view shared between, say, a mesh and a skin is not double counted.
  const owner = new Array(views.length).fill(null);
  const claim = (viewIndex, role) => {
    if (Number.isInteger(viewIndex) && owner[viewIndex] === null) owner[viewIndex] = role;
  };
  const claimAccessor = (accessorIndex, role) => {
    const accessor = accessors[accessorIndex];
    if (accessor) claim(accessor.bufferView, role);
  };

  for (const image of json.images ?? []) claim(image.bufferView, "image");
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers ?? []) {
      claimAccessor(sampler.input, "anim");
      claimAccessor(sampler.output, "anim");
    }
  }
  for (const skin of json.skins ?? []) claimAccessor(skin.inverseBindMatrices, "skin");
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const accessorIndex of Object.values(primitive.attributes ?? {})) {
        claimAccessor(accessorIndex, "mesh");
      }
      claimAccessor(primitive.indices, "mesh");
      for (const target of primitive.targets ?? []) {
        for (const accessorIndex of Object.values(target)) claimAccessor(accessorIndex, "morph");
      }
    }
  }

  const totals = { image: 0, anim: 0, mesh: 0, skin: 0, morph: 0, unclaimed: 0 };
  views.forEach((view, index) => {
    totals[owner[index] ?? "unclaimed"] += view.byteLength ?? 0;
  });

  const imageRows = (json.images ?? []).map((image, index) => {
    const view = Number.isInteger(image.bufferView) ? views[image.bufferView] : null;
    return {
      index,
      name: image.name ?? `image${index}`,
      mime: image.mimeType ?? (image.uri ? "uri" : "?"),
      bytes: view?.byteLength ?? 0,
    };
  });

  let triangles = 0;
  let vertices = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const position = accessors[primitive.attributes?.POSITION];
      if (position) vertices += position.count ?? 0;
      const indices = accessors[primitive.indices];
      if (indices) triangles += Math.floor((indices.count ?? 0) / 3);
      else if (position) triangles += Math.floor((position.count ?? 0) / 3);
    }
  }

  console.log(`=== ${basename(path)}  ${mib(data.length)} (${data.length} bytes)`);
  console.log(
    `    json=${mib(jsonLength)} bin=${mib(binLength)} ` +
      `tris=${triangles} verts=${vertices} ` +
      `clips=${(json.animations ?? []).length} images=${(json.images ?? []).length}`,
  );
  for (const [role, bytes] of Object.entries(totals)) {
    if (bytes === 0) continue;
    const share = ((bytes / data.length) * 100).toFixed(1);
    console.log(`    ${role.padEnd(9)} ${mib(bytes).padStart(9)}  ${share.padStart(5)}%`);
  }
  for (const row of imageRows.sort((a, b) => b.bytes - a.bytes)) {
    console.log(
      `      img[${row.index}] ${row.mime.padEnd(10)} ${mib(row.bytes).padStart(9)}  ${row.name}`,
    );
  }
  const clips = (json.animations ?? []).map((a, i) => a.name ?? `clip${i}`);
  if (clips.length > 0) console.log(`    clipNames: ${clips.join(", ")}`);
}
