import { getPiAgentSettings } from '@pivi/agent/settings/agentSettings';
import type { AppModelTestResult } from '@pivi/agent/settings/modelReadiness';

import { testProviderReadiness } from './providerReadiness';

export async function runPiProviderReadinessTest(
  providerId: string,
  settings: Record<string, unknown>,
): Promise<AppModelTestResult> {
  return testProviderReadiness(providerId, getPiAgentSettings(settings));
}
