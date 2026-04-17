import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the bitcoinmints X-ray app.
 *
 * This PR (#6) is the data-dump verifier — we want Vite + React + the
 * workspace `@bitcoinmints/core` on the module graph and nothing more.
 * PR #7+ will layer designed UI on top.
 *
 * The `@/*` alias matches shadcn's components.json so future scaffolding
 * (PR #7+) drops in without reshaping imports.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
