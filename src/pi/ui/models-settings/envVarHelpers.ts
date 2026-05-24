import { parseEnvironmentVariables } from '../../../utils/env';

export function getEnvVarValue(envStr: string, varName: string): string {
  const env = parseEnvironmentVariables(envStr);
  return env[varName] || '';
}

export function setEnvVarValue(envStr: string, varName: string, value: string): string {
  const env = parseEnvironmentVariables(envStr);
  if (value.trim()) {
    env[varName] = value.trim();
  } else {
    delete env[varName];
  }
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}
