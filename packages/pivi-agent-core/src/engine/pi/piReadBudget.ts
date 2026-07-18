import { READ_TOOL_MAX_CHARS_CAP } from '../../foundation/usage';

export interface PiReadBudget {
  reserve(requestedMaxChars?: number): number;
  reset(): void;
}

/** Reserve one turn's read headroom synchronously across sibling tool calls. */
export function createPiReadBudget(resolveAvailableChars: () => number): PiReadBudget {
  let remainingChars: number | null = null;
  return {
    reserve(requestedMaxChars) {
      const availableChars = Math.max(0, resolveAvailableChars());
      remainingChars = remainingChars === null
        ? availableChars
        : Math.min(remainingChars, availableChars);
      const requested = requestedMaxChars ?? READ_TOOL_MAX_CHARS_CAP;
      const allocation = Math.min(remainingChars, requested);
      remainingChars -= allocation;
      return allocation;
    },
    reset() {
      remainingChars = null;
    },
  };
}
