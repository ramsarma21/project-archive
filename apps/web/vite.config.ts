import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin proxy so session cookies are first-party on localhost:5173.
      "/v1": {
        target: "http://localhost:3001",
        changeOrigin: false,
      },
    },
  },
  worker: {
    format: "es",
  },
});
