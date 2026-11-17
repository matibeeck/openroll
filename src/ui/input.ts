/** Note input sources: Web MIDI, computer keyboard. Both call the same handlers. */
export interface NoteHandlers {
  onNoteOn(pitch: number, velocity: number): void;
  onNoteOff(pitch: number): void;
}

export type MidiStatus = { kind: 'unsupported' } | { kind: 'none' } | { kind: 'connected'; name: string };

export async function connectMidi(h: NoteHandlers, onStatus: (s: MidiStatus) => void): Promise<() => void> {
  if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
    onStatus({ kind: 'unsupported' });
    return () => {};
  }
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    onStatus({ kind: 'none' });
    return () => {};
  }
  const onMessage = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 3) return;
    const cmd = d[0]! & 0xf0;
    if (cmd === 0x90 && d[2]! > 0) h.onNoteOn(d[1]!, d[2]! / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) h.onNoteOff(d[1]!);
  };
  const bind = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      names.push(input.name ?? 'MIDI');
    });
    onStatus(names.length ? { kind: 'connected', name: names.join(', ') } : { kind: 'none' });
  };
  bind();
  access.onstatechange = bind;
  return () => {
    access.onstatechange = null;
    access.inputs.forEach((i) => (i.onmidimessage = null));
  };
}

/** Computer keyboard: home row = white keys from C, upper row = black keys. Z/X shift octaves. */
const KEYMAP: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
};

export function connectComputerKeyboard(h: NoteHandlers, target: Window = window): () => void {
  let octave = 4;
  const held = new Map<string, number>();
  const down = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'z') octave = Math.max(1, octave - 1);
    else if (k === 'x') octave = Math.min(7, octave + 1);
    else if (k in KEYMAP && !held.has(k)) {
      const pitch = 12 * (octave + 1) + KEYMAP[k]!;
      held.set(k, pitch);
      h.onNoteOn(pitch, 0.8);
    }
  };
  const up = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const p = held.get(k);
    if (p !== undefined) {
      held.delete(k);
      h.onNoteOff(p);
    }
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
  };
}
