import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@repolain/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@repolain/knowledge-base": path.resolve(__dirname, "packages/knowledge-base/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**"]
  }
});
