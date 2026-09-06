import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * UNIT test configuration (`npm test`).
 *
 * Unit tests live beside the code they cover as `src/**\/*.spec.ts` and must not
 * touch the database or boot the Nest application — collaborators are stubbed.
 *
 * The previous `**\/*.spec.ts` pattern matched nothing (every existing suite is
 * named `*.e2e-spec.ts`), so `npm test` exited 1 with "No test files found" and
 * would fail any CI pipeline that ran it.
 *
 * End-to-end suites run separately via `npm run test:e2e`
 * (see vitest.config.e2e.ts) and are excluded here.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e-spec.ts'],
  },
});
