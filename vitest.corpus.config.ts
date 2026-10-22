import { defineConfig } from 'vitest/config';

// The corpus gate lives apart from `npm test`: it needs the user's own map collection (GEORAMA_MAP_DIR),
// takes minutes and holds about 1.4 GiB while it runs. One file, one worker, no retries.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/corpus/**/*.test.ts'],
    testTimeout: 1_200_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    retry: 0,
    // The gate's one-line summary (counts only) must be visible on a passing run too.
    silent: false,
  },
});
