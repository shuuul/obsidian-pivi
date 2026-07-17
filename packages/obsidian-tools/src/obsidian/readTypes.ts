export { READ_TOOL_MAX_CHARS_CAP as DEFAULT_SAFE_READ_MAX_CHARS } from '@pivi/pivi-agent-core/foundation/usage';

export type ReadMode = 'content' | 'stats';

export interface LineSpan {
  start: number;
  end: number;
}

export interface ReadStats {
  characters: number;
  lines: number;
}
