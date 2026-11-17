/**
 * Piano audio: Tone.js Sampler with local Salamander samples (CC-BY 3.0), PolySynth fallback.
 * Tone is loaded lazily so it never blocks first paint.
 */
import type * as ToneNS from 'tone';

type Tone = typeof ToneNS;
const SAMPLE_NAMES = [
  'A0',
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((o) => [`C${o}`, `Ds${o}`, `Fs${o}`, `A${o}`]),
  'C8',
];

export interface Piano {
  tone: Tone;
  usingFallback: boolean;
  output: ToneNS.ToneAudioNode;
  noteOn(pitch: number, velocity?: number, when?: number): void;
  noteOff(pitch: number, when?: number): void;
  play(pitch: number, duration: number, velocity?: number, when?: number): void;
  releaseAll(): void;
  now(): number;
}

let pianoPromise: Promise<Piano> | null = null;

export function loadPiano(): Promise<Piano> {
  pianoPromise ??= createPiano();
  return pianoPromise;
}

async function createPiano(): Promise<Piano> {
  const tone = await import('tone');
  const base = new URL('samples/salamander/', document.baseURI).href;
  const urls: Record<string, string> = {};
  for (const n of SAMPLE_NAMES) urls[n.replace('s', '#')] = `${n}.mp3`;
  const volume = new tone.Volume(-4).toDestination();
  let usingFallback = false;
  let inst: ToneNS.Sampler | ToneNS.PolySynth;
  try {
    inst = await new Promise<ToneNS.Sampler>((resolve, reject) => {
      const s = new tone.Sampler({
        urls,
        baseUrl: base,
        release: 1,
        onload: () => resolve(s),
        onerror: reject,
      });
      setTimeout(() => reject(new Error('sample load timeout')), 20000);
    });
  } catch {
    usingFallback = true;
    inst = new tone.PolySynth(tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.8 },
    });
  }
  inst.connect(volume);
  const freq = (p: number) => tone.Frequency(p, 'midi').toFrequency();
  return {
    tone,
    usingFallback,
    output: volume,
    noteOn: (p, v = 0.8, when) => inst.triggerAttack(freq(p), when, v),
    noteOff: (p, when) => inst.triggerRelease(freq(p), when),
    play: (p, d, v = 0.8, when) => inst.triggerAttackRelease(freq(p), Math.max(0.05, d), when, v),
    releaseAll: () => inst.releaseAll(),
    now: () => tone.now(),
  };
}
