import type { DeviceLocalProviderStateV1 } from '@pivi/pivi-agent-core/foundation';

type ProviderRegistration = DeviceLocalProviderStateV1['providers'][number];

/** Resolves the enabled registration whose exact id prefixes the active model key. */
export function activeProviderId(state: DeviceLocalProviderStateV1 | null | undefined): string | null {
  const model = state?.modelPreferences.activeModel.trim() ?? '';
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) return null;
  const prefix = model.slice(0, slash);
  return state?.providers.find(registration => !registration.disabled && registration.id === prefix)?.id ?? null;
}

export function isMobileRemoteProvider(registration: ProviderRegistration): boolean {
  if (registration.type === 'builtin') {
    return !['openai-codex', 'grok-build', 'claude'].includes(registration.id);
  }
  if (['ollama', 'lmstudio', 'llama-cpp'].includes(registration.config.kind)) return false;
  try {
    const url = new URL(registration.config.baseUrl);
    return url.protocol === 'https:' && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return isLocalIpv4(ipv4);
  const ipv6 = parseIpv6(hostname);
  if (!ipv6) return false;
  if (ipv6.every(part => part === 0) || ipv6.slice(0, 7).every(part => part === 0) && ipv6[7] === 1) return true;
  if ((ipv6[0]! & 0xfe00) === 0xfc00 || (ipv6[0]! & 0xffc0) === 0xfe80) return true;
  if (ipv6.slice(0, 5).every(part => part === 0) && ipv6[5] === 0xffff) {
    return isLocalIpv4([ipv6[6]! >> 8, ipv6[6]! & 0xff, ipv6[7]! >> 8, ipv6[7]! & 0xff]);
  }
  return false;
}

function parseIpv4(value: string): number[] | null {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts : null;
}

function isLocalIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
    || (a === 100 && b! >= 64 && b! <= 127);
}

function parseIpv6(value: string): number[] | null {
  if (!value.includes(':') || value.includes('%')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const result: number[] = [];
    for (const token of half.split(':')) {
      const ipv4 = parseIpv4(token);
      if (ipv4) result.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
      else if (/^[0-9a-f]{1,4}$/i.test(token)) result.push(Number.parseInt(token, 16));
      else return null;
    }
    return result;
  };
  const left = parseHalf(halves[0]!);
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const zeros = 8 - left.length - right.length;
  return zeros >= 1 ? [...left, ...Array<number>(zeros).fill(0), ...right] : null;
}
