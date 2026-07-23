// Record the imported colonial surface kit after optimization + sync_web.
// The manifest lives with the tracked concept sources because assets/build is
// intentionally ignored.
globalThis.self = globalThis;
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const threeRoot = resolve("node_modules/.pnpm/three@0.185.1/node_modules/three");
const { Box3, Vector3 } = await import(`${threeRoot}/build/three.module.js`);
const { GLTFLoader } = await import(
  `${threeRoot}/examples/jsm/loaders/GLTFLoader.js`
);

const budgets = {
  "colonial-street-a": 6000,
  "colonial-street-b": 6000,
  "colonial-street-c": 6000,
  "colonial-alley-a": 4000,
  "colonial-alley-b": 4000,
  "colonial-gutter-straight": 2500,
  "colonial-gutter-corner": 3000,
  "colonial-street-junction": 5000,
  "colonial-street-endcap": 5000,
  "colonial-civic-square": 5000,
  "colonial-yard-ground": 3000,
  "colonial-yard-perimeter": 3000,
  "colonial-yard-east-cap": 3000,
  "colonial-liberty-courtyard": 3000,
  "colonial-wharf-apron": 12000,
  "colonial-wharf-boardwalk": 6000,
  "colonial-wharf-pier-finger": 4000,
};

const loader = new GLTFLoader();
const assets = {};
for (const [key, triangleBudget] of Object.entries(budgets)) {
  const sourceConceptKey =
    key === "colonial-wharf-boardwalk"
      ? "wharf-boardwalk-plank"
      : key.startsWith("colonial-wharf-")
        ? "wharf-pier-module"
        : key === "colonial-yard-perimeter" || key === "colonial-yard-east-cap"
          ? "colonial-yard-ground"
        : key;
  const sourceConceptDir = key.startsWith("colonial-wharf-")
    ? "assets/source/concepts"
    : "assets/source/concepts/roads";
  const materialKey = key.startsWith("colonial-wharf-")
    ? "colonial-wharf-timber"
    : key === "colonial-yard-perimeter" || key === "colonial-yard-east-cap"
      ? "colonial-yard-ground"
      : key;
  const publicPath = `apps/web/public/world/props/${key}.glb`;
  const absolutePath = resolve(publicPath);
  const bytes = readFileSync(absolutePath);
  const gltf = await new Promise((resolvePromise, rejectPromise) => {
    loader.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
      resolvePromise,
      rejectPromise,
    );
  });

  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  let triangles = 0;
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position;
    triangles += (node.geometry.index?.count ?? positions.count) / 3;
  });

  assets[key] = {
    conceptPath: `${sourceConceptDir}/${sourceConceptKey}.png`,
    promptSidecar: `${sourceConceptDir}/${sourceConceptKey}.png.prompt.json`,
    materialPath: `assets/source/concepts/roads/materials/${materialKey}-material.png`,
    materialPromptSidecar: `assets/source/concepts/roads/materials/${materialKey}-material.png.prompt.json`,
    meshySourcePath: `assets/build/world-v3/${sourceConceptKey}.glb`,
    optimizedPath: `assets/build/world-v3-opt/${key}.glb`,
    publicPath,
    optimizedBytes: statSync(absolutePath).size,
    bboxSize: [
      Number(size.x.toFixed(3)),
      Number(size.y.toFixed(3)),
      Number(size.z.toFixed(3)),
    ],
    triangles: Math.round(triangles),
    triangleBudget,
  };
}

const output = {
  _meta: {
    pipeline:
      "Gemini concept -> Meshy image-to-3D -> Blender optimize_road_kit.py -> sync_web.mjs",
    generatedAt: new Date().toISOString(),
    textures: "embedded JPEG, max 1024px, quality 80",
    placement:
      "Exact world footprints fitted non-uniformly by ImportedSurface; y=0 gameplay collision is unchanged and invisible.",
  },
  assets,
};

const outputPath = resolve(
  "assets/source/concepts/roads/road-kit-manifest.json",
);
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log("WROTE", outputPath, Object.keys(assets).length, "assets");
