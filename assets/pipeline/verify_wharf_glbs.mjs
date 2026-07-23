// Verify each synced wharf GLB parses with three's GLTFLoader (node) and
// print bounding-box sizes for the wharf manifest.
// Usage: node assets/pipeline/verify_wharf_glbs.mjs
globalThis.self = globalThis;
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "../../node_modules/.pnpm/three@0.185.1/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../../node_modules/.pnpm/three@0.185.1/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

const KEYS = [
  "ship-brig-hero",
  "ship-snow-background",
  "ship-sloop",
  "rowboat",
  "gangplank",
  "buoy",
  "wharf-pier-module",
  "wharf-boardwalk-plank",
  "bldg-warehouse-wharf-a",
  "bldg-warehouse-wharf-b",
  "timber-crane",
  "bollard",
  "rope-coil-large",
  "cargo-net-bundle",
  "crate-mound",
  "fish-flakes-rack",
];

const loader = new GLTFLoader();
const results = {};
for (const key of KEYS) {
  const path = resolve(`apps/web/public/world/props/${key}.glb`);
  const bytes = readFileSync(path);
  try {
    const gltf = await new Promise((resolvePromise, reject) => {
      loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolvePromise, reject);
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    let tris = 0;
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.geometry) {
        const index = o.geometry.index;
        tris += (index ? index.count : o.geometry.attributes.position.count) / 3;
      }
    });
    results[key] = {
      ok: true,
      bboxSize: [size.x, size.y, size.z].map((v) => Number(v.toFixed(3))),
      tris: Math.round(tris),
      bytes: bytes.length,
    };
    console.log(`OK ${key} bbox ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} tris ${Math.round(tris)} bytes ${bytes.length}`);
  } catch (error) {
    results[key] = { ok: false, error: String(error) };
    console.log(`FAIL ${key}: ${error}`);
  }
}
writeFileSync(resolve("assets/build/world-v3/wharf-verify.json"), JSON.stringify(results, null, 2));
console.log("VERIFY DONE");
