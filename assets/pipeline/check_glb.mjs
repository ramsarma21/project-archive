// Spot-check that GLBs parse with three's GLTFLoader and print bbox size.
// Usage: node assets/pipeline/check_glb.mjs file1.glb [file2.glb ...]
globalThis.self = globalThis;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const threeRoot = resolve("node_modules/.pnpm/three@0.185.1/node_modules/three");
const { Box3, Vector3 } = await import(`${threeRoot}/build/three.module.js`);
const { GLTFLoader } = await import(`${threeRoot}/examples/jsm/loaders/GLTFLoader.js`);

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node assets/pipeline/check_glb.mjs file.glb [...]");
  process.exit(1);
}

const loader = new GLTFLoader();
let failed = 0;
for (const file of files) {
  const path = resolve(file);
  try {
    const bytes = readFileSync(path);
    const gltf = await new Promise((resolvePromise, rejectPromise) => {
      loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolvePromise, rejectPromise);
    });
    const box = new Box3().setFromObject(gltf.scene);
    const size = box.getSize(new Vector3());
    let meshes = 0;
    let triangles = 0;
    gltf.scene.traverse((node) => {
      if (node.isMesh) {
        meshes++;
        const index = node.geometry.index;
        triangles += (index ? index.count : node.geometry.attributes.position.count) / 3;
      }
    });
    console.log(
      `OK ${file} bbox=[${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}] meshes=${meshes} tris=${Math.round(triangles)}`,
    );
  } catch (error) {
    failed++;
    console.error(`FAIL ${file}: ${error?.message ?? error}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
