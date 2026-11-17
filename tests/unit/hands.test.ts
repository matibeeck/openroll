import { describe, expect, it } from 'vitest';
import { assignHands, handFromName, MAX_HAND_SPAN, splitHands } from '../../src/core/hands';
import { createScore, type Note } from '../../src/core/score';

function n(pitch: number, start: number, duration = 0.5, track = 0): Note {
  return { pitch, start, duration, velocity: 0.8, hand: null, track };
}

describe('handFromName', () => {
  it.each([
    ['Piano left', 'L'],
    ['Piano right', 'R'],
    ['LH', 'L'],
    ['RH', 'R'],
    ['Piano L.H.', 'L'],
    ['Bass', 'L'],
    ['Treble', 'R'],
    ['Staff 1', 'R'],
    ['staff 2', 'L'],
    ['Mano izquierda', 'L'],
    ['Mano derecha', 'R'],
    ['Piano - Right hand', 'R'],
  ] as const)('%s → %s', (name, hand) => {
    expect(handFromName(name)).toBe(hand);
  });

  it.each(['Piano', 'Track 1', '', 'Acoustic Grand', 'Left and right', 'Chlorophyll'])('%s → undefined', (name) => {
    expect(handFromName(name)).toBeUndefined();
  });
});

describe('assignHands', () => {
  it('uses track names when present', () => {
    const score = createScore({
      notes: [n(40, 0, 0.5, 1), n(72, 0, 0.5, 0), n(65, 1, 0.5, 1), n(50, 1, 0.5, 0)],
      tracks: [{ name: 'RH' }, { name: 'LH' }],
    });
    const out = assignHands(score);
    for (const note of out.notes) expect(note.hand).toBe(note.track === 0 ? 'R' : 'L');
    expect(out.tracks.map((t) => t.hand)).toEqual(['R', 'L']);
  });

  it('respects an explicit TrackInfo.hand over the name', () => {
    const score = createScore({ notes: [n(80, 0)], tracks: [{ name: 'Piano', hand: 'L' }] });
    expect(assignHands(score).notes[0]!.hand).toBe('L');
  });

  it('splits unlabeled tracks at C4 by default and at a custom pitch', () => {
    const score = createScore({ notes: [n(36, 0), n(48, 2), n(72, 4), n(84, 6)] });
    expect(assignHands(score).notes.map((x) => x.hand)).toEqual(['L', 'L', 'R', 'R']);
    // Same notes, split at C6: everything is left hand.
    expect(assignHands(score, { splitPitch: 96 }).notes.map((x) => x.hand)).toEqual(['L', 'L', 'L', 'L']);
  });

  it('labels some tracks by name and splits the rest by pitch', () => {
    const score = createScore({
      notes: [n(80, 0, 0.5, 0), n(40, 0, 0.5, 1), n(70, 0, 0.5, 1)],
      tracks: [{ name: 'Left hand' }, { name: 'Piano' }],
    });
    const out = assignHands(score);
    const byKey = new Map(out.notes.map((x) => [`${x.track}:${x.pitch}`, x.hand]));
    expect(byKey.get('0:80')).toBe('L');
    expect(byKey.get('1:40')).toBe('L');
    expect(byKey.get('1:70')).toBe('R');
  });

  it('keeps a right-hand line that dips just below the split in the right hand (voice continuity)', () => {
    // RH melody E4 D4 C4 B3 A3 C4 while the LH holds C2–G2 below.
    const melody = [64, 62, 60, 59, 57, 60].map((pitch, i) => n(pitch, i * 0.5, 0.45));
    const bass = [n(36, 0, 1.5), n(43, 1.5, 1.5)];
    const out = assignHands(createScore({ notes: [...melody, ...bass] }));
    const hands = out.notes.filter((x) => x.pitch >= 57).map((x) => x.hand);
    expect(hands).toEqual(['R', 'R', 'R', 'R', 'R', 'R']);
    expect(out.notes.filter((x) => x.pitch < 48).every((x) => x.hand === 'L')).toBe(true);
  });

  it('keeps a left-hand line that climbs just above the split in the left hand', () => {
    // LH A3 B3 C4 D4 while the RH plays high G5s.
    const bass = [57, 59, 60, 62].map((pitch, i) => n(pitch, i * 0.5, 0.45));
    const treble = [0, 0.5, 1, 1.5].map((t) => n(79, t, 0.45));
    const out = assignHands(createScore({ notes: [...bass, ...treble] }));
    expect(out.notes.filter((x) => x.pitch < 70).map((x) => x.hand)).toEqual(['L', 'L', 'L', 'L']);
    expect(out.notes.filter((x) => x.pitch === 79).every((x) => x.hand === 'R')).toBe(true);
  });

  it('falls back to the plain split after a long silence', () => {
    // B3 after a C4 phrase but 3 s later: continuity has expired, B3 < C4 → left.
    const out = splitHands([n(64, 0), n(60, 0.5), n(59, 4)]);
    expect(out).toEqual(['R', 'R', 'L']);
  });

  it('never puts a right-hand chord tone below a left-hand tone of the same chord', () => {
    const out = assignHands(createScore({ notes: [n(55, 0), n(59, 0), n(62, 0), n(67, 0)] }));
    const hands = out.notes.map((x) => x.hand);
    const firstR = hands.indexOf('R');
    expect(hands.slice(firstR).every((h) => h === 'R')).toBe(true);
  });

  it('never adds, removes or moves notes', () => {
    const notes = Array.from({ length: 200 }, (_, i) => n(30 + ((i * 37) % 70), (i * 0.13) % 20, 0.2 + (i % 5) * 0.1));
    const score = createScore({ notes });
    const out = assignHands(score);
    expect(out.notes.length).toBe(score.notes.length);
    out.notes.forEach((x, i) => {
      const o = score.notes[i]!;
      expect([x.pitch, x.start, x.duration, x.track]).toEqual([o.pitch, o.start, o.duration, o.track]);
      expect(x.hand === 'L' || x.hand === 'R').toBe(true);
    });
    // Input not mutated.
    expect(score.notes.every((x) => x.hand === null)).toBe(true);
  });
});

