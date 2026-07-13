import { parseEnvironmentVariables } from '@pivi/pivi-agent-core/foundation/settingsEnv';
import type { SettingsSubagentsSnapshot } from '@pivi/pivi-react/settings';

import type { PiviPluginWorkspace } from '@/app/hostContracts';

/** Chat/settings ports take an explicit workspace; throw when composition has not wired one. */
export function requireWorkspace(workspace: PiviPluginWorkspace | null): PiviPluginWorkspace {
  if (!workspace) {
    throw new Error('Pivi workspace services are not initialized.');
  }
  return workspace;
}

export function removeEnvVar(envStr: string, name: string): string {
  const env = parseEnvironmentVariables(envStr);
  if (!(name in env)) {
    return envStr;
  }
  delete env[name];
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function normalizeMaxConcurrentSubagents(
  value: number,
): SettingsSubagentsSnapshot['maxConcurrentSubagents'] {
  switch (value) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 8:
      return value;
    default:
      return 2;
  }
}
