import { bootstrapPiAgent } from '../src/pi/bootstrap';

let piAgentBootstrapped = false;

/** Register Pi adaptor once per Jest worker (idempotent). */
export function ensurePiAgentBootstrapped(): void {
  if (piAgentBootstrapped) {
    return;
  }
  bootstrapPiAgent();
  piAgentBootstrapped = true;
}
