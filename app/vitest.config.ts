import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./src/server/load-env.ts"],
  },
});
