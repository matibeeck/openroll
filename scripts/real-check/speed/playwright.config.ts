/**
 * Conversion speed check on real files (local only, never in CI, never committed media).
 * Run: E2E_PORT=4193 npx playwright test -c scripts/real-check/speed  (see ../README.md)
 * Its own config and port so it can run next to scripts/real-check/real-recording.spec.ts.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4193);
// Own build output (never dist/), so a concurrent `npm run build` / e2e run elsewhere is not clobbered.
const outDir = process.env.RC_OUT_DIR ?? join(tmpdir(), 'openroll-real-check-speed-dist');

export default defineConfig({
  testDir: '.',
  testMatch: '*.speed.ts',
  // Own artifacts folder: concurrent runs that share test-results/ delete each other's files.
  outputDir: join(tmpdir(), 'openroll-real-check-speed-results'),
  timeout: 900_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, channel: 'chrome' },
  webServer: {
    command:
      (process.env.RC_NO_BUILD === '1' ? '' : `node scripts/copy-models.mjs && npx vite build --outDir ${outDir} --emptyOutDir && `) +
      `npx vite preview --outDir ${outDir} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
