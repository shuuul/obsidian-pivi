export const DEFAULT_SAFE_READ_MAX_CHARS = 20_000;

export type ReadMode = 'content' | 'stats';

export interface LineSpan {
  start: number;
  end: number;
}

export interface ReadStats {
  characters: number;
  lines: number;
}
