import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The integration suites share one disposable Postgres database. Run test
    // files serially so their reset-and-seed hooks cannot race each other.
    fileParallelism: false
  }
});
