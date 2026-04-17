import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