describe('splitHands: span and voice leading', () => {
  it('keeps left-hand chords that reach above middle C in the left hand under right-hand octaves', () => {
    // Ballade-like bar: RH C5–C6 octaves; LH A♭2 bass with E♭3–C4 and F3–D♭4 chords.
    const notes = [
      n(72, 0), n(84, 0), n(44, 0), n(51, 0.25), n(60, 0.25), n(51, 0.5), n(60, 0.5),
      n(72, 0.5), n(84, 0.5), n(39, 0.75), n(53, 1), n(61, 1), n(72, 1), n(84, 1), n(53, 1.25), n(61, 1.25),
    ];
    const hands = splitHands(notes);
    notes.forEach((x, i) => expect(hands[i], `${x.pitch}@${x.start}`).toBe(x.pitch >= 72 ? 'R' : 'L'));
  });

  it('never gives one hand more than a ninth when the chord can be split', () => {
    // C3 E3 G3 · E4 G4 C5: 24 semitones; the split gives each hand ≤ 14.
    const chord = [48, 52, 55, 64, 67, 72].map((p) => n(p, 0));
    const hands = splitHands(chord);
    for (const h of ['L', 'R'] as const) {
      const ps = chord.filter((_, i) => hands[i] === h).map((x) => x.pitch);
      if (ps.length) expect(Math.max(...ps) - Math.min(...ps)).toBeLessThanOrEqual(MAX_HAND_SPAN);
    }
  });

  it('lets the right hand take a low note when the left hand is far away and busy', () => {
    // LH bass octave C2/C3 every beat; RH melody G4 F4 E4 D4 C4 B3 C4 (B3 below the split).
    const melody = [67, 65, 64, 62, 60, 59, 60].map((p, i) => n(p, i * 0.5, 0.45));
    const bass = [0, 0.5, 1, 1.5, 2, 2.5, 3].flatMap((t) => [n(36, t, 0.45), n(48, t, 0.45)]);
    const out = assignHands(createScore({ notes: [...melody, ...bass] }));
    expect(out.notes.filter((x) => x.pitch >= 59).every((x) => x.hand === 'R')).toBe(true);
    expect(out.notes.filter((x) => x.pitch <= 48).every((x) => x.hand === 'L')).toBe(true);
  });
});
