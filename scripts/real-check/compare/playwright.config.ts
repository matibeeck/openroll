/**
 * Fast (Basic Pitch) vs high precision (Transkun) in the BUILT app, real Chrome (WebGPU), this machine.
 * Run: npm run real-check:compare   (REAL_RECORDING=/path/to/recording for the real-recording part)
 * Own port and build folder so it can run next to the other checks. Never writes into the repo.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4194);
export const COMPARE_OUT_DIR = process.env.RC_OUT_DIR ?? join(tmpdir(), 'openroll-real-check-compare-dist');

export default defineConfig({
  testDir: '.',
  testMatch: '*.compare.ts',
  outputDir: join(tmpdir(), 'openroll-real-check-compare-results'),
  timeout: 1_800_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, channel: 'chrome' },
  webServer: {
    command:
      (process.env.RC_NO_BUILD === '1'
        ? ''
        : `node scripts/copy-models.mjs && node scripts/fetch-transkun.mjs --strict && npx vite build --outDir ${COMPARE_OUT_DIR} --emptyOutDir && `) +
      `npx vite preview --outDir ${COMPARE_OUT_DIR} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
