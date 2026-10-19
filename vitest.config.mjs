import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    // The real "obsidian" package has no runtime code; tests use a small mock.
    alias: { obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", ".claude/**"],
    testTimeout: 20000,
  },
});
