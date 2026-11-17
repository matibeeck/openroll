// Trims the reference tensors of huggingface.co/TuesdayCrowd/transkun-onnx (MIT) into the small
// fixtures used by tests/unit/transkun-frontend.test.ts (the originals are ~2 MB; nothing over 150 KB
// is committed).
//
//   node scripts/transkun/make-fixtures.mjs DIR_WITH_HF_FILES
//
// Writes tests/fixtures/transkun/:
//   ref3b_audio.i16       1.5 s of piano at 44.1 kHz (the reference input; int16, exact)
//   ref3b_features.json   every 29th value of its featuresBatch [66, 229, 6]
//   ref3c_S.f32           the model's S [66, 66, 90] for 6 tracks, entries e ≥ b only (track-major)
//   ref3c.json            those tracks, their expected Viterbi intervals, and the synthetic cases
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/transkun/make-fixtures.mjs DIR_WITH_HF_FILES');
  process.exit(1);
}
const out = join(import.meta.dirname, '../../tests/fixtures/transkun');
mkdirSync(out, { recursive: true });
const f32 = (name) => {
  const b = readFileSync(join(src, name));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

const audio = f32('ref3b_audio.f32');
const i16 = new Int16Array(audio.length);
for (let i = 0; i < audio.length; i++) {
  const v = audio[i] * 32768;
  if (v !== Math.round(v)) throw new Error('reference audio is not 16-bit');
  i16[i] = v;
}
writeFileSync(join(out, 'ref3b_audio.i16'), Buffer.from(i16.buffer));

const feats = f32('ref3b_features.f32');
const STRIDE = 29;
const values = [];
for (let i = 0; i < feats.length; i += STRIDE) values.push(feats[i]);
writeFileSync(join(out, 'ref3b_features.json'), JSON.stringify({ shape: [66, 229, 6], stride: STRIDE, values }));

const S = f32('ref3c_S.f32');
const T = 66;
const K = 90;
// The track with the reference note and the five tracks whose best score is closest to firing.
const tracks = [45, 43, 41, 57, 0, 55];
const tri = [];
for (const k of tracks) for (let e = 0; e < T; e++) for (let b = 0; b <= e; b++) tri.push(S[(e * T + b) * K + k]);
writeFileSync(join(out, 'ref3c_S.f32'), Buffer.from(Float32Array.from(tri).buffer));
const intervals = JSON.parse(readFileSync(join(src, 'ref3c_intervals.json'), 'utf8'));
const syn = JSON.parse(readFileSync(join(src, 'ref3c_syn_intervals.json'), 'utf8'));
const forced = JSON.parse(readFileSync(join(src, 'ref3c_forced_intervals.json'), 'utf8'));
const nonEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.length));
writeFileSync(
  join(out, 'ref3c.json'),
  JSON.stringify({
    T,
    tracks,
    intervals: Object.fromEntries(tracks.map((k) => [k, intervals[k]])),
    totalIntervals: Object.values(intervals).reduce((s, v) => s + v.length, 0),
    synthetic: nonEmpty(syn),
    forced: { forcedStartPos: forced.forcedStartPos, intervals: nonEmpty(forced.intervals) },
  }),
);
console.log(`wrote ${out}`);
