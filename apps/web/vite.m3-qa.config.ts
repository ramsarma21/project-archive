import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config.js";

// Immutable-enough dev server for long visual tours: source modules are loaded
// once into Vite's transform cache, while concurrent asset/runtime workers may
// continue elsewhere without HMR reloads destroying this QA page.
export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      host: "127.0.0.1",
      port: 5183,
      strictPort: true,
      watch: {
        ignored: ["**/*"],
      },
    },
  }),
);
