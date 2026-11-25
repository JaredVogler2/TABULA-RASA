import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws when imported outside a React Server environment.
      // Unit tests exercise server modules directly in Node, so map it to a no-op.
      "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    reporters: ["default"],
  },
});
