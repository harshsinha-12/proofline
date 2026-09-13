import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "server-only": path.resolve(root, "./tests/helpers/server-only.ts"),
      "@": path.resolve(root, "./src"),
    },
  },
});
