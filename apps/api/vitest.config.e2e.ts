import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // E2E tests share a real database — must run sequentially to avoid teardown races
    fileParallelism: false,
    pool: 'forks',
    // The T0-C kill switch. Suites boot the whole AppModule, which registers
    // the Phase 9 routine job; without this a timer could materialise tasks
    // underneath a running test.
    env: { SCHEDULER_ENABLED: 'false' },
  },
});
