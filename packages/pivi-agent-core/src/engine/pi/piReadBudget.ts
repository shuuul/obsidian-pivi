import { READ_TOOL_MAX_CHARS_CAP, type ReadAllowanceReservation } from '../../foundation/usage';

export interface PiReadBudget {
  reserve(requestedMaxChars?: number): ReadAllowanceReservation;
  reset(): void;
}

/** Reserve one turn's read headroom synchronously across sibling tool calls. */
export function createPiReadBudget(resolveAvailableChars: () => number): PiReadBudget {
  let remainingChars: number | null = null;
  // Late settles from an earlier turn must not refund into the current turn's allowance.
  let epoch = 0;
  return {
    reserve(requestedMaxChars) {
      const availableChars = Math.max(0, resolveAvailableChars());
      remainingChars = remainingChars === null
        ? availableChars
        : Math.min(remainingChars, availableChars);
      const requested = requestedMaxChars ?? READ_TOOL_MAX_CHARS_CAP;
      const allocation = Math.min(remainingChars, requested);
      remainingChars -= allocation;
      const reservationEpoch = epoch;
      let settled = false;
      return {
        maxChars: allocation,
        settle(returnedChars) {
          if (settled || reservationEpoch !== epoch) {
            return;
          }
          settled = true;
          // Stats-only and truncated responses return far less than the reservation; charging
          // the full reservation would starve every later read in the turn.
          const refund = Math.max(0, allocation - Math.max(0, returnedChars));
          if (refund > 0 && remainingChars !== null) {
            remainingChars += refund;
          }
        },
      };
    },
    reset() {
      remainingChars = null;
      epoch += 1;
    },
  };
}
