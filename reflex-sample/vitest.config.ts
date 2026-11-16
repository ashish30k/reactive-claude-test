import { defineConfig } from "vitest/config";

// Behavior tests run in plain Node: the core has no UI, so no DOM is needed.
export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
