// Re-runs the grid search that chose the audio post-processing defaults (M4) on the seeded dev
// set, then prints the held-out fixtures. The logic lives in tests/roundtrip/audio-tuning.test.ts
// (it needs the TypeScript sources and the test synth); this just runs it with TUNE=1.
// First run ≈ 2 min (Basic Pitch on tfjs CPU); activations are cached in the OS temp dir.
// `npm run tune:audio -- realistic` ranks the grid on the recording-like TUNING set instead
// (tests/fixtures/audio-realistic.ts; first run ≈ 3 min); add EVAL=1 to then report the separate
// evaluation set for the shipped defaults and the tuning set's best config.
import { spawnSync } from 'node:child_process';

const realistic = process.argv.includes('realistic');
const r = spawnSync('npx', ['vitest', 'run', 'tests/roundtrip/audio-tuning.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, TUNE: '1', ...(realistic ? { TUNE_SET: 'realistic' } : {}) },
});
process.exit(r.status ?? 1);
