import { audioInput } from './inputs/audio';
import { midiInput } from './inputs/midi';
import { musicXmlInput } from './inputs/musicxml';
import { performanceVideoInput } from './inputs/performance-video';
import { midiOutput } from './outputs/midi';
import type { InputConverter, OutputConverter } from './types';

/** All input converters, in detection priority order. Filled in by later milestones. */
export const inputConverters: InputConverter[] = [midiInput, musicXmlInput, audioInput, performanceVideoInput];

/** All output converters. */
export const outputConverters: OutputConverter[] = [midiOutput];

export function findInputConverter(id: string): InputConverter | undefined {
  return inputConverters.find((c) => c.id === id);
}
