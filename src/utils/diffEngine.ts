import { diffLines } from 'diff';

export interface DiffSegment {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function computeDiff(original: string, modified: string): DiffSegment[] {
  return diffLines(original, modified);
}
