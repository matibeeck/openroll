import type { InputConverter, OutputConverter } from './types';

/** All input converters, in detection priority order. Filled in by later milestones. */
export const inputConverters: InputConverter[] = [];

/** All output converters. */
export const outputConverters: OutputConverter[] = [];

export function findInputConverter(id: string): InputConverter | undefined {
  return inputConverters.find((c) => c.id === id);
}
