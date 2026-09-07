import { capToolResultText } from '@pivi/agent/tools';

/** Cap CLI stdout that becomes the next model-visible tool result. */
export function capCliToolOutput(output: string): string {
  return capToolResultText(output, { label: 'cli output' });
}
