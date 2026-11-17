import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sheet check against the user's real recording, which is NOT in the repo (see real-recording.spec.ts).
// Own config (port 4191, temp build dir) so it runs next to the other real-check configs.
// Run: npm run real-check:sheet   (REAL_RECORDING=/path/to/file.mov for another file, SHOT=name for the screenshot)
// Builds into a temp dir so it never clashes with other builds in dist/.
const port = Number(process.env.E2E_PORT ?? 4191);
const outDir = join(tmpdir(), 'openroll-real-check-sheet-dist');

export default defineConfig({
  testDir: '.',
  testMatch: 'real-recording.spec.ts',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, channel: 'chrome', viewport: { width: 1280, height: 1000 } },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: `npx vite build --outDir ${outDir} --emptyOutDir && npx vite preview --outDir ${outDir} --port ${port} --strictPort`,
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
