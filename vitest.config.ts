import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/setup/global.ts"],
    // Integration tests share one anvil chain — run files sequentially so state is predictable.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000, // globalSetup builds + deploys the contracts once
  },
});
