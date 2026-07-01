let piAgentBootstrapped = false;

/** Legacy no-op kept while tests migrate away from static agent bootstrap. */
export function ensurePiAgentBootstrapped(): void {
  if (piAgentBootstrapped) {
    return;
  }
  piAgentBootstrapped = true;
}
