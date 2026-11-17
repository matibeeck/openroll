// Re-runs the grid search that chose the audio post-processing defaults (M4) on the seeded dev
// set, then prints the held-out fixtures. The logic lives in tests/roundtrip/audio-tuning.test.ts
// (it needs the TypeScript sources and the test synth); this just runs it with TUNE=1.
// First run ≈ 2 min (Basic Pitch on tfjs CPU); activations are cached in the OS temp dir.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', 'tests/roundtrip/audio-tuning.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, TUNE: '1' },
});
process.exit(r.status ?? 1);
