/**
 * Tiny piano-like additive synth for round-trip tests (Node, no Web Audio).
 * Each note: slightly inharmonic partials with per-partial exponential decay (lower notes and
 * lower partials ring longer), a 3 ms attack, a short noisy "hammer" transient, and a 80 ms
 * release after note-off. Deterministic (seeded noise).
 */
import type { Score } from '../../src/core/score';

export interface SynthOptions {
  sampleRate: number;
  /** Silence added after the last note, seconds. */
  tail: number;
  /** Background noise level relative to full scale (0 = none). */
  noiseFloor: number;
  seed: number;
}

const DEFAULTS: SynthOptions = { sampleRate: 22050, tail: 1, noiseFloor: 0.001, seed: 1 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthesizeScore(score: Score, opts: Partial<SynthOptions> = {}): Float32Array {
  const o = { ...DEFAULTS, ...opts };
  const sr = o.sampleRate;
  const nyquist = sr / 2;
  const release = 0.08;
  const attack = 0.003;
  let end = 0;
  for (const n of score.notes) end = Math.max(end, n.start + n.duration + release);
  const out = new Float32Array(Math.ceil((end + o.tail) * sr));
  const rand = mulberry32(o.seed);

  for (const n of score.notes) {
    const f0 = 440 * 2 ** ((n.pitch - 69) / 12);
    // Bass strings ring longer than treble strings.
    const tau0 = 1.6 * 2 ** (-(n.pitch - 60) / 30);
    const inharm = 0.0004 * 2 ** ((n.pitch - 60) / 24);
    const gain = 0.15 * (0.3 + 0.7 * n.velocity);
    const s0 = Math.round(n.start * sr);
    const len = Math.round((n.duration + release) * sr);
    const offIdx = Math.round(n.duration * sr);
    const partials: { w: number; amp: number; decay: number; phase: number }[] = [];
    for (let k = 1; k <= 16; k++) {
      const fk = k * f0 * Math.sqrt(1 + inharm * k * k);
      if (fk >= nyquist * 0.95) break;
      partials.push({
        w: (2 * Math.PI * fk) / sr,
        amp: 1 / k ** 1.3,
        decay: 1 / (tau0 / (1 + 0.4 * (k - 1)) * sr),
        phase: rand() * 2 * Math.PI,
      });
    }
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const t = i / sr;
      let env = t < attack ? t / attack : 1;
      if (i > offIdx) env *= Math.exp(-(i - offIdx) / (release * 0.25 * sr));
      let v = 0;
      for (const p of partials) v += p.amp * Math.exp(-p.decay * i) * Math.sin(p.w * i + p.phase);
      // Hammer noise: ~5 ms burst.
      if (t < 0.005) v += (rand() * 2 - 1) * 0.3 * (1 - t / 0.005);
      out[s0 + i]! += gain * env * v;
    }
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i]! += (rand() * 2 - 1) * o.noiseFloor;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i]! *= 0.95 / peak;
  return out;
}

/**
 * Schroeder reverb (4 parallel combs + 2 series allpasses); returns a new dry/wet mix.
 * Cheap stand-in for a room so tests can check robustness beyond a dry signal.
 */
export function addReverb(audio: Float32Array, sampleRate: number, rt60 = 1.2, wet = 0.3): Float32Array {
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.round(d * sampleRate));
  const out = new Float32Array(audio.length);
  for (const d of combDelays) {
    const g = 10 ** ((-3 * d) / (rt60 * sampleRate));
    const buf = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
      buf[i] = audio[i]! + (i >= d ? g * buf[i - d]! : 0);
      out[i]! += buf[i]! / combDelays.length;
    }
  }
  let x = out;
  for (const [delay, g] of [[Math.round(0.005 * sampleRate), 0.7], [Math.round(0.0017 * sampleRate), 0.7]] as const) {
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const xd = i >= delay ? x[i - delay]! : 0;
      const yd = i >= delay ? y[i - delay]! : 0;
      y[i] = -g * x[i]! + xd + g * yd;
    }
    x = y;
  }
  const mixed = new Float32Array(audio.length);
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    mixed[i] = (1 - wet) * audio[i]! + wet * x[i]!;
    peak = Math.max(peak, Math.abs(mixed[i]!));
  }
  if (peak > 0.95) for (let i = 0; i < mixed.length; i++) mixed[i]! *= 0.95 / peak;
  return mixed;
}
