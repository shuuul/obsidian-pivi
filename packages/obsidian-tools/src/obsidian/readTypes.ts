export type ReadMode = 'content' | 'stats';

export interface LineSpan {
  start: number;
  end: number;
}

export interface ReadStats {
  characters: number;
  lines: number;
}
