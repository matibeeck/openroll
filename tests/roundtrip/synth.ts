/**
 * Tiny piano-like additive synth for round-trip tests (Node, no Web Audio).
 * Each note: slightly inharmonic partials with per-partial exponential decay (lower notes and
 * lower partials ring longer), a 3 ms attack, a short noisy "hammer" transient, and a 80 ms
 * release after note-off. Deterministic (seeded noise).
 *
 * Opt-in realism (all off by default, so default output is unchanged): a wider velocity →
 * level range and darker soft notes (`dynamicRangeDb`, `velocityTimbre`), longer-ringing
 * upper partials under the sustain pedal (`resonance`), plus helpers for pedalling a Score
 * (`sustainPedal`), room noise and mains hum (`addRoomNoise`) and a damped room (`addReverb`).
 */
import type { Note, Score } from '../../src/core/score';

export interface SynthOptions {
  sampleRate: number;
  /** Silence added after the last note, seconds. */
  tail: number;
  /** Background noise level relative to full scale (0 = none). */
  noiseFloor: number;
  seed: number;
  /**
   * Level difference between velocity 1 and velocity 0 in dB (a real piano spans ~30–40 dB
   * from pp to ff). Unset = the original mapping (≈10 dB).
   */
  dynamicRangeDb?: number;
  /** Softer notes have weaker upper partials (hammer felt is softer at low speed). */
  velocityTimbre?: boolean;
  /** Sustain-pedal resonance 0–1: upper partials ring longer and slightly louder (undamped strings). */
  resonance?: number;
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
    const gain =
      o.dynamicRangeDb === undefined ? 0.15 * (0.3 + 0.7 * n.velocity) : 0.15 * 10 ** (-((1 - n.velocity) * o.dynamicRangeDb) / 20);
    const rolloff = 1.3 + (o.velocityTimbre ? 1.2 * (1 - n.velocity) : 0);
    const res = o.resonance ?? 0;
    const s0 = Math.round(n.start * sr);
    const len = Math.round((n.duration + release) * sr);
    const offIdx = Math.round(n.duration * sr);
    const partials: { w: number; amp: number; decay: number; phase: number }[] = [];
    for (let k = 1; k <= 16; k++) {
      const fk = k * f0 * Math.sqrt(1 + inharm * k * k);
      if (fk >= nyquist * 0.95) break;
      partials.push({
        w: (2 * Math.PI * fk) / sr,
        amp: (1 / k ** rolloff) * (k > 1 ? 1 + 0.25 * res : 1),
        decay: 1 / (((tau0 / (1 + 0.4 * (k - 1))) * (k > 1 ? 1 + 0.6 * res : 1)) * sr),
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
 * `damping` (0–1, default 0 = original) low-passes the comb feedback: highs die out faster,
 * as in a real room.
 */
export function addReverb(audio: Float32Array, sampleRate: number, rt60 = 1.2, wet = 0.3, damping = 0): Float32Array {
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.round(d * sampleRate));
  const out = new Float32Array(audio.length);
  for (const d of combDelays) {
    const g = 10 ** ((-3 * d) / (rt60 * sampleRate));
    const buf = new Float32Array(audio.length);
    let lp = 0;
    for (let i = 0; i < audio.length; i++) {
      const fb = i >= d ? buf[i - d]! : 0;
      lp = damping ? fb * (1 - damping) + lp * damping : fb;
      buf[i] = audio[i]! + g * lp;
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

/**
 * Sustain pedal on a Score (for synthesis): the pedal is changed (released and pressed again)
 * at each new bass note — the lowest note ≤ `bassMax` starting at a time — or every
 * `fallbackEvery` seconds when there is no bass line. A note released while the pedal is down
 * keeps sounding until the next pedal change; a re-struck key cuts its previous sound.
 * Onsets and pitches are unchanged, so the original Score stays the reference.
 */
export function sustainPedal(score: Score, opts: { bassMax?: number; fallbackEvery?: number; maxRing?: number } = {}): Score {
  const bassMax = opts.bassMax ?? 55;
  const maxRing = opts.maxRing ?? 4;
  const end = score.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const changes = new Set<number>();
  for (const n of score.notes) {
    if (n.pitch > bassMax) continue;
    const lowest = score.notes.every((m) => Math.abs(m.start - n.start) > 0.02 || m.pitch >= n.pitch);
    if (lowest) changes.add(Math.round(n.start * 1000) / 1000);
  }
  if (changes.size < 2) for (let t = 0; t < end; t += opts.fallbackEvery ?? 2) changes.add(t);
  const sorted = [...changes].sort((a, b) => a - b);
  const notes: Note[] = score.notes.map((n) => {
    const off = n.start + n.duration;
    const change = sorted.find((c) => c >= off - 1e-6) ?? end + 1;
    let until = Math.min(Math.max(off, change), off + maxRing);
    const next = score.notes.find((m) => m.pitch === n.pitch && m.start > n.start + 1e-6 && m.start < until);
    if (next) until = Math.min(until, next.start);
    return { ...n, duration: Math.max(n.duration, until - n.start) };
  });
  return { ...score, notes };
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

/**
 * Room noise and mains hum mixed in at fixed levels relative to full scale (RMS dBFS): pink
 * noise (Paul Kellet's filter) for air/handling noise, and hum at `humHz` with two harmonics.
 */
export function addRoomNoise(
  audio: Float32Array,
  sampleRate: number,
  o: { noiseDb: number; humDb?: number; humHz?: number; seed?: number },
): Float32Array {
  let a = (o.seed ?? 9) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pink = new Float32Array(audio.length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; // prettier-ignore
  for (let i = 0; i < pink.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    pink[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  const noiseGain = 10 ** (o.noiseDb / 20) / Math.max(1e-9, rms(pink));
  const humGain = o.humDb === undefined ? 0 : 10 ** (o.humDb / 20) * Math.SQRT2;
  const hz = o.humHz ?? 50;
  const out = new Float32Array(audio.length);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const hum = humGain
      ? humGain * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t) + 0.25 * Math.sin(6 * Math.PI * hz * t)) / 1.75
      : 0;
    out[i] = audio[i]! + noiseGain * pink[i]! + hum;
  }
  return out;
}
